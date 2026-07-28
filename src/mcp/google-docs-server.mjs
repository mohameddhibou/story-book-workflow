#!/usr/bin/env node
/**
 * A minimal Google Docs MCP server.
 *
 * Written in-repo rather than pulled from npm: there is no official Google
 * Workspace MCP server, and the community packages all want long-lived Google
 * OAuth credentials. Keeping it here means the code touching those credentials
 * is auditable, and the tool schemas stay simple enough that Gemini accepts
 * them without translation.
 *
 * Auth is a refresh token obtained once via `node scripts/google-auth.mjs`, so
 * nothing interactive happens at request time. Scope is `drive.file`, which
 * grants access only to files this app itself creates — it cannot read the rest
 * of the user's Drive.
 *
 * Run over stdio:
 *   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... GOOGLE_REFRESH_TOKEN=... \
 *     node src/mcp/google-docs-server.mjs
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { google } from "googleapis";
import { z } from "zod";

const DOC_MIME = "application/vnd.google-apps.document";

function driveClient() {
  const {
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REFRESH_TOKEN,
  } = process.env;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new Error(
      "Missing Google credentials. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET " +
        "and GOOGLE_REFRESH_TOKEN — see `node scripts/google-auth.mjs`.",
    );
  }

  const auth = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  return google.drive({ version: "v3", auth });
}

/** MCP expects tool results as content parts; JSON keeps them model-readable. */
function json(value) {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function failure(error) {
  const message =
    error?.errors?.[0]?.message ?? error?.message ?? String(error);
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: message }) }],
  };
}

const server = new McpServer({ name: "google-docs", version: "1.0.0" });

server.registerTool(
  "create_google_doc",
  {
    title: "Create a Google Doc",
    description:
      "Creates a new, empty Google Doc in the user's Drive and returns its " +
      "document id and shareable URL. Write the content in a separate step.",
    inputSchema: {
      title: z.string().describe("The title of the document to create."),
    },
  },
  async ({ title }) => {
    try {
      const drive = driveClient();
      const { data } = await drive.files.create({
        requestBody: { name: title, mimeType: DOC_MIME },
        fields: "id, name, webViewLink",
      });
      return json({
        documentId: data.id,
        title: data.name,
        url: data.webViewLink,
      });
    } catch (error) {
      return failure(error);
    }
  },
);

server.registerTool(
  "write_doc_markdown",
  {
    title: "Write markdown into a Google Doc",
    description:
      "Replaces the entire body of an existing Google Doc with the supplied " +
      "markdown. Headings, emphasis and rules are converted to native Google " +
      "Docs formatting.",
    inputSchema: {
      document_id: z
        .string()
        .describe("The id returned by create_google_doc."),
      markdown: z.string().describe("The complete document body as markdown."),
    },
  },
  async ({ document_id, markdown }) => {
    try {
      const drive = driveClient();
      // Drive converts an uploaded text/markdown body into Docs formatting when
      // the target file is already a Google Doc — no manual batchUpdate needed.
      const { data } = await drive.files.update({
        fileId: document_id,
        media: { mimeType: "text/markdown", body: markdown },
        fields: "id, name, webViewLink",
      });
      return json({
        documentId: data.id,
        url: data.webViewLink,
        charactersWritten: markdown.length,
      });
    } catch (error) {
      return failure(error);
    }
  },
);

await server.connect(new StdioServerTransport());
