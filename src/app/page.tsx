"use client";

import { useCallback, useEffect, useState } from "react";
import { StoryInput } from "@/src/components/story-input";
import { StoryOutline } from "@/src/components/story-outline";
import { StoryBook } from "@/src/components/story-book";
import { PublishPanel } from "@/src/components/publish-panel";
import { AnimatePresence, motion } from "motion/react";
import { useStoryWorkflow } from "../hooks/use-story-workflow";
import { usePublish } from "../hooks/use-publish";
import type { PublishTargetId } from "@/src/types/story-workflow";

type AppState = "input" | "outlining" | "book";

export default function Home() {
  const [appState, setAppState] = useState<AppState>("input");
  const [storyPrompt, setStoryPrompt] = useState("");
  const [chapterCount, setChapterCount] = useState(3);

  const { send, workflow, reset } = useStoryWorkflow();
  const {
    publish,
    start: startPublish,
    reset: resetPublish,
    availableTargets,
  } = usePublish();

  // Extract outline data (chapter-generation)
  const chapterOutlines = workflow?.parts.find(
    (item) => item.type === "data-chapter-generation",
  );

  // Extract chapter content data (chapter-content-generation)
  const chapters =
    workflow?.parts
      .filter((item) => item.type === "data-chapter-content-generation")
      .map((item) => item.data) || [];

  const storyTitle = chapterOutlines?.data.content.storyTitle || "Your Story";

  // Only finished chapters are publishable, and they must be in reading order.
  const completedChapters = chapters
    .filter((chapter) => chapter.status === "completed")
    .sort((a, b) => a.chapterNumber - b.chapterNumber);

  // Compare against the plan, not against the parts received so far: early in
  // the run only some chapters have parts yet, and those could all be complete.
  const plannedChapterCount =
    chapterOutlines?.data.content.chapters?.length ?? 0;

  const canPublish =
    plannedChapterCount > 0 &&
    completedChapters.length === plannedChapterCount;

  const handlePublish = useCallback(
    (target: PublishTargetId) => {
      startPublish(target, {
        storyTitle,
        totalChapters: completedChapters.length,
        chapters: completedChapters.map(({ chapterNumber, title, content }) => ({
          chapterNumber,
          title,
          content,
        })),
      });
    },
    [startPublish, storyTitle, completedChapters],
  );

  const handleGenerate = (prompt: string, chapters: number) => {
    send({ numberOfChapters: chapters, userPrompt: prompt });
    setStoryPrompt(prompt);
    setChapterCount(chapters);
    setAppState("outlining");
  };

  const handleReset = () => {
    setAppState("input");
    setStoryPrompt("");
    reset();
    resetPublish();
  };

  useEffect(() => {
    if (!chapterOutlines) return;

    switch (chapterOutlines.data.status) {
      case "streaming": {
        setAppState("outlining");
        break;
      }
      case "completed": {
        setAppState("book");
        break;
      }
    }
  }, [chapterOutlines]);

  return (
    <main className="min-h-screen relative overflow-hidden">
      <AnimatePresence mode="wait">
        {appState === "input" && (
          <motion.div
            key="input"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{ duration: 0.5 }}
            className="relative z-10"
          >
            <StoryInput onGenerate={handleGenerate} />
          </motion.div>
        )}

        {appState === "outlining" && chapterOutlines && (
          <motion.div
            key="outline"
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10"
          >
            <StoryOutline
              prompt={storyPrompt}
              chapterCount={chapterCount}
              outline={chapterOutlines.data}
            />
          </motion.div>
        )}

        {appState === "book" && chapterOutlines && (
          <motion.div
            key="book"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10"
          >
            <StoryBook
              prompt={storyPrompt}
              chapters={chapters}
              storyTitle={storyTitle}
              onClose={handleReset}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {appState === "book" && canPublish && (
        <div className="fixed bottom-6 left-1/2 z-20 w-full max-w-md -translate-x-1/2 px-4">
          <PublishPanel
            publish={publish}
            availableTargets={availableTargets}
            onPublish={handlePublish}
            onReset={resetPublish}
          />
        </div>
      )}
    </main>
  );
}
