import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FolderOpen,
  Activity,
  Play,
  Pause,
  RefreshCw,
  Clock,
  ArrowUpDown,
  Layers,
  ChevronRight,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { confirm } from "@tauri-apps/plugin-dialog";
import * as api from "../api";
import type { AppConfig, ActivityLogEntry, ScheduledDeletion } from "../types";
import { formatBytes } from "../utils/format";

type ScanStatusEvent = {
  scope: "all" | "folder";
  folder_id: string | null;
  status: "started" | "finished" | "failed";
  count?: number;
  error?: string | null;
};

/** Split a full file path into directory + file name */
/** Extract a destination path from activity details strings like:
 *  "Moved to C:\path\file.txt", "File moved to C:\path\", "File scheduled for move → C:\path\" */
function extractDestination(details: string | null): string | null {
  if (!details) return null;
  // "→ C:\..." or "Moved to C:\..." or "File moved to C:\..."
  const arrowMatch = details.match(/→\s*(.+)/);
  if (arrowMatch) return arrowMatch[1].trim();
  const movedMatch = details.match(/[Mm]oved to\s+(.+)/);
  if (movedMatch) return movedMatch[1].trim();
  return null;
}

function splitPath(filePath: string): { dir: string; name: string } {
  const sep = filePath.lastIndexOf("\\") !== -1 ? "\\" : "/";
  const idx = filePath.lastIndexOf(sep);
  if (idx === -1) return { dir: "", name: filePath };
  return { dir: filePath.slice(0, idx), name: filePath.slice(idx + 1) };
}

/** Shorten a full file path by collapsing middle segments.
 *  Always keeps the first 2 dir segments + ".." + last 2 dir segments + file name.
 *  e.g. C:\Users\korsm\AppData\Local\deep\folder\file.txt
 *    => C:\Users\..\deep\folder\file.txt
 *  Short paths (<=5 total segments) are returned unchanged. */
function formatDisplayPath(filePath: string): { dir: string; name: string } {
  const sep = filePath.includes("\\") ? "\\" : "/";
  const allParts = filePath.split(/[\\/]/);
  if (allParts.length <= 1) return { dir: "", name: filePath };

  const name = allParts[allParts.length - 1];
  const dirParts = allParts.slice(0, -1);

  if (dirParts.length <= 4) {
    return { dir: dirParts.join(sep), name };
  }

  const head = dirParts.slice(0, 2);
  const tail = dirParts.slice(-2);
  return { dir: head.join(sep) + sep + ".." + sep + tail.join(sep), name };
}

// Persist collapsed groups across tab switches (module-level, resets on window close)
let _savedCollapsedGroups = new Set<string>();

