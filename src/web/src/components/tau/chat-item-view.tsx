import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";

import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import { cn } from "@/lib/utils";

import { formatToolSummary, isToolExpandable } from "../../tau/tool-summary";
import type { ChatItem } from "../../tau/types";
import { ImagePreviewStrip } from "./image-preview-strip";

export function ChatItemView({
  item,
  onCopy,
  onToggleTool,
  showThinking,
}: {
  item: ChatItem;
  onCopy: (text: string) => Promise<void> | void;
  onToggleTool: (id: string, open: boolean) => void;
  showThinking: boolean;
}) {
  const [copied, setCopied] = useState(false);

  if (item.kind === "system") {
    return (
      <div
        className={cn(
          "mx-auto max-w-xl whitespace-pre-wrap rounded-md border px-3 py-2 text-center text-sm",
          item.tone === "error" && "border-destructive/30 bg-destructive/10 text-destructive",
          item.tone === "success" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
          (!item.tone || item.tone === "info") && "bg-muted text-muted-foreground",
        )}
      >
        {item.text}
      </div>
    );
  }

  if (item.kind === "tool") {
    const expandable = isToolExpandable(item);
    const open = expandable ? (item.open ?? false) : false;

    return (
      <div className="w-full max-w-[95%]">
        <Tool onOpenChange={(nextOpen) => expandable && onToggleTool(item.id, nextOpen)} open={open}>
          <ToolHeader
            collapsible={expandable}
            state={item.state}
            summary={formatToolSummary(item)}
            title={item.name}
            type={`tool-${item.name}` as `tool-${string}`}
          />
          {expandable && (
            <ToolContent>
              <ToolInput input={item.input as never} />
              <ToolOutput errorText={item.errorText} output={item.output as never} />
            </ToolContent>
          )}
        </Tool>
      </div>
    );
  }

  const canCopy = item.text.trim().length > 0 && item.copyable !== false && !item.streaming;
  const isActivity = item.presentation === "activity";

  const copyMessage = async () => {
    if (!canCopy) return;
    await onCopy(item.text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <Message className={cn(isActivity && "gap-1")} from={item.role}>
      <MessageContent
        className={cn(
          item.role === "assistant" && "w-full",
          isActivity && item.role === "assistant" && "gap-1 text-muted-foreground",
          item.streaming && 'after:ml-1 after:animate-pulse after:content-["▋"]',
        )}
      >
        {item.images && <ImagePreviewStrip images={item.images} readonly />}
        {showThinking && item.reasoning && (
          <Reasoning className={cn(isActivity && "mb-1")} isStreaming={Boolean(item.streaming)}>
            <ReasoningTrigger className={cn(isActivity && "text-xs")} />
            <ReasoningContent className={cn(isActivity && "mt-1 text-xs")}>{item.reasoning}</ReasoningContent>
          </Reasoning>
        )}
        <MessageResponse
          className={cn(isActivity && "text-muted-foreground [&_ol]:my-1 [&_p]:my-0 [&_pre]:my-1 [&_ul]:my-1")}
        >
          {item.text}
        </MessageResponse>
      </MessageContent>
      {canCopy && (
        <MessageActions
          className={cn(
            "opacity-0 transition-opacity group-hover:opacity-100",
            item.role === "user" ? "self-end" : "self-start",
          )}
        >
          <MessageAction label="Copy message" onClick={copyMessage} tooltip="Copy">
            {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
          </MessageAction>
        </MessageActions>
      )}
    </Message>
  );
}
