import type { ReactNode } from 'react';
import { XIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';

export function Modal({
  children,
  onClose,
  title,
}: {
  children: ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-background/80 p-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg border bg-popover p-4 shadow-lg"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold text-base">{title}</h2>
          <Button onClick={onClose} size="icon-sm" type="button" variant="ghost">
            <XIcon className="size-4" />
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}
