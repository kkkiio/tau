import { PanelLeftCloseIcon, RefreshCwIcon, SearchIcon, Settings2Icon, TerminalIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import type { ConnectionState, ProjectGroup, SearchResult, SessionInfo } from "../../core/types";
import { ConnectionDot } from "./connection-dot";
import { SessionSidebar } from "./session-sidebar";

interface AppSidebarContentProps {
  connection: ConnectionState;
  sessionName: string;
  modelLabel: string;
  sessionQuery: string;
  sessionsLoading: boolean;
  activeSessionFile: string | null;
  viewedSessionFile: string | null;
  favourites: string[];
  projects: ProjectGroup[];
  searchResults: SearchResult[];
  onToggle: (open: boolean) => void;
  onOpenSettings: () => void;
  onLoadSessions: () => void;
  onSessionQueryChange: (value: string) => void;
  onSelectSession: (session: SessionInfo) => void;
  onToggleFavourite: (filePath: string) => void;
}

export function AppSidebarContent({
  connection,
  sessionName,
  modelLabel,
  sessionQuery,
  sessionsLoading,
  activeSessionFile,
  viewedSessionFile,
  favourites,
  projects,
  searchResults,
  onToggle,
  onOpenSettings,
  onLoadSessions,
  onSessionQueryChange,
  onSelectSession,
  onToggleFavourite,
}: AppSidebarContentProps) {
  return (
    <>
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
        <TerminalIcon className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm">Pi Web UI</div>
          <div className="text-muted-foreground text-xs">Browser interface for Pi</div>
        </div>
        <Button onClick={() => onToggle(false)} size="icon-sm" type="button" variant="ghost">
          <PanelLeftCloseIcon className="size-4" />
        </Button>
      </div>

      {/* Active session info */}
      <div className="border-b px-3 py-1.5">
        <div className="flex items-center gap-2">
          <ConnectionDot state={connection} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm">{sessionName}</div>
            <div className="text-muted-foreground text-xs">{modelLabel}</div>
          </div>
        </div>
      </div>

      {/* History */}
      <div className="border-b px-3 py-1.5">
        <div className="flex items-center justify-between">
          <div className="font-medium text-xs">History</div>
          <Button onClick={onLoadSessions} size="icon-sm" type="button" variant="ghost">
            <RefreshCwIcon className="size-3" />
          </Button>
        </div>
        <div className="relative mt-2">
          <SearchIcon className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-8"
            onChange={(event) => onSessionQueryChange(event.target.value)}
            placeholder="Search history..."
            value={sessionQuery}
          />
        </div>
      </div>

      {/* Session list */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <SessionSidebar
          activeSessionFile={activeSessionFile}
          viewedSessionFile={viewedSessionFile}
          favourites={favourites}
          loading={sessionsLoading}
          onSelect={onSelectSession}
          onToggleFavourite={onToggleFavourite}
          projects={projects}
          query={sessionQuery}
          searchResults={searchResults}
        />
      </div>

      {/* Settings footer */}
      <div className="shrink-0 border-t p-2">
        <Button className="w-full justify-start gap-2" onClick={onOpenSettings} type="button" variant="ghost">
          <Settings2Icon className="size-4" />
          <span>Settings</span>
        </Button>
      </div>
    </>
  );
}
