import { createUIMessageStream, createUIMessageStreamResponse } from "ai";

import { runStoryWorkflow } from "@/src/adk/story-workflow";
import type { StoryWorkflowUIMessage } from "@/src/types/story-workflow";

// Writing every chapter can outlast the default serverless timeout.
export const maxDuration = 300;

export const POST = async (request: Request) => {
  const {
    userPrompt,
    numberOfChapters,
  }: { userPrompt: string; numberOfChapters: number } = await request.json();

  const stream = createUIMessageStream<StoryWorkflowUIMessage>({
    execute: async ({ writer }) => {
      await runStoryWorkflow({
        storyIdea: userPrompt,
        numberOfChapters: numberOfChapters || 3,
        writer,
        abortSignal: request.signal,
      });
    },
  });

  return createUIMessageStreamResponse({ stream });
};
