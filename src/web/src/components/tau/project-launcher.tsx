import { CircleIcon, FolderOpenIcon, PlayIcon } from "lucide-react";

import type { LaunchProject } from "../../tau/types";

export function ProjectLauncher({
  loading,
  onLaunch,
  projects,
}: {
  loading: boolean;
  onLaunch: (path: string) => void;
  projects: LaunchProject[];
}) {
  if (loading) return <div className="p-4 text-muted-foreground text-sm">Loading projects...</div>;

  if (!projects.length) {
    return (
      <div className="p-4 text-muted-foreground text-sm">
        No projects directory configured. Add <code>tau.projectsDir</code> to settings.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {[...projects]
        .sort(
          (a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)) || (b.lastActive || 0) - (a.lastActive || 0),
        )
        .map((project) => (
          <button
            className="flex w-full items-center gap-3 rounded-md border bg-card px-3 py-3 text-left hover:bg-muted"
            key={project.path}
            onClick={() => onLaunch(project.path)}
            type="button"
          >
            <FolderOpenIcon className="size-4 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{project.name}</div>
              <div className="truncate text-muted-foreground text-xs">{project.path}</div>
            </div>
            {project.active ? (
              <CircleIcon className="size-2 fill-emerald-500 text-emerald-500" />
            ) : (
              <PlayIcon className="size-4 text-muted-foreground" />
            )}
          </button>
        ))}
    </div>
  );
}
