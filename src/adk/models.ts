/**
 * Gemini model IDs used by the story agents.
 *
 * Defaults use the `-latest` aliases so they keep resolving as Google rotates
 * the underlying Gemini 3.x Flash releases. Pin an exact ID (e.g.
 * `gemini-3.5-flash`) via env when you want reproducible output.
 */
export const PLANNER_MODEL = process.env.GEMINI_PLANNER_MODEL ?? "gemini-flash-latest";

export const WRITER_MODEL = process.env.GEMINI_WRITER_MODEL ?? "gemini-flash-latest";

/** Drives the Notion MCP tools, so it needs reliable multi-step tool calling. */
export const PUBLISHER_MODEL =
  process.env.GEMINI_PUBLISHER_MODEL ?? "gemini-flash-latest";
