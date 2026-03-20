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
  ProjectUpsertPayload,
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
    project: ProjectUpsertPayload;
    templateId: ProjectTemplateId | null;
    applyTemplateAfterCreate: boolean;
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
  templateId: ProjectTemplateId;
  applyTemplateAfterCreate: boolean;
  bulkHooks: boolean;
  bulkSkills: boolean;
  bulkMemory: boolean;
  bulkConfigPatch: boolean;
};

type ChannelType = "none" | "telegram" | "wecom" | "feishu";

type SimpleCreatorState = {
  botName: string;
  channelType: ChannelType;
  telegramToken: string;
  wecomBotId: string;
  wecomSecret: string;
  feishuAppId: string;
  feishuAppSecret: string;
  port: string;
};

const DEFAULT_CAPABILITIES: ProjectCapabilities = {
  bulkHooks: true,
  bulkSkills: true,
  bulkMemory: true,
  bulkConfigPatch: true,
};

function generatePort(): number {
  return 18800 + Math.floor(Math.random() * 200);
}

function generateProjectId(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (/[\u4e00-\u9fff]/.test(cleaned) || cleaned.length === 0) {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let id = "bot-";
    for (let i = 0; i < 6; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
  }

  return cleaned.length > 32 ? cleaned.slice(0, 32) : cleaned;
}

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
    authLabel: "自定义 token",
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
    templateId: "general",
    applyTemplateAfterCreate: false,
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

const CHANNEL_OPTIONS: { value: ChannelType; label: string }[] = [
  { value: "telegram", label: "Telegram Bot" },
  { value: "wecom", label: "企业微信" },
  { value: "feishu", label: "飞书" },
  { value: "none", label: "仅本地使用（无消息通道）" },
];

function SimpleCreatorForm({
  busy,
  errorMessage,
  onCancel,
  onSubmit,
  templates,
}: {
  busy: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onSubmit: ProjectEditorProps["onSubmit"];
  templates: ProjectTemplateDefinition[];
}) {
  const [simple, setSimple] = useState<SimpleCreatorState>({
    botName: "",
    channelType: "none",
    telegramToken: "",
    wecomBotId: "",
    wecomSecret: "",
    feishuAppId: "",
    feishuAppSecret: "",
    port: String(generatePort()),
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advanced, setAdvanced] = useState<EditorState>(createDefaultState);
  const [localError, setLocalError] = useState<string | null>(null);
  const [generatedId, setGeneratedId] = useState("");

  useEffect(() => {
    setGeneratedId(generateProjectId(simple.botName));
  }, [simple.botName]);

  function updateSimple<K extends keyof SimpleCreatorState>(key: K, value: SimpleCreatorState[K]) {
    setSimple((current) => ({ ...current, [key]: value }));
  }

  function updateAdvanced<K extends keyof EditorState>(key: K, value: EditorState[K]) {
    setAdvanced((current) => ({ ...current, [key]: value }));
  }

  const selectedTemplate = templates.find((t) => t.id === advanced.templateId) ?? templates[0] ?? null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);

    const name = simple.botName.trim();
    if (name.length === 0) {
      setLocalError("请输入机器人名称。");
      return;
    }

    const port = Number.parseInt(simple.port, 10);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      setLocalError("端口必须是 1 到 65535 之间的整数。");
      return;
    }

    if (simple.channelType === "telegram" && simple.telegramToken.trim().length === 0) {
      setLocalError("请输入 Telegram Bot Token。");
      return;
    }
    if (simple.channelType === "wecom") {
      if (simple.wecomBotId.trim().length === 0) {
        setLocalError("请输入企业微信 Bot ID。");
        return;
      }
      if (simple.wecomSecret.trim().length === 0) {
        setLocalError("请输入企业微信 Secret。");
        return;
      }
    }
    if (simple.channelType === "feishu") {
      if (simple.feishuAppId.trim().length === 0) {
        setLocalError("请输入飞书 App ID。");
        return;
      }
      if (simple.feishuAppSecret.trim().length === 0) {
        setLocalError("请输入飞书 App Secret。");
        return;
      }
    }

    const projectId = showAdvanced && advanced.id.trim().length > 0
      ? advanced.id.trim().toLowerCase()
      : generatedId;
    const rootPath = showAdvanced && advanced.rootPath.trim().length > 0
      ? advanced.rootPath.trim()
      : `~/.openclaw/instances/${projectId}`;
    const configPath = showAdvanced && advanced.configPath.trim().length > 0
      ? advanced.configPath.trim()
      : `${rootPath}/openclaw.json`;
    const workspacePath = showAdvanced && advanced.workspacePath.trim().length > 0
      ? advanced.workspacePath.trim()
      : `${rootPath}/workspace`;

    const description = showAdvanced && advanced.description.trim().length > 0
      ? advanced.description.trim()
      : channelDescription(simple.channelType);

    const tags = showAdvanced && advanced.tags.trim().length > 0
      ? toTagArray(advanced.tags)
      : channelTags(simple.channelType);

    if (showAdvanced && advanced.authMode === "custom" && advanced.authSecret.trim().length === 0) {
      setLocalError("自定义认证模式时，secret 不能为空。");
      return;
    }

    const lifecycleMode = showAdvanced ? advanced.lifecycleMode : "managed_openclaw";

    if (showAdvanced && lifecycleMode === "managed_openclaw") {
      const timeout = Number.parseInt(advanced.lifecycleStartupTimeoutMs, 10);
      if (!Number.isInteger(timeout) || timeout < 1000) {
        setLocalError("托管 OpenClaw 的启动超时至少要 1000ms。");
        return;
      }
    }

    const authMode = showAdvanced ? advanced.authMode : "inherit_manager";

    const payload: ProjectUpsertPayload = {
      id: projectId,
      name: name,
      description,
      gateway: {
        protocol: showAdvanced ? advanced.protocol : "http",
        host: showAdvanced ? (advanced.host.trim() || "127.0.0.1") : "127.0.0.1",
        port,
      },
      tags,
      paths: {
        rootPath,
        configPath,
        workspacePath,
      },
      auth:
        authMode === "inherit_manager"
          ? { mode: "inherit_manager" }
          : {
              mode: "custom",
              strategy: advanced.authStrategy,
              label: advanced.authLabel.trim(),
              ...(advanced.authSecret.trim().length > 0 ? { secret: advanced.authSecret.trim() } : {}),
            },
      lifecycle:
        lifecycleMode === "managed_openclaw"
          ? {
              mode: "managed_openclaw",
              nodePath: showAdvanced ? (advanced.lifecycleNodePath.trim() || null) : null,
              cliPath: showAdvanced ? (advanced.lifecycleCliPath.trim() || null) : null,
              bind: showAdvanced ? advanced.lifecycleBind : "loopback",
              allowUnconfigured: showAdvanced ? advanced.lifecycleAllowUnconfigured : true,
              startupTimeoutMs: showAdvanced
                ? Number.parseInt(advanced.lifecycleStartupTimeoutMs, 10)
                : 15000,
            }
          : {
              mode: "custom_commands",
              startCommand: advanced.startCommand,
              stopCommand: advanced.stopCommand,
              restartCommand: advanced.restartCommand,
            },
      capabilities: showAdvanced
        ? {
            bulkHooks: advanced.bulkHooks,
            bulkSkills: advanced.bulkSkills,
            bulkMemory: advanced.bulkMemory,
            bulkConfigPatch: advanced.bulkConfigPatch,
          }
        : DEFAULT_CAPABILITIES,
    };

    const templateId = showAdvanced ? advanced.templateId : "general";
    const applyTemplate = showAdvanced ? advanced.applyTemplateAfterCreate : false;

    await onSubmit({
      project: payload,
      templateId,
      applyTemplateAfterCreate: applyTemplate,
    });
  }

  return (
    <aside className="detail-panel simple-creator">
      <header className="detail-header">
        <div>
          <p className="panel-kicker">创建新机器人</p>
          <h2>快速开始</h2>
        </div>
      </header>

      <p className="muted-copy">
        填写基本信息即可创建，高级选项可以稍后在编辑页面修改。
      </p>

      <form className="project-form simple-creator-form" onSubmit={handleSubmit}>
        <section className="detail-section">
          <label className="form-field form-field-full">
            <span className="simple-field-label">机器人名称</span>
            <input
              value={simple.botName}
              onChange={(e) => updateSimple("botName", e.target.value)}
              placeholder="例如：我的助手、客服机器人"
              disabled={busy}
              autoFocus
            />
            {simple.botName.trim().length > 0 ? (
              <span className="simple-field-hint">
                ID: <code>{generatedId}</code>
              </span>
            ) : null}
          </label>
        </section>

        <section className="detail-section">
          <p className="simple-field-label">连接方式</p>
          <div className="channel-radio-group">
            {CHANNEL_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`channel-radio-card${simple.channelType === option.value ? " channel-radio-card-active" : ""}`}
              >
                <input
                  type="radio"
                  name="channelType"
                  value={option.value}
                  checked={simple.channelType === option.value}
                  onChange={() => updateSimple("channelType", option.value)}
                  disabled={busy}
                />
                <span className="channel-radio-label">{option.label}</span>
              </label>
            ))}
          </div>

          {simple.channelType === "telegram" ? (
            <div className="channel-fields">
              <label className="form-field form-field-full">
                <span>Bot Token</span>
                <input
                  type="password"
                  value={simple.telegramToken}
                  onChange={(e) => updateSimple("telegramToken", e.target.value)}
                  placeholder="从 @BotFather 获取的 token"
                  disabled={busy}
                />
              </label>
            </div>
          ) : null}

          {simple.channelType === "wecom" ? (
            <div className="channel-fields">
              <label className="form-field form-field-full">
                <span>Bot ID</span>
                <input
                  value={simple.wecomBotId}
                  onChange={(e) => updateSimple("wecomBotId", e.target.value)}
                  placeholder="企业微信机器人 ID"
                  disabled={busy}
                />
              </label>
              <label className="form-field form-field-full">
                <span>Secret</span>
                <input
                  type="password"
                  value={simple.wecomSecret}
                  onChange={(e) => updateSimple("wecomSecret", e.target.value)}
                  placeholder="企业微信机器人 Secret"
                  disabled={busy}
                />
              </label>
            </div>
          ) : null}

          {simple.channelType === "feishu" ? (
            <div className="channel-fields">
              <label className="form-field form-field-full">
                <span>App ID</span>
                <input
                  value={simple.feishuAppId}
                  onChange={(e) => updateSimple("feishuAppId", e.target.value)}
                  placeholder="飞书应用 App ID"
                  disabled={busy}
                />
              </label>
              <label className="form-field form-field-full">
                <span>App Secret</span>
                <input
                  type="password"
                  value={simple.feishuAppSecret}
                  onChange={(e) => updateSimple("feishuAppSecret", e.target.value)}
                  placeholder="飞书应用 App Secret"
                  disabled={busy}
                />
              </label>
            </div>
          ) : null}
        </section>

        <section className="detail-section">
          <label className="form-field">
            <span className="simple-field-label">端口</span>
            <input
              value={simple.port}
              onChange={(e) => updateSimple("port", e.target.value)}
              inputMode="numeric"
              placeholder="18800"
              disabled={busy}
            />
            <span className="simple-field-hint">
              服务端口，已自动生成，可修改
            </span>
          </label>
        </section>

        <button
          type="button"
          className="advanced-toggle"
          onClick={() => setShowAdvanced((v) => !v)}
        >
          {showAdvanced ? "收起高级设置" : "高级设置"} {showAdvanced ? "\u25B2" : "\u25BC"}
        </button>

        {showAdvanced ? (
          <div className="advanced-section">
            <section className="detail-section">
              <p className="section-label">模板</p>
              <label className="form-field">
                <span>模板</span>
                <select
                  value={advanced.templateId}
                  onChange={(e) => updateAdvanced("templateId", e.target.value as ProjectTemplateId)}
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
                <div className="callout-box">
                  <strong>{selectedTemplate.summary}</strong>
                  <br />
                  {selectedTemplate.description}
                </div>
              ) : null}
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={advanced.applyTemplateAfterCreate}
                  onChange={(e) => updateAdvanced("applyTemplateAfterCreate", e.target.checked)}
                  disabled={busy || selectedTemplate === null}
                />
                <span>创建后立即应用模板</span>
              </label>
            </section>

            <section className="detail-section">
              <p className="section-label">基础信息</p>
              <div className="form-grid">
                <label className="form-field">
                  <span>机器人 ID</span>
                  <input
                    value={advanced.id}
                    onChange={(e) => updateAdvanced("id", e.target.value)}
                    placeholder={generatedId}
                    disabled={busy}
                  />
                  <span className="simple-field-hint">留空则使用自动生成的 ID</span>
                </label>
                <label className="form-field">
                  <span>描述</span>
                  <input
                    value={advanced.description}
                    onChange={(e) => updateAdvanced("description", e.target.value)}
                    placeholder="留空则自动生成"
                    disabled={busy}
                  />
                </label>
                <label className="form-field form-field-full">
                  <span>Tags</span>
                  <input
                    value={advanced.tags}
                    onChange={(e) => updateAdvanced("tags", e.target.value)}
                    placeholder="留空则自动生成"
                    disabled={busy}
                  />
                </label>
              </div>
            </section>

            <section className="detail-section">
              <p className="section-label">路径</p>
              <div className="form-grid">
                <label className="form-field form-field-full">
                  <span>Root Path</span>
                  <input
                    value={advanced.rootPath}
                    onChange={(e) => updateAdvanced("rootPath", e.target.value)}
                    placeholder={`~/.openclaw/instances/${generatedId}`}
                    disabled={busy}
                  />
                </label>
                <label className="form-field form-field-full">
                  <span>Config Path</span>
                  <input
                    value={advanced.configPath}
                    onChange={(e) => updateAdvanced("configPath", e.target.value)}
                    placeholder="留空则自动从 Root Path 推导"
                    disabled={busy}
                  />
                </label>
                <label className="form-field form-field-full">
                  <span>Workspace Path</span>
                  <input
                    value={advanced.workspacePath}
                    onChange={(e) => updateAdvanced("workspacePath", e.target.value)}
                    placeholder="留空则自动从 Root Path 推导"
                    disabled={busy}
                  />
                </label>
              </div>
            </section>

            <section className="detail-section">
              <p className="section-label">服务</p>
              <div className="form-grid">
                <label className="form-field">
                  <span>Protocol</span>
                  <select
                    value={advanced.protocol}
                    onChange={(e) => updateAdvanced("protocol", e.target.value as ProjectGatewayProtocol)}
                    disabled={busy}
                  >
                    <option value="http">http</option>
                    <option value="https">https</option>
                  </select>
                </label>
                <label className="form-field">
                  <span>Host</span>
                  <input
                    value={advanced.host}
                    onChange={(e) => updateAdvanced("host", e.target.value)}
                    placeholder="127.0.0.1"
                    disabled={busy}
                  />
                </label>
              </div>
            </section>

            <section className="detail-section">
              <p className="section-label">Auth</p>
              <div className="form-grid">
                <label className="form-field">
                  <span>认证模式</span>
                  <select
                    value={advanced.authMode}
                    onChange={(e) => updateAdvanced("authMode", e.target.value as ProjectAuthMode)}
                    disabled={busy}
                  >
                    <option value="inherit_manager">使用默认认证</option>
                    <option value="custom">自定义认证</option>
                  </select>
                </label>
                {advanced.authMode === "custom" ? (
                  <>
                    <label className="form-field">
                      <span>Strategy</span>
                      <select
                        value={advanced.authStrategy}
                        onChange={(e) => updateAdvanced("authStrategy", e.target.value as ProjectAuthStrategy)}
                        disabled={busy}
                      >
                        <option value="token">token</option>
                        <option value="password">password</option>
                      </select>
                    </label>
                    <label className="form-field form-field-full">
                      <span>Auth Label</span>
                      <input
                        value={advanced.authLabel}
                        onChange={(e) => updateAdvanced("authLabel", e.target.value)}
                        placeholder="自定义 token"
                        disabled={busy}
                      />
                    </label>
                    <label className="form-field form-field-full">
                      <span>Secret</span>
                      <input
                        type="password"
                        value={advanced.authSecret}
                        onChange={(e) => updateAdvanced("authSecret", e.target.value)}
                        placeholder="输入 token 或 password"
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
                    value={advanced.lifecycleMode}
                    onChange={(e) => updateAdvanced("lifecycleMode", e.target.value as ProjectLifecycleMode)}
                    disabled={busy}
                  >
                    <option value="managed_openclaw">自动托管</option>
                    <option value="custom_commands">自定义命令</option>
                  </select>
                </label>
                {advanced.lifecycleMode === "managed_openclaw" ? (
                  <>
                    <label className="form-field">
                      <span>Bind</span>
                      <select
                        value={advanced.lifecycleBind}
                        onChange={(e) => updateAdvanced("lifecycleBind", e.target.value as ProjectGatewayBindMode)}
                        disabled={busy}
                      >
                        <option value="loopback">loopback</option>
                        <option value="lan">lan</option>
                      </select>
                    </label>
                    <label className="form-field">
                      <span>启动超时 (ms)</span>
                      <input
                        value={advanced.lifecycleStartupTimeoutMs}
                        onChange={(e) => updateAdvanced("lifecycleStartupTimeoutMs", e.target.value)}
                        inputMode="numeric"
                        disabled={busy}
                      />
                    </label>
                    <label className="form-field form-field-full">
                      <span>CLI Path</span>
                      <input
                        value={advanced.lifecycleCliPath}
                        onChange={(e) => updateAdvanced("lifecycleCliPath", e.target.value)}
                        placeholder="留空自动探测"
                        disabled={busy}
                      />
                    </label>
                    <label className="form-field form-field-full">
                      <span>Node Path</span>
                      <input
                        value={advanced.lifecycleNodePath}
                        onChange={(e) => updateAdvanced("lifecycleNodePath", e.target.value)}
                        placeholder="留空使用默认 Node"
                        disabled={busy}
                      />
                    </label>
                    <label className="checkbox-field">
                      <input
                        type="checkbox"
                        checked={advanced.lifecycleAllowUnconfigured}
                        onChange={(e) => updateAdvanced("lifecycleAllowUnconfigured", e.target.checked)}
                        disabled={busy}
                      />
                      <span>启动时附加 `--allow-unconfigured`</span>
                    </label>
                  </>
                ) : (
                  <>
                    <label className="form-field form-field-full">
                      <span>Start Command</span>
                      <textarea
                        value={advanced.startCommand}
                        onChange={(e) => updateAdvanced("startCommand", e.target.value)}
                        rows={2}
                        disabled={busy}
                      />
                    </label>
                    <label className="form-field form-field-full">
                      <span>Stop Command</span>
                      <textarea
                        value={advanced.stopCommand}
                        onChange={(e) => updateAdvanced("stopCommand", e.target.value)}
                        rows={2}
                        disabled={busy}
                      />
                    </label>
                    <label className="form-field form-field-full">
                      <span>Restart Command</span>
                      <textarea
                        value={advanced.restartCommand}
                        onChange={(e) => updateAdvanced("restartCommand", e.target.value)}
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
                    checked={advanced.bulkHooks}
                    onChange={(e) => updateAdvanced("bulkHooks", e.target.checked)}
                    disabled={busy}
                  />
                  <span>允许批量 Hook</span>
                </label>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={advanced.bulkSkills}
                    onChange={(e) => updateAdvanced("bulkSkills", e.target.checked)}
                    disabled={busy}
                  />
                  <span>允许批量 Skill</span>
                </label>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={advanced.bulkMemory}
                    onChange={(e) => updateAdvanced("bulkMemory", e.target.checked)}
                    disabled={busy}
                  />
                  <span>允许批量记忆</span>
                </label>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={advanced.bulkConfigPatch}
                    onChange={(e) => updateAdvanced("bulkConfigPatch", e.target.checked)}
                    disabled={busy}
                  />
                  <span>允许批量配置 Patch</span>
                </label>
              </div>
            </section>
          </div>
        ) : null}

        {localError || errorMessage ? (
          <div className="callout-box callout-box-danger">{localError ?? errorMessage}</div>
        ) : null}

        <div className="panel-action-row simple-creator-actions">
          <button type="submit" className="primary-button simple-creator-submit" disabled={busy}>
            {busy ? "创建中..." : "创建机器人"}
          </button>
          <button type="button" className="ghost-button" onClick={onCancel} disabled={busy}>
            取消
          </button>
        </div>
      </form>
    </aside>
  );
}

