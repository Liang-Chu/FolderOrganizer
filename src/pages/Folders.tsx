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
  Check,
  X,
  ChevronDown,
  ChevronUp,
  ListChecks,
  Copy,
  RefreshCw,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { open, message, confirm } from "@tauri-apps/plugin-dialog";
import * as api from "../api";
import type { WatchedFolder, Rule, RuleExecutionStats } from "../types";
import { createEmptyRule } from "./rules/helpers";
import { RuleEditor } from "./rules/RuleEditor";
import { RuleListItem } from "./rules/RuleListItem";
import { ImportRulesModal } from "./rules/ImportRulesModal";

type ExpandedSection = "rules" | "whitelist" | null;
type ScanStatusEvent = {
  scope: "all" | "folder";
  folder_id: string | null;
  status: "started" | "finished" | "failed";
  count?: number;
  error?: string | null;
};

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
  const [folderWhitelistDrafts, setFolderWhitelistDrafts] = useState<Record<string, string[]>>({});
  const [folderWhitelistDirty, setFolderWhitelistDirty] = useState<Record<string, boolean>>({});
  const [editingWhitelistIndexByFolder, setEditingWhitelistIndexByFolder] = useState<Record<string, number | null>>({});
  const [editingWhitelistValueByFolder, setEditingWhitelistValueByFolder] = useState<Record<string, string>>({});

  // Rule execution stats per folder (keyed by folder id -> rule name -> stats)
  const [ruleStats, setRuleStats] = useState<Record<string, Record<string, RuleExecutionStats>>>({});
  const [scanningFolders, setScanningFolders] = useState<Record<string, boolean>>({});

  const loadFolders = async () => {
    try {
      const f = await api.getWatchedFolders();
      setFolders(f);
      // Default all folders to expanded (rules section)
      setExpandedSections((prev) => {
        const next = { ...prev };
        for (const folder of f) {
          if (!(folder.id in next)) {
            next[folder.id] = "rules";
          }
        }
        return next;
      });
      setFolderWhitelistDrafts(() => {
        const next: Record<string, string[]> = {};
        for (const folder of f) {
          next[folder.id] = [...folder.whitelist];
        }
        return next;
      });
      setFolderWhitelistDirty({});
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

    const unlistenScan = listen<ScanStatusEvent>("scan-status", (event) => {
      const payload = event.payload;
      if (payload.scope !== "folder" || !payload.folder_id) return;

      const folderId = payload.folder_id;
      if (payload.status === "started") {
        setScanningFolders((prev) => ({ ...prev, [folderId]: true }));
        return;
      }

      setScanningFolders((prev) => ({ ...prev, [folderId]: false }));
      loadFolders();

      if (payload.status === "failed") {
        message(payload.error || "Folder scan failed", {
          title: t("common.error"),
          kind: "error",
        }).catch(() => {});
      }
    });

    return () => {
      unlistenScan.then((fn) => fn());
    };
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
      // Scan the folder when re-enabled so existing files are evaluated
      if (enabled) {
        api.scanFolder(id).catch(() => {});
      }
    } finally {
      setBusy(false);
    }
  };


  const handleFolderCardClick = (folderId: string) => (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, textarea, label")) {
      return;
    }
    // Don't collapse the folder if a rule is being edited in it — user would lose edits
    if (editingFolderId === folderId && editingRule) {
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
    // Don't collapse if a rule is being edited in this folder — user would lose edits
    if (editingFolderId === folderId && editingRule && expandedSections[folderId] === section) {
      return;
    }
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
    const folderId = editingFolderId;
    const wasNewRule = isNewRule;
    if (wasNewRule) {
      await api.addRule(folderId, rule);
    } else {
      await api.updateRule(folderId, rule);
    }
    setEditingRule(null);
    setIsNewRule(false);
    setEditingFolderId(null);
    await loadFolders();
    // Trigger a scan for the folder when a rule is created or updated
    // For new rules: picks up existing files that match
    // For updated rules: re-evaluates after condition/action changes
    //   (backend already recalculated scheduled deletion dates)
    try {
      await api.scanFolder(folderId);
    } catch (e) {
      console.error("Scan after rule save failed:", e);
      message(String(e ?? "Scan failed"), {
        title: t("common.error"),
        kind: "error",
      }).catch(() => {});
    }
  };

  const handleDeleteRule = async (folderId: string, ruleId: string) => {
    const folder = folders.find((f) => f.id === folderId);
    const ruleName = folder?.rules.find((r) => r.id === ruleId)?.name ?? "";
    const ok = await confirm(
      t("rules.deleteRuleConfirm", { name: ruleName }),
      { title: t("rules.deleteRule"), kind: "warning" }
    );
    if (!ok) return;
    await api.deleteRule(folderId, ruleId);
    if (editingRule?.id === ruleId) {
      setEditingRule(null);
      setIsNewRule(false);
      setEditingFolderId(null);
    }
    await loadFolders();
    // Rescan: remaining rules may now match files the deleted rule was handling
    api.scanFolder(folderId).catch(() => {});
  };

  const handleToggleRule = async (folderId: string, rule: Rule) => {
    const updated = { ...rule, enabled: !rule.enabled };
    await api.updateRule(folderId, updated);
    await loadFolders();
    // Rescan so enabling/disabling takes effect on existing files
    api.scanFolder(folderId).catch(() => {});
  };

  const handleToggleRuleSubdirs = async (folderId: string, rule: Rule) => {
    const updated = { ...rule, match_subdirectories: !rule.match_subdirectories };
    await api.updateRule(folderId, updated);
    await loadFolders();
    await api.restartWatcher().catch(() => {});
    // Rescan: subdirectory matching changes which files are evaluated
    api.scanFolder(folderId).catch(() => {});
  };

  const handleEditRule = (folderId: string, rule: Rule) => {
    setEditingFolderId(folderId);
    setEditingRule({ ...rule });
    setIsNewRule(false);
  };

  // ── Drag-to-reorder rules ──

  const [dragFolderId, setDragFolderId] = useState<string | null>(null);
  const [dragFromIndex, setDragFromIndex] = useState<number | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [dragDirection, setDragDirection] = useState<"above" | "below" | null>(null);
  const [dragRuleId, setDragRuleId] = useState<string | null>(null);

  const handleRuleDragStart = (folderId: string, index: number) => {
    setDragFolderId(folderId);
    setDragFromIndex(index);
    const folder = folders.find((f) => f.id === folderId);
    if (folder && folder.rules[index]) {
      setDragRuleId(folder.rules[index].id);
    }
  };

  const handleRuleDragOver = (_folderId: string, e: React.DragEvent, index: number) => {
    setDragOverFolderId(_folderId);
    setDragOverIndex(index);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    setDragDirection(e.clientY < midY ? "above" : "below");
  };

  const handleRuleDrop = async (targetFolderId: string, dropIndex: number) => {
    if (dragFolderId === null || dragFromIndex === null || dragRuleId === null) {
      resetDrag();
      return;
    }

    if (dragFolderId === targetFolderId) {
      // Same folder: reorder
      const folder = folders.find((f) => f.id === targetFolderId);
      if (!folder) { resetDrag(); return; }

      const ids = folder.rules.map((r) => r.id);
      const [moved] = ids.splice(dragFromIndex, 1);
      let insertAt = dropIndex;
      if (dragFromIndex < dropIndex) insertAt--;
      if (dragDirection === "below") insertAt++;
      insertAt = Math.max(0, Math.min(ids.length, insertAt));
      ids.splice(insertAt, 0, moved);

      resetDrag();
      await api.reorderRules(targetFolderId, ids);
      await loadFolders();
      // Rescan the folder so scheduled entries reflect the new priority order
      api.scanFolder(targetFolderId).catch(() => {});
    } else {
      // Cross-folder: ask user to move or duplicate
      const targetFolder = folders.find((f) => f.id === targetFolderId);
      let insertAt = dropIndex;
      if (dragDirection === "below") insertAt++;
      if (targetFolder) {
        insertAt = Math.max(0, Math.min(targetFolder.rules.length, insertAt));
      }

      const srcFolderId = dragFolderId;
      const ruleId = dragRuleId;
      resetDrag();
      await handleCrossFolderDrop(srcFolderId, targetFolderId, ruleId, insertAt);
    }
  };

  /** Handle dropping on an empty rules area or the container itself */
  const handleRulesContainerDrop = async (targetFolderId: string, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragFolderId === null || dragRuleId === null || dragFolderId === targetFolderId) {
      resetDrag();
      return;
    }
    const targetFolder = folders.find((f) => f.id === targetFolderId);
    const position = targetFolder ? targetFolder.rules.length : 0;
    const srcFolderId = dragFolderId;
    const ruleId = dragRuleId;
    resetDrag();
    await handleCrossFolderDrop(srcFolderId, targetFolderId, ruleId, position);
  };

  /** Prompt user to move or duplicate a rule across folders, then execute. */
  const handleCrossFolderDrop = async (
    srcFolderId: string,
    targetFolderId: string,
    ruleId: string,
    insertAt: number,
  ) => {
    const result = await message(t("folders.crossFolderPrompt"), {
      title: t("folders.crossFolderTitle"),
      buttons: {
        yes: t("folders.moveRule"),
        no: t("folders.duplicateRule"),
        cancel: t("common.cancel"),
      },
    });

    if (result === "Cancel") return;

    if (result === "Yes") {
      // Move
      await api.moveRuleToFolder(srcFolderId, targetFolderId, ruleId, insertAt);
      await loadFolders();
      api.scanFolder(srcFolderId).catch(() => {});
      setTimeout(() => api.scanFolder(targetFolderId).catch(() => {}), 1500);
    } else {
      // Duplicate (copy)
      await api.copyRulesToFolder(targetFolderId, [
        { folder_id: srcFolderId, rule_id: ruleId },
      ]);
      // The copy is appended at the end — reorder to place it at insertAt
      const updated = await api.getConfig();
      const tgt = updated.folders.find((f) => f.id === targetFolderId);
      if (tgt && tgt.rules.length > 0) {
        const ids = tgt.rules.map((r) => r.id);
        // Move the last rule (the newly appended copy) to insertAt
        const copiedId = ids.pop()!;
        ids.splice(insertAt, 0, copiedId);
        await api.reorderRules(targetFolderId, ids);
      }
      await loadFolders();
      api.scanFolder(targetFolderId).catch(() => {});
    }
  };

  const resetDrag = () => {
    setDragFolderId(null);
    setDragFromIndex(null);
    setDragOverFolderId(null);
    setDragOverIndex(null);
    setDragDirection(null);
    setDragRuleId(null);
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
    // Scan folder so imported rules evaluate existing files
    api.scanFolder(importTargetFolderId).catch(() => {});
  };

  // ── Whitelist ──

  const handleSaveWhitelist = async (folderId: string, whitelist: string[]) => {
    await api.setFolderWhitelist(folderId, whitelist);
    await loadFolders();
    // Rescan: whitelist changes affect which files are skipped
    api.scanFolder(folderId).catch(() => {});
  };

  const updateWhitelistDraft = (
    folderId: string,
    updater: (prev: string[]) => string[]
  ) => {
    setFolderWhitelistDrafts((prev) => {
      const current = prev[folderId] ?? [];
      return {
        ...prev,
        [folderId]: updater(current),
      };
    });
    setFolderWhitelistDirty((prev) => ({ ...prev, [folderId]: true }));
  };

  const saveWhitelistDraft = async (folderId: string) => {
    const baseDraft = folderWhitelistDrafts[folderId] ?? [];
    let finalDraft = [...baseDraft];

    const editingIdx = editingWhitelistIndexByFolder[folderId];
    if (editingIdx !== null && editingIdx !== undefined) {
      const edited = (editingWhitelistValueByFolder[folderId] || "").trim();
      if (edited) {
        finalDraft[editingIdx] = edited;
      } else {
        finalDraft.splice(editingIdx, 1);
      }
    }

    const pendingInput = (whitelistInputs[folderId] || "").trim();
    if (pendingInput) {
      finalDraft.push(pendingInput);
    }

    await handleSaveWhitelist(folderId, finalDraft);

    if (pendingInput) {
      setWhitelistInputs((prev) => ({ ...prev, [folderId]: "" }));
    }
    if (editingIdx !== null && editingIdx !== undefined) {
      cancelEditingWhitelistPattern(folderId);
    }
    setFolderWhitelistDirty((prev) => ({ ...prev, [folderId]: false }));
  };

  const addWhitelistPattern = async (folderId: string) => {
    const pattern = (whitelistInputs[folderId] || "").trim();
    if (!pattern) return;
    updateWhitelistDraft(folderId, (prev) => [...prev, pattern]);
    setWhitelistInputs((prev) => ({ ...prev, [folderId]: "" }));
  };

  const removeWhitelistPattern = (folderId: string, idx: number) => {
    setEditingWhitelistIndexByFolder((prev) => ({
      ...prev,
      [folderId]: prev[folderId] === idx ? null : prev[folderId] !== null && (prev[folderId] as number) > idx ? (prev[folderId] as number) - 1 : prev[folderId] ?? null,
    }));
    updateWhitelistDraft(folderId, (prev) => {
      const updated = [...prev];
      updated.splice(idx, 1);
      return updated;
    });
  };

  const startEditingWhitelistPattern = (folderId: string, idx: number, pattern: string) => {
    setEditingWhitelistIndexByFolder((prev) => ({ ...prev, [folderId]: idx }));
    setEditingWhitelistValueByFolder((prev) => ({ ...prev, [folderId]: pattern }));
  };

  const cancelEditingWhitelistPattern = (folderId: string) => {
    setEditingWhitelistIndexByFolder((prev) => ({ ...prev, [folderId]: null }));
    setEditingWhitelistValueByFolder((prev) => ({ ...prev, [folderId]: "" }));
  };

  const applyEditingWhitelistPattern = async (folderId: string) => {
    const idx = editingWhitelistIndexByFolder[folderId];
    if (idx === null || idx === undefined) return;
    const edited = (editingWhitelistValueByFolder[folderId] || "").trim();
    updateWhitelistDraft(folderId, (prev) => {
      const updated = [...prev];
      if (edited) {
        updated[idx] = edited;
      } else {
        updated.splice(idx, 1);
      }
      return updated;
    });
    cancelEditingWhitelistPattern(folderId);
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
            const whitelistInput = whitelistInputs[folder.id] || "";
            const whitelistDraft = folderWhitelistDrafts[folder.id] ?? folder.whitelist;
            const whitelistDirty = folderWhitelistDirty[folder.id] ?? false;
            const editingWhitelistIndex = editingWhitelistIndexByFolder[folder.id] ?? null;
            const editingWhitelistValue = editingWhitelistValueByFolder[folder.id] || "";
            const hasPendingWhitelistInput = whitelistInput.trim().length > 0;
            const hasPendingWhitelistEdit = editingWhitelistIndex !== null;
            const canSaveWhitelist = whitelistDirty || hasPendingWhitelistInput || hasPendingWhitelistEdit;

            return (
              <div
                key={folder.id}
                id={`folder-${folder.id}`}
                className={`bg-zinc-900 rounded-xl border overflow-hidden cursor-pointer transition-colors ${
                  dragFolderId && dragFolderId !== folder.id && dragOverFolderId === folder.id
                    ? "border-purple-500"
                    : "border-zinc-800"
                }`}
                onClick={handleFolderCardClick(folder.id)}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragFolderId && dragFolderId !== folder.id) {
                    setDragOverFolderId(folder.id);
                    // Auto-expand rules section when dragging over a folder
                    if (expandedSections[folder.id] !== "rules") {
                      setExpandedSections((prev) => ({ ...prev, [folder.id]: "rules" }));
                    }
                  }
                }}
                onDrop={(e) => handleRulesContainerDrop(folder.id, e)}
              >
                {/* Folder header */}
                <div className="px-5 py-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <button
                        type="button"
                        onClick={(e) => handleOpenFolderPath(folder.path, e)}
                        className="text-sm font-medium text-left text-zinc-200 hover:text-blue-300 focus:outline-none inline-flex max-w-full p-0"
                      >
                        <span className="truncate">{folder.path}</span>
                      </button>
                      {scanningFolders[folder.id] && (
                        <span className="inline-flex items-center gap-1 text-xs text-zinc-400 flex-shrink-0">
                          <RefreshCw size={12} className="animate-spin" />
                          {t("folders.scanning")}
                        </span>
                      )}
                    </div>
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
                    {scanningFolders[folder.id] && (
                      <RefreshCw size={13} className="ml-1 animate-spin" />
                    )}
                  </button>
                  <button
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex-shrink-0 border text-emerald-300 border-emerald-500/30 bg-emerald-500/5"
                    disabled
                  >
                    <ShieldCheck size={15} />
                    {whitelistDraft.length > 0
                      ? t("folders.whitelistCount", { count: whitelistDraft.length })
                      : t("folders.whitelist")}
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
                      <div className="mb-3" onClick={(e) => e.stopPropagation()}>
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
                      <div
                        className={`text-center text-sm py-8 rounded-lg border-2 border-dashed transition-colors ${
                          dragFolderId && dragFolderId !== folder.id
                            ? "border-purple-500/40 bg-purple-500/5 text-purple-400"
                            : "border-transparent text-zinc-500"
                        }`}
                        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        onDrop={(e) => handleRulesContainerDrop(folder.id, e)}
                      >
                        {dragFolderId && dragFolderId !== folder.id
                          ? t("folders.dropRuleHere", "Drop rule here")
                          : t("rules.noRules")}
                      </div>
                    ) : (
                      <div
                        className="overflow-x-auto"
                        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        onDragEnd={resetDrag}
                        onDrop={(e) => handleRulesContainerDrop(folder.id, e)}
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
                            isDragOver={dragOverFolderId === folder.id && dragOverIndex === ruleIdx}
                            dragDirection={dragOverFolderId === folder.id && dragOverIndex === ruleIdx ? dragDirection : null}
                          />
                        ))}
                      </div>
                    )}

                    {/* Whitelist section (inline under rules) */}
                    <div className="mt-4 pt-4 border-t border-zinc-800">
                      <p className="text-sm text-zinc-400 mb-2">{t("folders.whitelistDesc")}</p>

                      {whitelistDraft.length > 0 && (
                        <div className="space-y-1.5 mb-3">
                          {whitelistDraft.map((pattern, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                              {editingWhitelistIndex === idx ? (
                                <input
                                  type="text"
                                  value={editingWhitelistValue}
                                  onChange={(e) =>
                                    setEditingWhitelistValueByFolder((prev) => ({
                                      ...prev,
                                      [folder.id]: e.target.value,
                                    }))
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      applyEditingWhitelistPattern(folder.id);
                                    } else if (e.key === "Escape") {
                                      e.preventDefault();
                                      cancelEditingWhitelistPattern(folder.id);
                                    }
                                  }}
                                  className="flex-1 px-3 py-1.5 bg-zinc-800 border border-blue-500 rounded-lg text-sm font-mono focus:outline-none"
                                  autoFocus
                                />
                              ) : (
                                <input
                                  type="text"
                                  value={pattern}
                                  readOnly
                                  onClick={() => startEditingWhitelistPattern(folder.id, idx, pattern)}
                                  className="flex-1 px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-sm font-mono text-zinc-100 cursor-text focus:outline-none"
                                />
                              )}
                              {editingWhitelistIndex === idx ? (
                                <>
                                  <button
                                    onClick={() => applyEditingWhitelistPattern(folder.id)}
                                    className="text-zinc-500 hover:text-green-400 transition-colors"
                                    title={t("rules.save")}
                                  >
                                    <Check size={14} />
                                  </button>
                                  <button
                                    onClick={() => cancelEditingWhitelistPattern(folder.id)}
                                    className="text-zinc-500 hover:text-zinc-300 transition-colors"
                                    title={t("rules.cancel")}
                                  >
                                    <X size={14} />
                                  </button>
                                </>
                              ) : null}
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

                      <div className="flex justify-end mt-2">
                        <button
                          onClick={() => saveWhitelistDraft(folder.id)}
                          disabled={!canSaveWhitelist}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded-lg text-sm font-medium transition-colors"
                        >
                          {t("rules.save")}
                        </button>
                      </div>
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
