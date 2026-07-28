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

// === INTÉGRATION ADK — CŒUR DU WORKFLOW ===
//
// Ce fichier est le point central où l'Agent Development Kit (ADK) de Google
// est utilisé pour orchestrer la génération du livre. Trois briques ADK
// interviennent ici :
//   1. `LlmAgent`  — défini dans agents/*.ts, c'est la config d'un agent
//                    (modèle, instructions, éventuellement un schéma de sortie).
//   2. `Runner`    — exécute un `LlmAgent` : il envoie le prompt au modèle
//                    (Gemini) et retourne un flux d'`Event` (deltas de texte,
//                    appels d'outils, erreurs...).
//   3. `SessionService` — stocke l'historique de conversation entre les tours.
//                    Ici on utilise `InMemorySessionService` (en RAM, perdu au
//                    redémarrage) et on crée/supprime une session jetable à
//                    chaque appel, puisqu'on n'a pas besoin de mémoriser quoi
//                    que ce soit entre deux générations de livre.

const APP_NAME = "story-book-workflow";
const USER_ID = "story-book-user";

/** Matches the `concurrency: 10` the Mastra `.foreach` step used. */
const CHAPTER_CONCURRENCY = 10;

// Le SessionService est partagé par toute l'app : il ne fait que gérer des
// sessions vides et jetables, donc aucun risque à le garder en module-scope.
const sessionService = new InMemorySessionService();

// Un `Runner` = un agent + un service de session. On en crée un par agent
// (planificateur / rédacteur) et on les réutilise pour chaque requête HTTP.
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

// Un `Event` ADK représente un tour du modèle. Son `content.parts` est une
// liste de morceaux (texte, appel d'outil, réponse d'outil...) — ici on ne
// s'intéresse qu'au texte, donc on concatène uniquement les `part.text`.
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
  // Une session ADK = un identifiant de conversation. Comme chaque appel est
  // indépendant (pas de suivi de dialogue), on en crée une, on l'utilise une
  // fois, puis on la détruit dans le `finally`.
  const session = await sessionService.createSession({
    appName: APP_NAME,
    userId: USER_ID,
  });

  let accumulated = "";

  try {
    // `runner.runAsync(...)` est l'appel ADK qui déclenche réellement la
    // requête au modèle Gemini et retourne un `AsyncGenerator<Event>`.
    // `runConfig.streamingMode: SSE` demande à ADK de streamer les deltas de
    // texte au fur et à mesure plutôt que d'attendre la réponse complète.
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

      // `event.partial === true` → c'est un delta (fragment) à ajouter au
      // texte déjà reçu. `event.partial === false/undefined` → c'est
      // l'événement final du tour, qui contient le texte complet et
      // remplace donc le buffer accumulé (au lieu de le concaténer).
      if (event.partial) accumulated += text;
      else accumulated = text;

      yield { text: accumulated, done: !event.partial };
    }
  } finally {
    // Nettoyage systématique de la session jetable, même en cas d'erreur ou
    // d'annulation (abortSignal).
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

  // On utilise le `plannerRunner`, dont l'agent (chapter-planner-agent.ts)
  // a un `outputSchema` : ADK force donc Gemini à répondre en JSON strict.
  // Comme le JSON arrive par fragments, `parsePartialJson` tente de le
  // parser à chaque delta, même incomplet, pour afficher le plan au fur et
  // à mesure côté UI.
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

  // Même mécanique que planChapters, mais avec le `writerRunner` (agent sans
  // outputSchema) : ici le texte streamé est directement de la prose, pas du
  // JSON à parser.
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
 *
 * Publishing is deliberately not part of this: the reader chooses a destination
 * once the book exists, and `src/adk/publishing/` handles it from there.
 */
export async function runStoryWorkflow(
  options: RunStoryWorkflowOptions,
): Promise<StoryResult> {
  const { writer, abortSignal } = options;

  // Étape 1 (ADK) : le `plannerRunner` génère le plan du livre (titre +
  // structure des chapitres) via Gemini, en streaming JSON.
  const plan = await planChapters(options);

  // Étape 2 (ADK) : le `writerRunner` rédige chaque chapitre. Chaque appel à
  // `writeChapter` crée sa propre session ADK jetable (voir streamAgentText),
  // donc les chapitres peuvent tourner en parallèle sans se marcher dessus —
  // au plus `CHAPTER_CONCURRENCY` (10) en même temps.
  const chapters = await mapWithConcurrency(
    plan.chapters,
    CHAPTER_CONCURRENCY,
    (chapter) => writeChapter(chapter, writer, abortSignal),
  );

  // Note : aucune connexion MCP ici. La publication (Notion / Google Docs,
  // qui elle utilise MCP) n'est déclenchée qu'après, à la demande de
  // l'utilisateur — voir src/adk/publishing/publish.ts.
  return {
    storyTitle: plan.storyTitle,
    chapters,
    totalChapters: chapters.length,
  };
}
