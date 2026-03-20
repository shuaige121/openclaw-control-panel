import { useState } from "react";
import type { ActionHistoryEntry } from "../types";

type ActionHistoryPanelProps = {
  title: string;
  subtitle: string;
  items: ActionHistoryEntry[];
  emptyMessage: string;
};

function formatTimestamp(value: string): string {
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

function formatRelativeTime(value: string): string {
  const now = Date.now();
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = now - then;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

const actionVerbs: Record<string, string> = {
  start: "启动了",
  stop: "停止了",
  restart: "重启了",
  compatibility_scan: "扫描了",
  smoke_test: "测试了",
  model_update: "切换了模型",
  memory_mode_update: "调整了记忆模式",
  template_apply: "应用了模板",
  hook_manage: "管理了钩子",
  skill_manage: "管理了技能",
  config_patch: "更新了配置",
  delete: "删除了",
  create: "创建了",
};

function narrativeSummary(item: ActionHistoryEntry): string {
  const projectNames = item.projects.map((p) => p.name).join("、");
  const verb = actionVerbs[item.actionName ?? ""] ?? "操作了";
  const status = item.ok ? "" : "（失败）";
  return `${verb} ${projectNames}${status}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return "不到 1 秒";
  if (ms < 60000) return `${Math.round(ms / 1000)} 秒`;
  return `${Math.round(ms / 60000)} 分钟`;
}

function HistoryItem({ item }: { item: ActionHistoryEntry }) {
  const [showDetail, setShowDetail] = useState(false);
  const hasDetail = Boolean(item.command ?? item.stdout ?? item.stderr);

  return (
    <article className={`history-item ${item.ok ? "history-item-ok" : "history-item-bad"}`}>
      <header className="history-item-header">
        <span className={`history-icon ${item.ok ? "tone-ok" : "tone-bad"}`}>
          {item.ok ? "✓" : "✗"}
        </span>
        <div className="history-item-main">
          <strong>{narrativeSummary(item)}</strong>
          {item.durationMs !== null ? (
            <span className="history-duration">用时 {formatDuration(item.durationMs)}</span>
          ) : null}
        </div>
        <span className="history-time" title={formatTimestamp(item.createdAt)}>
          {formatRelativeTime(item.createdAt)}
        </span>
      </header>
      {hasDetail ? (
        <button
          type="button"
          className="history-detail-toggle"
          onClick={() => setShowDetail(!showDetail)}
        >
          {showDetail ? "隐藏技术细节 ▲" : "查看技术细节 ▼"}
        </button>
      ) : null}
      {showDetail ? (
        <div className="history-technical">
          {item.command ? (
            <pre className="history-output"><code>{item.command}</code></pre>
          ) : null}
          {item.stdout ? (
            <pre className="history-output"><code>{item.stdout}</code></pre>
          ) : null}
          {item.stderr ? (
            <pre className="history-output history-output-error"><code>{item.stderr}</code></pre>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function ActionHistoryPanel({
  title,
  subtitle,
  items,
  emptyMessage,
}: ActionHistoryPanelProps) {
  return (
    <aside className="detail-panel">
      <header className="detail-header">
        <div>
          <p className="panel-kicker">最近操作</p>
          <h2>{title}</h2>
        </div>
      </header>

      <p className="muted-copy">{subtitle}</p>

      {items.length === 0 ? (
        <div className="callout-box callout-box-muted">{emptyMessage}</div>
      ) : (
        <div className="history-list">
          {items.map((item) => (
            <HistoryItem key={item.id} item={item} />
          ))}
        </div>
      )}
    </aside>
  );
}
