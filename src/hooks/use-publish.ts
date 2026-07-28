"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  PublishableStory,
  PublishEventData,
  PublishTargetId,
} from "@/src/types/story-workflow";

/**
 * Drives `/api/publish`, which streams newline-delimited progress frames.
 *
 * Only one publish runs at a time; starting another aborts the previous one.
 */
export function usePublish() {
  const [publish, setPublish] = useState<PublishEventData | null>(null);
  const [availableTargets, setAvailableTargets] = useState<
    PublishTargetId[] | null
  >(null);
  const abortRef = useRef<AbortController | null>(null);

  // Ask the server which destinations actually have credentials configured.
  useEffect(() => {
    let cancelled = false;

    fetch("/api/publish")
      .then((res) => (res.ok ? res.json() : { targets: [] }))
      .then((data) => {
        if (!cancelled) setAvailableTargets(data.targets ?? []);
      })
      .catch(() => {
        if (!cancelled) setAvailableTargets([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  const start = useCallback(
    async (target: PublishTargetId, story: PublishableStory) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setPublish({ target, status: "publishing", toolCalls: [] });

      try {
        const response = await fetch("/api/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target, story }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`Publish request failed (${response.status}).`);
        }

        const reader = response.body
          .pipeThrough(new TextDecoderStream())
          .getReader();

        let buffer = "";

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += value;

          // Keep the trailing fragment: a frame may be split across chunks.
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              setPublish(JSON.parse(line) as PublishEventData);
            } catch {
              // A malformed frame should not kill the rest of the stream.
            }
          }
        }
      } catch (error) {
        if (controller.signal.aborted) return;

        setPublish({
          target,
          status: "failed",
          toolCalls: [],
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setPublish(null);
  }, []);

  return { publish, start, reset, availableTargets };
}
