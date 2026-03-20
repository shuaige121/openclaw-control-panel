import { useEffect, useState, type FormEvent } from "react";
import type {
  BulkActionExecutePayload,
  BulkActionResponse,
  BulkIntent,
  ProjectListItem,
} from "../types";

type BulkActionPanelProps = {
  intent: BulkIntent;
  selectedProjects: ProjectListItem[];
  busy: boolean;
  errorMessage: string | null;
  result: BulkActionResponse | null;
  onCancel: () => void;
  onSubmit: (payload: BulkActionExecutePayload) => Promise<void>;
};

type PanelState = {
  mode: string;
  name: string;
  blockId: string;
  content: string;
  path: string;
  valueJson: string;
};

function createDefaultState(intent: BulkIntent): PanelState {
  if (intent === "memory") {
    return {
      mode: "append",
      name: "",
      blockId: "",
      content: "",
      path: "",
      valueJson: "\"\"",
    };
  }

  if (intent === "config") {
    return {
      mode: "set",
      name: "",
      blockId: "",
      content: "",
      path: "",
      valueJson: "\"\"",
    };
  }

  return {
    mode: "enable",
    name: "",
    blockId: "",
    content: "",
    path: "",
    valueJson: "\"\"",
  };
}

function getPanelTitle(intent: BulkIntent): string {
  if (intent === "hooks") {
    return "批量 Hook";
  }

  if (intent === "skills") {
    return "批量 Skill";
  }

  if (intent === "memory") {
    return "批量记忆";
  }

  return "批量配置 Patch";
}