function channelDescription(channelType: ChannelType): string {
  switch (channelType) {
    case "telegram":
      return "通过 Telegram Bot 接入的机器人";
    case "wecom":
      return "通过企业微信接入的机器人";
    case "feishu":
      return "通过飞书接入的机器人";
    case "none":
      return "本地使用的机器人，无消息通道";
  }
}

function channelTags(channelType: ChannelType): string[] {
  switch (channelType) {
    case "telegram":
      return ["telegram", "bot"];
    case "wecom":
      return ["wecom", "bot"];
    case "feishu":
      return ["feishu", "bot"];
    case "none":
      return ["local"];
  }
}

function FullEditorForm({
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

    const port = Number.parseInt(state.port, 10);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      setLocalError("端口必须是 1 到 65535 之间的整数。");
      return;
    }

    if (state.authMode === "custom" && mode === "create" && state.authSecret.trim().length === 0) {
      setLocalError("使用自定义认证时，secret 不能为空。");
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

    const payload: ProjectUpsertPayload = {
      id: state.id.trim().toLowerCase(),
      name: state.name.trim(),
      description: state.description.trim(),
      gateway: {
        protocol: state.protocol,
        host: state.host.trim(),
        port,
      },
      tags: toTagArray(state.tags),
      paths: {
        rootPath: state.rootPath.trim(),
        configPath: state.configPath.trim(),
        workspacePath: state.workspacePath.trim(),
      },
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
        state.lifecycleMode === "managed_openclaw"
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

    await onSubmit({
      project: payload,
      templateId: mode === "create" ? state.templateId : null,
      applyTemplateAfterCreate: mode === "create" ? state.applyTemplateAfterCreate : false,
    });
  }

  return (
    <aside className="detail-panel">
      <header className="detail-header">
        <div>
          <p className="panel-kicker">{mode === "create" ? "创建新机器人" : "编辑机器人"}</p>
          <h2>{mode === "create" ? "创建一个新机器人" : initialProject?.name ?? "编辑设置"}</h2>
        </div>
      </header>

      <p className="muted-copy">
        填写机器人信息，创建后就会出现在列表中。
      </p>

      <div className="callout-box">
        <strong>默认认证：</strong> {managerAuth?.label ?? "未配置"}
        <br />
        <strong>当前认证：</strong>{" "}
        {state.authMode === "inherit_manager" ? "使用默认" : "自定义"}
      </div>

      <form className="project-form" onSubmit={handleSubmit}>
        {mode === "create" ? (
          <section className="detail-section">
            <p className="section-label">模板</p>
            <label className="form-field">
              <span>模板</span>
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
                当前没有可用模板。
              </div>
            )}
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={state.applyTemplateAfterCreate}
                onChange={(event) => updateField("applyTemplateAfterCreate", event.target.checked)}
                disabled={busy || selectedTemplate === null}
              />
              <span>创建后立即应用模板</span>
            </label>
          </section>
        ) : null}

        <section className="detail-section">
          <p className="section-label">基础信息</p>
          <div className="form-grid">
            <label className="form-field">
              <span>机器人 ID</span>
              <input
                value={state.id}
                onChange={(event) => updateField("id", event.target.value)}
                placeholder="例如 main-prod"
                disabled={mode === "edit" || busy}
              />
            </label>
            <label className="form-field">
              <span>名称</span>
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
                placeholder="这个机器人是做什么的"
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
          <p className="section-label">服务</p>
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
                placeholder="18789"
                inputMode="numeric"
                disabled={busy}
              />
            </label>
          </div>
        </section>

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

        <section className="detail-section">
          <p className="section-label">Auth</p>
          <div className="form-grid">
            <label className="form-field">
              <span>认证模式</span>
              <select
                value={state.authMode}
                onChange={(event) => updateField("authMode", event.target.value as ProjectAuthMode)}
                disabled={busy}
              >
                <option value="inherit_manager">使用默认认证</option>
                <option value="custom">自定义认证</option>
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
                    placeholder="自定义 token"
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
                value={state.lifecycleMode}
                onChange={(event) => updateField("lifecycleMode", event.target.value as ProjectLifecycleMode)}
                disabled={busy}
              >
                <option value="managed_openclaw">自动托管</option>
                <option value="custom_commands">自定义命令</option>
              </select>
            </label>
            {state.lifecycleMode === "managed_openclaw" ? (
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
                  <span>CLI Path（留空自动探测）</span>
                  <input
                    value={state.lifecycleCliPath}
                    onChange={(event) => updateField("lifecycleCliPath", event.target.value)}
                    placeholder="例如 /home/leonard/openclaw/openclaw.mjs"
                    disabled={busy}
                  />
                </label>
                <label className="form-field form-field-full">
                  <span>Node Path（留空使用默认 Node）</span>
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
                  机器人会在后台自动运行，系统会维护进程和日志。
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
            {busy ? "保存中..." : mode === "create" ? "创建机器人" : "保存修改"}
          </button>
          <button type="button" className="ghost-button" onClick={onCancel} disabled={busy}>
            取消
          </button>
        </div>
      </form>
    </aside>
  );
}

export function ProjectEditor(props: ProjectEditorProps) {
  if (props.mode === "create") {
    return (
      <SimpleCreatorForm
        busy={props.busy}
        errorMessage={props.errorMessage}
        onCancel={props.onCancel}
        onSubmit={props.onSubmit}
        templates={props.templates}
      />
    );
  }

  return <FullEditorForm {...props} />;
}
