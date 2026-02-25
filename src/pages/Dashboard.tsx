import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FolderOpen,
  Activity,
  Play,
  Pause,
  RefreshCw,
  Trash2,
  Clock,
  HelpCircle,
  ArrowUpDown,
} from "lucide-react";
import * as api from "../api";
import type { AppConfig, ActivityLogEntry, ScheduledDeletion } from "../types";
import { formatBytes } from "../utils/format";

/** Split a full file path into directory + file name */
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

export default function Dashboard() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [recentActivity, setRecentActivity] = useState<ActivityLogEntry[]>([]);
  const [scheduledDeletions, setScheduledDeletions] = useState<ScheduledDeletion[]>([]);
  const [watcherRunning, setWatcherRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showAllDeletions, setShowAllDeletions] = useState(false);
  const [deletionResult, setDeletionResult] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<"file" | "rule" | "date">("date");
  const [sortAsc, setSortAsc] = useState(true);

  const loadData = async () => {
    try {
      const [cfg, log, status, deletions] = await Promise.all([
        api.getConfig(),
        api.getActivityLog(10),
        api.getWatcherStatus(),
        api.getScheduledDeletions(),
      ]);
      setConfig(cfg);
      setRecentActivity(log);
      setWatcherRunning(status);
      setScheduledDeletions(deletions);
    } catch (e) {
      console.error("Failed to load dashboard data:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const toggleWatcher = async () => {
    if (watcherRunning) {
      await api.stopWatcher();
    } else {
      await api.restartWatcher();
    }
    setWatcherRunning(!watcherRunning);
  };

  const handleScan = async () => {
    await api.scanNow();
    loadData();
  };

  const handleRunDeletions = async () => {
    const count = await api.runDeletions();
    setDeletionResult(t("dashboard.deletionsRan", { count }));
    setTimeout(() => setDeletionResult(null), 3000);
    loadData();
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

  const visibleDeletions = showAllDeletions
    ? sortedDeletions
    : sortedDeletions.slice(0, 8);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{t("dashboard.title")}</h2>
        <div className="flex gap-2">
          <button
            onClick={handleScan}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm font-medium transition-colors"
          >
            <RefreshCw size={16} />
            {t("dashboard.scanNow")}
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
                  {t("dashboard.scheduledDeletions")}
                </h3>
                <span className="text-xs text-amber-400/60 ml-1">
                  {t("dashboard.scheduledDeletionsCount", { count: scheduledDeletions.length })}
                </span>
              </div>
              <div className="flex gap-2 items-center">
                {deletionResult && (
                  <span className="text-xs text-green-400">{deletionResult}</span>
                )}
                <span
                  className="text-amber-400/50 cursor-help"
                  title={t("dashboard.runDeletionsHint")}
                >
                  <HelpCircle size={14} />
                </span>
                <button
                  onClick={handleRunDeletions}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-700 hover:bg-amber-600 rounded-lg text-xs font-medium transition-colors"
                >
                  <Trash2 size={14} />
                  {t("dashboard.runDeletionsNow")}
                </button>
              </div>
            </div>
            <table className="w-full text-sm table-fixed">
              <colgroup>
                <col className="w-[55%]" />
                <col className="w-[25%]" />
                <col className="w-[20%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-400">
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
                {visibleDeletions.map((entry) => {
                  const { dir, name } = formatDisplayPath(entry.file_path);
                  const dateOnly = entry.delete_after.split(" ")[0];
                  return (
                    <tr key={entry.id} className="hover:bg-zinc-800/50">
                      <td className="px-5 py-3 overflow-hidden">
                        <button
                          onClick={() => handleOpenFolder(entry.file_path)}
                          className="text-left underline decoration-zinc-600 underline-offset-2 hover:decoration-amber-400 transition-colors cursor-pointer break-words max-w-full"
                          title={entry.file_path}
                        >
                          <span className="text-zinc-500">{dir}\</span>
                          <span className="font-semibold text-amber-300">{name}</span>
                        </button>
                        {entry.size_bytes != null && (
                          <span className="text-xs text-zinc-600">
                            {formatBytes(entry.size_bytes)}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-zinc-400 truncate" title={entry.rule_name}>{entry.rule_name}</td>
                      <td className="px-5 py-3 text-amber-400/80 whitespace-nowrap">{dateOnly}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {scheduledDeletions.length > 8 && (
              <div className="px-5 py-2 border-t border-zinc-800/50">
                <button
                  onClick={() => setShowAllDeletions(!showAllDeletions)}
                  className="text-xs text-amber-400/70 hover:text-amber-300 transition-colors"
                >
                  {showAllDeletions
                    ? t("dashboard.showLess")
                    : t("dashboard.viewAll") + ` (${scheduledDeletions.length})`}
                </button>
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
