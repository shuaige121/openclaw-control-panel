import { useEffect, useState, type FormEvent } from "react";
import type {
  ManagerAuthProfile,
  ProjectAuthMode,
  ProjectAuthStrategy,
  ProjectCapabilities,
  ProjectDetailResponse,
  ProjectGatewayBindMode,
  ProjectGatewayProtocol,
  ProjectLifecycleMode,
  ProjectTemplateDefinition,
  ProjectTemplateId,
} from "../types";

type ProjectEditorProps = {
  mode: "create" | "edit";
  managerAuth: ManagerAuthProfile | null;
  templates: ProjectTemplateDefinition[];
  initialProject: ProjectDetailResponse["registry"] | null;
  busy: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onSubmit: (payload: {
    project: Record<string, unknown>;
    templateId: ProjectTemplateId | null;
    applyTemplateAfterCreate: boolean;
    createInstance: boolean;
  }) => Promise<void>;
};

type EditorState = {
  id: string;
  name: string;
  description: string;
  protocol: ProjectGatewayProtocol;
  host: string;
  port: string;
  tags: string;
  rootPath: string;
  configPath: string;
  workspacePath: string;
  authMode: ProjectAuthMode;
  authStrategy: ProjectAuthStrategy;
  authLabel: string;
  authSecret: string;
  lifecycleMode: ProjectLifecycleMode;
  startCommand: string;
  stopCommand: string;
  restartCommand: string;
  lifecycleNodePath: string;
  lifecycleCliPath: string;
  lifecycleBind: ProjectGatewayBindMode;
  lifecycleAllowUnconfigured: boolean;
  lifecycleStartupTimeoutMs: string;
  provisionInstance: boolean;
  provisionModel: string;
  templateId: ProjectTemplateId;
  applyTemplateAfterCreate: boolean;
  bulkHooks: boolean;
  bulkSkills: boolean;
  bulkMemory: boolean;
  bulkConfigPatch: boolean;
};

const DEFAULT_CAPABILITIES: ProjectCapabilities = {
  bulkHooks: true,
  bulkSkills: true,
  bulkMemory: true,
  bulkConfigPatch: true,
};

function createDefaultState(): EditorState {
  return {
    id: "",
    name: "",
    description: "",
    protocol: "http",
    host: "127.0.0.1",
    port: "",
    tags: "",
    rootPath: "",
    configPath: "",
    workspacePath: "",
    authMode: "inherit_manager",
    authStrategy: "token",
    authLabel: "项目自定义 token",
    authSecret: "",
    lifecycleMode: "managed_openclaw",
    startCommand: "",
    stopCommand: "",
    restartCommand: "",
    lifecycleNodePath: "",
    lifecycleCliPath: "",
    lifecycleBind: "loopback",
    lifecycleAllowUnconfigured: true,
    lifecycleStartupTimeoutMs: "15000",
    provisionInstance: true,
    provisionModel: "",
    templateId: "general",
    applyTemplateAfterCreate: true,
    ...DEFAULT_CAPABILITIES,
  };
}

function createStateFromProject(project: ProjectDetailResponse["registry"]): EditorState {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    protocol: project.gateway.protocol,
    host: project.gateway.host,
    port: String(project.gateway.port),
    tags: project.tags.join(", "),
    rootPath: project.paths.rootPath,
    configPath: project.paths.configPath,
    workspacePath: project.paths.workspacePath,
    authMode: project.auth.mode,
    authStrategy: project.auth.strategy,
    authLabel: project.auth.label,
    authSecret: "",
    lifecycleMode: project.lifecycle.mode,
    startCommand: project.lifecycle.mode === "custom_commands" ? project.lifecycle.startCommand : "",
    stopCommand: project.lifecycle.mode === "custom_commands" ? project.lifecycle.stopCommand : "",
    restartCommand: project.lifecycle.mode === "custom_commands" ? project.lifecycle.restartCommand : "",
    lifecycleNodePath:
      project.lifecycle.mode === "managed_openclaw" ? (project.lifecycle.nodePath ?? "") : "",
    lifecycleCliPath:
      project.lifecycle.mode === "managed_openclaw" ? (project.lifecycle.cliPath ?? "") : "",
    lifecycleBind: project.lifecycle.mode === "managed_openclaw" ? project.lifecycle.bind : "loopback",
    lifecycleAllowUnconfigured:
      project.lifecycle.mode === "managed_openclaw" ? project.lifecycle.allowUnconfigured : true,
    lifecycleStartupTimeoutMs:
      project.lifecycle.mode === "managed_openclaw"
        ? String(project.lifecycle.startupTimeoutMs)
        : "15000",
    provisionInstance: false,
    provisionModel: "",
    templateId: "general",
    applyTemplateAfterCreate: false,
    bulkHooks: project.capabilities.bulkHooks,
    bulkSkills: project.capabilities.bulkSkills,
    bulkMemory: project.capabilities.bulkMemory,
    bulkConfigPatch: project.capabilities.bulkConfigPatch,
  };
}

