import { CheckIcon, CopyIcon, PencilIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";

import type { ChatItem } from "../../core/types";
import { ImagePreviewStrip } from "./image-preview-strip";

export function UserMessageView({
  item,
  onCopy,
  onEdit,
}: {
  item: ChatItem & { kind: "message"; role: "user" };
  onCopy: (text: string) => Promise<void> | void;
  onEdit?: (entryId: string, newText: string) => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const autoResize = useCallback((ta: HTMLTextAreaElement) => {
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, []);

  const startEditing = useCallback(() => {
    setEditText(item.text);
    setEditError(null);
    setEditing(true);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        autoResize(ta);
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    });
  }, [item.text, autoResize]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    setEditText("");
    setEditError(null);
  }, []);

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setEditText(e.target.value);
      autoResize(e.target);
    },
    [autoResize],
  );

  const submitEdit = useCallback(async () => {
    if (!onEdit || !editText.trim() || !item.entryId) return;
    setSaving(true);
    setEditError(null);
    try {
      await onEdit(item.entryId, editText);
      setEditing(false);
      setEditText("");
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Edit failed");
    } finally {
      setSaving(false);
    }
  }, [editText, item.entryId, onEdit]);

  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submitEdit();
      } else if (e.key === "Escape") {
        cancelEditing();
      }
    },
    [submitEdit, cancelEditing],
  );

  const canCopy = item.text.trim().length > 0 && !item.streaming && !editing;

  const copyMessage = async () => {
    if (!canCopy) return;
    await onCopy(item.text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <Message className="is-user ml-auto justify-end" from="user">
      {editing ? (
        <div className="flex w-full flex-col gap-2">
          <textarea
            ref={textareaRef}
            className="w-full resize-none rounded-md bg-background px-3 py-2 text-sm text-foreground outline-none ring-1 ring-border focus:ring-2 focus:ring-ring"
            disabled={saving}
            onChange={handleInput}
            onKeyDown={handleEditKeyDown}
            rows={1}
            value={editText}
          />
          {editError && <div className="text-destructive text-xs">{editError}</div>}
          <div className="flex items-center gap-1 self-end">
            <Button disabled={saving} onClick={cancelEditing} size="sm" type="button" variant="ghost">
              Cancel
            </Button>
            <Button disabled={saving || !editText.trim()} onClick={submitEdit} size="sm" type="button">
              {saving ? "Saving..." : "Save & Send"}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <MessageContent className="is-user:dark ml-auto min-w-0 max-w-full rounded-lg bg-secondary px-4 py-3 text-sm text-foreground">
            {item.images && <ImagePreviewStrip images={item.images} readonly />}
            <MessageResponse>{item.text}</MessageResponse>
          </MessageContent>
          <MessageActions className="self-end opacity-0 transition-opacity group-hover:opacity-100">
            {canCopy && (
              <MessageAction label="Copy message" onClick={copyMessage} tooltip="Copy">
                {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
              </MessageAction>
            )}
            <MessageAction
              disabled={!onEdit}
              label="Edit message"
              onClick={startEditing}
              tooltip={onEdit ? "Edit" : "Run /tau in terminal to enable editing"}
            >
              <PencilIcon className="size-4" />
            </MessageAction>
          </MessageActions>
        </>
      )}
    </Message>
  );
}
