import { useEffect, useState, useCallback } from "react";
import {
  Database,
  Search,
  ChevronLeft,
  ChevronRight,
  Trash2,
  RefreshCw,
  HardDrive,
} from "lucide-react";
import * as api from "../api";
import type { DbStats, TableQueryResult } from "../types";
import { formatBytes } from "../utils/format";

const TABLES = ["activity_log", "file_index", "undo_history", "rule_metadata"];
const PAGE_SIZE = 25;

function friendlyTableName(name: string): string {
  return name
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export default function DataExplorer() {
  const [stats, setStats] = useState<DbStats | null>(null);
  const [selectedTable, setSelectedTable] = useState(TABLES[0]);
  const [data, setData] = useState<TableQueryResult | null>(null);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [dbPath, setDbPath] = useState("");

  const loadStats = useCallback(async () => {
    try {
      setStats(await api.getDbStats());
    } catch (e) {
      console.error("Failed to load stats:", e);
    }
  }, []);

  const loadTable = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.queryDbTable(
        selectedTable,
        PAGE_SIZE,
        page * PAGE_SIZE,
        search || undefined
      );
      setData(result);
    } catch (e) {
      console.error("Failed to query table:", e);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [selectedTable, page, search]);

  useEffect(() => {
    loadStats();
    api.getDbPath().then(setDbPath);
  }, [loadStats]);

  useEffect(() => {
    setPage(0);
  }, [selectedTable, search]);

  useEffect(() => {
    loadTable();
  }, [loadTable]);

  const handleSearch = () => {
    setSearch(searchInput);
  };

  const handleClear = async () => {
    if (!confirm(`Clear all rows from "${friendlyTableName(selectedTable)}"? This cannot be undone.`)) {
      return;
    }
    setClearing(true);
    try {
      await api.clearDbTable(selectedTable);
      await loadTable();
      await loadStats();
    } catch (e) {
      console.error("Failed to clear table:", e);
    } finally {
      setClearing(false);
    }
  };

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;
  const tableRowCount = (name: string) =>
    stats?.tables.find((t) => t.table_name === name)?.row_count ?? 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Database size={24} />
          Data Explorer
        </h2>
        <button
          onClick={async () => {
            await loadStats();
            await loadTable();
          }}
          className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* Storage overview */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 px-4 py-3">
            <p className="text-xs text-zinc-500 mb-1">Database Size</p>
            <p className="text-lg font-semibold">{formatBytes(stats.db_size_bytes)}</p>
          </div>
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 px-4 py-3">
            <p className="text-xs text-zinc-500 mb-1">Trash Staging</p>
            <p className="text-lg font-semibold">{formatBytes(stats.trash_size_bytes)}</p>
          </div>
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 px-4 py-3">
            <p className="text-xs text-zinc-500 mb-1">Total Records</p>
            <p className="text-lg font-semibold">
              {stats.tables.reduce((s, t) => s + t.row_count, 0).toLocaleString()}
            </p>
          </div>
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 px-4 py-3">
            <p className="text-xs text-zinc-500 mb-1">Location</p>
            <p
              className="text-xs font-mono text-blue-400 hover:text-blue-300 cursor-pointer truncate mt-1"
              title={dbPath}
              onClick={() => {
                const dir = dbPath.replace(/[/\\][^/\\]+$/, "");
                api.openInExplorer(dir).catch(() => {});
              }}
            >
              {dbPath.split(/[/\\]/).pop() || "data.db"}
            </p>
            <p className="text-[10px] text-zinc-600 truncate" title={dbPath}>
              {dbPath}
            </p>
          </div>
        </div>
      )}

      {/* Table selector tabs */}
      <div className="flex gap-1 border-b border-zinc-800 pb-px">
        {TABLES.map((table) => (
          <button
            key={table}
            onClick={() => setSelectedTable(table)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
              selectedTable === table
                ? "border-blue-500 text-blue-400 bg-zinc-900"
                : "border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/50"
            }`}
          >
            {friendlyTableName(table)}
            <span className="ml-1.5 text-xs text-zinc-600">
              ({tableRowCount(table).toLocaleString()})
            </span>
          </button>
        ))}
      </div>

      {/* Search & Actions bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
          />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search all columns…"
            className="w-full pl-9 pr-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-sm focus:outline-none focus:border-blue-500 placeholder-zinc-600"
          />
        </div>
        <button
          onClick={handleSearch}
          className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-sm transition-colors"
        >
          Search
        </button>
        {search && (
          <button
            onClick={() => {
              setSearchInput("");
              setSearch("");
            }}
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            Clear filter
          </button>
        )}
        <button
          onClick={handleClear}
          disabled={clearing || (data?.total ?? 0) === 0}
          className="flex items-center gap-1.5 px-3 py-2 bg-red-900/30 hover:bg-red-900/50 border border-red-800/50 text-red-400 disabled:opacity-30 rounded-lg text-sm transition-colors"
        >
          <Trash2 size={14} />
          Clear Table
        </button>
      </div>

      {/* Data table */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
        {loading ? (
          <div className="px-5 py-12 text-center text-zinc-500 text-sm">
            Loading…
          </div>
        ) : !data || data.rows.length === 0 ? (
          <div className="px-5 py-12 text-center text-zinc-500 text-sm">
            {search
              ? "No rows match your search."
              : "This table is empty."}
          </div>
        ) : (
          <div className="overflow-auto max-h-[60vh]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-zinc-800 text-zinc-400 text-xs uppercase">
                  <th className="px-3 py-2 text-left font-medium w-8">#</th>
                  {data.columns.map((col) => (
                    <th
                      key={col}
                      className="px-3 py-2 text-left font-medium whitespace-nowrap"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {data.rows.map((row, idx) => (
                  <tr
                    key={idx}
                    className="hover:bg-zinc-800/40 transition-colors"
                  >
                    <td className="px-3 py-2 text-zinc-600 text-xs">
                      {page * PAGE_SIZE + idx + 1}
                    </td>
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className="px-3 py-2 text-zinc-300 max-w-[300px] truncate font-mono text-xs"
                        title={cell}
                      >
                        {cell === "NULL" ? (
                          <span className="text-zinc-600 italic">null</span>
                        ) : (
                          cell
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {data && data.total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-800 text-xs text-zinc-500">
            <span>
              {data.total.toLocaleString()} row{data.total !== 1 && "s"}
              {search && " (filtered)"}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="p-1 hover:text-zinc-300 disabled:opacity-30 transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
              <span>
                Page {page + 1} of {totalPages || 1}
              </span>
              <button
                onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                disabled={page >= totalPages - 1}
                className="p-1 hover:text-zinc-300 disabled:opacity-30 transition-colors"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Storage info */}
      <div className="flex items-center gap-2 text-xs text-zinc-600">
        <HardDrive size={12} />
        <span>
          Data is pruned automatically based on your retention &amp; max storage settings in{" "}
          <span
            className="text-blue-400 hover:text-blue-300 cursor-pointer"
            onClick={() => window.location.hash = "#/settings"}
          >
            Settings
          </span>.
        </span>
      </div>
    </div>
  );
}
