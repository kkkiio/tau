import { CheckIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { formatTokens, shortModelName } from "../../core/format";
import type { ModelInfo } from "../../core/types";
import { Modal } from "./modal";

export function ModelPicker({
  currentModel,
  models,
  onClose,
  onSelect,
  query,
  setQuery,
}: {
  currentModel: ModelInfo | null;
  models: ModelInfo[];
  onClose: () => void;
  onSelect: (model: ModelInfo) => void;
  query: string;
  setQuery: (query: string) => void;
}) {
  const filtered = models.filter((model) =>
    `${model.provider || ""} ${model.id}`.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <Modal onClose={onClose} title="Switch Model">
      <Input
        autoFocus
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search models..."
        value={query}
      />
      <div className="mt-3 max-h-96 overflow-y-auto">
        {filtered.map((model) => (
          <button
            className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left hover:bg-muted"
            key={`${model.provider}-${model.id}`}
            onClick={() => onSelect(model)}
            type="button"
          >
            <div>
              <div className="text-sm">{shortModelName(model.id)}</div>
              <div className="text-muted-foreground text-xs">
                {model.provider}
                {model.contextWindow ? ` / ${formatTokens(model.contextWindow)}` : ""}
              </div>
            </div>
            {currentModel?.id === model.id && <CheckIcon className="size-4" />}
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="px-3 py-8 text-center text-muted-foreground text-sm">No models found</div>
        )}
      </div>
      <div className="mt-4 flex justify-end">
        <Button onClick={onClose} type="button" variant="outline">
          Close
        </Button>
      </div>
    </Modal>
  );
}
