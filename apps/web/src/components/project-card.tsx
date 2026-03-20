import type { MouseEvent } from "react";
import { ProjectDetail } from "./project-detail";
import type {
  BulkIntent,
  ManagerAuthProfile,
  ProjectActionName,
  ProjectListItem,
  ProjectMemoryMode,
  ProjectSmokeTestResponse,
  ProjectTemplateDefinition,
  ProjectTemplateId,
} from "../types";

type ProjectCardProps = {
  project: ProjectListItem;
  selected: boolean;
  expanded: boolean;
  managerAuth: ManagerAuthProfile | null;
  bulkIntent: BulkIntent | null;
  selectedCount: number;
  deleting: boolean;
  activeAction: ProjectActionName | null;
  scanningCompatibility: boolean;
  smokeTesting: boolean;
  modelUpdating: boolean;
  memoryUpdating: boolean;
  templateApplying: boolean;
  catalogActionKey: string | null;
  smokeTestResult: ProjectSmokeTestResponse | null;
  templates: ProjectTemplateDefinition[];
  onToggleExpand: (projectId: string) => void;
  onToggleSelection: (projectId: string) => void;
  onEdit: (projectId: string) => void;
  onDelete: (projectId: string) => void;
  onRunAction: (projectId: string, action: ProjectActionName) => void;
  onScanCompatibility: (projectId: string) => void;
  onRunSmokeTest: (projectId: string) => void;
  onUpdateModel: (projectId: string, payload: { modelRef: string; restartIfRunning: boolean }) => void;
  onUpdateMemoryMode: (
    projectId: string,
    payload: { mode: ProjectMemoryMode; restartIfRunning: boolean },
  ) => void;
  onApplyTemplate: (
    projectId: string,
    payload: { templateId: ProjectTemplateId; restartIfRunning: boolean },
  ) => void;
  onManageHook: (
    projectId: string,
    hookName: string,
    mode: "enable" | "disable" | "remove",
  ) => void;
  onManageSkill: (
    projectId: string,
    skillName: string,
    mode: "enable" | "disable" | "remove",
  ) => void;
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

function formatObservedModel(project: ProjectListItem): string {
  if (project.model.primaryRef && project.model.lastObservedRef) {
    if (project.model.primaryRef === project.model.lastObservedRef) {
      return project.model.primaryRef;
    }

    return `${project.model.primaryRef} · 实测 ${project.model.lastObservedRef}`;
  }

  return project.model.primaryRef ?? project.model.lastObservedRef ?? "未显式设置";
}

function formatSmokeSummary(project: ProjectListItem): string {
  const smoke = project.lastSmokeTest;
  if (!smoke) {
    return "未测试";
  }

  return `${smoke.summary.passed}/${smoke.summary.total}`;
}

export function ProjectCard({
  project,
  selected,
  expanded,
  managerAuth,
  bulkIntent,
  selectedCount,
  deleting,
  activeAction,
  scanningCompatibility,
  smokeTesting,
  modelUpdating,
  memoryUpdating,
  templateApplying,
  catalogActionKey,
  smokeTestResult,
  templates,
  onToggleExpand,
  onToggleSelection,
  onEdit,
  onDelete,
  onRunAction,
  onScanCompatibility,
  onRunSmokeTest,
  onUpdateModel,
  onUpdateMemoryMode,
  onApplyTemplate,
  onManageHook,
  onManageSkill,
}: ProjectCardProps) {
  return (
    <article
      className={`project-card${expanded ? " project-card-expanded" : ""}`}
      onClick={() => onToggleExpand(project.id)}
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
        {expanded ? (
          <button
            type="button"
            className="ghost-button card-collapse-button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleExpand(project.id);
            }}
          >
            收起
          </button>
        ) : null}
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
          <dd>{formatObservedModel(project)}</dd>
        </div>
        <div>
          <dt>Memory</dt>
          <dd>{project.memory.mode}</dd>
        </div>
        <div>
          <dt>Smoke</dt>
          <dd>{formatSmokeSummary(project)}</dd>
        </div>
        <div>
          <dt>Sandbox</dt>
          <dd>{project.sandbox.mode}</dd>
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
          打开 Control UI &#8599;
        </a>
        <a href={project.endpoints.gatewayUrl} target="_blank" rel="noreferrer">
          打开 Gateway &#8599;
        </a>
      </footer>

      {expanded ? (
        <div className="project-card-detail" onClick={stopCardClick}>
          <div className="project-card-detail-divider" />
          <ProjectDetail
            project={project}
            managerAuth={managerAuth}
            bulkIntent={bulkIntent}
            selectedCount={selectedCount}
            deleting={deleting}
            activeAction={activeAction}
            scanningCompatibility={scanningCompatibility}
            smokeTesting={smokeTesting}
            modelUpdating={modelUpdating}
            memoryUpdating={memoryUpdating}
            templateApplying={templateApplying}
            catalogActionKey={catalogActionKey}
            smokeTestResult={smokeTestResult}
            templates={templates}
            onEdit={onEdit}
            onDelete={onDelete}
            onRunAction={onRunAction}
            onScanCompatibility={onScanCompatibility}
            onRunSmokeTest={onRunSmokeTest}
            onUpdateModel={onUpdateModel}
            onUpdateMemoryMode={onUpdateMemoryMode}
            onApplyTemplate={onApplyTemplate}
            onManageHook={onManageHook}
            onManageSkill={onManageSkill}
            inline
          />
        </div>
      ) : null}
    </article>
  );
}
