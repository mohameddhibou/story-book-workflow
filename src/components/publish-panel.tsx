"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  AlertCircle,
  Check,
  ExternalLink,
  FileText,
  Loader2,
  NotebookPen,
  RotateCcw,
} from "lucide-react";

import type {
  PublishEventData,
  PublishTargetId,
} from "@/src/types/story-workflow";

/** MCP tool names are wire identifiers; show something a viewer can read. */
const TOOL_LABELS: Record<string, string> = {
  "API-post-search": "Searching the Notion workspace",
  "API-post-page": "Creating the Notion page",
  create_google_doc: "Creating the Google Doc",
  publish_book_content: "Writing the chapters",
};

const TARGETS: {
  id: PublishTargetId;
  label: string;
  icon: typeof FileText;
}[] = [
  { id: "notion", label: "Notion", icon: NotebookPen },
  { id: "google-docs", label: "Google Docs", icon: FileText },
];

interface PublishPanelProps {
  publish: PublishEventData | null;
  /** Null while still loading; ids of destinations with credentials set. */
  availableTargets: PublishTargetId[] | null;
  onPublish: (target: PublishTargetId) => void;
  onReset: () => void;
}

export function PublishPanel({
  publish,
  availableTargets,
  onPublish,
  onReset,
}: PublishPanelProps) {
  const busy = publish?.status === "publishing";
  const label =
    TARGETS.find((target) => target.id === publish?.target)?.label ?? "";

  const HEADINGS: Record<PublishEventData["status"], string> = {
    publishing: `Publishing to ${label}`,
    completed: `Published to ${label}`,
    failed: `Couldn't publish to ${label}`,
    skipped: `${label} isn't configured`,
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="mx-auto w-full max-w-md rounded-xl border border-border/50 bg-card/90 p-4 shadow-lg backdrop-blur"
    >
      <AnimatePresence mode="wait">
        {!publish ? (
          <motion.div key="choose" exit={{ opacity: 0 }}>
            <p className="mb-3 text-sm font-medium">Publish this book</p>
            <div className="grid grid-cols-2 gap-2">
              {TARGETS.map((target) => {
                // `null` means we haven't heard back yet — don't flash as disabled.
                const ready =
                  availableTargets === null ||
                  availableTargets.includes(target.id);

                return (
                  <button
                    key={target.id}
                    onClick={() => onPublish(target.id)}
                    disabled={!ready}
                    title={
                      ready
                        ? `Publish to ${target.label}`
                        : `${target.label} is not configured — see the README`
                    }
                    className="flex items-center justify-center gap-2 rounded-lg border border-border/60 bg-background px-3 py-2.5 text-sm font-medium transition-all hover:border-primary/40 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <target.icon className="h-4 w-4 text-primary" />
                    {target.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-center text-xs uppercase tracking-wider text-muted-foreground">
              via MCP
            </p>
          </motion.div>
        ) : (
          <motion.div
            key="progress"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              ) : publish.status === "completed" ? (
                <Check className="h-4 w-4 text-primary" />
              ) : (
                <AlertCircle className="h-4 w-4 text-destructive" />
              )}
              <span>{HEADINGS[publish.status]}</span>
              <span className="ml-auto text-xs uppercase tracking-wider text-muted-foreground">
                via MCP
              </span>
            </div>

            <ul className="space-y-2">
              <AnimatePresence initial={false}>
                {publish.toolCalls.map((call, index) => (
                  <motion.li
                    key={`${call.name}-${index}`}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center gap-2 text-sm text-muted-foreground"
                  >
                    {call.status === "running" && (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                    )}
                    {call.status === "completed" && (
                      <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                    )}
                    {call.status === "failed" && (
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                    )}
                    <span
                      className={
                        call.status === "failed" ? "text-destructive" : ""
                      }
                    >
                      {TOOL_LABELS[call.name] ?? call.name}
                    </span>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>

            {publish.message && publish.status !== "completed" && (
              <p className="mt-3 text-xs text-destructive">{publish.message}</p>
            )}

            <div className="mt-3 flex items-center gap-4">
              {publish.documentUrl && (
                <a
                  href={publish.documentUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary transition-opacity hover:opacity-80"
                >
                  Open in {label}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}

              {!busy && (
                <button
                  onClick={onReset}
                  className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <RotateCcw className="h-3 w-3" />
                  Publish elsewhere
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
