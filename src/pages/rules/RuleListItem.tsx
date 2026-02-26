import { useTranslation } from "react-i18next";
import { GripVertical, Trash2, Clock, Zap, ShieldCheck, Copy, FolderTree } from "lucide-react";
import type { Rule, RuleExecutionStats } from "../../types";
import { conditionSummary } from "./helpers";
import { ActionDisplay } from "./ActionDisplay";

/** Format a timestamp like "2026-02-25 14:03:22" (UTC) into a short relative or date string */
function formatLastRun(timestamp: string | null | undefined, t: (k: string, opts?: Record<string, unknown>) => string): string {
  if (!timestamp) return t("rules.neverRun");
  try {
    // Timestamps are stored in UTC without a Z suffix — append it
    const date = new Date(timestamp.replace(" ", "T") + "Z");
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return t("rules.justNow");
    if (diffMins < 60) return t("rules.minutesAgo", { count: diffMins });
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return t("rules.hoursAgo", { count: diffHours });
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return t("rules.daysAgo", { count: diffDays });
    return date.toLocaleDateString();
  } catch {
    return timestamp;
  }
}

interface RuleListItemProps {
  rule: Rule;
  index?: number;
  isEditing: boolean;
  onEdit: (rule: Rule) => void;
  onDelete: (ruleId: string) => void;
  onToggle: (rule: Rule) => void;
  onToggleSubdirs?: (rule: Rule) => void;
  stats?: RuleExecutionStats;
  showAssign?: boolean;
  onAssign?: () => void;
  onDragStart?: (index: number) => void;
  onDragOver?: (e: React.DragEvent, index: number) => void;
  onDrop?: (index: number) => void;
  isDragOver?: boolean;
  dragDirection?: "above" | "below" | null;
}

export function RuleListItem({ rule, index = 0, isEditing, onEdit, onDelete, onToggle, onToggleSubdirs, stats, showAssign, onAssign, onDragStart, onDragOver, onDrop, isDragOver, dragDirection }: RuleListItemProps) {
  const { t } = useTranslation();
  const draggable = !!(onDragStart && onDragOver && onDrop);

  const handleRowClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation(); // prevent folder card toggle
    if ((e.target as HTMLElement).closest("button")) return;
    onEdit(rule);
  };

  return (
    <div
      className={`grid grid-cols-12 items-center px-2 py-2 rounded-lg text-sm bg-zinc-900 border mb-1 cursor-pointer hover:border-zinc-600 transition-colors ${
        isEditing ? "border-blue-600" : isDragOver && dragDirection === "above" ? "border-t-purple-500 border-zinc-800" : isDragOver && dragDirection === "below" ? "border-b-purple-500 border-zinc-800" : "border-zinc-800"
      } ${!rule.enabled ? "opacity-50" : ""}`}
      onClick={handleRowClick}
      draggable={draggable}
      onDragStart={draggable ? (e) => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", rule.id);
        onDragStart!(index);
      } : undefined}
      onDragOver={draggable ? (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        onDragOver!(e, index);
      } : undefined}
      onDrop={draggable ? (e) => {
        e.preventDefault();
        e.stopPropagation();
        onDrop!(index);
      } : undefined}
      onDragEnd={draggable ? (e) => e.stopPropagation() : undefined}
    >
      {/* Name */}
      <div className="col-span-2 truncate flex items-center gap-2">
        <GripVertical size={14} className={`flex-shrink-0 ${draggable ? "text-zinc-500 cursor-grab active:cursor-grabbing" : "text-zinc-600"}`} />
        <span className="font-medium truncate">{rule.name}</span>
      </div>
      {/* Condition — subfolder toggle + text */}
      <div className="col-span-3 min-w-0 flex items-center gap-1.5">
        {onToggleSubdirs ? (
          <button
            onClick={() => onToggleSubdirs(rule)}
            className={`flex-shrink-0 p-0.5 rounded transition-colors ${
              rule.match_subdirectories
                ? "text-purple-400 hover:text-purple-300"
                : "text-zinc-600 hover:text-zinc-400"
            }`}
            title={rule.match_subdirectories ? t("rules.subfoldersOn") : t("rules.subfoldersOff")}
          >
            <FolderTree size={13} />
          </button>
        ) : rule.match_subdirectories ? (
          <span className="flex-shrink-0 text-purple-400/80" title={t("rules.subfoldersTag")}>
            <FolderTree size={12} />
          </span>
        ) : null}
        <span className="truncate font-mono text-xs text-zinc-400">{conditionSummary(rule.condition_text, t)}</span>
      </div>
      {/* Action */}
      <div className="col-span-3 truncate"><ActionDisplay action={rule.action} /></div>
      {/* Whitelist */}
      <div className="col-span-2 text-xs text-amber-500/80 leading-tight max-h-9 overflow-hidden pl-1">
        {rule.whitelist.length > 0 ? (
          <span className="flex items-start gap-1 break-words">
            <ShieldCheck size={11} className="mt-0.5 flex-shrink-0" />
            <span className="break-words">{rule.whitelist.join(", ")}</span>
          </span>
        ) : (
          <span className="text-zinc-600">—</span>
        )}
      </div>
      {/* Last Run */}
      <div className="col-span-1 truncate text-[11px] text-zinc-500 flex items-center gap-1 pl-2">
        <Clock size={10} />
        {formatLastRun(stats?.last_executed, t)}
      </div>
      {/* 7d */}
      <div className="col-span-1 flex items-center justify-end gap-1 text-[11px] text-zinc-500 pr-1">
        <Zap size={10} />
        {stats?.executions_this_week ?? 0}
      </div>
      {/* Controls */}
      <div className="hidden">
        <button
          onClick={() => onToggle(rule)}
          className={`text-xs px-2 py-1 rounded-lg border transition-colors ${
            rule.enabled
              ? "border-green-700 text-green-400 hover:bg-green-900/30"
              : "border-zinc-700 text-zinc-500 hover:bg-zinc-800"
          }`}
        >
          {rule.enabled ? t("rules.on") : t("rules.off")}
        </button>
        <button
          onClick={() => onEdit(rule)}
          className="text-xs px-3 py-1 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
        >
          {t("rules.edit")}
        </button>
        <button
          onClick={() => onDelete(rule.id)}
          className="text-zinc-500 hover:text-red-400 transition-colors"
        >
          <Trash2 size={15} />
        </button>
        {showAssign && onAssign && (
          <button
            onClick={onAssign}
            className="text-zinc-600 hover:text-blue-400 transition-colors ml-1"
            title={t("folders.assignToOtherFolders")}
          >
            <Copy size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
