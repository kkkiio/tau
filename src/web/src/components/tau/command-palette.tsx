import type { CommandAction } from "../../tau/types";
import { Modal } from "./modal";

export function CommandPalette({ commands, onClose }: { commands: CommandAction[]; onClose: () => void }) {
  return (
    <Modal onClose={onClose} title="Commands">
      <div className="space-y-1">
        {commands.map((command) => {
          const Icon = command.icon;
          return (
            <button
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-muted"
              key={command.label}
              onClick={() => {
                onClose();
                command.action();
              }}
              type="button"
            >
              <Icon className="size-4 text-muted-foreground" />
              <div>
                <div className="text-sm">{command.label}</div>
                <div className="text-muted-foreground text-xs">{command.desc}</div>
              </div>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
