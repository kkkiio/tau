import { BotIcon, CheckCircle2Icon, Clock3Icon, XCircleIcon } from "lucide-react";

import { formatTokens } from "../../tau/format";
import { canOpenSubagentDetail, formatDuration, subagentStatusLabel } from "../../tau/subagents";
import type { SubagentViewState } from "../../tau/types";

export function WorkspaceStatusFloat({
  onOpenSubagent,
  subagents,
}: {
  onOpenSubagent: (id: string) => void;
  subagents: SubagentViewState[];
}) {
  const recentSubagents = subagents.slice(0, 5);

  return (
    <div className="absolute right-4 top-4 z-20 hidden w-80 rounded-lg border bg-popover/95 p-4 shadow-lg backdrop-blur md:block">
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-muted-foreground text-sm">Subagents</div>
          {subagents.length > 0 && <div className="text-muted-foreground text-xs">{subagents.length}</div>}
        </div>
        {recentSubagents.length === 0 ? (
          <div className="text-muted-foreground text-sm">No sub-agents yet</div>
        ) : (
          <div className="space-y-1">
            {recentSubagents.map((agent) => (
              <SubagentFloatRow agent={agent} key={agent.id} onOpen={() => onOpenSubagent(agent.id)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SubagentFloatRow({ agent, onOpen }: { agent: SubagentViewState; onOpen: () => void }) {
  const canOpen = canOpenSubagentDetail(agent);
  const content = (
    <>
      <StatusIcon agent={agent} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-sm">{agent.type || "Agent"}</span>
          <span className="shrink-0 text-muted-foreground text-xs">{subagentStatusLabel(agent.status)}</span>
        </div>
        <div className="truncate text-muted-foreground text-xs">{agent.description || agent.id}</div>
      </div>
      <div className="shrink-0 text-muted-foreground text-xs">{subagentMetric(agent)}</div>
    </>
  );

  if (!canOpen) {
    return <div className="flex items-center gap-2 rounded-md px-2 py-1.5">{content}</div>;
  }

  return (
    <button
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
      onClick={onOpen}
      type="button"
    >
      {content}
    </button>
  );
}

function StatusIcon({ agent }: { agent: SubagentViewState }) {
  if (agent.status === "completed" || agent.status === "steered") {
    return <CheckCircle2Icon className="size-4 shrink-0 text-emerald-500" />;
  }
  if (agent.status === "error" || agent.status === "aborted" || agent.status === "stopped") {
    return <XCircleIcon className="size-4 shrink-0 text-destructive" />;
  }
  if (agent.status === "queued" || agent.status === "background") {
    return <Clock3Icon className="size-4 shrink-0 text-muted-foreground" />;
  }
  return <BotIcon className="size-4 shrink-0 text-sky-500" />;
}

function subagentMetric(agent: SubagentViewState): string {
  if (agent.error) return "error";
  if (agent.toolUses) return `${agent.toolUses} tools`;
  if (agent.tokens?.total) return formatTokens(agent.tokens.total);
  const duration = formatDuration(agent.durationMs);
  if (duration) return duration;
  return "";
}
