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

`src/adk/` holds two `LlmAgent`s and the orchestration that drives them:

| File | Role |
| --- | --- |
| `agents/chapter-planner-agent.ts` | Plans the story. Constrained to `storyPlanSchema` via `outputSchema`, so it emits JSON. |
| `agents/chapter-writer-agent.ts` | Writes the prose for one chapter. |
| `story-workflow.ts` | Runs the planner, then writes every chapter with at most 10 in flight. |
| `models.ts` | Gemini model IDs, overridable per agent via env. |

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
```

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
