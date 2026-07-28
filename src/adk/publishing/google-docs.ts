import path from "node:path";

import type { StdioConnectionParams } from "@google/adk";

import type { PublishTarget } from "./types";

/**
 * Publishes through the Google Docs MCP server that lives in this repo
 * (`src/mcp/google-docs-server.mjs`).
 *
 * There is no official Google Workspace MCP server, and the community packages
 * all want long-lived Google OAuth credentials — keeping the server in-repo
 * means the code handling those credentials is auditable.
 */

const REQUIRED_ENV = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REFRESH_TOKEN",
] as const;

export const googleDocsTarget: PublishTarget = {
  id: "google-docs",
  label: "Google Docs",

  isConfigured: () => REQUIRED_ENV.every((key) => Boolean(process.env[key])),
  missingConfigMessage:
    "Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN in .env — " +
    "run `node --env-file=.env scripts/google-auth.mjs` to obtain the refresh token.",

  connectionParams(): StdioConnectionParams {
    const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
    if (missing.length) {
      throw new Error(`Missing Google credentials: ${missing.join(", ")}.`);
    }

    return {
      type: "StdioConnectionParams",
      serverParams: {
        command: process.execPath,
        args: [
          process.env.GOOGLE_DOCS_MCP_ENTRY ??
            path.join(process.cwd(), "src/mcp/google-docs-server.mjs"),
        ],
        env: { ...process.env } as Record<string, string>,
      },
      timeout: 60_000,
    };
  },

  toolFilter: ["create_google_doc"],

  contentTool: "write_doc_markdown",
  contentToolArgs: (documentId, markdown) => ({
    document_id: documentId,
    markdown,
  }),
  containerIdDescription:
    "The documentId returned by create_google_doc.",

  instruction(story) {
    return `1. Create the document with create_google_doc, using the title "${story.storyTitle.replace(/"/g, '\\"')}".

2. Call publish_book_content with the documentId you just received.`;
  },

  extractUrl(serialized) {
    return serialized
      .replace(/\\\//g, "/")
      .match(/https:\/\/docs\.google\.com\/[^\s"'\\)]+/)?.[0];
  },
};
