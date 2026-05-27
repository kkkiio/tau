import { CircleIcon, Settings2Icon, StarIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import { findSession, formatTime, highlightSegments, sessionTitle } from "../../tau/format";
import type { ProjectGroup, SearchResult, SessionInfo } from "../../tau/types";

export function SessionSidebar({
  activeSessionFile,
  collapsedProjects,
  favourites,
  liveFiles,
  loading,
  onRename,
  onSelect,
  onToggleCollapsed,
  onToggleFavourite,
  projects,
  query,
  searchResults,
}: {
  activeSessionFile: string | null;
  collapsedProjects: Set<string>;
  favourites: string[];
  liveFiles: Set<string>;
  loading: boolean;
  onRename: (name: string) => void;
  onSelect: (session: SessionInfo, project?: ProjectGroup) => void;
  onToggleCollapsed: (dirName: string) => void;
  onToggleFavourite: (filePath: string) => void;
  projects: ProjectGroup[];
  query: string;
  searchResults: SearchResult[];
}) {
  const lowerQuery = query.toLowerCase().trim();
  const favouriteSessions = projects.flatMap((project) =>
    project.sessions
      .filter((session) => favourites.includes(session.filePath))
      .map((session) => ({ project, session })),
  );

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
            const found = findSession(projects, result.filePath);
            return (
              <button
                className="block w-full border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted"
                key={result.filePath}
                onClick={() =>
                  onSelect(
                    found?.session || {
                      filePath: result.filePath,
                      name: result.sessionName,
                    },
                    found?.project,
                  )
                }
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

      {favouriteSessions.length > 0 && (
        <SessionGroup
          activeSessionFile={activeSessionFile}
          favourites={favourites}
          liveFiles={liveFiles}
          onRename={onRename}
          onSelect={onSelect}
          onToggleFavourite={onToggleFavourite}
          sessions={favouriteSessions}
          title="Favourites"
        />
      )}

      {projects.map((project) => {
        const sessions = project.sessions.filter((session) => {
          if (!lowerQuery) return true;
          return sessionTitle(session).toLowerCase().includes(lowerQuery);
        });
        if (lowerQuery && sessions.length === 0) return null;
        const collapsed = collapsedProjects.has(project.dirName);
        const shortPath = project.path.split("/").filter(Boolean).at(-1) || project.path;
        return (
          <div className="rounded-md border bg-card" key={project.dirName}>
            <button
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm"
              onClick={() => onToggleCollapsed(project.dirName)}
              type="button"
            >
              <span className="truncate" title={project.path}>
                {shortPath}
              </span>
              <span className="text-muted-foreground text-xs">{sessions.length}</span>
            </button>
            {!collapsed && (
              <SessionGroup
                activeSessionFile={activeSessionFile}
                favourites={favourites}
                liveFiles={liveFiles}
                onRename={onRename}
                onSelect={onSelect}
                onToggleFavourite={onToggleFavourite}
                sessions={sessions.map((session) => ({ session, project }))}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function SessionGroup({
  activeSessionFile,
  favourites,
  liveFiles,
  onRename,
  onSelect,
  onToggleFavourite,
  sessions,
  title,
}: {
  activeSessionFile: string | null;
  favourites: string[];
  liveFiles: Set<string>;
  onRename: (name: string) => void;
  onSelect: (session: SessionInfo, project?: ProjectGroup) => void;
  onToggleFavourite: (filePath: string) => void;
  sessions: Array<{ session: SessionInfo; project: ProjectGroup }>;
  title?: string;
}) {
  return (
    <div>
      {title && <div className="border-b px-3 py-2 font-medium text-xs">{title}</div>}
      {sessions.map(({ session, project }) => {
        const active = session.filePath === activeSessionFile;
        const favourite = favourites.includes(session.filePath);
        const live = liveFiles.has(session.filePath);
        return (
          <div
            className={cn("group flex items-start gap-2 border-b px-2 py-2 last:border-b-0", active && "bg-muted")}
            key={`${project.dirName}-${session.filePath}`}
          >
            <button
              className="mt-0.5 text-muted-foreground hover:text-foreground"
              onClick={() => onToggleFavourite(session.filePath)}
              type="button"
            >
              <StarIcon className={cn("size-3.5", favourite && "fill-current text-amber-500")} />
            </button>
            <button className="min-w-0 flex-1 text-left" onClick={() => onSelect(session, project)} type="button">
              <div className="flex items-center gap-1">
                {live && <CircleIcon className="size-2 fill-emerald-500 text-emerald-500" />}
                <div className="truncate text-sm">{sessionTitle(session)}</div>
                {session.tmux && (
                  <span className="rounded bg-emerald-500/10 px-1 text-emerald-600 text-[10px]">tmux</span>
                )}
              </div>
              <div className="text-muted-foreground text-xs">{formatTime(session.timestamp)}</div>
            </button>
            {active && (
              <button
                className="opacity-0 text-muted-foreground group-hover:opacity-100"
                onClick={() => {
                  const name = window.prompt("Rename session", sessionTitle(session));
                  if (name) onRename(name);
                }}
                type="button"
              >
                <Settings2Icon className="size-3.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
