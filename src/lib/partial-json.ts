/**
 * Tolerant JSON parsing for text that is still streaming in.
 *
 * The chapter planner streams its outline as JSON, and the UI renders chapters
 * as they appear, so every chunk needs to be read as a best-effort object even
 * though the text is not yet valid JSON. This mirrors what Mastra's
 * `objectStream` gave us for free.
 *
 * Three attempts, all single-pass, cheapest first:
 *   1. Parse as-is (the text happens to be complete).
 *   2. Greedy repair — close the open string and brackets, so a half-typed
 *      value still shows up.
 *   3. Safe truncation — rewind to the last completed element and close from
 *      there, dropping whatever was mid-write.
 */

interface ScanResult {
  /** Open brackets, outermost first. */
  stack: string[];
  /** Whether the text ends inside a string literal. */
  inString: boolean;
  /** Whether the text ends on a dangling backslash inside a string. */
  trailingEscape: boolean;
  /** Index to cut at for the last known-complete element, or -1. */
  safeEnd: number;
  /** Bracket stack as it stood at `safeEnd`. */
  safeStack: string[];
}

function scan(src: string): ScanResult {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let safeEnd = -1;
  let safeStack: string[] = [];

  for (let i = 0; i < src.length; i++) {
    const char = src[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    switch (char) {
      case '"':
        inString = true;
        break;
      case "{":
      case "[":
        stack.push(char);
        break;
      case "}":
      case "]":
        stack.pop();
        // A value just closed, so cutting right after it is safe.
        safeEnd = i + 1;
        safeStack = stack.slice();
        break;
      case ",":
        // Everything before the separator is complete; cut before it.
        safeEnd = i;
        safeStack = stack.slice();
        break;
    }
  }

  return { stack, inString, trailingEscape: escaped, safeEnd, safeStack };
}

function closers(stack: string[]): string {
  let out = "";
  for (let i = stack.length - 1; i >= 0; i--) {
    out += stack[i] === "{" ? "}" : "]";
  }
  return out;
}

/** Drops the string literal the text ends on, escapes included. */
function stripTrailingString(text: string): string {
  if (!text.endsWith('"')) return text;

  for (let i = text.length - 2; i >= 0; i--) {
    if (text[i] !== '"') continue;

    let backslashes = 0;
    for (let j = i - 1; j >= 0 && text[j] === "\\"; j--) backslashes++;
    if (backslashes % 2 === 0) return text.slice(0, i);
  }

  return text;
}

function repairGreedy(src: string, state: ScanResult): string {
  let out = src;
  if (state.trailingEscape) out = out.slice(0, -1);
  if (state.inString) out += '"';

  out = out.replace(/\s+$/, "");

  if (out.endsWith(":")) {
    // A key whose value hasn't arrived. Omit the key rather than invent a
    // value for it — callers treat a missing field as "not written yet".
    out = stripTrailingString(out.slice(0, -1).replace(/\s+$/, ""));
    out = out.replace(/\s+$/, "");
  }

  if (out.endsWith(",")) out = out.slice(0, -1);

  return out + closers(state.stack);
}

function tryParse<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/** Strips a ```json fence if the model wrapped its output in one. */
function stripCodeFence(text: string): string {
  const fenced = text.match(/^\s*```(?:json)?\s*\n([\s\S]*?)(?:\n\s*```\s*$|$)/);
  return fenced ? fenced[1] : text;
}

/**
 * Parses possibly-incomplete JSON, returning `undefined` when not even a
 * partial object can be recovered yet.
 */
export function parsePartialJson<T = unknown>(text: string): T | undefined {
  const src = stripCodeFence(text).trim();
  if (!src) return undefined;

  const direct = tryParse<T>(src);
  if (direct !== undefined) return direct;

  const state = scan(src);

  const greedy = tryParse<T>(repairGreedy(src, state));
  if (greedy !== undefined) return greedy;

  if (state.safeEnd >= 0) {
    const truncated = src.slice(0, state.safeEnd) + closers(state.safeStack);
    const safe = tryParse<T>(truncated);
    if (safe !== undefined) return safe;
  }

  return undefined;
}
