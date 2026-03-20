import type { BulkIntent, ProjectListItem } from "../types";

type BulkToolbarProps = {
  selectedProjects: ProjectListItem[];
  bulkIntent: BulkIntent | null;
  onIntentChange: (intent: BulkIntent) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
};

const bulkLabels: Record<BulkIntent, string> = {
  hooks: "批量 Hook",
  skills: "批量 Skill",
  memory: "批量记忆",
  config: "批量配置 Patch",
};

export function BulkToolbar({
  selectedProjects,
  bulkIntent,
  onIntentChange,
  onSelectAll,
  onClearSelection,
}: BulkToolbarProps) {
  const names = selectedProjects.map((project) => project.name).join("、");
  const intentAvailability: Record<BulkIntent, { enabled: boolean; reason: string }> = {
    hooks: {
      enabled: selectedProjects.every((project) => project.capabilities.bulkHooks),
      reason: "有机器人禁用了批量 Hook。",
    },
    skills: {
      enabled: selectedProjects.every((project) => project.capabilities.bulkSkills),
      reason: "有机器人禁用了批量 Skill。",
    },
    memory: {
      enabled: selectedProjects.every(
        (project) => project.capabilities.bulkMemory && project.memory.mode === "normal",
      ),
      reason: "有机器人不是正常记忆模式，或禁用了批量记忆。",
    },
    config: {
      enabled: selectedProjects.every((project) => project.capabilities.bulkConfigPatch),
      reason: "有机器人禁用了批量配置修改。",
    },
  };

  return (
    <section className="bulk-toolbar">
      <div>
        <p className="panel-kicker">批量操作</p>
        <h2>已选 {selectedProjects.length} 个机器人</h2>
        <p className="muted-copy">
          对选中的机器人统一执行批量操作。
        </p>
      </div>

      <div className="bulk-actions">
        {Object.entries(bulkLabels).map(([intent, label]) => (
          <button
            key={intent}
            type="button"
            className={`ghost-button${bulkIntent === intent ? " ghost-button-active" : ""}`}
            onClick={() => onIntentChange(intent as BulkIntent)}
            disabled={!intentAvailability[intent as BulkIntent].enabled}
            title={intentAvailability[intent as BulkIntent].enabled ? undefined : intentAvailability[intent as BulkIntent].reason}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="bulk-footer">
        <p className="muted-copy">
          当前选择：<span className="strong-inline">{names}</span>
        </p>
        <div className="bulk-footer-actions">
          <button type="button" className="link-button" onClick={onSelectAll}>
            选中全部
          </button>
          <button type="button" className="link-button" onClick={onClearSelection}>
            清空选择
          </button>
        </div>
      </div>
    </section>
  );
}