function toTagArray(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function ProjectEditor({
  mode,
  managerAuth,
  templates,
  initialProject,
  busy,
  errorMessage,
  onCancel,
  onSubmit,
}: ProjectEditorProps) {
  const [state, setState] = useState<EditorState>(createDefaultState);
  const [localError, setLocalError] = useState<string | null>(null);
  const selectedTemplate =
    mode === "create"
      ? templates.find((template) => template.id === state.templateId) ?? templates[0] ?? null
      : null;

  useEffect(() => {
    if (mode === "create") {
      setState(createDefaultState());
      setLocalError(null);
      return;
    }

    if (initialProject) {
      setState(createStateFromProject(initialProject));
      setLocalError(null);
    }
  }, [initialProject, mode]);

  function updateField<Key extends keyof EditorState>(key: Key, value: EditorState[Key]) {
    setState((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);

    const isProvisionCreate = mode === "create" && state.provisionInstance;
    const trimmedPort = state.port.trim();
    const parsedPort = trimmedPort.length > 0 ? Number.parseInt(trimmedPort, 10) : undefined;

    if (
      parsedPort !== undefined &&
      (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535)
    ) {
      setLocalError("Gateway port 必须是 1 到 65535 之间的整数。");
      return;
    }

    if (!isProvisionCreate && parsedPort === undefined) {
      setLocalError("Gateway port 必须是 1 到 65535 之间的整数。");
      return;
    }

    if (state.authMode === "custom" && mode === "create" && state.authSecret.trim().length === 0) {
      setLocalError("创建自定义 auth 项目时，secret 不能为空。");
      return;
    }

    const startupTimeoutMs = Number.parseInt(state.lifecycleStartupTimeoutMs, 10);
    if (
      state.lifecycleMode === "managed_openclaw" &&
      (!Number.isInteger(startupTimeoutMs) || startupTimeoutMs < 1000)
    ) {
      setLocalError("托管 OpenClaw 的启动超时至少要 1000ms。");
      return;
    }

    const effectiveLifecycleMode =
      mode === "create" && state.provisionInstance ? "managed_openclaw" : state.lifecycleMode;

    const payload: Record<string, unknown> = {
      id: state.id.trim().toLowerCase(),
      name: state.name.trim(),
      description: state.description.trim(),
      gateway: {
        protocol: state.protocol,
        host: state.host.trim(),
        ...(parsedPort !== undefined ? { port: parsedPort } : {}),
      },
      tags: toTagArray(state.tags),
      auth:
        state.authMode === "inherit_manager"
          ? {
              mode: "inherit_manager",
            }
          : {
              mode: "custom",
              strategy: state.authStrategy,
              label: state.authLabel.trim(),
              ...(state.authSecret.trim().length > 0 ? { secret: state.authSecret.trim() } : {}),
            },
      lifecycle:
        effectiveLifecycleMode === "managed_openclaw"
          ? {
              mode: "managed_openclaw",
              nodePath: state.lifecycleNodePath.trim() || null,
              cliPath: state.lifecycleCliPath.trim() || null,
              bind: state.lifecycleBind,
              allowUnconfigured: state.lifecycleAllowUnconfigured,
              startupTimeoutMs,
            }
          : {
              mode: "custom_commands",
              startCommand: state.startCommand,
              stopCommand: state.stopCommand,
              restartCommand: state.restartCommand,
            },
      capabilities: {
        bulkHooks: state.bulkHooks,
        bulkSkills: state.bulkSkills,
        bulkMemory: state.bulkMemory,
        bulkConfigPatch: state.bulkConfigPatch,
      },
    };

    if (!isProvisionCreate) {
      payload.paths = {
        rootPath: state.rootPath.trim(),
        configPath: state.configPath.trim(),
        workspacePath: state.workspacePath.trim(),
      };
    }

    if (isProvisionCreate) {
      payload.createInstance = true;
      if (state.provisionModel.trim().length > 0) {
        payload.model = state.provisionModel.trim();
      }
      payload.templateId = state.templateId;
      payload.applyTemplateAfterCreate = state.applyTemplateAfterCreate;
    }

    await onSubmit({
      project: payload,
      templateId: mode === "create" ? state.templateId : null,
      applyTemplateAfterCreate: mode === "create" ? state.applyTemplateAfterCreate : false,
      createInstance: isProvisionCreate,
    });
  }

  return (
    <aside className="detail-panel">
      <header className="detail-header">
        <div>
          <p className="panel-kicker">{mode === "create" ? "新增项目" : "编辑项目"}</p>
          <h2>{mode === "create" ? "写入新的项目注册记录" : initialProject?.name ?? "编辑注册表"}</h2>
        </div>
      </header>

      <p className="muted-copy">
        这里只改 manager 注册表，不替代单项目 OpenClaw Control UI。创建后就会进入项目总览卡片。
      </p>

      <div className="callout-box">
        <strong>默认 manager auth：</strong> {managerAuth?.label ?? "未配置"}
        <br />
        <strong>项目 auth：</strong>{" "}
        {state.authMode === "inherit_manager" ? "继承默认" : "项目自定义"}
      </div>

      <form className="project-form" onSubmit={handleSubmit}>
        {mode === "create" ? (
          <section className="detail-section">
            <p className="section-label">模板</p>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={state.provisionInstance}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setState((current) => ({
                    ...current,
                    provisionInstance: checked,
                    applyTemplateAfterCreate: checked ? true : current.applyTemplateAfterCreate,
                    lifecycleMode: checked ? "managed_openclaw" : current.lifecycleMode,
                  }));
                }}
                disabled={busy}
              />
              <span>创建并初始化新的 OpenClaw 实例</span>
            </label>
            <div className="callout-box callout-box-muted">
              {state.provisionInstance
                ? "创建时会自动找空闲 port、写入 openclaw.json、初始化 workspace，并把 main agent 的 auth/models 以共享链接方式接进来。"
                : "关闭后就只是写一条 registry 记录，不会在磁盘上创建新的 OpenClaw 实例。"}
            </div>
            <label className="form-field">
              <span>项目模板</span>
              <select
                value={state.templateId}
                onChange={(event) => updateField("templateId", event.target.value as ProjectTemplateId)}
                disabled={busy}
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
                  <strong>记忆：</strong> {selectedTemplate.memoryMode}
                  <br />
                  <strong>Sandbox：</strong> {selectedTemplate.sandbox.mode} / {selectedTemplate.sandbox.backend} /{" "}
                  {selectedTemplate.sandbox.scope} / {selectedTemplate.sandbox.workspaceAccess}
                </div>
                <div className="callout-box callout-box-muted">
                  {selectedTemplate.notes.map((note) => (
                    <div key={note}>{note}</div>
                  ))}
                </div>
              </>
            ) : (
              <div className="callout-box callout-box-muted">
                当前没有可用模板，先按普通项目写入注册表。
              </div>
            )}
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={state.applyTemplateAfterCreate}
                onChange={(event) => updateField("applyTemplateAfterCreate", event.target.checked)}
                disabled={busy || selectedTemplate === null}
              />
              <span>
                {state.provisionInstance
                  ? "创建时立即按模板写入 memory / sandbox 配置"
                  : "创建后立即把模板写进目标项目的 `openclaw.json`"}
              </span>
            </label>
            {state.provisionInstance ? (
              <label className="form-field">
                <span>默认模型（留空用 provisioner 默认）</span>
                <input
                  value={state.provisionModel}
                  onChange={(event) => updateField("provisionModel", event.target.value)}
                  placeholder="例如 openai-codex/gpt-5.4"
                  disabled={busy}
                />
              </label>
            ) : null}
          </section>
        ) : null}

        <section className="detail-section">
          <p className="section-label">基础信息</p>
          <div className="form-grid">
            <label className="form-field">
              <span>项目 ID</span>
              <input
                value={state.id}
                onChange={(event) => updateField("id", event.target.value)}
                placeholder="例如 main-prod"
                disabled={mode === "edit" || busy}
              />
            </label>
            <label className="form-field">
              <span>项目名</span>
              <input
                value={state.name}
                onChange={(event) => updateField("name", event.target.value)}
                placeholder="例如 Main Assistant"
                disabled={busy}
              />
            </label>
            <label className="form-field form-field-full">
              <span>描述</span>
              <textarea
                value={state.description}
                onChange={(event) => updateField("description", event.target.value)}
                rows={3}
                placeholder="这个项目是做什么的"
                disabled={busy}
              />
            </label>
            <label className="form-field form-field-full">
              <span>Tags</span>
              <input
                value={state.tags}
                onChange={(event) => updateField("tags", event.target.value)}
                placeholder="prod, default, ops"
                disabled={busy}
              />
            </label>
          </div>
        </section>

        <section className="detail-section">
          <p className="section-label">Gateway</p>
          <div className="form-grid">
            <label className="form-field">
              <span>Protocol</span>
              <select
                value={state.protocol}
                onChange={(event) => updateField("protocol", event.target.value as ProjectGatewayProtocol)}
                disabled={busy}
              >
                <option value="http">http</option>
                <option value="https">https</option>
              </select>
            </label>
            <label className="form-field">
              <span>Host</span>
              <input
                value={state.host}
                onChange={(event) => updateField("host", event.target.value)}
                placeholder="127.0.0.1"
                disabled={busy}
              />
            </label>
            <label className="form-field">
              <span>Port</span>
              <input
                value={state.port}
                onChange={(event) => updateField("port", event.target.value)}
                placeholder={mode === "create" && state.provisionInstance ? "留空自动分配" : "18789"}
                inputMode="numeric"
                disabled={busy}
              />
            </label>
          </div>
        </section>

        {mode === "create" && state.provisionInstance ? (
          <section className="detail-section">
            <p className="section-label">路径</p>
            <div className="callout-box callout-box-muted">
              manager 会自动生成 profile state 目录、`openclaw.json` 和 workspace 路径，不需要手填。
            </div>
          </section>
        ) : (
          <section className="detail-section">
            <p className="section-label">路径</p>
            <div className="form-grid">
              <label className="form-field form-field-full">
                <span>Root Path</span>
                <input
                  value={state.rootPath}
                  onChange={(event) => updateField("rootPath", event.target.value)}
                  placeholder="/srv/openclaw/projects/main"
                  disabled={busy}
                />
              </label>
              <label className="form-field form-field-full">
                <span>Config Path</span>
                <input
                  value={state.configPath}
                  onChange={(event) => updateField("configPath", event.target.value)}
                  placeholder="/srv/openclaw/projects/main/openclaw.json"
                  disabled={busy}
                />
              </label>
              <label className="form-field form-field-full">
                <span>Workspace Path</span>
                <input
                  value={state.workspacePath}
                  onChange={(event) => updateField("workspacePath", event.target.value)}
                  placeholder="/srv/openclaw/projects/main/workspace"
                  disabled={busy}
                />
              </label>
            </div>
          </section>
        )}

        <section className="detail-section">
          <p className="section-label">Auth</p>
          <div className="form-grid">
            <label className="form-field">
              <span>Auth 模式</span>
              <select
                value={state.authMode}
                onChange={(event) => updateField("authMode", event.target.value as ProjectAuthMode)}
                disabled={busy}
              >
                <option value="inherit_manager">继承 manager 默认 auth</option>
                <option value="custom">项目自定义 auth</option>
              </select>
            </label>
            {state.authMode === "custom" ? (
              <>
                <label className="form-field">
                  <span>Strategy</span>
                  <select
                    value={state.authStrategy}
                    onChange={(event) =>
                      updateField("authStrategy", event.target.value as ProjectAuthStrategy)
                    }
                    disabled={busy}
                  >
                    <option value="token">token</option>
                    <option value="password">password</option>
                  </select>
                </label>
                <label className="form-field form-field-full">
                  <span>Auth Label</span>
                  <input
                    value={state.authLabel}
                    onChange={(event) => updateField("authLabel", event.target.value)}
                    placeholder="项目自定义 token"
                    disabled={busy}
                  />
                </label>
                <label className="form-field form-field-full">
                  <span>{mode === "edit" ? "新的 Secret（留空则沿用旧值）" : "Secret"}</span>
                  <input
                    type="password"
                    value={state.authSecret}
                    onChange={(event) => updateField("authSecret", event.target.value)}
                    placeholder={mode === "edit" ? "不改就留空" : "输入 token 或 password"}
                    disabled={busy}
                  />
                </label>
              </>
            ) : null}
          </div>
        </section>

        <section className="detail-section">
          <p className="section-label">Lifecycle</p>
          <div className="form-grid">
            <label className="form-field">
              <span>运行模式</span>
              <select
                value={mode === "create" && state.provisionInstance ? "managed_openclaw" : state.lifecycleMode}
                onChange={(event) => updateField("lifecycleMode", event.target.value as ProjectLifecycleMode)}
                disabled={busy || (mode === "create" && state.provisionInstance)}
              >
                <option value="managed_openclaw">Manager 托管 OpenClaw</option>
                <option value="custom_commands">自定义命令</option>
              </select>
            </label>
            {((mode === "create" && state.provisionInstance) || state.lifecycleMode === "managed_openclaw") ? (
              <>
                <label className="form-field">
                  <span>Bind</span>
                  <select
                    value={state.lifecycleBind}
                    onChange={(event) =>
                      updateField("lifecycleBind", event.target.value as ProjectGatewayBindMode)
                    }
                    disabled={busy}
                  >
                    <option value="loopback">loopback</option>
                    <option value="lan">lan</option>
                  </select>
                </label>
                <label className="form-field">
                  <span>启动超时 (ms)</span>
                  <input
                    value={state.lifecycleStartupTimeoutMs}
                    onChange={(event) => updateField("lifecycleStartupTimeoutMs", event.target.value)}
                    inputMode="numeric"
                    disabled={busy}
                  />
                </label>
                <label className="form-field form-field-full">
                  <span>CLI Path（留空自动探测 `rootPath/openclaw.mjs` 或 PATH）</span>
                  <input
                    value={state.lifecycleCliPath}
                    onChange={(event) => updateField("lifecycleCliPath", event.target.value)}
                    placeholder="例如 /home/leonard/openclaw/openclaw.mjs"
                    disabled={busy}
                  />
                </label>
                <label className="form-field form-field-full">
                  <span>Node Path（留空用 manager 当前 Node）</span>
                  <input
                    value={state.lifecycleNodePath}
                    onChange={(event) => updateField("lifecycleNodePath", event.target.value)}
                    placeholder="/usr/bin/node"
                    disabled={busy}
                  />
                </label>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={state.lifecycleAllowUnconfigured}
                    onChange={(event) =>
                      updateField("lifecycleAllowUnconfigured", event.target.checked)
                    }
                    disabled={busy}
                  />
                  <span>启动时附加 `--allow-unconfigured`</span>
                </label>
                <div className="callout-box callout-box-muted">
                  manager 会直接用 `gateway run` 在后台起一个独立 OpenClaw 进程，并自己维护 pid 和日志。
                </div>
              </>
            ) : (
              <>
                <label className="form-field form-field-full">
                  <span>Start Command</span>
                  <textarea
                    value={state.startCommand}
                    onChange={(event) => updateField("startCommand", event.target.value)}
                    rows={2}
                    disabled={busy}
                  />
                </label>
                <label className="form-field form-field-full">
                  <span>Stop Command</span>
                  <textarea
                    value={state.stopCommand}
                    onChange={(event) => updateField("stopCommand", event.target.value)}
                    rows={2}
                    disabled={busy}
                  />
                </label>
                <label className="form-field form-field-full">
                  <span>Restart Command</span>
                  <textarea
                    value={state.restartCommand}
                    onChange={(event) => updateField("restartCommand", event.target.value)}
                    rows={2}
                    disabled={busy}
                  />
                </label>
              </>
            )}
          </div>
        </section>

        <section className="detail-section">
          <p className="section-label">Capabilities</p>
          <div className="checkbox-grid">
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={state.bulkHooks}
                onChange={(event) => updateField("bulkHooks", event.target.checked)}
                disabled={busy}
              />
              <span>允许批量 Hook</span>
            </label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={state.bulkSkills}
                onChange={(event) => updateField("bulkSkills", event.target.checked)}
                disabled={busy}
              />
              <span>允许批量 Skill</span>
            </label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={state.bulkMemory}
                onChange={(event) => updateField("bulkMemory", event.target.checked)}
                disabled={busy}
              />
              <span>允许批量记忆</span>
            </label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={state.bulkConfigPatch}
                onChange={(event) => updateField("bulkConfigPatch", event.target.checked)}
                disabled={busy}
              />
              <span>允许批量配置 Patch</span>
            </label>
          </div>
        </section>

        {localError || errorMessage ? (
          <div className="callout-box callout-box-danger">{localError ?? errorMessage}</div>
        ) : null}

        <div className="panel-action-row">
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? "保存中..." : mode === "create" ? "创建项目" : "保存修改"}
          </button>
          <button type="button" className="ghost-button" onClick={onCancel} disabled={busy}>
            取消
          </button>
        </div>
      </form>
    </aside>
  );
}
