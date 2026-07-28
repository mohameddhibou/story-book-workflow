import {
  InMemorySessionService,
  Runner,
  StreamingMode,
  type Event,
} from "@google/adk";

import { parsePartialJson } from "@/src/lib/partial-json";
import {
  type ChapterContent,
  type ChapterContentEventData,
  type ChapterGenerationEventData,
  type ChapterInfo,
  type StoryPlan,
  type StoryResult,
} from "@/src/types/story-workflow";

import { chapterPlannerAgent } from "./agents/chapter-planner-agent";
import { chapterWriterAgent } from "./agents/chapter-writer-agent";

const APP_NAME = "story-book-workflow";
const USER_ID = "story-book-user";

/** Matches the `concurrency: 10` the Mastra `.foreach` step used. */
const CHAPTER_CONCURRENCY = 10;

// Sessions are created and deleted per run, so these are safe to share.
const sessionService = new InMemorySessionService();

const plannerRunner = new Runner({
  appName: APP_NAME,
  agent: chapterPlannerAgent,
  sessionService,
});

const writerRunner = new Runner({
  appName: APP_NAME,
  agent: chapterWriterAgent,
  sessionService,
});

/** The subset of the AI SDK stream writer this workflow needs. */
export interface StoryStreamWriter {
  write(
    part:
      | {
          type: "data-chapter-generation";
          id: string;
          data: ChapterGenerationEventData;
        }
      | {
          type: "data-chapter-content-generation";
          id: string;
          data: ChapterContentEventData;
        },
  ): void;
}

export interface RunStoryWorkflowOptions {
  storyIdea: string;
  numberOfChapters: number;
  writer: StoryStreamWriter;
  abortSignal?: AbortSignal;
}

function textOf(event: Event): string {
  return (
    event.content?.parts
      ?.map((part) => part.text ?? "")
      .join("") ?? ""
  );
}

/**
 * Runs an agent in a throwaway session and yields the text as it accumulates.
 *
 * ADK emits deltas on `partial` events and a single aggregated event at the end
 * of the turn, so partials are appended and a final event replaces the buffer.
 */
async function* streamAgentText(
  runner: Runner,
  prompt: string,
  abortSignal?: AbortSignal,
): AsyncGenerator<{ text: string; done: boolean }> {
  const session = await sessionService.createSession({
    appName: APP_NAME,
    userId: USER_ID,
  });

  let accumulated = "";

  try {
    for await (const event of runner.runAsync({
      userId: USER_ID,
      sessionId: session.id,
      newMessage: { role: "user", parts: [{ text: prompt }] },
      runConfig: { streamingMode: StreamingMode.SSE },
      abortSignal,
    })) {
      if (event.errorMessage) {
        throw new Error(
          `${event.author ?? "agent"} failed: ${event.errorMessage}`,
        );
      }

      const text = textOf(event);
      if (!text) continue;

      if (event.partial) accumulated += text;
      else accumulated = text;

      yield { text: accumulated, done: !event.partial };
    }
  } finally {
    await sessionService.deleteSession({
      appName: APP_NAME,
      userId: USER_ID,
      sessionId: session.id,
    });
  }
}

/**
 * Step 1 — plan the story. Streams the outline as it is written so the UI can
 * render chapters progressively.
 */
async function planChapters({
  storyIdea,
  numberOfChapters,
  writer,
  abortSignal,
}: RunStoryWorkflowOptions): Promise<StoryPlan> {
  const prompt = `Create a ${numberOfChapters}-chapter story plan for the following:

      <story_idea>${storyIdea}</story_idea>

      <rules>
      First, create a compelling story title.

      For each chapter provide:
      1. Chapter number (starting from 1)
      2. Chapter title
      3. Premise (2-3 sentences describing what happens)
      4. Main characters involved
      5. Setting/location
      6. Emotional tone
      7. Key events (3-5 bullet points)
      8. How it connects to the overall story arc
      9. Ensure the chapters flow naturally and build a complete narrative arc.
      </rules>
`;

  let plan: Partial<StoryPlan> = {};

  for await (const { text } of streamAgentText(
    plannerRunner,
    prompt,
    abortSignal,
  )) {
    const partial = parsePartialJson<Partial<StoryPlan>>(text);
    if (!partial) continue;

    plan = partial;
    writer.write({
      id: "chapter-generation",
      type: "data-chapter-generation",
      data: { status: "streaming", content: partial },
    });
  }

  if (!plan.chapters?.length) {
    throw new Error("The chapter planner did not return any chapters.");
  }

  writer.write({
    id: "chapter-generation",
    type: "data-chapter-generation",
    data: { status: "completed", content: plan },
  });

  return plan as StoryPlan;
}

/** Step 2 — write one chapter, streaming its prose. */
async function writeChapter(
  chapter: ChapterInfo,
  writer: StoryStreamWriter,
  abortSignal?: AbortSignal,
): Promise<ChapterContent> {
  const {
    chapterNumber,
    title,
    premise,
    characters,
    setting,
    emotionalTone,
    keyEvents,
    storyConnection,
  } = chapter;

  const prompt = `Write Chapter ${chapterNumber} with the following details:

<chapter_title>${title}</chapter_title>

<premise>${premise}</premise>

<context>
- Characters involved: ${characters.join(", ")}
- Setting/Location: ${setting}
- Emotional tone: ${emotionalTone}
- Key events to include: ${keyEvents.join("; ")}
- Connection to overall story: ${storyConnection}
</context>

<rules>
1. Please write an engaging chapter (800-1500 words) that brings this premise to life.
2. Always output in markdown format.
3. Avoid saying "Chapter ${chapterNumber}" in the content.
</rules>
`;

  const id = `chapter-${chapterNumber}-content`;
  let content = "";

  for await (const { text } of streamAgentText(
    writerRunner,
    prompt,
    abortSignal,
  )) {
    content = text;
    writer.write({
      id,
      type: "data-chapter-content-generation",
      data: { status: "streaming", content, chapterNumber, title },
    });
  }

  writer.write({
    id,
    type: "data-chapter-content-generation",
    data: { status: "completed", content, chapterNumber, title },
  });

  return { chapterNumber, title, premise, content };
}

/** Runs `task` over `items` with at most `limit` in flight, preserving order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await task(items[index]);
      }
    },
  );

  await Promise.all(workers);
  return results;
}

/**
 * Plans a story, then writes every chapter in parallel — the ADK equivalent of
 * the Mastra `.then(plan).foreach(write, { concurrency: 10 })` workflow.
 */
export async function runStoryWorkflow(
  options: RunStoryWorkflowOptions,
): Promise<StoryResult> {
  const { writer, abortSignal } = options;

  const plan = await planChapters(options);

  const chapters = await mapWithConcurrency(
    plan.chapters,
    CHAPTER_CONCURRENCY,
    (chapter) => writeChapter(chapter, writer, abortSignal),
  );

  return {
    storyTitle: plan.storyTitle,
    chapters,
    totalChapters: chapters.length,
  };
}
