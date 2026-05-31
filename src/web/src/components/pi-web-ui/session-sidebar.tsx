import { ChevronDownIcon, ChevronRightIcon, CircleIcon, StarIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";

import { formatTime, highlightSegments, sessionTitle } from "../../core/format";
import type { SearchResult, SessionInfo } from "../../core/types";

export function SessionSidebar({
  activeSessionFile,
  viewedSessionFile,
  favourites,
  loading,
  onSelect,
  onToggleFavourite,
  projects,
  query,
  searchResults,
}: {
  activeSessionFile: string | null;
  viewedSessionFile: string | null;
  favourites: string[];
  loading: boolean;
  onSelect: (session: SessionInfo) => void;
  onToggleFavourite: (filePath: string) => void;
  projects: { dirName: string; path: string; sessions: SessionInfo[] }[];
  query: string;
  searchResults: SearchResult[];
}) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const lowerQuery = query.toLowerCase().trim();

  const allSessions = useMemo(() => {
    const sessions = projects.flatMap((project) => project.sessions);
    sessions.sort((a, b) => {
      const aTime = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const bTime = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return bTime - aTime;
    });
    return sessions;
  }, [projects]);

  const groupedSessions = useMemo(() => {
    const groups = new Map<string, SessionInfo[]>();
    for (const session of allSessions) {
      const dir = session.cwd?.split("/").filter(Boolean).pop() || "Unknown";
      if (!groups.has(dir)) groups.set(dir, []);
      groups.get(dir)?.push(session);
    }
    return groups;
  }, [allSessions]);

  if (loading) {
    return <div className="p-4 text-muted-foreground text-sm">Loading sessions...</div>;
  }

  if (!projects.length) {
    return <div className="p-4 text-muted-foreground text-sm">No sessions found</div>;
  }

  return (
    <div className="space-y-2">
      {searchResults.length > 0 && (
        <div className="rounded-md border bg-card">
          <div className="flex items-center justify-between border-b px-3 py-2 text-muted-foreground text-xs">
            <span>Message matches</span>
            <span>{searchResults.length}</span>
          </div>
          {searchResults.map((result) => {
            const session = allSessions.find((s) => s.filePath === result.filePath);
            return (
              <button
                className="block w-full border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted"
                key={result.filePath}
                onClick={() => onSelect(session || { filePath: result.filePath, name: result.sessionName })}
                type="button"
              >
                <div className="truncate text-sm">{result.sessionName || result.firstMessage || "Untitled"}</div>
                <div className="line-clamp-2 text-muted-foreground text-xs">
                  {highlightSegments(result.matches?.[0]?.snippet || "", lowerQuery).map((segment) =>
                    segment.match ? (
                      <mark key={segment.offset}>{segment.text}</mark>
                    ) : (
                      <span key={segment.offset}>{segment.text}</span>
                    ),
                  )}
                </div>
                <div className="mt-1 text-muted-foreground text-xs">{formatTime(result.sessionTimestamp)}</div>
              </button>
            );
          })}
        </div>
      )}

      {Array.from(groupedSessions.entries()).map(([dir, sessions]) => {
        const filtered = lowerQuery
          ? sessions.filter((s) => sessionTitle(s).toLowerCase().includes(lowerQuery))
          : sessions;
        if (lowerQuery && filtered.length === 0) return null;
        return (
          <div className="rounded-md border bg-card" key={dir}>
            <button
              className="flex w-full items-center gap-1 border-b px-3 py-1.5 font-medium text-muted-foreground text-xs hover:bg-muted"
              onClick={() => {
                setCollapsedGroups((prev) => {
                  const next = new Set(prev);
                  if (next.has(dir)) {
                    next.delete(dir);
                  } else {
                    next.add(dir);
                  }
                  return next;
                });
              }}
              type="button"
            >
              {collapsedGroups.has(dir) ? (
                <ChevronRightIcon className="size-3.5" />
              ) : (
                <ChevronDownIcon className="size-3.5" />
              )}
              <span>{dir}</span>
              <span className="ml-auto text-muted-foreground">{sessions.length}</span>
            </button>
            {!collapsedGroups.has(dir) &&
              filtered.map((session) => {
                const active = session.filePath === activeSessionFile;
                const viewed = session.filePath === viewedSessionFile;
                const favourite = favourites.includes(session.filePath);
                return (
                  <div
                    className={cn(
                      "group flex items-start gap-2 border-b px-2 py-2 last:border-b-0",
                      viewed && "bg-muted",
                    )}
                    key={session.filePath}
                  >
                    <button
                      className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
                      onClick={() => onToggleFavourite(session.filePath)}
                      type="button"
                    >
                      <StarIcon className={cn("size-3.5", favourite && "fill-current text-amber-500")} />
                    </button>
                    <button className="min-w-0 flex-1 text-left" onClick={() => onSelect(session)} type="button">
                      <div className="flex items-center gap-1">
                        {active && <CircleIcon className="size-2 shrink-0 fill-emerald-500 text-emerald-500" />}
                        <div className="truncate text-sm">{sessionTitle(session)}</div>
                      </div>
                      <div className="text-muted-foreground text-xs">{formatTime(session.timestamp)}</div>
                    </button>
                  </div>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}
