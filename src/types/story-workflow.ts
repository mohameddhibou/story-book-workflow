import { z } from "zod";
import { UIMessage } from "ai";

export const chapterInfoSchema = z.object({
  chapterNumber: z.number(),
  title: z.string(),
  premise: z.string(),
  characters: z.array(z.string()),
  setting: z.string(),
  emotionalTone: z.string(),
  keyEvents: z.array(z.string()),
  storyConnection: z.string(),
});

export const storyPlanSchema = z.object({
  storyTitle: z.string(),
  chapters: z.array(chapterInfoSchema),
});

export const chapterContentSchema = z.object({
  chapterNumber: z.number(),
  title: z.string(),
  premise: z.string(),
  content: z.string(),
});

export const storyResultSchema = z.object({
  storyTitle: z.string(),
  chapters: z.array(chapterContentSchema),
  totalChapters: z.number(),
});

export const workflowInputSchema = z.object({
  storyIdea: z.string().describe("The story idea or concept"),
  numberOfChapters: z
    .number()
    .default(3)
    .describe("Number of chapters to generate"),
});

export const workflowStateSchema = z.object({
  storyTitle: z.string(),
});

export type ChapterInfo = z.infer<typeof chapterInfoSchema>;
export type StoryPlan = z.infer<typeof storyPlanSchema>;
export type ChapterContent = z.infer<typeof chapterContentSchema>;
export type StoryResult = z.infer<typeof storyResultSchema>;
export type WorkflowState = z.infer<typeof workflowStateSchema>;
export type StreamingStatus = "streaming" | "completed";

export interface ChapterGenerationEventData {
  status: StreamingStatus;
  content: Partial<StoryPlan> | StoryPlan;
}

export interface ChapterContentEventData {
  status: StreamingStatus;
  content: string;
  chapterNumber: number;
  title: string;
}

/**
 * What publishing actually needs from a finished book.
 *
 * Narrower than `storyResultSchema` on purpose: the client reassembles this
 * from the stream, where chapters carry no `premise`, and the published
 * markdown never uses one. `StoryResult` satisfies this shape.
 */
export const publishableStorySchema = z.object({
  storyTitle: z.string(),
  chapters: z.array(
    z.object({
      chapterNumber: z.number(),
      title: z.string(),
      content: z.string(),
    }),
  ),
  totalChapters: z.number(),
});

export type PublishableStory = z.infer<typeof publishableStorySchema>;

export type PublishTargetId = "notion" | "google-docs";

/** One MCP tool invocation, surfaced so the UI can show the agent's work. */
export interface PublishToolCall {
  /** The MCP tool name, e.g. `API-post-page` or `create_google_doc`. */
  name: string;
  status: "running" | "completed" | "failed";
}

export interface PublishEventData {
  target: PublishTargetId;
  status: "publishing" | "completed" | "failed" | "skipped";
  toolCalls: PublishToolCall[];
  /** Set once the published page or document exists. */
  documentUrl?: string;
  /** Failure reason, or why the target was unavailable. */
  message?: string;
}

export type StoryWorkflowUIMessage = UIMessage<
  unknown,
  {
    "chapter-generation": ChapterGenerationEventData;
    "chapter-content-generation": ChapterContentEventData;
    "number-of-chapters": { count: number };
  }
>;
