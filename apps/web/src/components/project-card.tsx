import type { MouseEvent } from "react";
import type { ProjectListItem } from "../types";

type ProjectCardProps = {
  project: ProjectListItem;
  selected: boolean;
  active: boolean;
  onSelect: (projectId: string) => void;
  onToggleSelection: (projectId: string) => void;
};

const runtimeTone: Record<ProjectListItem["runtimeStatus"], string> = {
  running: "tone-ok",
  starting: "tone-warn",
  stopped: "tone-muted",
  error: "tone-bad",
};

const healthTone: Record<ProjectListItem["healthStatus"], string> = {
  healthy: "tone-ok",
  degraded: "tone-warn",
  unknown: "tone-muted",
  unhealthy: "tone-bad",
};

const compatibilityTone: Record<ProjectListItem["compatibility"]["status"], string> = {
  full: "tone-ok",
  runtime_only: "tone-warn",
  incompatible: "tone-bad",
};

const compatibilityLabel: Record<ProjectListItem["compatibility"]["status"], string> = {
  full: "完美适配",
  runtime_only: "运行兼容",
  incompatible: "高风险",
};

function stopCardClick(event: MouseEvent<HTMLElement>) {
  event.stopPropagation();
}

export function ProjectCard({
  project,
  selected,
  active,
  onSelect,
  onToggleSelection,
}: ProjectCardProps) {
  return (
    <article
      className={`project-card${active ? " project-card-active" : ""}`}
      onClick={() => onSelect(project.id)}
    >
      <header className="project-card-header">
        <label className="selection-toggle" onClick={stopCardClick}>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelection(project.id)}
          />
          <span>选择</span>
        </label>
        <div className="project-badges">
          <span className={`status-pill ${runtimeTone[project.runtimeStatus]}`}>
            {project.runtimeStatus}
          </span>
          <span className={`status-pill ${healthTone[project.healthStatus]}`}>
            {project.healthStatus}
          </span>
          <span className={`status-pill ${compatibilityTone[project.compatibility.status]}`}>
            {compatibilityLabel[project.compatibility.status]}
          </span>
        </div>
      </header>

      <div className="project-card-body">
        <div>
          <p className="card-kicker">Gateway {project.gatewayPort}</p>
          <h3>{project.name}</h3>
        </div>
        <p className="project-description">{project.description}</p>
      </div>

      <dl className="project-meta">
        <div>
          <dt>Auth</dt>
          <dd>{project.auth.label}</dd>
        </div>
        <div>
          <dt>Model</dt>
          <dd>{project.model.primaryRef ?? "未显式设置"}</dd>
        </div>
        <div>
          <dt>Memory</dt>
          <dd>{project.memory.mode}</dd>
        </div>
        <div>
          <dt>Config</dt>
          <dd>{project.paths.configPath}</dd>
        </div>
        <div>
          <dt>Workspace</dt>
          <dd>{project.paths.workspacePath}</dd>
        </div>
      </dl>

      <div className="project-tags">
        {project.tags.map((tag) => (
          <span key={tag} className="tag-pill">
            {tag}
          </span>
        ))}
      </div>

      <footer className="project-actions" onClick={stopCardClick}>
        <a href={project.endpoints.controlUiUrl} target="_blank" rel="noreferrer">
          打开 Control UI
        </a>
        <a href={project.endpoints.gatewayUrl} target="_blank" rel="noreferrer">
          打开 Gateway
        </a>
      </footer>
    </article>
  );
}