export default function Dashboard() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [recentActivity, setRecentActivity] = useState<ActivityLogEntry[]>([]);
  const [scheduledDeletions, setScheduledDeletions] = useState<ScheduledDeletion[]>([]);
  const [watcherRunning, setWatcherRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deletionResult, setDeletionResult] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<"file" | "rule" | "date">("date");
  const [sortAsc, setSortAsc] = useState(true);
  const [selectedDeletionIds, setSelectedDeletionIds] = useState<string[]>([]);
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [groupBy, setGroupByState] = useState<"none" | "date" | "rule" | "folder">("date");
  const [collapsedGroups, setCollapsedGroupsState] = useState<Set<string>>(_savedCollapsedGroups);

  const setGroupBy = (v: typeof groupBy) => {
    setGroupByState(v);
    if (config) {
      const updated = { ...config, settings: { ...config.settings, dashboard_group_by: v } };
      setConfig(updated);
      api.saveConfig(updated);
    }
  };
  const setCollapsedGroups = (fn: (prev: Set<string>) => Set<string>) => {
    setCollapsedGroupsState((prev) => { const next = fn(prev); _savedCollapsedGroups = next; return next; });
  };
  const refreshInFlight = useRef(false);

  const loadData = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      const [cfg, log, status, deletions] = await Promise.all([
        api.getConfig(),
        api.getActivityLog(10),
        api.getWatcherStatus(),
        api.getScheduledDeletions(),
      ]);
      setConfig(cfg);
      if (cfg.settings.dashboard_group_by) {
        setGroupByState(cfg.settings.dashboard_group_by);
      }
      setRecentActivity(log);
      setWatcherRunning(status);
      setScheduledDeletions(deletions);
      setSelectedDeletionIds((prev) => prev.filter((id) => deletions.some((d) => d.id === id)));
    } catch (e) {
      console.error("Failed to load dashboard data:", e);
    } finally {
      setLoading(false);
      refreshInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    loadData();
    const unlistenDashboard = listen("dashboard-data-changed", () => {
      loadData();
    });

    const unlistenScan = listen<ScanStatusEvent>("scan-status", (event) => {
      const payload = event.payload;
      if (payload.scope !== "all") return;

      if (payload.status === "started") {
        setScanning(true);
        setScanResult(null);
        return;
      }

      if (payload.status === "finished") {
        setScanning(false);
        setScanResult(t("dashboard.scanComplete", { count: payload.count ?? 0 }));
        setTimeout(() => setScanResult(null), 4000);
        loadData();
        return;
      }

      setScanning(false);
      setScanResult(payload.error || t("dashboard.scanFailed"));
      setTimeout(() => setScanResult(null), 4000);
    });

    return () => {
      unlistenDashboard.then((fn) => fn());
      unlistenScan.then((fn) => fn());
    };
  }, [loadData, t]);

  const toggleWatcher = async () => {
    if (watcherRunning) {
      await api.stopWatcher();
    } else {
      await api.restartWatcher();
    }
    setWatcherRunning(!watcherRunning);
  };

  const handleScan = async () => {
    try {
      await api.scanNow();
    } catch (e) {
      console.error("Scan failed:", e);
      setScanning(false);
      setScanResult(String(e) || t("dashboard.scanFailed"));
      setTimeout(() => setScanResult(null), 4000);
    }
  };

  const handleRunDeletions = async () => {
    const count = await api.runDeletions();
    setDeletionResult(t("dashboard.deletionsRan", { count }));
    setTimeout(() => setDeletionResult(null), 3000);
    loadData();
  };

  const handleDeleteSelectedNow = async () => {
    if (selectedDeletionIds.length === 0) return;
    const ok = await confirm(
      t("dashboard.deleteNowConfirm", { count: selectedDeletionIds.length }),
      { title: t("dashboard.deleteNow"), kind: "warning" }
    );
    if (!ok) return;
    setDeletingSelected(true);
    try {
      const count = await api.deleteScheduledNow(selectedDeletionIds);
      setDeletionResult(t("dashboard.deletionsSelectedRan", { count }));
      setSelectedDeletionIds([]);
      setTimeout(() => setDeletionResult(null), 3000);
      loadData();
    } catch (e) {
      console.error("Delete selected failed:", e);
    } finally {
      setDeletingSelected(false);
    }
  };

  const handleOpenFolder = async (filePath: string) => {
    const { dir } = splitPath(filePath);
    if (dir) {
      try {
        await api.openInExplorer(dir);
      } catch (e) {
        console.error("Failed to open folder:", e);
      }
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500">
        {t("common.loading")}
      </div>
    );
  }

  const enabledFolders = config?.folders.filter((f) => f.enabled).length ?? 0;
  const totalRules =
    config?.folders.reduce((sum, f) => sum + f.rules.length, 0) ?? 0;

  const sortedDeletions = [...scheduledDeletions].sort((a, b) => {
    let cmp = 0;
    if (sortCol === "file") cmp = a.file_name.localeCompare(b.file_name);
    else if (sortCol === "rule") cmp = a.rule_name.localeCompare(b.rule_name);
    else cmp = a.delete_after.localeCompare(b.delete_after);
    return sortAsc ? cmp : -cmp;
  });

  const visibleDeletions = sortedDeletions;
  const allVisibleSelected = visibleDeletions.length > 0 && visibleDeletions.every((entry) => selectedDeletionIds.includes(entry.id));

  // Build folder id → path lookup
  const folderPathMap = new Map<string, string>();
  for (const f of config?.folders ?? []) folderPathMap.set(f.id, f.path);

  // Group visible deletions
  type DeletionGroup = { label: string; items: typeof visibleDeletions };
  const groupedDeletions: DeletionGroup[] = (() => {
    if (groupBy === "none") return [{ label: "", items: visibleDeletions }];
    const map = new Map<string, typeof visibleDeletions>();
    for (const entry of visibleDeletions) {
      let key: string;
      if (groupBy === "date") key = entry.delete_after.split(" ")[0];
      else if (groupBy === "rule") key = entry.rule_name;
      else key = folderPathMap.get(entry.folder_id) ?? entry.folder_id;
      const list = map.get(key);
      if (list) list.push(entry);
      else map.set(key, [entry]);
    }
    return [...map.entries()].map(([label, items]) => ({ label, items }));
  })();

  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedDeletionIds((prev) => prev.filter((id) => !visibleDeletions.some((entry) => entry.id === id)));
      return;
    }

    setSelectedDeletionIds((prev) => {
      const merged = new Set(prev);
      for (const entry of visibleDeletions) merged.add(entry.id);
      return [...merged];
    });
  };

  const toggleSelectDeletion = (id: string) => {
    setSelectedDeletionIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleGroupCollapsed = (label: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const toggleSelectGroup = (group: { items: typeof visibleDeletions }) => {
    const groupIds = group.items.map((e) => e.id);
    const allSelected = groupIds.every((id) => selectedDeletionIds.includes(id));
    if (allSelected) {
      setSelectedDeletionIds((prev) => prev.filter((id) => !groupIds.includes(id)));
    } else {
      setSelectedDeletionIds((prev) => {
        const merged = new Set(prev);
        for (const id of groupIds) merged.add(id);
        return [...merged];
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{t("dashboard.title")}</h2>
        <div className="flex gap-2 items-center">
          {scanResult && (
            <span className="flex items-center text-xs text-zinc-400 px-2">
              {scanResult}
            </span>
          )}
          <button
            onClick={handleScan}
            disabled={scanning}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-60 disabled:cursor-not-allowed text-sm font-medium transition-colors"
          >
            <RefreshCw size={16} className={scanning ? "animate-spin" : ""} />
            {scanning ? t("dashboard.scanning") : t("dashboard.scanNow")}
          </button>
          <button
            onClick={toggleWatcher}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              watcherRunning
                ? "bg-amber-600 hover:bg-amber-500"
                : "bg-green-600 hover:bg-green-500"
            }`}
          >
            {watcherRunning ? <Pause size={16} /> : <Play size={16} />}
            {watcherRunning ? t("dashboard.pause") : t("dashboard.start")}
          </button>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-zinc-900 rounded-xl p-5 border border-zinc-800">
          <div className="flex items-center gap-3 text-zinc-400 mb-2">
            <FolderOpen size={20} />
            <span className="text-sm font-medium">{t("dashboard.watchedFolders")}</span>
          </div>
          <p className="text-3xl font-bold">{enabledFolders}</p>
        </div>
        <div className="bg-zinc-900 rounded-xl p-5 border border-zinc-800">
          <div className="flex items-center gap-3 text-zinc-400 mb-2">
            <Activity size={20} />
            <span className="text-sm font-medium">{t("dashboard.activeRules")}</span>
          </div>
          <p className="text-3xl font-bold">{totalRules}</p>
        </div>
        <div className="bg-zinc-900 rounded-xl p-5 border border-zinc-800">
          <div className="flex items-center gap-3 text-zinc-400 mb-2">
            <div
              className={`w-3 h-3 rounded-full ${
                watcherRunning ? "bg-green-500" : "bg-zinc-600"
              }`}
            />
            <span className="text-sm font-medium">{t("dashboard.watcherStatus")}</span>
          </div>
          <p className="text-3xl font-bold">
            {watcherRunning ? t("dashboard.running") : t("dashboard.stopped")}
          </p>
        </div>
      </div>

      {/* Scheduled Deletions + Recent Activity side by side */}
      <div className={`grid gap-4 ${scheduledDeletions.length > 0 ? "grid-cols-[3fr_2fr]" : "grid-cols-1"}`}>
        {/* Scheduled Deletions — left side */}
        {scheduledDeletions.length > 0 && (
          <div className="bg-zinc-900 rounded-xl border border-amber-800/40 overflow-hidden min-w-0">
            <div className="px-5 py-4 border-b border-amber-800/20 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock size={16} className="text-amber-400" />
                <h3 className="font-semibold text-amber-400">
                  {t("dashboard.scheduledActions")}
                </h3>
                <span className="text-xs text-amber-400/60 ml-1">
                  {t("dashboard.scheduledDeletionsCount", { count: scheduledDeletions.length })}
                </span>
              </div>
              <div className="flex gap-2 items-center">
                {deletionResult && (
                  <span className="text-xs text-green-400">{deletionResult}</span>
                )}
                {selectedDeletionIds.length > 0 && (
                  <span className="text-xs text-amber-300/80">
                    {t("dashboard.selectedCount", { count: selectedDeletionIds.length })}
                  </span>
                )}
                <div className="flex items-center gap-1 text-zinc-400">
                  <Layers size={14} />
                  <select
                    value={groupBy}
                    onChange={(e) => setGroupBy(e.target.value as typeof groupBy)}
                    className="bg-zinc-800 border border-zinc-700 rounded text-xs px-1.5 py-1 text-zinc-300 cursor-pointer focus:border-amber-500 focus:outline-none"
                  >
                    <option value="none">{t("dashboard.groupByNone")}</option>
                    <option value="date">{t("dashboard.groupByDate")}</option>
                    <option value="rule">{t("dashboard.groupByRule")}</option>
                    <option value="folder">{t("dashboard.groupByFolder")}</option>
                  </select>
                </div>
                <button
                  onClick={handleRunDeletions}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-700 hover:bg-amber-600 rounded-lg text-xs font-medium transition-colors"
                  title={t("dashboard.runDeletionsHint")}
                >
                  <Play size={14} />
                  {t("dashboard.runDeletionsNow")}
                </button>
                <button
                  onClick={handleDeleteSelectedNow}
                  disabled={selectedDeletionIds.length === 0 || deletingSelected}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-700 hover:bg-red-600 disabled:opacity-60 disabled:cursor-not-allowed rounded-lg text-xs font-medium transition-colors"
                  title={t("dashboard.deleteNowHint")}
                >
                  <Play size={14} />
                  {deletingSelected ? t("dashboard.deletingNow") : t("dashboard.deleteNow")}
                </button>
              </div>
            </div>
          <div className="max-h-[60vh] overflow-y-auto">
            <table className="w-full text-sm table-fixed">
              <colgroup>
                <col className="w-[5%]" />
                <col className="w-[55%]" />
                <col className="w-[25%]" />
                <col className="w-[20%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-400">
                  <th className="text-left pl-3 pr-1 py-3">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAllVisible}
                      className="h-4 w-4 accent-amber-500 cursor-pointer"
                    />
                  </th>
                  <th
                    className="text-left px-5 py-3 font-medium cursor-pointer hover:text-zinc-200 select-none"
                    onClick={() => { if (sortCol === "file") setSortAsc(!sortAsc); else { setSortCol("file"); setSortAsc(true); } }}
                  >
                    <span className="inline-flex items-center gap-1">
                      {t("activity.headerFile")}
                      {sortCol === "file" && <ArrowUpDown size={12} className="text-amber-400" />}
                    </span>
                  </th>
                  <th
                    className="text-left px-5 py-3 font-medium cursor-pointer hover:text-zinc-200 select-none"
                    onClick={() => { if (sortCol === "rule") setSortAsc(!sortAsc); else { setSortCol("rule"); setSortAsc(true); } }}
                  >
                    <span className="inline-flex items-center gap-1">
                      {t("activity.headerRule")}
                      {sortCol === "rule" && <ArrowUpDown size={12} className="text-amber-400" />}
                    </span>
                  </th>
                  <th
                    className="text-left px-5 py-3 font-medium cursor-pointer hover:text-zinc-200 select-none"
                    onClick={() => { if (sortCol === "date") setSortAsc(!sortAsc); else { setSortCol("date"); setSortAsc(true); } }}
                  >
                    <span className="inline-flex items-center gap-1">
                      {t("dashboard.scheduledFor")}
                      {sortCol === "date" && <ArrowUpDown size={12} className="text-amber-400" />}
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {groupedDeletions.map((group) => {
                  const isGrouped = groupBy !== "none" && group.label;
                  const isCollapsed = isGrouped ? collapsedGroups.has(group.label) : false;
                  const allGroupSelected = group.items.length > 0 && group.items.every((e) => selectedDeletionIds.includes(e.id));
                  return (
                    <>
                      {isGrouped && (
                        <tr key={`group-${group.label}`} className="bg-zinc-800/60">
                          <td className="pl-6 pr-1 py-2">
                            <input
                              type="checkbox"
                              checked={allGroupSelected}
                              onChange={() => toggleSelectGroup(group)}
                              className="h-4 w-4 accent-amber-500 cursor-pointer"
                            />
                          </td>
                          <td
                            colSpan={3}
                            className="py-2 pr-4 cursor-pointer select-none"
                            onClick={() => toggleGroupCollapsed(group.label)}
                          >
                            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-400/90 tracking-wide uppercase">
                              <ChevronRight
                                size={14}
                                className={`transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                              />
                              {group.label}
                              <span className="text-zinc-500 font-normal normal-case">({group.items.length})</span>
                            </span>
                          </td>
                        </tr>
                      )}
                      {!isCollapsed && group.items.map((entry) => {
                        const { dir, name } = formatDisplayPath(entry.file_path);
                        const dateOnly = entry.delete_after.split(" ")[0];
                        const timePart = entry.delete_after.split(" ")[1]?.slice(0, 5) ?? "";
                        return (
                          <tr key={entry.id} className="hover:bg-zinc-800/50">
                            <td className="pl-9 pr-1 py-3 align-top">
                              <input
                                type="checkbox"
                                checked={selectedDeletionIds.includes(entry.id)}
                                onChange={() => toggleSelectDeletion(entry.id)}
                                className="h-4 w-4 accent-amber-500 cursor-pointer"
                              />
                            </td>
                            <td className="px-5 py-3 overflow-hidden">
                              <button
                                onClick={() => handleOpenFolder(entry.file_path)}
                                className="text-left underline decoration-zinc-600 underline-offset-2 hover:decoration-amber-400 transition-colors cursor-pointer break-words max-w-full"
                                title={entry.file_path}
                              >
                                <span className="text-zinc-500">{dir}\</span>
                                <span className="font-semibold text-amber-300">{name}</span>
                              </button>
                              {entry.action_type === "move" && (
                                <span className={`text-[10px] font-medium rounded px-1 py-0.5 ml-1.5 align-middle ${
                                  entry.keep_source
                                    ? "text-emerald-400/70 bg-emerald-400/10"
                                    : "text-blue-400/70 bg-blue-400/10"
                                }`}>
                                  {entry.keep_source ? t("dashboard.copyAction") : t("dashboard.moveAction")}
                                </span>
                              )}
                              {entry.size_bytes != null && (
                                <span className="text-xs text-zinc-600 ml-2">
                                  {formatBytes(entry.size_bytes)}
                                </span>
                              )}
                              {entry.action_type === "move" && entry.move_destination && (
                                <div className="mt-0.5">
                                  <button
                                    onClick={() => handleOpenFolder(entry.move_destination!)}
                                    className="text-xs text-blue-400/70 hover:text-blue-300 hover:underline transition-colors cursor-pointer truncate max-w-full"
                                    title={entry.move_destination}
                                  >
                                    → {entry.move_destination}
                                  </button>
                                </div>
                              )}
                            </td>
                            <td className="px-5 py-3 text-zinc-400 truncate" title={entry.rule_name}>{entry.rule_name}</td>
                            <td className="px-5 py-3 text-amber-400/80 whitespace-nowrap">
                              {dateOnly}
                              <span className="text-amber-400/50 ml-1 text-xs">{timePart}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </>
                  );
                })}
              </tbody>
            </table>
            </div>
            {scheduledDeletions.length > 8 && (
              <div className="px-5 py-1.5 border-t border-zinc-800/50 text-xs text-zinc-500 text-center">
                {scheduledDeletions.length} items
              </div>
            )}
          </div>
        )}

        {/* Recent activity — right side (or full width if no deletions) */}
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden min-w-0">
          <div className="px-5 py-4 border-b border-zinc-800">
            <h3 className="font-semibold">{t("dashboard.recentActivity")}</h3>
          </div>
          {recentActivity.length === 0 ? (
            <div className="px-5 py-8 text-center text-zinc-500 text-sm">
              {t("dashboard.noActivity")}
            </div>
          ) : (
            <div className="divide-y divide-zinc-800">
              {recentActivity.map((entry) => {
                const { dir, name } = formatDisplayPath(entry.file_path);
                const destination = extractDestination(entry.details);
                const destDisplay = destination ? formatDisplayPath(destination) : null;
                return (
                  <div
                    key={entry.id}
                    className="px-5 py-3 flex items-center justify-between"
                  >
                    <div className="min-w-0 flex-1 mr-3">
                      <button
                        onClick={() => handleOpenFolder(entry.file_path)}
                        className="text-left underline decoration-zinc-600 underline-offset-2 hover:decoration-zinc-400 transition-colors cursor-pointer text-sm break-words max-w-full"
                        title={entry.file_path}
                      >
                        <span className="text-zinc-500">{dir}\</span>
                        <span className="font-medium text-zinc-200">{name}</span>
                      </button>
                      {destDisplay && (
                        <button
                          onClick={() => handleOpenFolder(destination!)}
                          className="text-left text-xs text-blue-400/70 hover:text-blue-300 underline decoration-zinc-700 underline-offset-2 hover:decoration-blue-400/50 transition-colors cursor-pointer break-words max-w-full mt-0.5 block"
                          title={destination!}
                        >
                          → <span className="text-zinc-500">{destDisplay.dir}\</span>
                          <span>{destDisplay.name}</span>
                        </button>
                      )}
                      <p className="text-xs text-zinc-500 mt-0.5">
                        {entry.action} — {entry.rule_name ?? t("dashboard.manual")}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <span
                        className={`text-xs px-2 py-1 rounded-full ${
                          entry.result === "success"
                            ? "bg-green-900/50 text-green-400"
                            : "bg-red-900/50 text-red-400"
                        }`}
                      >
                        {entry.result}
                      </span>
                      <p className="text-xs text-zinc-500 mt-1">
                        {entry.timestamp}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
