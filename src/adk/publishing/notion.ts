import { createRequire } from "node:module";
import path from "node:path";

import type { StdioConnectionParams } from "@google/adk";

import type { PublishTarget } from "./types";

/**
 * Publishes through the official Notion MCP server
 * (`@notionhq/notion-mcp-server`), spawned as a local child process over stdio.
 */

function serverEntry(): string {
  const override = process.env.NOTION_MCP_ENTRY;
  if (override) return override;

  // No `exports` field on the package, so the deep path resolves directly.
  try {
    return createRequire(import.meta.url).resolve(
      "@notionhq/notion-mcp-server/bin/cli.mjs",
    );
  } catch {
    // Next may relocate server chunks; fall back to the project's node_modules.
    return path.join(
      process.cwd(),
      "node_modules/@notionhq/notion-mcp-server/bin/cli.mjs",
    );
  }
}

export const notionTarget: PublishTarget = {
  id: "notion",
  label: "Notion",

  isConfigured: () => Boolean(process.env.NOTION_TOKEN),
  missingConfigMessage:
    "Set NOTION_TOKEN in .env, then share a Notion page with the integration.",

  connectionParams(): StdioConnectionParams {
    const token = process.env.NOTION_TOKEN;
    if (!token) throw new Error("NOTION_TOKEN is not set.");

    return {
      type: "StdioConnectionParams",
      serverParams: {
        // process.execPath rather than `npx`, so no network round-trip and no
        // shell resolution differences on Windows.
        command: process.execPath,
        args: [serverEntry()],
        env: { ...process.env, NOTION_TOKEN: token } as Record<string, string>,
      },
      timeout: 60_000,
    };
  },

  toolFilter: ["API-post-search", "API-post-page"],

  contentTool: "API-update-page-markdown",
  contentToolArgs: (pageId, markdown) => ({
    page_id: pageId,
    type: "replace_content",
    replace_content: { new_str: markdown },
  }),
  containerIdDescription: "The id of the Notion page returned by API-post-page.",

  instruction(story) {
    const parentPageId = process.env.NOTION_PARENT_PAGE_ID;
    const locateParent = parentPageId
      ? `Use "${parentPageId}" as the parent page id. Do not search.`
      : `Call API-post-search with an empty query and filter {"value":"page","property":"object"} to list pages the integration can access, then pick the first result as the parent page.`;

    return `1. Find the parent page. ${locateParent}

2. Create the book's page with API-post-page:
   - parent: {"page_id": "<the parent page id>"}
   - properties: {"title": {"title": [{"text": {"content": "${story.storyTitle.replace(/"/g, '\\"')}"}}]}}
   - icon: {"type": "emoji", "emoji": "📖"}
   Do NOT pass a "children" array — the content is written in the next step.

3. Call publish_book_content with the id of the page you just created.`;
  },

  extractUrl(serialized) {
    return serialized
      .replace(/\\\//g, "/")
      .match(/https:\/\/(?:www\.)?notion\.so\/[^\s"'\\)]+/)?.[0];
  },
};
