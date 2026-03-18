import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, Undo2, ChevronRight } from "lucide-react";
import * as api from "../api";
import type { ActivityLogEntry, UndoEntry } from "../types";

type GroupedActivity = {
  entry: ActivityLogEntry;
  retries: ActivityLogEntry[];
};

/** Group consecutive error entries for the same file_path into collapsible retry groups.
 *  Entries arrive in DESC timestamp order. A sequence of same-file errors (possibly
 *  ending with a success) is collapsed into one row with expandable retries. */
function groupRetries(entries: ActivityLogEntry[]): GroupedActivity[] {
  const result: GroupedActivity[] = [];
  let i = 0;
  while (i < entries.length) {
    const current = entries[i];
    const retries: ActivityLogEntry[] = [];
    let j = i + 1;
    while (
      j < entries.length &&
      entries[j].file_path === current.file_path &&
      entries[j].result === "error"
    ) {
      retries.push(entries[j]);
      j++;
    }
    result.push({ entry: current, retries });
    i = j;
  }
  return result;
}

export default function ActivityPage() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [undoEntries, setUndoEntries] = useState<UndoEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const PAGE_SIZE = 30;

  const loadData = async () => {
    setLoading(true);
    try {
      const [log, undos] = await Promise.all([
        api.getActivityLog(PAGE_SIZE, page * PAGE_SIZE),
        api.getUndoEntries(),
      ]);
      setEntries(log);
      setUndoEntries(undos);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [page]);

  const handleUndo = async (id: string) => {
    try {
      await api.undoAction(id);
      loadData();
    } catch (e) {
      console.error("Undo failed:", e);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{t("activity.title")}</h2>
        <button
          onClick={loadData}
          className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm font-medium transition-colors"
        >
          <RefreshCw size={16} />
          {t("activity.refresh")}
        </button>
      </div>

      {/* Undo section */}
      {undoEntries.length > 0 && (
        <div className="bg-amber-950/30 border border-amber-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-amber-400 mb-3">
            {t("activity.recoverable")}
          </h3>
          <div className="space-y-2">
            {undoEntries.slice(0, 5).map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-zinc-300 truncate flex-1">
                  {entry.original_path}
                </span>
                <div className="flex items-center gap-3 ml-3">
                  <span className="text-xs text-zinc-500">
                    {t("activity.expires", { date: entry.expires_at })}
                  </span>
                  <button
                    onClick={() => handleUndo(entry.id)}
                    className="flex items-center gap-1 px-3 py-1 bg-amber-700 hover:bg-amber-600 rounded-lg text-xs font-medium"
                  >
                    <Undo2 size={14} />
                    {t("activity.undo")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Activity table */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-400">
              <th className="text-left px-5 py-3 font-medium">{t("activity.headerFile")}</th>
              <th className="text-left px-5 py-3 font-medium">{t("activity.headerAction")}</th>
              <th className="text-left px-5 py-3 font-medium">{t("activity.headerRule")}</th>
              <th className="text-left px-5 py-3 font-medium">{t("activity.headerResult")}</th>
              <th className="text-left px-5 py-3 font-medium">{t("activity.headerDetails", "Details")}</th>
              <th className="text-left px-5 py-3 font-medium">{t("activity.headerTime")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-zinc-500">
                  {t("common.loading")}
                </td>
              </tr>
            ) : entries.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-zinc-500">
                  {t("activity.noActivity")}
                </td>
              </tr>
            ) : (
              groupRetries(entries).map((group) => {
                const { entry } = group;
                const hasRetries = group.retries.length > 0;
                const isExpanded = expandedGroups.has(entry.id);
                const toggleExpand = () =>
                  setExpandedGroups((prev) => {
                    const next = new Set(prev);
                    if (next.has(entry.id)) next.delete(entry.id);
                    else next.add(entry.id);
                    return next;
                  });
                return (
                  <>
                    <tr key={entry.id} className="hover:bg-zinc-800/50">
                      <td className="px-5 py-3 max-w-[200px] truncate">
                        {entry.file_name}
                      </td>
                      <td className="px-5 py-3">{entry.action}</td>
                      <td className="px-5 py-3 text-zinc-400">
                        {entry.rule_name ?? "—"}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`text-xs px-2 py-1 rounded-full ${
                            entry.result === "success"
                              ? "bg-green-900/50 text-green-400"
                              : "bg-red-900/50 text-red-400"
                          }`}
                        >
                          {entry.result}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-zinc-400 max-w-[250px]">
                        <div className="truncate" title={entry.details ?? undefined}>
                          {entry.result !== "success" ? (entry.details ?? "—") : (entry.details ?? "")}
                        </div>
                        {hasRetries && (
                          <button
                            onClick={toggleExpand}
                            className="inline-flex items-center gap-1 mt-1 text-xs text-amber-400/80 hover:text-amber-300 transition-colors"
                          >
                            <ChevronRight
                              size={12}
                              className={`transition-transform ${isExpanded ? "rotate-90" : ""}`}
                            />
                            {t("activity.retryCount", { count: group.retries.length })}
                          </button>
                        )}
                      </td>
                      <td className="px-5 py-3 text-zinc-500">{entry.timestamp}</td>
                    </tr>
                    {hasRetries && isExpanded &&
                      group.retries.map((retry) => (
                        <tr key={retry.id} className="bg-zinc-800/30">
                          <td className="pl-9 pr-5 py-2 max-w-[200px] truncate text-zinc-500 text-xs">
                            ↳ {retry.file_name}
                          </td>
                          <td className="px-5 py-2 text-xs text-zinc-500">{retry.action}</td>
                          <td className="px-5 py-2 text-xs text-zinc-500">
                            {retry.rule_name ?? "—"}
                          </td>
                          <td className="px-5 py-2">
                            <span className="text-xs px-2 py-0.5 rounded-full bg-red-900/30 text-red-400/70">
                              {retry.result}
                            </span>
                          </td>
                          <td className="px-5 py-2 text-xs text-zinc-500 max-w-[250px] truncate" title={retry.details ?? undefined}>
                            {retry.details ?? "—"}
                          </td>
                          <td className="px-5 py-2 text-xs text-zinc-600">{retry.timestamp}</td>
                        </tr>
                      ))
                    }
                  </>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex justify-center gap-3">
        <button
          onClick={() => setPage(Math.max(0, page - 1))}
          disabled={page === 0}
          className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 rounded-lg text-sm"
        >
          {t("activity.previous")}
        </button>
        <span className="px-4 py-2 text-sm text-zinc-500">{t("activity.page", { page: page + 1 })}</span>
        <button
          onClick={() => setPage(page + 1)}
          disabled={entries.length < PAGE_SIZE}
          className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 rounded-lg text-sm"
        >
          {t("activity.next")}
        </button>
      </div>
    </div>
  );
}
