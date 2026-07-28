A [Next.js](https://nextjs.org) app that generates an illustrated multi-chapter
story, built on [Google's Agent Development Kit](https://adk.dev) for TypeScript.

## Getting Started

Create a `.env.local` with a Gemini API key from
[AI Studio](https://aistudio.google.com/apikey):

```bash
GEMINI_API_KEY=your-key-here
```

> ADK reads `GOOGLE_GENAI_API_KEY` first, then `GEMINI_API_KEY`. `GOOGLE_API_KEY`
> is **not** used here — it only applies to Vertex AI express mode.

Then install and run the development server:

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## How the story workflow works

`src/adk/` holds the agents and the orchestration that drives them:

| File | Role |
| --- | --- |
| `agents/chapter-planner-agent.ts` | Plans the story. Constrained to `storyPlanSchema` via `outputSchema`, so it emits JSON. |
| `agents/chapter-writer-agent.ts` | Writes the prose for one chapter. |
| `story-workflow.ts` | Runs the planner, then writes every chapter with at most 10 in flight. |
| `models.ts` | Gemini model IDs, overridable per agent via env. |
| `publishing/` | The publish-to-MCP step — see [Publishing over MCP](#publishing-over-mcp). |

Generation and publishing are deliberately separate: the book is finished and
readable before any destination is chosen, so a Notion or Google outage can
never cost you the story.

Both agents run through ADK `Runner`s against a throwaway session per call, in
`StreamingMode.SSE`. The route handler (`src/app/api/story-workflow/route.ts`)
republishes those events as AI SDK UI-message data parts
(`data-chapter-generation`, `data-chapter-content-generation`), which is what
`useStoryWorkflow` on the client consumes.

Because the planner streams JSON rather than a finished object, its output is
read through `src/lib/partial-json.ts` so the outline can render chapter by
chapter as it arrives.

### Choosing models

Defaults use the rolling `gemini-flash-latest` alias. To pin exact releases:

```bash
GEMINI_PLANNER_MODEL=gemini-3.5-flash
GEMINI_WRITER_MODEL=gemini-3.5-flash
GEMINI_PUBLISHER_MODEL=gemini-3.5-flash
```

## Publishing over MCP

Once a book is finished the reader picks a destination — **Notion** or **Google
Docs** — and `book-publisher-agent` publishes it through that destination's MCP
server. This is the one genuinely agent-driven step: the model discovers the
tools over MCP and decides how to create the document, rather than following
hard-coded orchestration.

Each destination is independent. Configure one, both, or neither — an
unconfigured destination shows as a disabled button, and the book is still
generated either way.

| Destination | MCP server | Auth |
| --- | --- | --- |
| Notion | `@notionhq/notion-mcp-server` (official, from npm) | integration token |
| Google Docs | `src/mcp/google-docs-server.mjs` (in this repo) | OAuth refresh token |

### Why the Google Docs server is written here

There is no official Google Workspace MCP server, and every community package
on npm wants long-lived Google OAuth credentials. Keeping the server in-repo
means the code handling those credentials is auditable, and it demonstrates
both halves of MCP — server and client — rather than just the client.

It requests only the `drive.file` scope, which grants access to files the app
itself creates. It cannot read the rest of your Drive.

### Setup — Notion

1. Create an internal integration at
   <https://www.notion.so/profile/integrations> and copy its secret.
2. Put it in `.env`:
   ```bash
   NOTION_TOKEN=ntn_****
   ```
3. In Notion, open the page you want books published under and share it with
   the integration (**⋯ → Connections → your integration**). Without this the
   integration can see nothing and the search returns no pages.

Optionally set `NOTION_PARENT_PAGE_ID` to skip the search and publish under a
fixed page. Leaving it unset makes the demo better — the agent's
`API-post-search` call is visible in the UI.

### Setup — Google Docs

1. In <https://console.cloud.google.com>, enable the **Google Drive API**.
2. Create an OAuth client ID of type **Desktop app**.
3. While the consent screen is in "Testing", add your own Google account under
   **Test users** — otherwise consent is refused.
4. Put the client id and secret in `.env`:
   ```bash
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```
5. Get a refresh token — a one-time browser consent:
   ```bash
   node --env-file=.env scripts/google-auth.mjs
   ```
   Paste the `GOOGLE_REFRESH_TOKEN=...` line it prints into `.env`.

### How the content is written

Both destinations follow the same shape, streamed to the UI as progress frames:

| Step | Notion | Google Docs |
| --- | --- | --- |
| Find a home | `API-post-search` | — |
| Create the document | `API-post-page` | `create_google_doc` |
| Write the chapters | `publish_book_content` | `publish_book_content` |

The first two are MCP tools the model calls itself. The last is a local
`FunctionTool` wrapping an MCP call (`API-update-page-markdown` /
`write_doc_markdown`): the model passes only an id, and our code supplies the
prose. Routing a 10k+ token book back through Gemini just to hand it to a tool
would be slow, expensive, and — worse — the model would quietly paraphrase it.

Chapters are already markdown, so neither destination needs a format
conversion: Notion accepts markdown directly, and Drive converts an uploaded
`text/markdown` body into native Docs formatting.

### Requires a real Node host

Both MCP servers run as local child processes over stdio, so publishing works
under `next dev` and `next start` but not on serverless platforms, which cannot
fork processes. Story generation itself is unaffected.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
