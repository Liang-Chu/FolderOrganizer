import { useEffect, useState, useRef } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import {
  FolderPlus,
  Trash2,
  ToggleLeft,
  ToggleRight,
  ShieldCheck,
  Plus,
  ChevronDown,
  ChevronUp,
  ListChecks,
  Copy,
} from "lucide-react";
import { open, message, confirm } from "@tauri-apps/plugin-dialog";
import * as api from "../api";
import type { WatchedFolder, Rule, RuleExecutionStats } from "../types";
import { createEmptyRule } from "./rules/helpers";
import { RuleEditor } from "./rules/RuleEditor";
import { RuleListItem } from "./rules/RuleListItem";
import { ImportRulesModal } from "./rules/ImportRulesModal";

type ExpandedSection = "rules" | "whitelist" | null;

export default function Folders() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [folders, setFolders] = useState<WatchedFolder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [defaultSortRoot, setDefaultSortRoot] = useState("D:\\sorted");

  // Track which folder has which section expanded
  const [expandedSections, setExpandedSections] = useState<Record<string, ExpandedSection>>({});

  // Rule editing state
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [isNewRule, setIsNewRule] = useState(false);

  // Assign-to-folders modal
  const [assignRule, setAssignRule] = useState<Rule | null>(null);
  const [assignSourceFolderId, setAssignSourceFolderId] = useState<string | null>(null);

  // Import rules modal
  const [importTargetFolderId, setImportTargetFolderId] = useState<string | null>(null);

  // Add rule dropdown menu
  const [addRuleMenuFolderId, setAddRuleMenuFolderId] = useState<string | null>(null);
  const addRuleMenuRef = useRef<HTMLDivElement>(null);

  // Whitelist input per folder
  const [whitelistInputs, setWhitelistInputs] = useState<Record<string, string>>({});

  // Rule execution stats per folder (keyed by folder id -> rule name -> stats)
  const [ruleStats, setRuleStats] = useState<Record<string, Record<string, RuleExecutionStats>>>({});

  const loadFolders = async () => {
    try {
      const f = await api.getWatchedFolders();
      setFolders(f);
      // Load stats for all folders
      const statsMap: Record<string, Record<string, RuleExecutionStats>> = {};
      await Promise.all(
        f.map(async (folder) => {
          try {
            const stats = await api.getRuleExecutionStats(folder.id);
            const byName: Record<string, RuleExecutionStats> = {};
            for (const s of stats) {
              byName[s.rule_name] = s;
            }
            statsMap[folder.id] = byName;
          } catch {}
        })
      );
      setRuleStats(statsMap);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadFolders();
    api.getConfig().then((cfg) => {
      if (cfg.settings.default_sort_root) {
        setDefaultSortRoot(cfg.settings.default_sort_root);
      }
    });
  }, []);

  // Auto-expand folder from query param (e.g. right-click "Watch with Folder Organizer")
  useEffect(() => {
    const expandId = searchParams.get("expand");
    if (expandId && folders.length > 0) {
      // Expand the rules section for this folder
      setExpandedSections((prev) => ({ ...prev, [expandId]: "rules" }));
      // Clear the param so it doesn't persist
      setSearchParams({}, { replace: true });
      // Scroll the folder into view
      requestAnimationFrame(() => {
        const el = document.getElementById(`folder-${expandId}`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    }
  }, [searchParams, folders]);

  // Close add-rule dropdown on outside click
  useEffect(() => {
    if (!addRuleMenuFolderId) return;
    const handler = (e: MouseEvent) => {
      if (addRuleMenuRef.current && !addRuleMenuRef.current.contains(e.target as Node)) {
        setAddRuleMenuFolderId(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [addRuleMenuFolderId]);

  // ── Folder actions ──

  const handleAdd = async () => {
    if (busy) return;
    setError(null);
    try {
      const selected = await open({ directory: true, multiple: false, title: t("folders.selectFolder"), defaultPath: "C:\\" });
      if (!selected) return;
      setBusy(true);
      await api.addWatchedFolder(selected as string);
      await loadFolders();
      try { await api.restartWatcher(); } catch {}
    } catch (e: any) {
      const errMsg = String(e);
      setError(errMsg);
      await message(errMsg, { title: t("folders.failedToAdd"), kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (id: string) => {
    setBusy(true);
    try {
      await api.removeWatchedFolder(id);
      await loadFolders();
      await api.restartWatcher().catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    setBusy(true);
    try {
      await api.toggleWatchedFolder(id, enabled);
      await loadFolders();
      await api.restartWatcher().catch(() => {});
    } finally {
      setBusy(false);
    }
  };


  const handleFolderCardClick = (folderId: string) => (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, textarea, label")) {
      return;
    }
    toggleSection(folderId, "rules");
  };

  const handleOpenFolderPath = async (
    folderPath: string,
    event: ReactMouseEvent<HTMLButtonElement>
  ) => {
    event.stopPropagation();
    try {
      await api.openInExplorer(folderPath);
    } catch (err) {
      message(String(err ?? "Failed to open folder"), { kind: "error" }).catch(() => {});
    }
  };

  // ── Section expand/collapse ──

  const toggleSection = (folderId: string, section: ExpandedSection) => {
    setExpandedSections((prev) => ({
      ...prev,
      [folderId]: prev[folderId] === section ? null : section,
    }));
  };

  // ── Rule CRUD ──

  const handleAddRule = (folderId: string) => {
    const rule = createEmptyRule();
    setEditingFolderId(folderId);
    setEditingRule(rule);
    setIsNewRule(true);
    setExpandedSections((prev) => ({ ...prev, [folderId]: "rules" }));
  };

  const handleSaveRule = async (rule: Rule) => {
    if (!editingFolderId) return;
    if (isNewRule) {
      await api.addRule(editingFolderId, rule);
    } else {
      await api.updateRule(editingFolderId, rule);
    }
    setEditingRule(null);
    setIsNewRule(false);
    setEditingFolderId(null);
    await loadFolders();
  };

  const handleDeleteRule = async (folderId: string, ruleId: string) => {
    await api.deleteRule(folderId, ruleId);
    if (editingRule?.id === ruleId) {
      setEditingRule(null);
      setIsNewRule(false);
      setEditingFolderId(null);
    }
    await loadFolders();
  };

  const handleToggleRule = async (folderId: string, rule: Rule) => {
    const updated = { ...rule, enabled: !rule.enabled };
    await api.updateRule(folderId, updated);
    await loadFolders();
  };

  const handleToggleRuleSubdirs = async (folderId: string, rule: Rule) => {
    const updated = { ...rule, match_subdirectories: !rule.match_subdirectories };
    await api.updateRule(folderId, updated);
    await loadFolders();
    await api.restartWatcher().catch(() => {});
  };

  const handleEditRule = (folderId: string, rule: Rule) => {
    setEditingFolderId(folderId);
    setEditingRule({ ...rule });
    setIsNewRule(false);
  };

  // ── Drag-to-reorder rules ──

  const [dragFolderId, setDragFolderId] = useState<string | null>(null);
  const [dragFromIndex, setDragFromIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [dragDirection, setDragDirection] = useState<"above" | "below" | null>(null);

  const handleRuleDragStart = (folderId: string, index: number) => {
    setDragFolderId(folderId);
    setDragFromIndex(index);
  };

  const handleRuleDragOver = (folderId: string, e: React.DragEvent, index: number) => {
    if (dragFolderId !== folderId) return;
    setDragOverIndex(index);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    setDragDirection(e.clientY < midY ? "above" : "below");
  };

  const handleRuleDrop = async (folderId: string, dropIndex: number) => {
    if (dragFolderId !== folderId || dragFromIndex === null) {
      resetDrag();
      return;
    }
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) { resetDrag(); return; }

    const ids = folder.rules.map((r) => r.id);
    const [moved] = ids.splice(dragFromIndex, 1);
    let insertAt = dropIndex;
    if (dragFromIndex < dropIndex) insertAt--;
    if (dragDirection === "below") insertAt++;
    insertAt = Math.max(0, Math.min(ids.length, insertAt));
    ids.splice(insertAt, 0, moved);

    resetDrag();
    await api.reorderRules(folderId, ids);
    await loadFolders();
  };

  const resetDrag = () => {
    setDragFolderId(null);
    setDragFromIndex(null);
    setDragOverIndex(null);
    setDragDirection(null);
  };

  // ── Assign rule to multiple folders ──

  const handleOpenAssign = (folderId: string, rule: Rule) => {
    setAssignSourceFolderId(folderId);
    setAssignRule(rule);
  };

  const handleAssignToFolders = async (targetFolderIds: string[]) => {
    if (!assignSourceFolderId || !assignRule) return;
    for (const targetId of targetFolderIds) {
      await api.copyRulesToFolder(targetId, [
        { folder_id: assignSourceFolderId, rule_id: assignRule.id },
      ]);
    }
    setAssignRule(null);
    setAssignSourceFolderId(null);
    await loadFolders();
  };

  // ── Import rules ──

  const handleImportRules = async (sources: { folder_id: string; rule_id: string }[]) => {
    if (!importTargetFolderId) return;
    await api.copyRulesToFolder(importTargetFolderId, sources);
    await loadFolders();
  };

  // ── Whitelist ──

  const handleSaveWhitelist = async (folderId: string, whitelist: string[]) => {
    await api.setFolderWhitelist(folderId, whitelist);
    await loadFolders();
  };

  const addWhitelistPattern = async (folderId: string) => {
    const pattern = (whitelistInputs[folderId] || "").trim();
    if (!pattern) return;
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return;
    await handleSaveWhitelist(folderId, [...folder.whitelist, pattern]);
    setWhitelistInputs((prev) => ({ ...prev, [folderId]: "" }));
  };

  const removeWhitelistPattern = async (folderId: string, idx: number) => {
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return;
    const updated = [...folder.whitelist];
    updated.splice(idx, 1);
    await handleSaveWhitelist(folderId, updated);
  };

  const otherFoldersHaveRules = (folderId: string) =>
    folders.some((f) => f.id !== folderId && f.rules.length > 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{t("folders.title")}</h2>
        <button
          onClick={handleAdd}
          disabled={busy}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
        >
          <FolderPlus size={16} />
          {busy ? t("folders.adding") : t("folders.addFolder")}
        </button>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {folders.length === 0 ? (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 px-5 py-12 text-center text-zinc-500">
          {t("folders.noFolders")}
        </div>
      ) : (
        <div className="space-y-3">
          {folders.map((folder) => {
            const rulesExpanded = expandedSections[folder.id] === "rules";
            const whitelistExpanded = expandedSections[folder.id] === "whitelist";
            const whitelistInput = whitelistInputs[folder.id] || "";

            return (
              <div
                key={folder.id}
                id={`folder-${folder.id}`}
                className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden cursor-pointer"
                onClick={handleFolderCardClick(folder.id)}
                onDragOver={(e) => { e.preventDefault(); }}
              >
                {/* Folder header */}
                <div className="px-5 py-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={(e) => handleOpenFolderPath(folder.path, e)}
                      className="text-sm font-medium text-left text-zinc-200 hover:text-blue-300 focus:outline-none inline-flex max-w-full p-0"
                    >
                      <span className="truncate">{folder.path}</span>
                    </button>
                  </div>

                  {/* Section tabs */}
                  <button
                    onClick={() => toggleSection(folder.id, "rules")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex-shrink-0 border ${
                      rulesExpanded
                        ? "bg-blue-600/15 text-blue-400 border-blue-500/40"
                        : "text-blue-300 border-blue-500/30 bg-blue-500/5 hover:text-blue-200 hover:border-blue-400/50 hover:bg-blue-500/10"
                    }`}
                  >
                    <ListChecks size={15} />
                    {t("folders.ruleCount", { count: folder.rules.length })}
                    {rulesExpanded
                      ? <ChevronUp size={14} className="ml-0.5" />
                      : <ChevronDown size={14} className="ml-0.5" />
                    }
                  </button>
                  <button
                    onClick={() => toggleSection(folder.id, "whitelist")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex-shrink-0 border ${
                      whitelistExpanded
                        ? "bg-emerald-600/15 text-emerald-400 border-emerald-500/40"
                        : "text-emerald-300 border-emerald-500/30 bg-emerald-500/5 hover:text-emerald-200 hover:border-emerald-400/50 hover:bg-emerald-500/10"
                    }`}
                  >
                    <ShieldCheck size={15} />
                    {folder.whitelist.length > 0
                      ? t("folders.whitelistCount", { count: folder.whitelist.length })
                      : t("folders.whitelist")}
                    {whitelistExpanded
                      ? <ChevronUp size={14} className="ml-0.5" />
                      : <ChevronDown size={14} className="ml-0.5" />
                    }
                  </button>

                  <div className="w-px h-6 bg-zinc-700 flex-shrink-0" />

                  <button
                    onClick={() => handleToggle(folder.id, !folder.enabled)}
                    className={`transition-colors flex-shrink-0 ${
                      folder.enabled ? "text-green-400" : "text-zinc-600"
                    }`}
                    title={folder.enabled ? t("folders.disable") : t("folders.enable")}
                  >
                    {folder.enabled ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
                  </button>
                  <button
                    onClick={async () => {
                      const ok = await confirm(
                        t("folders.removeConfirm", { path: folder.path }),
                        { title: t("folders.remove"), kind: "warning" }
                      );
                      if (ok) handleRemove(folder.id);
                    }}
                    className="text-zinc-500 hover:text-red-400 transition-colors flex-shrink-0"
                    title={t("folders.remove")}
                  >
                    <Trash2 size={18} />
                  </button>
                </div>

                {/* Rules section */}
                {rulesExpanded && (
                  <div className="px-5 pb-4 pt-3">
                    <div className="flex items-center justify-end mb-3">
                      <div className="relative" ref={addRuleMenuFolderId === folder.id ? addRuleMenuRef : null}>
                        <button
                          onClick={() => setAddRuleMenuFolderId(
                            addRuleMenuFolderId === folder.id ? null : folder.id
                          )}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition-colors"
                        >
                          <Plus size={14} />
                          {t("rules.addRule")}
                          <ChevronDown size={12} className="ml-0.5" />
                        </button>
                        {addRuleMenuFolderId === folder.id && (
                          <div className="absolute right-0 top-full mt-1 w-48 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-10 py-1">
                            <button
                              onClick={() => {
                                setAddRuleMenuFolderId(null);
                                handleAddRule(folder.id);
                              }}
                              className="w-full text-left px-4 py-2.5 text-sm hover:bg-zinc-700 transition-colors flex items-center gap-2.5"
                            >
                              <Plus size={14} />
                              {t("rules.newRule")}
                            </button>
                            {otherFoldersHaveRules(folder.id) && (
                              <button
                                onClick={() => {
                                  setAddRuleMenuFolderId(null);
                                  setImportTargetFolderId(folder.id);
                                }}
                                className="w-full text-left px-4 py-2.5 text-sm hover:bg-zinc-700 transition-colors flex items-center gap-2.5"
                              >
                                <Copy size={14} />
                                {t("rules.importRules")}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Rule editor (inline) */}
                    {editingFolderId === folder.id && editingRule && (
                      <div className="mb-3">
                        <RuleEditor
                          rule={editingRule}
                          isNew={isNewRule}
                          defaultSortRoot={defaultSortRoot}
                          onSave={handleSaveRule}
                          onCancel={() => {
                            setEditingRule(null);
                            setIsNewRule(false);
                            setEditingFolderId(null);
                          }}
                        />
                      </div>
                    )}

                    {/* Rules list */}
                    {folder.rules.length === 0 && !(editingFolderId === folder.id && editingRule) ? (
                      <div className="text-center text-zinc-500 text-sm py-8">
                        {t("rules.noRules")}
                      </div>
                    ) : (
                      <div
                        className="overflow-x-auto"
                        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        onDragEnd={resetDrag}
                        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); resetDrag(); }}
                      >
                        <div className="grid grid-cols-12 gap-2 px-2 py-1 text-xs text-zinc-400 font-semibold border-b border-zinc-800 select-none">
                          <span className="col-span-2">{t("rules.colName", "Name")}</span>
                          <span className="col-span-3">{t("rules.colCondition", "Condition")}</span>
                          <span className="col-span-3">{t("rules.colAction", "Action")}</span>
                          <span className="col-span-2 pl-1">{t("rules.colWhitelist", "Whitelist")}</span>
                          <span className="col-span-1 pl-2">{t("rules.colLastRun", "Last Run")}</span>
                          <span className="col-span-1 text-right pr-1">{t("rules.colWeekly", "7d")}</span>
                        </div>
                        {folder.rules.map((rule, ruleIdx) => (
                          <RuleListItem
                            key={rule.id}
                            rule={rule}
                            index={ruleIdx}
                            isEditing={editingFolderId === folder.id && editingRule?.id === rule.id}
                            onEdit={(r) => handleEditRule(folder.id, r)}
                            onDelete={(ruleId) => handleDeleteRule(folder.id, ruleId)}
                            onToggle={(r) => handleToggleRule(folder.id, r)}
                            onToggleSubdirs={(r) => handleToggleRuleSubdirs(folder.id, r)}
                            stats={ruleStats[folder.id]?.[rule.name]}
                            showAssign={folders.length > 1}
                            onAssign={() => handleOpenAssign(folder.id, rule)}
                            onDragStart={(idx) => handleRuleDragStart(folder.id, idx)}
                            onDragOver={(e, idx) => handleRuleDragOver(folder.id, e, idx)}
                            onDrop={(idx) => handleRuleDrop(folder.id, idx)}
                            isDragOver={dragFolderId === folder.id && dragOverIndex === ruleIdx}
                            dragDirection={dragFolderId === folder.id && dragOverIndex === ruleIdx ? dragDirection : null}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Whitelist section */}
                {whitelistExpanded && (
                  <div className="px-5 pb-4 pt-3">
                    <p className="text-sm text-zinc-400 mb-3">{t("folders.whitelistDesc")}</p>

                    {folder.whitelist.length > 0 && (
                      <div className="space-y-1.5 mb-3">
                        {folder.whitelist.map((pattern, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <span className="flex-1 px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-sm font-mono">
                              {pattern}
                            </span>
                            <button
                              onClick={() => removeWhitelistPattern(folder.id, idx)}
                              className="text-zinc-500 hover:text-red-400 transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={whitelistInput}
                        onChange={(e) =>
                          setWhitelistInputs((prev) => ({
                            ...prev,
                            [folder.id]: e.target.value,
                          }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") addWhitelistPattern(folder.id);
                        }}
                        placeholder={t("folders.whitelistPlaceholder")}
                        className="flex-1 px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-sm font-mono focus:outline-none focus:border-blue-500"
                      />
                      <button
                        onClick={() => addWhitelistPattern(folder.id)}
                        disabled={!whitelistInput.trim()}
                        className="flex items-center gap-1 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 border border-zinc-700 rounded-lg text-sm transition-colors"
                      >
                        <Plus size={14} />
                        {t("folders.whitelistAdd")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Assign Rule to Folders Modal */}
      {assignRule && assignSourceFolderId && (
        <AssignRuleModal
          rule={assignRule}
          sourceFolderId={assignSourceFolderId}
          folders={folders}
          onAssign={handleAssignToFolders}
          onClose={() => {
            setAssignRule(null);
            setAssignSourceFolderId(null);
          }}
        />
      )}

      {/* Import Rules Modal */}
      {importTargetFolderId && (
        <ImportRulesModal
          folders={folders}
          targetFolderId={importTargetFolderId}
          onImport={handleImportRules}
          onClose={() => setImportTargetFolderId(null)}
        />
      )}
    </div>
  );
}

// ── Assign Rule to Multiple Folders Modal ──

function AssignRuleModal({
  rule,
  sourceFolderId,
  folders,
  onAssign,
  onClose,
}: {
  rule: Rule;
  sourceFolderId: string;
  folders: WatchedFolder[];
  onAssign: (folderIds: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const otherFolders = folders.filter((f) => f.id !== sourceFolderId);
  const selectedCount = Object.values(selected).filter(Boolean).length;

  const handleAssign = async () => {
    const ids = otherFolders.filter((f) => selected[f.id]).map((f) => f.id);
    if (ids.length === 0) return;
    setBusy(true);
    try {
      await onAssign(ids);
      setDone(true);
      setTimeout(() => onClose(), 1200);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-md shadow-2xl">
        <div className="px-5 py-4 border-b border-zinc-800">
          <h3 className="text-sm font-semibold">{t("folders.assignRuleTitle")}</h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            {t("folders.assignRuleDesc", { name: rule.name })}
          </p>
        </div>
        <div className="px-5 py-4 space-y-2 max-h-60 overflow-y-auto">
          {otherFolders.map((f) => (
            <label
              key={f.id}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                selected[f.id]
                  ? "bg-blue-950/40 border-blue-600"
                  : "bg-zinc-800/60 border-zinc-700 hover:border-zinc-600"
              }`}
            >
              <input
                type="checkbox"
                checked={!!selected[f.id]}
                onChange={() => setSelected((prev) => ({ ...prev, [f.id]: !prev[f.id] }))}
                className="accent-blue-600 flex-shrink-0"
              />
              <span className="text-sm truncate">{f.path}</span>
            </label>
          ))}
        </div>
        <div className="px-5 py-3 border-t border-zinc-800 flex items-center justify-between">
          <span className="text-xs text-zinc-500">
            {done
              ? t("folders.assignRuleDone")
              : selectedCount > 0
                ? t("rules.importRulesSelected", { count: selectedCount })
                : ""}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
            >
              {t("rules.cancel")}
            </button>
            <button
              onClick={handleAssign}
              disabled={selectedCount === 0 || busy || done}
              className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg font-medium transition-colors"
            >
              {t("folders.assignRuleCopy")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
