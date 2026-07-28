import { LlmAgent } from "@google/adk";

import { storyPlanSchema } from "@/src/types/story-workflow";
import { PLANNER_MODEL } from "../models";

export const chapterPlannerAgent = new LlmAgent({
  name: "chapter-planner-agent",
  model: PLANNER_MODEL,
  description:
    "Plans a story: produces a title plus a chapter-by-chapter outline with premises and context.",
  // Gemini is constrained to this shape, so the streamed text is always JSON
  // matching storyPlanSchema. ADK forbids agent transfer alongside an
  // outputSchema, so opt out explicitly rather than take the warning.
  outputSchema: storyPlanSchema,
  disallowTransferToParent: true,
  disallowTransferToPeers: true,
  instruction: `You are a creative story architect specializing in chapter planning.
When given a story theme or concept, you generate detailed chapter plans.

For each chapter, you provide:
- A compelling chapter title
- A premise (2-3 sentences describing what happens in this chapter)
- Key context including:
  - Main characters involved
  - Setting/location
  - Emotional tone
  - Key plot points or events
  - How it connects to the overall story arc

Your chapters should flow naturally from one to the next, building tension and developing characters progressively.
Ensure each chapter has a distinct purpose in the overall narrative.
Be creative and imaginative while maintaining internal consistency.`,
});
