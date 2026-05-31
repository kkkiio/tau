import type { ProjectGroup, SessionInfo } from "./types";

export function shortModelName(id: string) {
  return id.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}

export function sessionTitle(session: SessionInfo) {
  return session.name || session.firstMessage || "Empty session";
}

export function formatTime(isoTimestamp?: string) {
  if (!isoTimestamp) return "";
  try {
    const date = new Date(isoTimestamp);
    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const days = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (days === 1) return "Yesterday";
    if (days < 7) return date.toLocaleDateString([], { weekday: "long" });
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

export function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function findSession(projects: ProjectGroup[], filePath: string) {
  for (const project of projects) {
    const session = project.sessions.find((candidate) => candidate.filePath === filePath);
    if (session) return { project, session };
  }
  return null;
}

export function highlightSegments(text: string, query: string) {
  if (!query) return [{ text, match: false, offset: 0 }];
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(escapedQuery, "gi");
  const segments: Array<{ text: string; match: boolean; offset: number }> = [];
  let cursor = 0;
  for (const match of text.matchAll(re)) {
    const offset = match.index ?? 0;
    if (offset > cursor) {
      segments.push({
        text: text.slice(cursor, offset),
        match: false,
        offset: cursor,
      });
    }
    segments.push({ text: match[0], match: true, offset });
    cursor = offset + match[0].length;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), match: false, offset: cursor });
  }
  return segments;
}

export function toggleSetValue<T>(set: Set<T>, value: T) {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

export function copyText(text: string) {
  if (navigator.clipboard) return navigator.clipboard.writeText(text);
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.cssText = "position:fixed;left:-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
  return Promise.resolve();
}
