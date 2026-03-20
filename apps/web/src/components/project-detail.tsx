import { useEffect, useState } from "react";
import { ChannelConfig } from "./channel-config";
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

type ProjectDetailProps = {
  project: ProjectListItem | null;
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
  /** When true, renders without the outer <aside> wrapper (for inline use in expanded card). */
  inline?: boolean;
};

const bulkDescriptions: Record<BulkIntent, string> = {
  hooks: "对选中项目批量启用、禁用或分发 hooks.internal.entries.* 相关改动。",
  skills: "对选中项目批量分发 skill 目录，并 patch skills.entries.* 或 agent skill allowlist。",
  memory: "对选中项目批量追加或删除 Control Panel 写入的记忆块，不直接改 SQLite 索引。",
  config: "对选中项目批量做安全的配置 patch，适合少量高频字段。",
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

const checkLabel: Record<ProjectListItem["compatibility"]["checks"][number]["name"], string> = {
  lifecycle: "Lifecycle",
  gateway_probe: "Gateway Probe",
  web_ui: "Web UI",
  config_patch: "Config Patch",
  hooks: "Hooks",
  skills: "Skills",
  memory: "Memory",
};

const memoryModeLabel: Record<ProjectMemoryMode, string> = {
  normal: "正常记忆",
  locked: "锁定记忆",
  stateless: "白纸模式",
};

const memoryModeDescription: Record<ProjectMemoryMode, string> = {
  normal: "可读可写。允许记忆插件、自动 memory flush，以及后续沉淀长期记忆。",
  locked: "只读记忆。允许读已有记忆，但不再新增 session memory 或 compaction memory。",
  stateless: "完全白纸。既不读记忆，也不写记忆，适合客服机器人或严格无状态 bot。",
};

const sandboxModeLabel: Record<ProjectListItem["sandbox"]["mode"], string> = {
  off: "关闭",
  "non-main": "仅非主会话",
  all: "全部会话",
};

const sandboxScopeLabel: Record<ProjectListItem["sandbox"]["scope"], string> = {
  session: "每会话一个沙箱",
  agent: "每 Agent 一个沙箱",
  shared: "所有会话共享",
};

const workspaceAccessLabel: Record<ProjectListItem["sandbox"]["workspaceAccess"], string> = {
  none: "不暴露工作区",
  ro: "只读工作区",
  rw: "读写工作区",
};

const skillSourceLabel: Record<ProjectListItem["skills"]["catalogEntries"][number]["source"], string> = {
  bundled: "官方",
  managed: "共享",
  workspace: "项目",
  config_only: "仅配置",
};

function deriveTemplateId(project: ProjectListItem): ProjectTemplateId {
  if (project.memory.mode === "stateless" && project.sandbox.mode === "off") {
    return "stateless";
  }

  if (project.sandbox.mode !== "off") {
    return "sandboxed";
  }

  return "general";
}

function formatLastSeen(value: string | null): string {
  if (!value) {
    return "尚未探测到";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatModelLabel(modelRef: string, alias?: string | null): string {
  return alias ? `${alias} · ${modelRef}` : modelRef;
}

export function ProjectDetail({
  project,
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
  inline,
}: ProjectDetailProps) {
  const [modelRef, setModelRef] = useState("");
  const [restartIfRunning, setRestartIfRunning] = useState(true);
  const [memoryMode, setMemoryMode] = useState<ProjectMemoryMode>("normal");
  const [restartMemoryIfRunning, setRestartMemoryIfRunning] = useState(true);
  const [templateId, setTemplateId] = useState<ProjectTemplateId>("general");
  const [restartTemplateIfRunning, setRestartTemplateIfRunning] = useState(true);
  const [draftHookName, setDraftHookName] = useState("");
  const [draftSkillName, setDraftSkillName] = useState("");
  const [showChannelConfig, setShowChannelConfig] = useState(false);

  useEffect(() => {
    if (!project) {
      setModelRef("");
      setRestartIfRunning(true);
      setMemoryMode("normal");
      setRestartMemoryIfRunning(true);
      setTemplateId("general");
      setRestartTemplateIfRunning(true);
      setDraftHookName("");
      setDraftSkillName("");
      return;
    }

    setModelRef(project.model.primaryRef ?? project.model.configuredModels[0]?.ref ?? "");
    setRestartIfRunning(true);
    setMemoryMode(project.memory.mode);
    setRestartMemoryIfRunning(true);
    setTemplateId(deriveTemplateId(project));
    setRestartTemplateIfRunning(true);
    setDraftHookName("");
    setDraftSkillName("");
  }, [project]);

  useEffect(() => {
    setShowChannelConfig(false);
  }, [project?.id]);

  if (!project) {
    if (inline) {
      return null;
    }
    return (
      <aside className="detail-panel">
        <p className="panel-kicker">项目详情</p>
        <h2>选择一个项目</h2>
        <p className="muted-copy">
          点击任意一个项目卡片查看详情。
        </p>
      </aside>
    );
  }

  const selectedTemplate =
    templates.find((template) => template.id === templateId) ?? templates[0] ?? null;
  const projectId = project.id;
  const officialSkillPreview = project.skills.catalogEntries
    .filter((entry) => entry.official)
    .slice(0, 6)
    .map((entry) => entry.name);

  function isCatalogActionBusy(kind: "hook" | "skill", name: string, mode: "enable" | "disable" | "remove") {
    return catalogActionKey === `${kind}:${projectId}:${name}:${mode}`;
  }

  const activeSmokeResult =
    smokeTestResult?.projectId === project.id ? smokeTestResult : project.lastSmokeTest;

  const detailContent = (
    <>
      {!inline ? (
        <>
          <header className="detail-header">
            <div>
              <p className="panel-kicker">项目详情</p>
              <h2>{project.name}</h2>
            </div>
            <div className="project-badges">
              <span className="tag-pill">Port {project.gatewayPort}</span>
              <span className="tag-pill">{project.auth.strategy}</span>
              <span className={`status-pill ${compatibilityTone[project.compatibility.status]}`}>
                {compatibilityLabel[project.compatibility.status]}
              </span>
            </div>
          </header>

          <p className="muted-copy">{project.description}</p>
        </>
      ) : null}

      <div className="detail-actions">
        <a href={project.endpoints.controlUiUrl} target="_blank" rel="noreferrer">
          打开项目 Control UI &#8599;
        </a>
        <a href={project.endpoints.gatewayUrl} target="_blank" rel="noreferrer">
          打开 Gateway &#8599;
        </a>
        <a href={project.endpoints.healthUrl} target="_blank" rel="noreferrer">
          打开 Health &#8599;
        </a>
      </div>

      <div className="panel-action-row">
        <button
          type="button"
          className="ghost-button"
          onClick={() => onRunAction(project.id, "start")}
          disabled={activeAction !== null}
        >
          {activeAction === "start" ? "启动中..." : "启动"}
        </button>
        <button
          type="button"
          className="ghost-button"
          onClick={() => onRunAction(project.id, "stop")}
          disabled={activeAction !== null}
        >
          {activeAction === "stop" ? "停止中..." : "停止"}
        </button>
        <button
          type="button"
          className="ghost-button"
          onClick={() => onRunAction(project.id, "restart")}
          disabled={activeAction !== null}
        >
          {activeAction === "restart" ? "重启中..." : "重启"}
        </button>
        <button type="button" className="ghost-button" onClick={() => onEdit(project.id)}>
          编辑注册表
        </button>
        <button
          type="button"
          className="ghost-button"
          onClick={() => onScanCompatibility(project.id)}
          disabled={scanningCompatibility || activeAction !== null}
        >
          {scanningCompatibility ? "扫描中..." : "重新扫描兼容性"}
        </button>
        <button
          type="button"
          className="ghost-button"
          onClick={() => onRunSmokeTest(project.id)}
          disabled={smokeTesting || activeAction !== null}
        >
          {smokeTesting ? "测试中..." : "运行 Smoke Test"}
        </button>
        <button
          type="button"
          className="ghost-button ghost-button-danger"
          onClick={() => onDelete(project.id)}
          disabled={deleting}
        >
          {deleting ? "删除中..." : "删除项目"}
        </button>
      </div>

      <section className="detail-section">
        <div className="panel-action-row">
          <button
            type="button"
            className="ghost-button"
            onClick={() => setShowChannelConfig((value) => !value)}
            aria-expanded={showChannelConfig}
            aria-controls={`channel-config-panel-${projectId}`}
          >
            {showChannelConfig ? "Channel 配置 ▲" : "Channel 配置 ▼"}
          </button>
        </div>
        {showChannelConfig ? (
          <div id={`channel-config-panel-${projectId}`}>
            <ChannelConfig projectId={projectId} />
          </div>
        ) : null}
      </section>

      <section className="detail-section">
        <p className="section-label">兼容性扫描</p>
        <div className="callout-box">
          <strong>当前结论：</strong> {compatibilityLabel[project.compatibility.status]}
          <br />
          <strong>说明：</strong> {project.compatibility.reason}
          <br />
          <strong>上次扫描：</strong> {formatLastSeen(project.compatibility.lastScannedAt)}
          <br />
          <strong>手动覆盖：</strong>{" "}
          {project.compatibility.manualOverride ? compatibilityLabel[project.compatibility.manualOverride] : "未设置"}
        </div>
        <dl className="detail-list">
          {project.compatibility.checks.map((check) => (
            <div key={check.name}>
              <dt>{checkLabel[check.name]}</dt>
              <dd>
                <span className={`status-pill ${check.supported ? "tone-ok" : "tone-warn"}`}>
                  {check.supported ? "ok" : "partial"}
                </span>{" "}
                {check.message}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="detail-section">
        <p className="section-label">Smoke Test</p>
        {activeSmokeResult ? (
          <>
            <div className="callout-box">
              <strong>最近一次：</strong> {formatLastSeen(activeSmokeResult.finishedAt)}
              <br />
              <strong>通过率：</strong> {activeSmokeResult.summary.passed}/{activeSmokeResult.summary.total}
              <br />
              <strong>Provider / Model：</strong> {activeSmokeResult.summary.provider ?? "unknown"} /{" "}
              {activeSmokeResult.summary.model ?? "unknown"}
            </div>
            <div className="catalog-list">
              {activeSmokeResult.results.map((result) => (
                <article key={result.id} className="catalog-item">
                  <div className="catalog-item-header">
                    <div className="catalog-item-title">
                      <strong>{result.label}</strong>
                      <span className={`status-pill ${result.ok ? "tone-ok" : "tone-bad"}`}>
                        {result.ok ? "pass" : "fail"}
                      </span>
                      <span className="tag-pill">{result.durationMs}ms</span>
                      {result.toolHint ? <span className="tag-pill">{result.toolHint}</span> : null}
                    </div>
                  </div>
                  <div className="catalog-item-meta">{result.outputText || "没有文本输出"}</div>
                  {result.error ? <div className="catalog-item-meta">{result.error}</div> : null}
                </article>
              ))}
            </div>
          </>
        ) : (
          <div className="callout-box callout-box-muted">
            还没有跑过 smoke test。它会问 4 个固定问题，检查模型识别、工具调用和上下文承接。
          </div>
        )}
      </section>

      <section className="detail-section">
        <p className="section-label">Gateway / Auth</p>
        <dl className="detail-list">
          <div>
            <dt>默认 Control Panel auth</dt>
            <dd>{managerAuth?.label ?? "未配置"}</dd>
          </div>
          <div>
            <dt>当前项目 auth</dt>
            <dd>{project.auth.label}</dd>
          </div>
          <div>
            <dt>覆盖模式</dt>
            <dd>{project.auth.mode === "inherit_manager" ? "继承默认" : "项目自定义"}</dd>
          </div>
          <div>
            <dt>最后探测</dt>
            <dd>{formatLastSeen(project.lastSeenAt)}</dd>
          </div>
        </dl>
      </section>

      <section className="detail-section">
        <p className="section-label">默认模型</p>
        <div className="callout-box">
          <strong>当前默认：</strong> {project.model.primaryRef ?? "未显式设置"}<br />
          <strong>最近实测：</strong>{" "}
          {project.model.lastObservedRef
            ? `${project.model.lastObservedProvider ?? "unknown"} / ${project.model.lastObservedRef}`
            : "还没有 smoke test 数据"}
          <br />
          <strong>实测时间：</strong> {formatLastSeen(project.model.lastObservedAt)}
          <br />
          <strong>模型目录：</strong>{" "}
          {project.model.catalogMode === "allowlist"
            ? `allowlist（${project.model.configuredModels.length} 个已配置模型）`
            : "open（未限制 allowlist，可直接手填 provider/model）"}
          <br />
          <strong>Fallback：</strong> {project.model.fallbackRefs.length > 0 ? project.model.fallbackRefs.join(", ") : "未设置"}
        </div>
        {project.model.configuredModels.length > 0 ? (
          <label className="form-field">
            <span>已配置模型</span>
            <select
              value={
                project.model.configuredModels.some((entry) => entry.ref === modelRef) ? modelRef : "__custom__"
              }
              onChange={(event) => {
                if (event.target.value === "__custom__") {
                  return;
                }
                setModelRef(event.target.value);
              }}
              disabled={modelUpdating}
            >
              {project.model.configuredModels.map((entry) => (
                <option key={entry.ref} value={entry.ref}>
                  {formatModelLabel(entry.ref, entry.alias)}
                </option>
              ))}
              <option value="__custom__">手动输入其他模型</option>
            </select>
          </label>
        ) : null}
        <label className="form-field">
          <span>provider/model</span>
          <input
            value={modelRef}
            onChange={(event) => setModelRef(event.target.value)}
            placeholder="anthropic/claude-opus-4-6"
            disabled={modelUpdating}
          />
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={restartIfRunning}
            onChange={(event) => setRestartIfRunning(event.target.checked)}
            disabled={modelUpdating}
          />
          <span>项目运行中时自动重启，让模型变更立即生效</span>
        </label>
        <div className="panel-action-row">
          <button
            type="button"
            className="ghost-button"
            onClick={() => onUpdateModel(project.id, { modelRef, restartIfRunning })}
            disabled={modelUpdating || modelRef.trim().length === 0 || activeAction !== null}
          >
            {modelUpdating ? "保存中..." : "保存默认模型"}
          </button>
        </div>
      </section>

      <section className="detail-section">
        <p className="section-label">记忆策略</p>
        <div className="callout-box">
          <strong>当前模式：</strong> {memoryModeLabel[project.memory.mode]}<br />
          <strong>读取记忆：</strong> {project.memory.canReadMemory ? "允许" : "关闭"}<br />
          <strong>写入记忆：</strong> {project.memory.canWriteMemory ? "允许" : "关闭"}<br />
          <strong>Memory Plugin：</strong> {project.memory.effectivePluginSlot ?? "none"}<br />
          <strong>Session Memory Hook：</strong> {project.memory.sessionMemoryHookEnabled ? "启用" : "关闭"}<br />
          <strong>Memory Flush：</strong> {project.memory.memoryFlushEnabled ? "启用" : "关闭"}
        </div>
        <label className="form-field">
          <span>记忆模式</span>
          <select
            value={memoryMode}
            onChange={(event) => setMemoryMode(event.target.value as ProjectMemoryMode)}
            disabled={memoryUpdating}
          >
            <option value="normal">正常记忆</option>
            <option value="locked">锁定记忆</option>
            <option value="stateless">白纸模式</option>
          </select>
        </label>
        <div className="callout-box callout-box-muted">{memoryModeDescription[memoryMode]}</div>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={restartMemoryIfRunning}
            onChange={(event) => setRestartMemoryIfRunning(event.target.checked)}
            disabled={memoryUpdating}
          />
          <span>项目运行中时自动重启，让记忆策略立即生效</span>
        </label>
        <div className="panel-action-row">
          <button
            type="button"
            className="ghost-button"
            onClick={() => onUpdateMemoryMode(project.id, { mode: memoryMode, restartIfRunning: restartMemoryIfRunning })}
            disabled={memoryUpdating || activeAction !== null || memoryMode === project.memory.mode}
          >
            {memoryUpdating ? "保存中..." : "保存记忆策略"}
          </button>
        </div>
      </section>

      <section className="detail-section">
        <p className="section-label">Hooks</p>
        <div className="callout-box">
          <strong>已配置：</strong> {project.hooks.entries.length} 个
          <br />
          <strong>已启用：</strong> {project.hooks.enabledCount} 个
        </div>
        <div className="form-grid">
          <label className="form-field">
            <span>Hook 名称</span>
            <input
              value={draftHookName}
              onChange={(event) => setDraftHookName(event.target.value)}
              placeholder="daily-summary"
              disabled={catalogActionKey !== null}
            />
          </label>
        </div>
        <div className="panel-action-row">
          <button
            type="button"
            className="ghost-button"
            onClick={() => onManageHook(project.id, draftHookName, "enable")}
            disabled={catalogActionKey !== null || draftHookName.trim().length === 0}
          >
            启用 Hook
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => onManageHook(project.id, draftHookName, "disable")}
            disabled={catalogActionKey !== null || draftHookName.trim().length === 0}
          >
            禁用 Hook
          </button>
          <button
            type="button"
            className="ghost-button ghost-button-danger"
            onClick={() => onManageHook(project.id, draftHookName, "remove")}
            disabled={catalogActionKey !== null || draftHookName.trim().length === 0}
          >
            移除条目
          </button>
        </div>
        {project.hooks.entries.length > 0 ? (
          <div className="catalog-list">
            {project.hooks.entries.map((entry) => (
              <article key={entry.name} className="catalog-item">
                <div className="catalog-item-header">
                  <div className="catalog-item-title">
                    <strong>{entry.name}</strong>
                    <span className={`status-pill ${entry.enabled ? "tone-ok" : "tone-muted"}`}>
                      {entry.enabled ? "enabled" : "disabled"}
                    </span>
                    <span className="tag-pill">internal</span>
                  </div>
                  <div className="catalog-item-actions">
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => onManageHook(project.id, entry.name, "enable")}
                      disabled={catalogActionKey !== null || entry.enabled}
                    >
                      {isCatalogActionBusy("hook", entry.name, "enable") ? "处理中..." : "启用"}
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => onManageHook(project.id, entry.name, "disable")}
                      disabled={catalogActionKey !== null || !entry.enabled}
                    >
                      {isCatalogActionBusy("hook", entry.name, "disable") ? "处理中..." : "禁用"}
                    </button>
                    <button
                      type="button"
                      className="ghost-button ghost-button-danger"
                      onClick={() => onManageHook(project.id, entry.name, "remove")}
                      disabled={catalogActionKey !== null}
                    >
                      {isCatalogActionBusy("hook", entry.name, "remove") ? "处理中..." : "移除"}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="callout-box callout-box-muted">
            当前项目还没有任何 Hook 条目，直接在上面填名字就能创建并启用。
          </div>
        )}
      </section>

      <section className="detail-section">
        <p className="section-label">Skills</p>
        <div className="callout-box">
          <strong>已配置：</strong> {project.skills.configuredEntries.length} 个
          <br />
          <strong>已启用：</strong> {project.skills.enabledCount} 个
          <br />
          <strong>官方技能：</strong> {project.skills.officialCount} 个
          <br />
          <strong>非官方技能：</strong> {project.skills.customCount} 个
        </div>
        {officialSkillPreview.length > 0 ? (
          <div className="callout-box callout-box-muted">
            <strong>官方技能示例</strong>
            <br />
            {officialSkillPreview.join(", ")}
          </div>
        ) : null}
        <div className="form-grid">
          <label className="form-field">
            <span>Skill 名称</span>
            <input
              list={`skill-catalog-${project.id}`}
              value={draftSkillName}
              onChange={(event) => setDraftSkillName(event.target.value)}
              placeholder="github"
              disabled={catalogActionKey !== null}
            />
            <datalist id={`skill-catalog-${project.id}`}>
              {project.skills.catalogEntries.map((entry) => (
                <option key={entry.name} value={entry.name}>
                  {skillSourceLabel[entry.source]}
                </option>
              ))}
            </datalist>
          </label>
        </div>
        <div className="panel-action-row">
          <button
            type="button"
            className="ghost-button"
            onClick={() => onManageSkill(project.id, draftSkillName, "enable")}
            disabled={catalogActionKey !== null || draftSkillName.trim().length === 0}
          >
            启用 Skill
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => onManageSkill(project.id, draftSkillName, "disable")}
            disabled={catalogActionKey !== null || draftSkillName.trim().length === 0}
          >
            禁用 Skill
          </button>
          <button
            type="button"
            className="ghost-button ghost-button-danger"
            onClick={() => onManageSkill(project.id, draftSkillName, "remove")}
            disabled={catalogActionKey !== null || draftSkillName.trim().length === 0}
          >
            移除条目
          </button>
        </div>
        {project.skills.configuredEntries.length > 0 ? (
          <div className="catalog-list">
            {project.skills.configuredEntries.map((entry) => (
              <article key={entry.name} className="catalog-item">
                <div className="catalog-item-header">
                  <div className="catalog-item-title">
                    <strong>{entry.name}</strong>
                    <span className={`status-pill ${entry.enabled ? "tone-ok" : "tone-muted"}`}>
                      {entry.enabled ? "enabled" : "disabled"}
                    </span>
                    <span className="tag-pill">{entry.official ? "official" : "custom"}</span>
                    <span className="tag-pill">{skillSourceLabel[entry.source]}</span>
                  </div>
                  <div className="catalog-item-actions">
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => onManageSkill(project.id, entry.name, "enable")}
                      disabled={catalogActionKey !== null || entry.enabled}
                    >
                      {isCatalogActionBusy("skill", entry.name, "enable") ? "处理中..." : "启用"}
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => onManageSkill(project.id, entry.name, "disable")}
                      disabled={catalogActionKey !== null || !entry.enabled}
                    >
                      {isCatalogActionBusy("skill", entry.name, "disable") ? "处理中..." : "禁用"}
                    </button>
                    <button
                      type="button"
                      className="ghost-button ghost-button-danger"
                      onClick={() => onManageSkill(project.id, entry.name, "remove")}
                      disabled={catalogActionKey !== null}
                    >
                      {isCatalogActionBusy("skill", entry.name, "remove") ? "处理中..." : "移除"}
                    </button>
                  </div>
                </div>
                {entry.path ? <div className="catalog-item-meta">{entry.path}</div> : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="callout-box callout-box-muted">
            当前项目还没有任何 Skill 条目。可以直接输入名字启用，也可以从 datalist 里选官方或本地 Skill。
          </div>
        )}
      </section>

      <section className="detail-section">
        <p className="section-label">Sandbox</p>
        <div className="callout-box">
          <strong>当前模式：</strong> {sandboxModeLabel[project.sandbox.mode]}<br />
          <strong>Backend：</strong> {project.sandbox.backend}<br />
          <strong>Scope：</strong> {sandboxScopeLabel[project.sandbox.scope]}<br />
          <strong>Workspace Access：</strong> {workspaceAccessLabel[project.sandbox.workspaceAccess]}<br />
          <strong>Docker Network：</strong> {project.sandbox.dockerNetwork ?? "默认值"}<br />
          <strong>Docker Image：</strong> {project.sandbox.dockerImage ?? "OpenClaw 默认镜像"}
        </div>
        {project.sandbox.toolAllow.length > 0 || project.sandbox.toolDeny.length > 0 ? (
          <div className="callout-box callout-box-muted">
            <strong>Sandbox Tool Policy</strong>
            <br />
            allow: {project.sandbox.toolAllow.length > 0 ? project.sandbox.toolAllow.join(", ") : "默认"}
            <br />
            deny: {project.sandbox.toolDeny.length > 0 ? project.sandbox.toolDeny.join(", ") : "默认"}
          </div>
        ) : null}
      </section>

      <section className="detail-section">
        <p className="section-label">模板</p>
        <label className="form-field">
          <span>策略模板</span>
          <select
            value={templateId}
            onChange={(event) => setTemplateId(event.target.value as ProjectTemplateId)}
            disabled={templateApplying || templates.length === 0}
          >
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        </label>
        {selectedTemplate ? (
          <>
            <div className="callout-box">
              <strong>{selectedTemplate.summary}</strong>
              <br />
              {selectedTemplate.description}
              <br />
              <strong>模板记忆：</strong> {selectedTemplate.memoryMode}
              <br />
              <strong>模板 Sandbox：</strong> {selectedTemplate.sandbox.mode} / {selectedTemplate.sandbox.backend} /{" "}
              {selectedTemplate.sandbox.scope} / {selectedTemplate.sandbox.workspaceAccess}
            </div>
            <div className="callout-box callout-box-muted">
              {selectedTemplate.notes.map((note) => (
                <div key={note}>{note}</div>
              ))}
            </div>
          </>
        ) : (
          <div className="callout-box callout-box-muted">当前没有可用模板。</div>
        )}
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={restartTemplateIfRunning}
            onChange={(event) => setRestartTemplateIfRunning(event.target.checked)}
            disabled={templateApplying || templates.length === 0}
          />
          <span>项目运行中时自动重启，让模板立即生效</span>
        </label>
        <div className="panel-action-row">
          <button
            type="button"
            className="ghost-button"
            onClick={() =>
              onApplyTemplate(project.id, {
                templateId,
                restartIfRunning: restartTemplateIfRunning,
              })
            }
            disabled={templateApplying || activeAction !== null || selectedTemplate === null}
          >
            {templateApplying ? "套用中..." : "套用模板"}
          </button>
        </div>
      </section>

      <section className="detail-section">
        <p className="section-label">路径</p>
        <dl className="detail-list">
          <div>
            <dt>Root</dt>
            <dd>{project.paths.rootPath}</dd>
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
      </section>

      <section className="detail-section">
        <p className="section-label">单个与批量</p>
        <div className="callout-box">
          <strong>单项目深控：</strong> 直接跳它自己的 Control UI。<br />
          <strong>批量动作：</strong> 由 Control Panel 对选中项目统一执行，不去同时嵌多个 UI。
        </div>
        <div className="callout-box callout-box-muted">
          OpenClaw Control UI 默认禁止 iframe 内嵌，所以第一版仍以新标签打开为主。
        </div>
      </section>

      <section className="detail-section">
        <p className="section-label">批量上下文</p>
        <div className="callout-box">
          <strong>当前已选：</strong> {selectedCount} 个项目
          <br />
          <strong>当前面板：</strong>{" "}
          {bulkIntent ? bulkDescriptions[bulkIntent] : "先在上方批量栏里选一个操作类型。"}
        </div>
      </section>
    </>
  );

  if (inline) {
    return <div className="detail-inline">{detailContent}</div>;
  }

  return <aside className="detail-panel">{detailContent}</aside>;
}
