import { useEffect, useState } from "react";

type ChannelConfigProps = {
  projectId: string;
};

type ChannelTab = "wecom" | "feishu";
type NoticeTone = "success" | "error";
type WeComDmPolicy = "open" | "pairing";
type WeComGroupPolicy = "open" | "mention";
type FeishuDomain = "feishu" | "lark";

type ChannelNotice = {
  channel: ChannelTab;
  tone: NoticeTone;
  text: string;
};

type WeComAccountDraft = {
  clientId: string;
  key: string;
  botId: string;
  secret: string;
  name: string;
  dmPolicy: WeComDmPolicy;
  groupPolicy: WeComGroupPolicy;
};

type FeishuAccountDraft = {
  clientId: string;
  key: string;
  appId: string;
  appSecret: string;
  botName: string;
};

type WeComConfigState = {
  enabled: boolean;
  accounts: WeComAccountDraft[];
};

type FeishuConfigState = {
  enabled: boolean;
  domain: FeishuDomain;
  accounts: FeishuAccountDraft[];
};

type ChannelState = {
  wecom: WeComConfigState;
  feishu: FeishuConfigState;
};

type WeComPayload = {
  enabled: boolean;
  accounts: Record<
    string,
    {
      botId: string;
      secret: string;
      dmPolicy: WeComDmPolicy;
      groupPolicy: WeComGroupPolicy;
      name?: string;
    }
  >;
};

type FeishuPayload = {
  enabled: boolean;
  domain: FeishuDomain;
  accounts: Record<
    string,
    {
      appId: string;
      appSecret: string;
      botName?: string;
    }
  >;
};

const channelConfigStyles = `
  .channel-config {
    display: grid;
    gap: 18px;
  }

  .channel-config-tabs {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .channel-config-tab {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 108px;
  }

  .channel-config-tab[aria-selected="true"] {
    border-color: rgba(122, 162, 255, 0.34);
    background: rgba(122, 162, 255, 0.18);
  }

  .channel-config-loading {
    display: grid;
    gap: 12px;
  }

  .channel-config-top-row,
  .channel-config-footer,
  .channel-config-card-header {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    align-items: center;
  }

  .channel-config-switch {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    color: var(--ink-soft);
    cursor: pointer;
  }

  .channel-config-switch input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  .channel-config-switch-track {
    position: relative;
    width: 46px;
    height: 26px;
    border-radius: 999px;
    background: rgba(139, 148, 158, 0.24);
    border: 1px solid rgba(139, 148, 158, 0.28);
    transition:
      background 150ms ease,
      border-color 150ms ease;
  }

  .channel-config-switch-track::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #f7faff;
    box-shadow: 0 4px 12px rgba(8, 17, 31, 0.26);
    transition: transform 150ms ease;
  }

  .channel-config-switch input:checked + .channel-config-switch-track {
    background: linear-gradient(135deg, rgba(82, 124, 255, 0.9), rgba(122, 162, 255, 0.88));
    border-color: rgba(122, 162, 255, 0.54);
  }

  .channel-config-switch input:checked + .channel-config-switch-track::after {
    transform: translateX(20px);
  }

  .channel-config-switch-copy {
    display: grid;
    gap: 2px;
  }

  .channel-config-switch-label {
    color: var(--ink, #edf2ff);
    font-weight: 600;
  }

  .channel-config-switch-hint,
  .channel-config-subtle {
    margin: 0;
    color: var(--ink-soft);
    font-size: 0.92rem;
  }

  .channel-config-account-list {
    display: grid;
    gap: 14px;
  }

  .channel-config-account-card {
    display: grid;
    gap: 14px;
    border: 1px solid var(--border, rgba(147, 176, 255, 0.16));
    border-radius: 22px;
    padding: 18px;
    background:
      linear-gradient(180deg, rgba(122, 162, 255, 0.06), rgba(255, 255, 255, 0)),
      var(--bg-base, rgba(11, 17, 32, 0.58));
  }

  .channel-config-card-title {
    display: grid;
    gap: 6px;
  }

  .channel-config-card-title strong {
    font-family: "Space Grotesk", "Trebuchet MS", sans-serif;
    font-size: 1.05rem;
    letter-spacing: -0.03em;
  }

  .channel-config-badge {
    display: inline-flex;
    width: fit-content;
  }

  .channel-config-actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    align-items: center;
  }

  .channel-config-inline-button {
    padding: 8px 12px;
    font-size: 0.88rem;
  }

  .channel-config-footer {
    padding-top: 4px;
  }

  .channel-config-footer .inline-notice {
    margin-top: 0;
    flex: 1 1 320px;
  }

  .channel-config-save {
    min-width: 120px;
  }

  @media (max-width: 720px) {
    .channel-config-top-row,
    .channel-config-footer,
    .channel-config-card-header {
      align-items: stretch;
    }

    .channel-config-tab,
    .channel-config-save {
      width: 100%;
    }
  }
`;

