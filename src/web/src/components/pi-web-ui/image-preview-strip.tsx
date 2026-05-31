import { XIcon } from "lucide-react";

import type { PromptImage } from "../../core/types";

export function ImagePreviewStrip({
  images,
  onRemove,
  readonly = false,
}: {
  images?: PromptImage[];
  onRemove?: (index: number) => void;
  readonly?: boolean;
}) {
  if (!images?.length) return null;

  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {images.map((image, index) => (
        <div
          className="relative size-16 overflow-hidden rounded-md border bg-muted"
          key={`${image.mimeType}-${image.data.slice(0, 64)}`}
        >
          <img alt="Attached" className="size-full object-cover" src={`data:${image.mimeType};base64,${image.data}`} />
          {!readonly && (
            <button
              className="absolute right-1 top-1 rounded bg-background/80 p-0.5"
              onClick={() => onRemove?.(index)}
              type="button"
            >
              <XIcon className="size-3" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
