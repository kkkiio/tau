import { BotIcon, Clock3Icon, CopyIcon, XIcon } from "lucide-react";
import { type CSSProperties, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useState } from "react";

import { MessageResponse } from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";

import { copyText, formatTokens } from "../../core/format";
import { formatDuration, subagentStatusLabel } from "../../core/subagents";
import type { SubagentViewState } from "../../core/types";

const DEFAULT_WIDTH = 420;
const MIN_WIDTH = 320;
const MAX_WIDTH = 760;
const MIN_CHAT_WIDTH = 480;
const STORAGE_KEY = "tau-subagent-sidebar-width";

export function SubagentDetailSidebar({ agent, onClose }: { agent: SubagentViewState; onClose: () => void }) {
  const [sidebarWidth, setSidebarWidth] = useState(() => getInitialWidth());
  const [isResizing, setIsResizing] = useState(false);
  const response = agent.finalResponse || agent.error || "";
  const copyResponse = () => {
    if (response) void copyText(response);
  };

  const updateWidth = useCallback((nextWidth: number) => {
    setSidebarWidth(clampSidebarWidth(nextWidth));
  }, []);

  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 || !window.matchMedia("(min-width: 768px)").matches) return;
      event.preventDefault();

      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      setIsResizing(true);

      const handlePointerMove = (moveEvent: PointerEvent) => {
        updateWidth(window.innerWidth - moveEvent.clientX);
      };

      const stopResize = () => {
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        setIsResizing(false);
        document.removeEventListener("pointermove", handlePointerMove);
        document.removeEventListener("pointerup", stopResize);
        document.removeEventListener("pointercancel", stopResize);
      };

      document.addEventListener("pointermove", handlePointerMove);
      document.addEventListener("pointerup", stopResize);
      document.addEventListener("pointercancel", stopResize);
    },
    [updateWidth],
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    const handleResize = () => setSidebarWidth((current) => clampSidebarWidth(current));
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <aside
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l bg-background shadow-xl md:relative md:z-auto md:w-[var(--subagent-sidebar-width)] md:max-w-none md:shrink-0 md:shadow-none"
      style={{ "--subagent-sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <button
        aria-label="Resize sub-agent sidebar"
        className="group absolute inset-y-0 left-0 z-20 hidden w-4 -translate-x-2 cursor-col-resize touch-none appearance-none border-0 bg-transparent p-0 md:block"
        onDoubleClick={() => updateWidth(DEFAULT_WIDTH)}
        onPointerDown={startResize}
        title="Drag to resize"
        type="button"
      >
        <div className="mx-auto h-full w-px bg-border" />
        <div
          className={[
            "absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 rounded-full transition-colors",
            isResizing ? "bg-primary" : "bg-transparent group-hover:bg-primary/70",
          ].join(" ")}
        />
      </button>

      <div className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <div className="flex size-8 items-center justify-center rounded-md bg-muted">
          <BotIcon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-sm">{agent.description || agent.type || "Sub-agent"}</div>
          <div className="text-muted-foreground text-xs">
            {agent.type || "Agent"} · {subagentStatusLabel(agent.status)}
          </div>
        </div>
        {response && (
          <Button onClick={copyResponse} size="icon-sm" type="button" variant="ghost">
            <CopyIcon className="size-4" />
          </Button>
        )}
        <Button onClick={onClose} size="icon-sm" type="button" variant="ghost">
          <XIcon className="size-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mb-4 grid grid-cols-2 gap-2 text-sm">
          <Metric label="Status" value={subagentStatusLabel(agent.status)} />
          <Metric label="Tools" value={agent.toolUses ? String(agent.toolUses) : "—"} />
          <Metric label="Duration" value={formatDuration(agent.durationMs) || "—"} />
          <Metric label="Tokens" value={agent.tokens?.total ? formatTokens(agent.tokens.total) : "—"} />
        </div>

        {agent.compactionCount ? (
          <div className="mb-4 flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-muted-foreground text-sm">
            <Clock3Icon className="size-4" />
            <span>
              {agent.compactionCount} compaction
              {agent.compactionCount === 1 ? "" : "s"}
            </span>
          </div>
        ) : null}

        <section className="space-y-2">
          <div className="font-medium text-sm">Final response</div>
          {response ? (
            <div className="rounded-md border bg-card p-3">
              <MessageResponse className="break-words text-sm leading-6 [&_pre]:overflow-x-auto">
                {response}
              </MessageResponse>
            </div>
          ) : (
            <div className="rounded-md border bg-muted/40 p-3 text-muted-foreground text-sm">
              No final response yet.
            </div>
          )}
        </section>

        {agent.outputFile && (
          <section className="mt-4 space-y-2">
            <div className="font-medium text-sm">Transcript</div>
            <div className="break-all rounded-md border bg-muted/40 p-3 text-muted-foreground text-xs">
              {agent.outputFile}
            </div>
          </section>
        )}
      </div>
    </aside>
  );
}

function getInitialWidth(): number {
  if (typeof window === "undefined") return DEFAULT_WIDTH;
  const storedWidth = Number(localStorage.getItem(STORAGE_KEY));
  return clampSidebarWidth(Number.isFinite(storedWidth) && storedWidth > 0 ? storedWidth : DEFAULT_WIDTH);
}

function clampSidebarWidth(width: number): number {
  return Math.min(sidebarMaxWidth(), Math.max(MIN_WIDTH, Math.round(width)));
}

function sidebarMaxWidth(): number {
  if (typeof window === "undefined") return MAX_WIDTH;
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, window.innerWidth - MIN_CHAT_WIDTH));
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-1 truncate">{value}</div>
    </div>
  );
}