let accountIdSequence = 0;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringField(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") {
      return value;
    }
  }

  return "";
}

function parseResponseBody(raw: string): unknown {
  if (raw.trim().length === 0) {
    return null;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function getErrorMessage(body: unknown): string | null {
  if (
    isObject(body) &&
    isObject(body.error) &&
    typeof body.error.message === "string" &&
    body.error.message.trim().length > 0
  ) {
    return body.error.message;
  }

  if (typeof body === "string" && body.trim().length > 0) {
    return body;
  }

  return null;
}

async function requestApi<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = parseResponseBody(await response.text());

  if (!response.ok) {
    throw new Error(getErrorMessage(body) ?? `${response.status} ${response.statusText}`);
  }

  return body as T;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Request failed. Please try again.";
}

function createAccountClientId(channel: ChannelTab): string {
  accountIdSequence += 1;
  return `${channel}-account-${accountIdSequence}`;
}

function createEmptyWeComAccount(
  initial: Partial<Omit<WeComAccountDraft, "clientId">> = {},
): WeComAccountDraft {
  return {
    clientId: createAccountClientId("wecom"),
    key: initial.key ?? "",
    botId: initial.botId ?? "",
    secret: initial.secret ?? "",
    name: initial.name ?? "",
    dmPolicy: initial.dmPolicy ?? "open",
    groupPolicy: initial.groupPolicy ?? "open",
  };
}

function createEmptyFeishuAccount(
  initial: Partial<Omit<FeishuAccountDraft, "clientId">> = {},
): FeishuAccountDraft {
  return {
    clientId: createAccountClientId("feishu"),
    key: initial.key ?? "",
    appId: initial.appId ?? "",
    appSecret: initial.appSecret ?? "",
    botName: initial.botName ?? "",
  };
}

function createDefaultChannelState(): ChannelState {
  return {
    wecom: {
      enabled: false,
      accounts: [],
    },
    feishu: {
      enabled: false,
      domain: "feishu",
      accounts: [],
    },
  };
}

function normalizeDmPolicy(value: unknown): WeComDmPolicy {
  return value === "pairing" ? "pairing" : "open";
}

function normalizeGroupPolicy(value: unknown): WeComGroupPolicy {
  return value === "mention" ? "mention" : "open";
}

function normalizeFeishuDomain(value: unknown): FeishuDomain {
  if (typeof value !== "string") {
    return "feishu";
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "lark" || normalized.includes("lark")) {
    return "lark";
  }

  return "feishu";
}

function normalizeAccounts<T>(
  value: unknown,
  normalizeAccount: (entry: unknown, keyHint: string) => T,
): T[] {
  if (Array.isArray(value)) {
    return value.map((entry, index) => normalizeAccount(entry, `account-${index + 1}`));
  }

  if (isObject(value)) {
    return Object.entries(value).map(([key, entry]) => normalizeAccount(entry, key));
  }

  return [];
}

function normalizeWeComAccount(value: unknown, keyHint: string): WeComAccountDraft {
  const record = isObject(value) ? value : {};

  return createEmptyWeComAccount({
    key: readStringField(record, ["key"]) || keyHint,
    botId: readStringField(record, ["botId"]),
    secret: readStringField(record, ["secret"]),
    name: readStringField(record, ["name", "displayName"]),
    dmPolicy: normalizeDmPolicy(record.dmPolicy),
    groupPolicy: normalizeGroupPolicy(record.groupPolicy),
  });
}

function normalizeFeishuAccount(value: unknown, keyHint: string): FeishuAccountDraft {
  const record = isObject(value) ? value : {};

  return createEmptyFeishuAccount({
    key: readStringField(record, ["key"]) || keyHint,
    appId: readStringField(record, ["appId"]),
    appSecret: readStringField(record, ["appSecret", "secret"]),
    botName: readStringField(record, ["botName", "name", "displayName"]),
  });
}

function normalizeWeComConfig(value: unknown): WeComConfigState {
  const record = isObject(value) ? value : {};

  return {
    enabled: record.enabled === true,
    accounts: normalizeAccounts(record.accounts, normalizeWeComAccount),
  };
}

function normalizeFeishuConfig(value: unknown): FeishuConfigState {
  const record = isObject(value) ? value : {};

  return {
    enabled: record.enabled === true,
    domain: normalizeFeishuDomain(record.domain),
    accounts: normalizeAccounts(record.accounts, normalizeFeishuAccount),
  };
}

function normalizeChannelsResponse(value: unknown): ChannelState {
  const root = isObject(value) ? value : {};
  const source = isObject(root.channels) ? root.channels : isObject(root.data) ? root.data : root;

  return {
    wecom: normalizeWeComConfig(source.wecom ?? source.weCom),
    feishu: normalizeFeishuConfig(source.feishu ?? source.lark),
  };
}

function toWeComPayload(config: WeComConfigState): WeComPayload {
  const accounts: WeComPayload["accounts"] = {};

  for (const account of config.accounts) {
    const key = account.key.trim();
    const name = account.name.trim();

    accounts[key] = {
      botId: account.botId.trim(),
      secret: account.secret.trim(),
      dmPolicy: account.dmPolicy,
      groupPolicy: account.groupPolicy,
      ...(name ? { name } : {}),
    };
  }

  return {
    enabled: config.enabled,
    accounts,
  };
}

function toFeishuPayload(config: FeishuConfigState): FeishuPayload {
  const accounts: FeishuPayload["accounts"] = {};

  for (const account of config.accounts) {
    const key = account.key.trim();
    const botName = account.botName.trim();

    accounts[key] = {
      appId: account.appId.trim(),
      appSecret: account.appSecret.trim(),
      ...(botName ? { botName } : {}),
    };
  }

  return {
    enabled: config.enabled,
    domain: config.domain,
    accounts,
  };
}

function validateWeComConfig(config: WeComConfigState): string | null {
  if (config.enabled && config.accounts.length === 0) {
    return "Add at least one WeCom account before enabling the channel.";
  }

  const seenKeys = new Set<string>();

  for (const [index, account] of config.accounts.entries()) {
    const accountNumber = index + 1;
    const key = account.key.trim();

    if (!key) {
      return `WeCom account ${accountNumber}: key is required.`;
    }

    if (seenKeys.has(key)) {
      return `WeCom account key "${key}" must be unique.`;
    }

    seenKeys.add(key);

    if (account.botId.trim().length === 0) {
      return `WeCom account ${accountNumber}: Bot ID is required.`;
    }

    if (account.secret.trim().length === 0) {
      return `WeCom account ${accountNumber}: Secret is required.`;
    }
  }

  return null;
}

function validateFeishuConfig(config: FeishuConfigState): string | null {
  if (config.enabled && config.accounts.length === 0) {
    return "Add at least one Feishu account before enabling the channel.";
  }

  const seenKeys = new Set<string>();

  for (const [index, account] of config.accounts.entries()) {
    const accountNumber = index + 1;
    const key = account.key.trim();

    if (!key) {
      return `Feishu account ${accountNumber}: key is required.`;
    }

    if (seenKeys.has(key)) {
      return `Feishu account key "${key}" must be unique.`;
    }

    seenKeys.add(key);

    if (account.appId.trim().length === 0) {
      return `Feishu account ${accountNumber}: App ID is required.`;
    }

    if (account.appSecret.trim().length === 0) {
      return `Feishu account ${accountNumber}: App Secret is required.`;
    }
  }

  return null;
}

export function ChannelConfig({ projectId }: ChannelConfigProps) {
  const [activeTab, setActiveTab] = useState<ChannelTab>("wecom");
  const [state, setState] = useState<ChannelState>(createDefaultChannelState);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [savingChannel, setSavingChannel] = useState<ChannelTab | null>(null);
  const [notice, setNotice] = useState<ChannelNotice | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadChannels() {
      setLoading(true);
      setLoadError(null);
      setNotice(null);
      setState(createDefaultChannelState());

      try {
        const response = await requestApi<unknown>(`/api/projects/${projectId}/channels`, {
          signal: controller.signal,
          headers: {
            Accept: "application/json",
          },
        });

        if (controller.signal.aborted) {
          return;
        }

        setState(normalizeChannelsResponse(response));
        setLoading(false);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setLoadError(toErrorMessage(error));
        setLoading(false);
      }
    }

    void loadChannels();

    return () => {
      controller.abort();
    };
  }, [projectId, reloadToken]);

  function clearChannelNotice(channel: ChannelTab) {
    setNotice((current) => (current?.channel === channel ? null : current));
  }

  function updateWeComState(updater: (current: WeComConfigState) => WeComConfigState) {
    clearChannelNotice("wecom");
    setState((current) => ({
      ...current,
      wecom: updater(current.wecom),
    }));
  }

  function updateFeishuState(updater: (current: FeishuConfigState) => FeishuConfigState) {
    clearChannelNotice("feishu");
    setState((current) => ({
      ...current,
      feishu: updater(current.feishu),
    }));
  }

  function updateWeComAccount(
    clientId: string,
    field: "key" | "botId" | "secret" | "name" | "dmPolicy" | "groupPolicy",
    value: string,
  ) {
    updateWeComState((current) => ({
      ...current,
      accounts: current.accounts.map((account) =>
        account.clientId === clientId ? { ...account, [field]: value } : account,
      ),
    }));
  }

  function updateFeishuAccount(
    clientId: string,
    field: "key" | "appId" | "appSecret" | "botName",
    value: string,
  ) {
    updateFeishuState((current) => ({
      ...current,
      accounts: current.accounts.map((account) =>
        account.clientId === clientId ? { ...account, [field]: value } : account,
      ),
    }));
  }

  function deleteWeComAccount(clientId: string) {
    const account = state.wecom.accounts.find((entry) => entry.clientId === clientId);
    const label = account?.key.trim() || "this account";

    if (!window.confirm(`Delete WeCom account "${label}"?`)) {
      return;
    }

    updateWeComState((current) => ({
      ...current,
      accounts: current.accounts.filter((entry) => entry.clientId !== clientId),
    }));
  }

  function deleteFeishuAccount(clientId: string) {
    const account = state.feishu.accounts.find((entry) => entry.clientId === clientId);
    const label = account?.key.trim() || "this account";

    if (!window.confirm(`Delete Feishu account "${label}"?`)) {
      return;
    }

    updateFeishuState((current) => ({
      ...current,
      accounts: current.accounts.filter((entry) => entry.clientId !== clientId),
    }));
  }

  async function saveChannel(channel: ChannelTab) {
    const validationError =
      channel === "wecom" ? validateWeComConfig(state.wecom) : validateFeishuConfig(state.feishu);

    if (validationError) {
      setNotice({
        channel,
        tone: "error",
        text: validationError,
      });
      return;
    }

    setSavingChannel(channel);
    setNotice(null);

    try {
      const url = `/api/projects/${projectId}/channels/${channel}`;
      const payload = channel === "wecom" ? toWeComPayload(state.wecom) : toFeishuPayload(state.feishu);

      await requestApi<unknown>(url, {
        method: "PUT",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      setNotice({
        channel,
        tone: "success",
        text: `${channel === "wecom" ? "WeCom" : "Feishu"} settings saved.`,
      });
    } catch (error) {
      setNotice({
        channel,
        tone: "error",
        text: toErrorMessage(error),
      });
    } finally {
      setSavingChannel(null);
    }
  }

  function renderWeComPanel() {
    const busy = savingChannel === "wecom";
    const activeNotice = notice?.channel === "wecom" ? notice : null;

    return (
      <form
        className="channel-config"
        onSubmit={(event) => {
          event.preventDefault();
          void saveChannel("wecom");
        }}
      >
        <section className="detail-section">
          <div className="channel-config-top-row">
            <p className="section-label">Channel</p>
            <label className="channel-config-switch">
              <input
                type="checkbox"
                checked={state.wecom.enabled}
                onChange={(event) => updateWeComState((current) => ({ ...current, enabled: event.target.checked }))}
                disabled={busy}
              />
              <span className="channel-config-switch-track" aria-hidden="true" />
              <span className="channel-config-switch-copy">
                <span className="channel-config-switch-label">Enabled</span>
                <span className="channel-config-switch-hint">
                  为这个机器人启用企业微信消息。
                </span>
              </span>
            </label>
          </div>
        </section>

        <section className="detail-section">
          <div className="channel-config-top-row">
            <div>
              <p className="section-label">Accounts</p>
              <p className="channel-config-subtle">
                Use a stable key like <code>maple</code> or <code>ops-main</code>.
              </p>
            </div>
          </div>

          {state.wecom.accounts.length === 0 ? (
            <div className="callout-box callout-box-muted">
              No WeCom accounts yet. Add one to configure bot credentials.
            </div>
          ) : (
            <div className="channel-config-account-list">
              {state.wecom.accounts.map((account, index) => (
                <article key={account.clientId} className="channel-config-account-card">
                  <div className="channel-config-card-header">
                    <div className="channel-config-card-title">
                      <strong>{account.key.trim() || `Account ${index + 1}`}</strong>
                      <span className="tag-pill channel-config-badge">
                        Key {account.key.trim() || "pending"}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="ghost-button ghost-button-danger channel-config-inline-button"
                      onClick={() => deleteWeComAccount(account.clientId)}
                      disabled={busy}
                    >
                      Delete account
                    </button>
                  </div>

                  <div className="form-grid">
                    <label className="form-field">
                      <span>Key</span>
                      <input
                        value={account.key}
                        onChange={(event) => updateWeComAccount(account.clientId, "key", event.target.value)}
                        placeholder="maple"
                        disabled={busy}
                      />
                    </label>
                    <label className="form-field">
                      <span>Bot ID</span>
                      <input
                        value={account.botId}
                        onChange={(event) =>
                          updateWeComAccount(account.clientId, "botId", event.target.value)
                        }
                        placeholder="wwxxxxxxxxxxxxxxxx"
                        disabled={busy}
                      />
                    </label>
                    <label className="form-field">
                      <span>Secret</span>
                      <input
                        type="password"
                        value={account.secret}
                        onChange={(event) =>
                          updateWeComAccount(account.clientId, "secret", event.target.value)
                        }
                        placeholder="Enter bot secret"
                        disabled={busy}
                      />
                    </label>
                    <label className="form-field">
                      <span>Display Name</span>
                      <input
                        value={account.name}
                        onChange={(event) => updateWeComAccount(account.clientId, "name", event.target.value)}
                        placeholder="Optional"
                        disabled={busy}
                      />
                    </label>
                    <label className="form-field">
                      <span>DM Policy</span>
                      <select
                        value={account.dmPolicy}
                        onChange={(event) =>
                          updateWeComAccount(account.clientId, "dmPolicy", event.target.value)
                        }
                        disabled={busy}
                      >
                        <option value="open">open</option>
                        <option value="pairing">pairing</option>
                      </select>
                    </label>
                    <label className="form-field">
                      <span>Group Policy</span>
                      <select
                        value={account.groupPolicy}
                        onChange={(event) =>
                          updateWeComAccount(account.clientId, "groupPolicy", event.target.value)
                        }
                        disabled={busy}
                      >
                        <option value="open">open</option>
                        <option value="mention">mention</option>
                      </select>
                    </label>
                  </div>
                </article>
              ))}
            </div>
          )}

          <div className="channel-config-actions">
            <button
              type="button"
              className="ghost-button channel-config-inline-button"
              onClick={() => updateWeComState((current) => ({ ...current, accounts: [...current.accounts, createEmptyWeComAccount()] }))}
              disabled={busy}
            >
              Add Account
            </button>
          </div>
        </section>

        <div className="channel-config-footer">
          {activeNotice ? (
            <div className={`inline-notice inline-notice-${activeNotice.tone}`}>{activeNotice.text}</div>
          ) : (
            <p className="channel-config-subtle">Save applies only to the WeCom channel tab.</p>
          )}
          <button type="submit" className="primary-button channel-config-save" disabled={busy}>
            {busy ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    );
  }

  function renderFeishuPanel() {
    const busy = savingChannel === "feishu";
    const activeNotice = notice?.channel === "feishu" ? notice : null;

    return (
      <form
        className="channel-config"
        onSubmit={(event) => {
          event.preventDefault();
          void saveChannel("feishu");
        }}
      >
        <section className="detail-section">
          <div className="channel-config-top-row">
            <p className="section-label">Channel</p>
            <label className="channel-config-switch">
              <input
                type="checkbox"
                checked={state.feishu.enabled}
                onChange={(event) =>
                  updateFeishuState((current) => ({ ...current, enabled: event.target.checked }))
                }
                disabled={busy}
              />
              <span className="channel-config-switch-track" aria-hidden="true" />
              <span className="channel-config-switch-copy">
                <span className="channel-config-switch-label">Enabled</span>
                <span className="channel-config-switch-hint">
                  为这个机器人启用飞书消息。
                </span>
              </span>
            </label>
          </div>

          <label className="form-field">
            <span>Domain</span>
            <select
              value={state.feishu.domain}
              onChange={(event) =>
                updateFeishuState((current) => ({
                  ...current,
                  domain: normalizeFeishuDomain(event.target.value),
                }))
              }
              disabled={busy}
            >
              <option value="feishu">feishu</option>
              <option value="lark">lark</option>
            </select>
          </label>
        </section>

        <section className="detail-section">
          <div className="channel-config-top-row">
            <div>
              <p className="section-label">Accounts</p>
              <p className="channel-config-subtle">
                Use a stable key like <code>main</code> or <code>global-bot</code>.
              </p>
            </div>
          </div>

          {state.feishu.accounts.length === 0 ? (
            <div className="callout-box callout-box-muted">
              No Feishu accounts yet. Add one to configure app credentials.
            </div>
          ) : (
            <div className="channel-config-account-list">
              {state.feishu.accounts.map((account, index) => (
                <article key={account.clientId} className="channel-config-account-card">
                  <div className="channel-config-card-header">
                    <div className="channel-config-card-title">
                      <strong>{account.key.trim() || `Account ${index + 1}`}</strong>
                      <span className="tag-pill channel-config-badge">
                        Key {account.key.trim() || "pending"}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="ghost-button ghost-button-danger channel-config-inline-button"
                      onClick={() => deleteFeishuAccount(account.clientId)}
                      disabled={busy}
                    >
                      Delete account
                    </button>
                  </div>

                  <div className="form-grid">
                    <label className="form-field">
                      <span>Key</span>
                      <input
                        value={account.key}
                        onChange={(event) => updateFeishuAccount(account.clientId, "key", event.target.value)}
                        placeholder="main"
                        disabled={busy}
                      />
                    </label>
                    <label className="form-field">
                      <span>App ID</span>
                      <input
                        value={account.appId}
                        onChange={(event) =>
                          updateFeishuAccount(account.clientId, "appId", event.target.value)
                        }
                        placeholder="cli_xxxxxxxxxxxxxxxx"
                        disabled={busy}
                      />
                    </label>
                    <label className="form-field">
                      <span>App Secret</span>
                      <input
                        type="password"
                        value={account.appSecret}
                        onChange={(event) =>
                          updateFeishuAccount(account.clientId, "appSecret", event.target.value)
                        }
                        placeholder="Enter app secret"
                        disabled={busy}
                      />
                    </label>
                    <label className="form-field">
                      <span>Bot Name</span>
                      <input
                        value={account.botName}
                        onChange={(event) =>
                          updateFeishuAccount(account.clientId, "botName", event.target.value)
                        }
                        placeholder="Optional"
                        disabled={busy}
                      />
                    </label>
                  </div>
                </article>
              ))}
            </div>
          )}

          <div className="channel-config-actions">
            <button
              type="button"
              className="ghost-button channel-config-inline-button"
              onClick={() =>
                updateFeishuState((current) => ({
                  ...current,
                  accounts: [...current.accounts, createEmptyFeishuAccount()],
                }))
              }
              disabled={busy}
            >
              Add Account
            </button>
          </div>
        </section>

        <div className="channel-config-footer">
          {activeNotice ? (
            <div className={`inline-notice inline-notice-${activeNotice.tone}`}>{activeNotice.text}</div>
          ) : (
            <p className="channel-config-subtle">Save applies only to the Feishu channel tab.</p>
          )}
          <button type="submit" className="primary-button channel-config-save" disabled={busy}>
            {busy ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <aside className="detail-panel channel-config" aria-busy={loading || savingChannel !== null}>
      <style>{channelConfigStyles}</style>

      <header className="detail-header">
        <div>
          <p className="panel-kicker">消息通道</p>
          <h2>企业微信和飞书</h2>
        </div>
      </header>

      <p className="muted-copy">
        管理机器人 <code>{projectId}</code> 的消息通道凭证。
      </p>

      <div className="channel-config-tabs" role="tablist" aria-label="Channel configuration tabs">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "wecom"}
          className="ghost-button channel-config-tab"
          onClick={() => setActiveTab("wecom")}
          disabled={loading || savingChannel !== null}
        >
          WeCom
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "feishu"}
          className="ghost-button channel-config-tab"
          onClick={() => setActiveTab("feishu")}
          disabled={loading || savingChannel !== null}
        >
          Feishu
        </button>
      </div>

      {loading ? (
        <div className="channel-config-loading" role="status">
          <div className="callout-box">Loading channel configuration...</div>
        </div>
      ) : loadError ? (
        <>
          <div className="callout-box callout-box-danger">{loadError}</div>
          <div className="panel-action-row">
            <button
              type="button"
              className="ghost-button"
              onClick={() => setReloadToken((value) => value + 1)}
            >
              Retry
            </button>
          </div>
        </>
      ) : (
        <div role="tabpanel">{activeTab === "wecom" ? renderWeComPanel() : renderFeishuPanel()}</div>
      )}
    </aside>
  );
}

export default ChannelConfig;
