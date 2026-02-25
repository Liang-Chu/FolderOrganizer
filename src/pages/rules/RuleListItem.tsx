import { GripVertical, Trash2 } from "lucide-react";
import type { Rule } from "../../types";
import { conditionSummary } from "./helpers";
import { ActionDisplay } from "./ActionDisplay";

interface RuleListItemProps {
  rule: Rule;
  isEditing: boolean;
  onEdit: (rule: Rule) => void;
  onDelete: (ruleId: string) => void;
  onToggle: (rule: Rule) => void;
}

export function RuleListItem({ rule, isEditing, onEdit, onDelete, onToggle }: RuleListItemProps) {
  return (
    <div
      className={`bg-zinc-900 rounded-xl border px-5 py-3 flex items-center justify-between transition-colors ${
        isEditing
          ? "border-blue-600"
          : "border-zinc-800"
      } ${!rule.enabled ? "opacity-50" : ""}`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <GripVertical
          size={16}
          className="text-zinc-600 flex-shrink-0"
        />
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{rule.name}</p>
          <p className="text-xs text-zinc-500">
            <span className="font-mono text-zinc-400">
              {conditionSummary(rule.condition_text)}
            </span>
            {" → "}
            <ActionDisplay action={rule.action} />
          </p>
          {rule.description && (
            <p className="text-xs text-zinc-600 truncate">
              {rule.description}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0 ml-3">
        <button
          onClick={() => onToggle(rule)}
          className={`text-xs px-2 py-1 rounded-lg border transition-colors ${
            rule.enabled
              ? "border-green-700 text-green-400 hover:bg-green-900/30"
              : "border-zinc-700 text-zinc-500 hover:bg-zinc-800"
          }`}
        >
          {rule.enabled ? "On" : "Off"}
        </button>
        <button
          onClick={() => onEdit(rule)}
          className="text-xs px-3 py-1 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
        >
          Edit
        </button>
        <button
          onClick={() => onDelete(rule.id)}
          className="text-zinc-500 hover:text-red-400 transition-colors"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}
