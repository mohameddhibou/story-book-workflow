import {
  FunctionTool,
  InMemorySessionService,
  LlmAgent,
  MCPSessionManager,
  MCPToolset,
  Runner,
} from "@google/adk";
import { z } from "zod";

import type {
  PublishEventData,
  PublishToolCall,
  PublishableStory,
} from "@/src/types/story-workflow";

import { PUBLISHER_MODEL } from "../models";
import { buildBookMarkdown } from "./book-markdown";
import { googleDocsTarget } from "./google-docs";
import { notionTarget } from "./notion";
import type { PublishTarget, PublishTargetId } from "./types";

// === CONNEXION MCP — CŒUR DE LA PUBLICATION ===
//
// Ce fichier est l'endroit où le Model Context Protocol (MCP) est branché à
// un agent ADK. Deux briques MCP de la librairie `@google/adk` interviennent :
//
//   - `MCPToolset`        : se connecte à un serveur MCP (ici Notion ou
//                            Google Docs, voir ./notion.ts et ./google-docs.ts),
//                            liste ses outils, et les transforme en outils
//                            utilisables par un `LlmAgent`. C'est elle qui
//                            permet au modèle de "voir" et d'appeler les
//                            outils MCP tout seul.
//   - `MCPSessionManager` : connexion MCP "manuelle", sans passer par un
//                            agent — utilisée ici pour un seul appel précis
//                            (`callTargetTool`), déclenché par notre code et
//                            non par le modèle (voir plus bas pourquoi).
//
// Chaque `PublishTarget` (notion.ts / google-docs.ts) expose une méthode
// `connectionParams()` qui décrit COMMENT se connecter au serveur MCP
// (ici toujours en `StdioConnectionParams`, c'est-à-dire en lançant le
// serveur MCP comme un processus enfant local et en communiquant par
// entrée/sortie standard — voir ces fichiers pour le détail).

const APP_NAME = "story-book-publisher";
const USER_ID = "story-book-user";

const sessionService = new InMemorySessionService();

const TARGETS: Record<PublishTargetId, PublishTarget> = {
  notion: notionTarget,
  "google-docs": googleDocsTarget,
};

export function getPublishTarget(id: PublishTargetId): PublishTarget {
  return TARGETS[id];
}

/** Which destinations the server is actually able to publish to right now. */
export function configuredTargets(): PublishTargetId[] {
  return (Object.keys(TARGETS) as PublishTargetId[]).filter((id) =>
    TARGETS[id].isConfigured(),
  );
}

/**
 * Detects a failed MCP tool call.
 *
 * The Notion server reports API failures in the response body rather than
 * setting MCP's `isError` flag, so a 401 arrives as an ordinary result — check
 * for its error envelope too. Inner JSON is escaped, hence the optional
 * backslashes.
 */
function isFailedToolResponse(serialized: string): boolean {
  return (
    /\\?"isError\\?"\s*:\s*true/.test(serialized) ||
    /\\?"object\\?"\s*:\s*\\?"error\\?"/.test(serialized) ||
    /\\?"error\\?"\s*:\s*\\?"/.test(serialized) ||
    /\\?"status\\?"\s*:\s*[45]\d\d/.test(serialized)
  );
}

/**
 * Calls one MCP tool directly, bypassing the model.
 *
 * Used for the single call whose argument is the entire book: routing 10k+
 * tokens of prose back through Gemini would be slow, expensive, and — worse —
 * the model would quietly paraphrase it.
 */
async function callTargetTool(
  target: PublishTarget,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  // Ici, PAS de `MCPToolset` ni de `LlmAgent` : c'est une connexion MCP brute
  // et éphémère. `MCPSessionManager` ouvre une session MCP directement vers
  // le serveur (via `target.connectionParams()`), on appelle UN outil précis
  // par son nom (`client.callTool`), puis on ferme la session. Le modèle
  // Gemini n'est jamais impliqué dans cet appel : c'est notre code qui pousse
  // directement le texte du livre vers l'outil MCP, sans passer par le LLM.
  const manager = new MCPSessionManager(target.connectionParams());
  const client = await manager.createSession();

  try {
    return JSON.stringify(await client.callTool({ name, arguments: args }));
  } finally {
    await manager.closeSession(client);
  }
}

