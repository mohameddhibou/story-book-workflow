import type { StdioConnectionParams } from "@google/adk";

import type { PublishableStory } from "@/src/types/story-workflow";

export type PublishTargetId = "notion" | "google-docs";

/**
 * Everything that differs between publishing destinations.
 *
 * Both targets follow the same shape: the model drives discovery and container
 * creation over MCP, then calls one local tool that our code fulfils with the
 * book's prose. Only the tool names, arguments and instructions change.
 */
export interface PublishTarget {
  id: PublishTargetId;
  /** Shown on the publish button. */
  label: string;

  /** False when the required env vars are absent; publishing is then offered but refused politely. */
  isConfigured(): boolean;
  /** Explains what to set when `isConfigured()` is false. */
  missingConfigMessage: string;

  /** How to launch the MCP server for this target. */
  connectionParams(): StdioConnectionParams;
  /** MCP tools the model is allowed to call directly. */
  toolFilter: string[];

  /** The MCP tool our code calls with the full book, bypassing the model. */
  contentTool: string;
  /** Builds that tool's arguments. `containerId` is the page/document id. */
  contentToolArgs(containerId: string, markdown: string): Record<string, unknown>;
  /** Describes the id the model must pass to `publish_book_content`. */
  containerIdDescription: string;

  /** The agent's step-by-step instructions for this destination. */
  instruction(story: PublishableStory): string;

  /** Pulls the finished document's URL out of a serialized MCP response. */
  extractUrl(serialized: string): string | undefined;
}
