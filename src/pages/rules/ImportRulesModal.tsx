import { useState } from "react";
import { useTranslation } from "react-i18next";
import { X, Copy, Check } from "lucide-react";
import type { WatchedFolder, Rule } from "../../types";
import { conditionSummary } from "./helpers";
import { ActionDisplay } from "./ActionDisplay";

interface ImportRulesModalProps {
  folders: WatchedFolder[];
  /** The folder we're importing INTO — its rules are excluded from the picker */
  targetFolderId: string;
  onImport: (sources: { folder_id: string; rule_id: string }[]) => Promise<void>;
  onClose: () => void;
}

interface SelectableRule {
  folderId: string;
  folderPath: string;
  rule: Rule;
  selected: boolean;
}

export function ImportRulesModal({
  folders,
  targetFolderId,
  onImport,
  onClose,
}: ImportRulesModalProps) {
  const { t } = useTranslation();

  // Build flat list of rules from other folders
  const allRules: SelectableRule[] = [];
  for (const folder of folders) {
    if (folder.id === targetFolderId) continue;
    for (const rule of folder.rules) {
      allRules.push({
        folderId: folder.id,
        folderPath: typeof folder.path === "string" ? folder.path : String(folder.path),
        rule,
        selected: false,
      });
    }
  }

  const [selections, setSelections] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [successCount, setSuccessCount] = useState<number | null>(null);

  const toggleRule = (ruleId: string) => {
    setSelections((prev) => ({ ...prev, [ruleId]: !prev[ruleId] }));
    setSuccessCount(null);
  };

  const selectedCount = Object.values(selections).filter(Boolean).length;

  const handleImport = async () => {
    const sources = allRules
      .filter((r) => selections[r.rule.id])
      .map((r) => ({ folder_id: r.folderId, rule_id: r.rule.id }));
    if (sources.length === 0) return;
    setBusy(true);
    try {
      await onImport(sources);
      setSuccessCount(sources.length);
      // Clear selections after successful import
      setSelections({});
    } finally {
      setBusy(false);
    }
  };

  // Group rules by folder for display
  const groupedByFolder = new Map<string, { path: string; rules: SelectableRule[] }>();
  for (const item of allRules) {
    if (!groupedByFolder.has(item.folderId)) {
      groupedByFolder.set(item.folderId, { path: item.folderPath, rules: [] });
    }
    groupedByFolder.get(item.folderId)!.rules.push(item);
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div>
            <h3 className="text-lg font-semibold">{t("rules.importRulesTitle")}</h3>
            <p className="text-xs text-zinc-500 mt-0.5">{t("rules.importRulesDesc")}</p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {allRules.length === 0 ? (
            <div className="text-center text-zinc-500 py-12">
              {t("rules.importRulesNone")}
            </div>
          ) : (
            Array.from(groupedByFolder.entries()).map(([folderId, group]) => (
              <div key={folderId}>
                <p className="text-xs text-zinc-400 mb-2 flex items-center gap-1.5">
                  <span className="text-zinc-500">{t("rules.importRulesFrom")}</span>
                  <span className="font-mono text-zinc-300 truncate">{group.path}</span>
                </p>
                <div className="space-y-1.5">
                  {group.rules.map((item) => (
                    <label
                      key={item.rule.id}
                      className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                        selections[item.rule.id]
                          ? "bg-blue-950/40 border-blue-600"
                          : "bg-zinc-800/60 border-zinc-700 hover:border-zinc-600"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={!!selections[item.rule.id]}
                        onChange={() => toggleRule(item.rule.id)}
                        className="accent-blue-600 flex-shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{item.rule.name}</p>
                        <p className="text-xs text-zinc-500">
                          <span className="font-mono text-zinc-400">
                            {conditionSummary(item.rule.condition_text, t)}
                          </span>
                          {" → "}
                          <ActionDisplay action={item.rule.action} />
                        </p>
                        {item.rule.description && (
                          <p className="text-xs text-zinc-600 truncate mt-0.5">
                            {item.rule.description}
                          </p>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-zinc-800">
          <div className="text-xs text-zinc-500">
            {selectedCount > 0 && t("rules.importRulesSelected", { count: selectedCount })}
            {successCount !== null && (
              <span className="text-green-400 flex items-center gap-1 inline-flex ml-2">
                <Check size={12} />
                {t("rules.importRulesSuccess", { count: successCount })}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm transition-colors"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={handleImport}
              disabled={selectedCount === 0 || busy}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-lg text-sm font-medium transition-colors"
            >
              <Copy size={14} />
              {t("rules.importRulesCopy")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
