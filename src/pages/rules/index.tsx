import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, ChevronDown, Copy } from "lucide-react";
import * as api from "../../api";
import type { WatchedFolder, Rule } from "../../types";
import { createEmptyRule } from "./helpers";
import { RuleEditor } from "./RuleEditor";
import { RuleListItem } from "./RuleListItem";
import { ImportRulesModal } from "./ImportRulesModal";

export default function Rules() {
  const { t } = useTranslation();
  const [folders, setFolders] = useState<WatchedFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [isNewRule, setIsNewRule] = useState(false);
  const [defaultSortRoot, setDefaultSortRoot] = useState("D:\\sorted");
  const [showImportModal, setShowImportModal] = useState(false);

  useEffect(() => {
    api.getWatchedFolders().then((f) => {
      setFolders(f);
      if (f.length > 0) setSelectedFolderId(f[0].id);
    });
    api.getConfig().then((cfg) => {
      if (cfg.settings.default_sort_root) {
        setDefaultSortRoot(cfg.settings.default_sort_root);
      }
    });
  }, []);

  useEffect(() => {
    if (selectedFolderId) {
      api.getRules(selectedFolderId).then(setRules);
    }
  }, [selectedFolderId]);

  const handleAddRule = () => {
    const rule = createEmptyRule();
    setEditingRule(rule);
    setIsNewRule(true);
  };

  const handleSaveRule = async (rule: Rule) => {
    if (!selectedFolderId) return;
    if (isNewRule) {
      await api.addRule(selectedFolderId, rule);
    } else {
      await api.updateRule(selectedFolderId, rule);
    }
    setEditingRule(null);
    setIsNewRule(false);
    setRules(await api.getRules(selectedFolderId));
  };

  const handleDeleteRule = async (ruleId: string) => {
    if (!selectedFolderId) return;
    await api.deleteRule(selectedFolderId, ruleId);
    if (editingRule?.id === ruleId) {
      setEditingRule(null);
      setIsNewRule(false);
    }
    setRules(await api.getRules(selectedFolderId));
  };

  const handleToggleRule = async (rule: Rule) => {
    if (!selectedFolderId) return;
    const updated = { ...rule, enabled: !rule.enabled };
    await api.updateRule(selectedFolderId, updated);
    setRules(await api.getRules(selectedFolderId));
  };

  const handleImportRules = async (
    sources: { folder_id: string; rule_id: string }[]
  ) => {
    if (!selectedFolderId) return;
    await api.copyRulesToFolder(selectedFolderId, sources);
    // Refresh both rules list and folders (since folders contain rules)
    setRules(await api.getRules(selectedFolderId));
    const updatedFolders = await api.getWatchedFolders();
    setFolders(updatedFolders);
  };

  // Check if other folders have rules to import
  const otherFoldersHaveRules = folders.some(
    (f) => f.id !== selectedFolderId && f.rules.length > 0
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{t("rules.title")}</h2>
        <div className="flex items-center gap-2">
          {otherFoldersHaveRules && (
            <button
              onClick={() => setShowImportModal(true)}
              disabled={!selectedFolderId}
              className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 border border-zinc-700 rounded-lg text-sm font-medium transition-colors"
            >
              <Copy size={16} />
              {t("rules.importRules")}
            </button>
          )}
          <button
            onClick={handleAddRule}
            disabled={!selectedFolderId}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus size={16} />
            {t("rules.addRule")}
          </button>
        </div>
      </div>

      {/* Folder selector */}
      <div className="relative">
        <select
          value={selectedFolderId ?? ""}
          onChange={(e) => {
            setSelectedFolderId(e.target.value);
            setEditingRule(null);
            setIsNewRule(false);
          }}
          className="w-full px-4 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-sm focus:outline-none focus:border-blue-500 appearance-none"
        >
          {folders.length === 0 && (
            <option value="">{t("rules.noFoldersSelect")}</option>
          )}
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {typeof f.path === "string" ? f.path : String(f.path)}
            </option>
          ))}
        </select>
        <ChevronDown
          size={16}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
        />
      </div>

      {/* Rule editor */}
      {editingRule && (
        <RuleEditor
          rule={editingRule}
          isNew={isNewRule}
          defaultSortRoot={defaultSortRoot}
          onSave={handleSaveRule}
          onCancel={() => {
            setEditingRule(null);
            setIsNewRule(false);
          }}
        />
      )}

      {/* Rules list */}
      {rules.length === 0 ? (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 px-5 py-12 text-center text-zinc-500">
          {selectedFolderId
            ? t("rules.noRules")
            : t("rules.selectFolder")}
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <RuleListItem
              key={rule.id}
              rule={rule}
              isEditing={editingRule?.id === rule.id}
              onEdit={(r) => {
                setEditingRule({ ...r });
                setIsNewRule(false);
              }}
              onDelete={handleDeleteRule}
              onToggle={handleToggleRule}
            />
          ))}
        </div>
      )}

      {/* Import Rules Modal */}
      {showImportModal && selectedFolderId && (
        <ImportRulesModal
          folders={folders}
          targetFolderId={selectedFolderId}
          onImport={handleImportRules}
          onClose={() => setShowImportModal(false)}
        />
      )}
    </div>
  );
}
