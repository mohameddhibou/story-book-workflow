import type { PublishableStory } from "@/src/types/story-workflow";

/** Writer agents are told to emit markdown; some still wrap it in a fence. */
function stripCodeFence(content: string): string {
  const fenced = content.trim().match(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/);
  return fenced ? fenced[1] : content.trim();
}

/** Flattens the finished book into the single markdown document we publish. */
export function buildBookMarkdown(story: PublishableStory): string {
  const chapters = story.chapters
    .map(
      (chapter) =>
        `## Chapter ${chapter.chapterNumber} — ${chapter.title}\n\n${stripCodeFence(
          chapter.content,
        )}`,
    )
    .join("\n\n---\n\n");

  return `# ${story.storyTitle}\n\n${chapters}\n`;
}