// Construit l'agent ADK qui va piloter la publication. Il reçoit le
// `toolset` MCP déjà connecté (voir publishStory ci-dessous) ainsi qu'un
// outil "maison" (`publishBookContent`) qui, lui, n'est pas un outil MCP
// mais un `FunctionTool` ADK classique.
function createPublisherAgent(
  target: PublishTarget,
  story: PublishableStory,
  toolset: MCPToolset,
  onContentUrl: (url: string) => void,
): LlmAgent {
  const bookMarkdown = buildBookMarkdown(story);

  // `publish_book_content` est l'outil que le modèle appelle pour écrire le
  // livre. Techniquement ce n'est PAS un outil MCP exposé directement au
  // modèle : c'est un `FunctionTool` ADK normal, dont l'implémentation
  // (`execute`) appelle elle-même un outil MCP via `callTargetTool`
  // (connexion MCP manuelle décrite plus haut). Le modèle ne fournit que
  // l'identifiant du document (`container_id`) — jamais le texte du livre,
  // qui est injecté directement par notre code (`bookMarkdown` en closure).
  const publishBookContent = new FunctionTool({
    name: "publish_book_content",
    description:
      `Writes the full text of the finished book into the ${target.label} ` +
      "document you just created. Call this once. The book content is supplied " +
      "automatically — you only provide the id.",
    parameters: z.object({
      container_id: z.string().describe(target.containerIdDescription),
    }),
    execute: async ({ container_id }) => {
      const response = await callTargetTool(
        target,
        target.contentTool,
        target.contentToolArgs(container_id, bookMarkdown),
      );

      if (isFailedToolResponse(response)) {
        throw new Error(`${target.contentTool} failed: ${response.slice(0, 300)}`);
      }

      // Google Docs returns the URL here rather than at creation time.
      const url = target.extractUrl(response);
      if (url) onContentUrl(url);

      return {
        ok: true,
        charactersWritten: bookMarkdown.length,
        chapters: story.totalChapters,
      };
    },
  });

  return new LlmAgent({
    name: "book-publisher-agent",
    model: PUBLISHER_MODEL,
    // `tools: [toolset, publishBookContent]` — c'est ICI que le `MCPToolset`
    // est branché à l'agent ADK. En lui passant le toolset, l'agent expose
    // au modèle Gemini TOUS les outils MCP découverts sur le serveur (filtrés
    // par `target.toolFilter`, ex. "API-post-page" pour Notion), en plus de
    // l'outil maison `publishBookContent`. Le modèle choisit lui-même quel
    // outil appeler et dans quel ordre, en suivant les instructions ci-dessous.
    tools: [toolset, publishBookContent],
    disallowTransferToParent: true,
    disallowTransferToPeers: true,
    instruction: `You publish finished books to ${target.label}. Work through these steps in order and do not skip any.

${target.instruction(story)}

Finally, reply with one short sentence confirming the book was published, including its URL.

Never attempt to write the chapter prose yourself; publish_book_content already has it.`,
  });
}

/**
 * Publishes a finished book, yielding progress as it goes.
 *
 * This is the genuinely agent-driven part of the app: the model discovers the
 * destination's tools over MCP and decides how to create the document, rather
 * than following hard-coded orchestration. Every tool call is yielded so the UI
 * can show the MCP round-trips as they happen.
 */
