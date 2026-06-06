import { PanelLeftCloseIcon, PanelLeftOpenIcon, Settings2Icon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AppSidebar({
  open,
  onToggle,
  onOpenSettings,
  children,
}: {
  open: boolean;
  onToggle: (open: boolean) => void;
  onOpenSettings: () => void;
  children: ReactNode;
}) {
  return (
    <aside
      data-state={open ? "expanded" : "collapsed"}
      className={cn(
        "relative h-full shrink-0 overflow-hidden border-r bg-background",
        "transition-[width] duration-200 ease-[cubic-bezier(0.2,0,0,1)]",
      )}
      style={
        {
          "--pi-sidebar-width": open ? "20rem" : "3rem",
          width: open ? "20rem" : "3rem",
        } as CSSProperties
      }
    >
      {/* Expanded content — always rendered at 320px, clipped by outer overflow */}
      <div
        aria-hidden={!open}
        className={cn(
          "absolute inset-y-0 left-0 flex flex-col",
          "w-80 min-w-80",
          "transition-opacity duration-150",
          open ? "pointer-events-auto opacity-100 delay-75" : "pointer-events-none opacity-0",
        )}
      >
        {children}
      </div>

      {/* Collapsed rail — always rendered at 48px */}
      <div
        aria-hidden={open}
        className={cn(
          "absolute inset-y-0 left-0 flex flex-col items-center",
          "w-12",
          "transition-opacity duration-150",
          open ? "pointer-events-none opacity-0" : "pointer-events-auto opacity-100 delay-75",
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-center">
          <Button onClick={() => onToggle(true)} size="icon-sm" type="button" variant="ghost">
            <PanelLeftOpenIcon className="size-4" />
          </Button>
        </div>
        <div className="flex-1" />
        <div className="flex h-14 shrink-0 items-center justify-center">
          <Button onClick={onOpenSettings} size="icon-sm" type="button" variant="ghost">
            <Settings2Icon className="size-4" />
          </Button>
        </div>
      </div>
    </aside>
  );
}