export function BulkActionPanel({
  intent,
  selectedProjects,
  busy,
  errorMessage,
  result,
  onCancel,
  onSubmit,
}: BulkActionPanelProps) {
  const [state, setState] = useState<PanelState>(() => createDefaultState(intent));
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setState(createDefaultState(intent));
    setLocalError(null);
  }, [intent]);

  function updateField<Key extends keyof PanelState>(key: Key, value: PanelState[Key]) {
    setState((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);

    try {
      if (intent === "hooks") {
        await onSubmit({
          action: "hooks",
          projectIds: selectedProjects.map((project) => project.id),
          payload: {
            mode: state.mode as "enable" | "disable",
            hookName: state.name.trim(),
          },
        });
        return;
      }

      if (intent === "skills") {
        await onSubmit({
          action: "skills",
          projectIds: selectedProjects.map((project) => project.id),
          payload: {
            mode: state.mode as "enable" | "disable",
            skillName: state.name.trim(),
          },
        });
        return;
      }

      if (intent === "memory") {
        if (state.mode === "append") {
          await onSubmit({
            action: "memory",
            projectIds: selectedProjects.map((project) => project.id),
            payload: {
              mode: "append",
              content: state.content.trim(),
              ...(state.blockId.trim().length > 0 ? { blockId: state.blockId.trim() } : {}),
            },
          });
          return;
        }

        await onSubmit({
          action: "memory",
          projectIds: selectedProjects.map((project) => project.id),
          payload: {
            mode: "remove",
            blockId: state.blockId.trim(),
          },
        });
        return;
      }

      if (state.mode === "set") {
        await onSubmit({
          action: "config",
          projectIds: selectedProjects.map((project) => project.id),
          payload: {
            mode: "set",
            path: state.path.trim(),
            value: JSON.parse(state.valueJson),
          },
        });
        return;
      }

      await onSubmit({
        action: "config",
        projectIds: selectedProjects.map((project) => project.id),
        payload: {
          mode: "delete",
          path: state.path.trim(),
        },
      });
    } catch (error) {
      if (error instanceof Error && error.message.trim().length > 0) {
        setLocalError(error.message);
      } else {
        setLocalError("批量请求参数无效。");
      }
    }
  }

  return (
    <aside className="detail-panel">
      <header className="detail-header">
        <div>
          <p className="panel-kicker">批量执行</p>
          <h2>{getPanelTitle(intent)}</h2>
        </div>
      </header>

      <div className="callout-box">
        <strong>目标机器人：</strong> {selectedProjects.map((project) => project.name).join("、")}
      </div>

      <form className="project-form" onSubmit={handleSubmit}>
        {(intent === "hooks" || intent === "skills") ? (
          <section className="detail-section">
            <p className="section-label">{intent === "hooks" ? "Hook 设置" : "Skill 设置"}</p>
            <div className="form-grid">
              <label className="form-field">
                <span>动作</span>
                <select
                  value={state.mode}
                  onChange={(event) => updateField("mode", event.target.value)}
                  disabled={busy}
                >
                  <option value="enable">启用</option>
                  <option value="disable">禁用</option>
                </select>
              </label>
              <label className="form-field">
                <span>{intent === "hooks" ? "Hook 名称" : "Skill 名称"}</span>
                <input
                  value={state.name}
                  onChange={(event) => updateField("name", event.target.value)}
                  placeholder={intent === "hooks" ? "daily-summary" : "customer-support"}
                  disabled={busy}
                />
              </label>
            </div>
          </section>
        ) : null}

        {intent === "memory" ? (
          <section className="detail-section">
            <p className="section-label">记忆块</p>
            <div className="form-grid">
              <label className="form-field">
                <span>动作</span>
                <select
                  value={state.mode}
                  onChange={(event) => updateField("mode", event.target.value)}
                  disabled={busy}
                >
                  <option value="append">追加</option>
                  <option value="remove">删除</option>
                </select>
              </label>
              <label className="form-field">
                <span>Block ID</span>
                <input
                  value={state.blockId}
                  onChange={(event) => updateField("blockId", event.target.value)}
                  placeholder={state.mode === "append" ? "可留空自动生成" : "必须填写"}
                  disabled={busy}
                />
              </label>
              {state.mode === "append" ? (
                <label className="form-field form-field-full">
                  <span>内容</span>
                  <textarea
                    value={state.content}
                    onChange={(event) => updateField("content", event.target.value)}
                    rows={5}
                    placeholder="这段文本会被写入每个机器人的记忆"
                    disabled={busy}
                  />
                </label>
              ) : null}
            </div>
          </section>
        ) : null}

        {intent === "config" ? (
          <section className="detail-section">
            <p className="section-label">配置 Patch</p>
            <div className="form-grid">
              <label className="form-field">
                <span>动作</span>
                <select
                  value={state.mode}
                  onChange={(event) => updateField("mode", event.target.value)}
                  disabled={busy}
                >
                  <option value="set">写入</option>
                  <option value="delete">删除</option>
                </select>
              </label>
              <label className="form-field form-field-full">
                <span>Path</span>
                <input
                  value={state.path}
                  onChange={(event) => updateField("path", event.target.value)}
                  placeholder="例如 gateway.port 或 skills.entries.customer-support.enabled"
                  disabled={busy}
                />
              </label>
              {state.mode === "set" ? (
                <label className="form-field form-field-full">
                  <span>JSON Value</span>
                  <textarea
                    value={state.valueJson}
                    onChange={(event) => updateField("valueJson", event.target.value)}
                    rows={4}
                    placeholder={'例如 true、123、"hello"、{"enabled":true}'}
                    disabled={busy}
                  />
                </label>
              ) : null}
            </div>
          </section>
        ) : null}

        {localError || errorMessage ? (
          <div className="callout-box callout-box-danger">{localError ?? errorMessage}</div>
        ) : null}

        <div className="panel-action-row">
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? "执行中..." : "执行批量动作"}
          </button>
          <button type="button" className="ghost-button" onClick={onCancel} disabled={busy}>
            关闭面板
          </button>
        </div>
      </form>

      {result ? (
        <section className="detail-section">
          <p className="section-label">执行结果</p>
          <div className="result-list">
            {result.results.map((entry) => (
              <div key={entry.projectId} className={`result-item ${entry.ok ? "result-item-ok" : "result-item-bad"}`}>
                <strong>{entry.projectName}</strong>
                <span>{entry.message}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </aside>
  );
}