export async function* publishStory(
  targetId: PublishTargetId,
  story: PublishableStory,
  abortSignal?: AbortSignal,
): AsyncGenerator<PublishEventData> {
  const target = TARGETS[targetId];

  if (!target) {
    yield {
      target: targetId,
      status: "failed",
      toolCalls: [],
      message: `Unknown publish target "${targetId}".`,
    };
    return;
  }

  if (!target.isConfigured()) {
    yield {
      target: targetId,
      status: "skipped",
      toolCalls: [],
      message: target.missingConfigMessage,
    };
    return;
  }

  const toolCalls: PublishToolCall[] = [];
  let documentUrl: string | undefined;

  const frame = (
    status: PublishEventData["status"],
    message?: string,
  ): PublishEventData => ({
    target: targetId,
    status,
    // Copied so each streamed frame is a distinct object for React.
    toolCalls: toolCalls.map((call) => ({ ...call })),
    documentUrl,
    message,
  });

  yield frame("publishing");

  let toolset: MCPToolset | undefined;
  let sessionId: string | undefined;

  try {
    // *** LA CONNEXION MCP SE FAIT ICI ***
    // `new MCPToolset(target.connectionParams(), target.toolFilter)` :
    //   - `target.connectionParams()` décrit comment lancer/joindre le
    //     serveur MCP (commande à exécuter, variables d'env comme le token
    //     Notion ou les identifiants Google...).
    //   - `target.toolFilter` restreint les outils exposés au modèle (ex. on
    //     ne donne PAS accès à tous les outils Notion, seulement à ceux
    //     nécessaires pour créer une page).
    // À ce stade, aucune requête n'est encore partie : la connexion et la
    // découverte des outils se font au premier usage par le `Runner`.
    toolset = new MCPToolset(target.connectionParams(), target.toolFilter);

    const session = await sessionService.createSession({
      appName: APP_NAME,
      userId: USER_ID,
    });
    sessionId = session.id;

    // Le `Runner` ADK reçoit l'agent construit par `createPublisherAgent`,
    // qui embarque le `toolset` MCP. C'est la même mécanique Runner que dans
    // story-workflow.ts, mais cette fois l'agent peut appeler des outils
    // externes (MCP) en plus de générer du texte.
    const runner = new Runner({
      appName: APP_NAME,
      agent: createPublisherAgent(target, story, toolset, (url) => {
        documentUrl ??= url;
      }),
      sessionService,
    });

    for await (const event of runner.runAsync({
      userId: USER_ID,
      sessionId: session.id,
      newMessage: {
        role: "user",
        parts: [{ text: `Publish "${story.storyTitle}" to ${target.label}.` }],
      },
      abortSignal,
    })) {
      if (event.errorMessage) {
        throw new Error(event.errorMessage);
      }

      // Tool calls only land on complete events; partials would double-count.
      if (event.partial) continue;

      // Un `Event` ADK peut contenir soit un `functionCall` (le modèle
      // demande à appeler un outil — MCP ou non), soit un `functionResponse`
      // (le résultat renvoyé après exécution de cet outil). On traduit ces
      // deux cas en frames `PublishEventData` streamées vers le client, pour
      // que l'UI affiche en direct "Notion: création de la page... ✅".
      for (const part of event.content?.parts ?? []) {
        if (part.functionCall?.name) {
          toolCalls.push({ name: part.functionCall.name, status: "running" });
          yield frame("publishing");
        }

        const response = part.functionResponse;
        if (!response?.name) continue;

        const serialized = JSON.stringify(response.response ?? null);
        const failed = isFailedToolResponse(serialized);

        const pending = [...toolCalls]
          .reverse()
          .find(
            (call) => call.name === response.name && call.status === "running",
          );
        if (pending) pending.status = failed ? "failed" : "completed";

        documentUrl ??= target.extractUrl(serialized);
        yield frame("publishing");
      }
    }

    const failures = toolCalls.filter((call) => call.status === "failed");
    yield failures.length
      ? frame(
          "failed",
          `${target.label} rejected ${failures
            .map((call) => call.name)
            .join(", ")}. ${target.missingConfigMessage}`,
        )
      : frame("completed");
  } catch (error) {
    yield frame(
      "failed",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    // On ferme la connexion MCP (`toolset.close()`) et la session ADK dans
    // tous les cas — succès, erreur ou annulation — pour ne jamais laisser
    // le processus serveur MCP tourner en arrière-plan.
    await toolset?.close();
    if (sessionId) {
      await sessionService.deleteSession({
        appName: APP_NAME,
        userId: USER_ID,
        sessionId,
      });
    }
  }
}
