import { configuredTargets, publishStory } from "@/src/adk/publishing/publish";
import {
  publishableStorySchema,
  type PublishTargetId,
} from "@/src/types/story-workflow";
import { z } from "zod";

// The MCP server is a child process, so this route needs a real Node host.
export const runtime = "nodejs";
export const maxDuration = 300;

const requestSchema = z.object({
  target: z.enum(["notion", "google-docs"]),
  story: publishableStorySchema,
});

/** Which destinations have credentials configured, for enabling the buttons. */
export const GET = async () =>
  Response.json({ targets: configuredTargets() });

export const POST = async (request: Request) => {
  const parsed = requestSchema.safeParse(await request.json());

  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request", detail: parsed.error.issues },
      { status: 400 },
    );
  }

  const { target, story } = parsed.data;

  // Newline-delimited JSON rather than the AI SDK stream format: these are
  // plain progress frames, not model output, so the client can just split them.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const frame of publishStory(
          target as PublishTargetId,
          story,
          request.signal,
        )) {
          controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`));
        }
      } catch (error) {
        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({
              target,
              status: "failed",
              toolCalls: [],
              message: error instanceof Error ? error.message : String(error),
            })}\n`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
// Progress frames are useless if a proxy buffers them.
      "X-Accel-Buffering": "no",
    },
  });
};
