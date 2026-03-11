import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import {
  Database,
  Search,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  HardDrive,
  ArrowUp,
  ArrowDown,
  Filter,
  X,
} from "lucide-react";
import * as api from "../api";
import type { DbStats, TableQueryResult } from "../types";
import { formatBytes } from "../utils/format";

const TABLES = ["activity_log", "file_index", "scheduled_deletions"];
const TABLE_LABELS: Record<string, string> = {
  activity_log: "Activity Log",
  file_index: "Pending Actions",
  scheduled_deletions: "Scheduled Deletions",
};
const PAGE_SIZE = 25;

const HIDDEN_COLUMNS = new Set(["folder_id"]);

function getColumnWidthClass(column: string): string {
  switch (column) {
    case "action":
    case "action_type":
      return "w-[145px]";
    case "timestamp":
    case "scheduled_at":
    case "delete_after":
    case "created_at":
    case "updated_at":
      return "w-[120px]";
    case "rule_name":
      return "w-[130px]";
    case "result":
    case "status":
      return "w-[95px]";
    case "file_path":
      return "w-[420px]";
    case "details":
      return "w-[360px]";
    default:
      return "w-[160px]";
  }
}

/* ── Multi-select filter dropdown ───────────────────────────── */
function ColumnFilterDropdown({
  column,
  table,
  selected,
  onChangeSelected,
}: {
  column: string;
  table: string;
  selected: string[];
  onChangeSelected: (vals: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<string[]>([]);
  const [filterText, setFilterText] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Load distinct values when opened
  useEffect(() => {
    if (!open) return;
    api.getColumnValues(table, column).then(setOptions).catch(() => setOptions([]));
  }, [open, table, column]);

  const filtered = filterText
    ? options.filter((o) => o.toLowerCase().includes(filterText.toLowerCase()))
    : options;

  const toggle = (val: string) => {
    if (selected.includes(val)) {
      onChangeSelected(selected.filter((v) => v !== val));
    } else {
      onChangeSelected([...selected, val]);
    }
  };

  const active = selected.length > 0;

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className={`ml-1 p-0.5 rounded hover:bg-zinc-600 transition-colors ${active ? "text-blue-400" : "text-zinc-500"}`}
        title={`Filter ${column}`}
      >
        <Filter size={10} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-56 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50 overflow-hidden" onClick={(e) => e.stopPropagation()}>
          {/* Search within options */}
          <div className="p-2 border-b border-zinc-700">
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Search..."
              className="w-full px-2 py-1 bg-zinc-900 border border-zinc-600 rounded text-xs focus:outline-none focus:border-blue-500"
              autoFocus
            />
          </div>
          {/* Options list */}
          <div className="max-h-48 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className="text-xs text-zinc-500 p-2 text-center">No values</p>
            ) : (
              filtered.map((val) => (
                <label
                  key={val}
                  className="flex items-center gap-2 px-2 py-1 hover:bg-zinc-700 rounded cursor-pointer text-xs"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(val)}
                    onChange={() => toggle(val)}
                    className="accent-blue-500 rounded"
                  />
                  <span className="truncate text-zinc-300" title={val}>
                    {val === "NULL" ? <span className="italic text-zinc-500">null</span> : val}
                  </span>
                </label>
              ))
            )}
          </div>
          {/* Footer actions */}
          {selected.length > 0 && (
            <div className="border-t border-zinc-700 p-2">
              <button
                onClick={() => onChangeSelected([])}
                className="text-xs text-zinc-400 hover:text-zinc-200"
              >
                Clear filter ({selected.length} selected)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function DataExplorer() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [stats, setStats] = useState<DbStats | null>(null);
  const [selectedTable, setSelectedTable] = useState(TABLES[0]);
  const [data, setData] = useState<TableQueryResult | null>(null);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [dbPath, setDbPath] = useState("");
  const [sortColumn, setSortColumn] = useState<string | undefined>();
  const [sortAsc, setSortAsc] = useState(false);
  const [filters, setFilters] = useState<Record<string, string[]>>({});

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
      // Only pass non-empty filters
      const activeFilters = Object.fromEntries(
        Object.entries(filters).filter(([, v]) => v.length > 0)
      );
      const result = await api.queryDbTable(
        selectedTable,
        PAGE_SIZE,
        page * PAGE_SIZE,
        search || undefined,
        sortColumn,
        sortAsc,
        Object.keys(activeFilters).length > 0 ? activeFilters : undefined
      );
      setData(result);
    } catch (e) {
      console.error("Failed to query table:", e);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [selectedTable, page, search, sortColumn, sortAsc, filters]);

  useEffect(() => {
    loadStats();
    api.getDbPath().then(setDbPath);
  }, [loadStats]);

  useEffect(() => {
    setPage(0);
    setSortColumn(undefined);
    setSortAsc(false);
    setFilters({});
  }, [selectedTable, search]);

  useEffect(() => {
    loadTable();
  }, [loadTable]);

  const handleSearch = () => {
    setSearch(searchInput);
  };

  const handleSort = (col: string) => {
    if (sortColumn === col) {
      setSortAsc(!sortAsc);
    } else {
      setSortColumn(col);
      setSortAsc(true);
    }
    setPage(0);
  };

  const setColumnFilter = (col: string, vals: string[]) => {
    setFilters((prev) => {
      const next = { ...prev };
      if (vals.length === 0) {
        delete next[col];
      } else {
        next[col] = vals;
      }
      return next;
    });
    setPage(0);
  };

  const activeFilterCount = Object.values(filters).filter((v) => v.length > 0).length;

  const clearAllFilters = () => {
    setFilters({});
    setSortColumn(undefined);
    setSortAsc(false);
    setPage(0);
  };

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;
  const tableRowCount = (name: string) =>
    stats?.tables.find((t) => t.table_name === name)?.row_count ?? 0;

  const visibleColumnEntries = (data?.columns ?? [])
    .map((col, idx) => ({ col, idx }))
    .filter(({ col }) => !HIDDEN_COLUMNS.has(col));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Database size={24} />
          {t("data.title")}
        </h2>
        <button
          onClick={async () => {
            await loadStats();
            await loadTable();
          }}
          className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <RefreshCw size={14} />
          {t("data.refresh")}
        </button>
      </div>

      {/* Storage overview */}
      {stats && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 px-4 py-3">
            <p className="text-xs text-zinc-500 mb-1">{t("data.dbSize")}</p>
            <p className="text-lg font-semibold">{formatBytes(stats.db_size_bytes)}</p>
          </div>
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 px-4 py-3">
            <p className="text-xs text-zinc-500 mb-1">{t("data.totalRecords")}</p>
            <p className="text-lg font-semibold">
              {stats.tables.reduce((s, t) => s + t.row_count, 0).toLocaleString()}
            </p>
          </div>
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 px-4 py-3">
            <p className="text-xs text-zinc-500 mb-1">{t("data.location")}</p>
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
            {TABLE_LABELS[table] || table}
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
            placeholder={t("data.searchPlaceholder")}
            className="w-full pl-9 pr-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-sm focus:outline-none focus:border-blue-500 placeholder-zinc-600"
          />
        </div>
        <button
          onClick={handleSearch}
          className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-sm transition-colors"
        >
          {t("data.search")}
        </button>
        {(search || activeFilterCount > 0 || sortColumn) && (
          <button
            onClick={() => {
              setSearchInput("");
              setSearch("");
              clearAllFilters();
            }}
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300"
          >
            <X size={12} />
            Clear all
            {activeFilterCount > 0 && (
              <span className="ml-1 px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded-full text-[10px]">
                {activeFilterCount} filter{activeFilterCount > 1 ? "s" : ""}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Data table */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
        {loading ? (
          <div className="px-5 py-12 text-center text-zinc-500 text-sm">
            {t("data.loading")}
          </div>
        ) : !data || data.rows.length === 0 ? (
          <div className="px-5 py-12 text-center text-zinc-500 text-sm">
            {search
              ? t("data.noMatchSearch")
              : t("data.tableEmpty")}
          </div>
        ) : (
          <div className="overflow-auto max-h-[60vh]">
            <table className="w-full text-sm table-fixed">
              <thead className="sticky top-0 z-10">
                <tr className="bg-zinc-800 text-zinc-400 text-xs uppercase">
                  <th className="px-3 py-2 text-left font-medium w-8">#</th>
                  {visibleColumnEntries.map(({ col }) => (
                    <th
                      key={col}
                      className={`px-3 py-2 text-left font-medium whitespace-nowrap ${getColumnWidthClass(col)}`}
                    >
                      <div className="flex items-center gap-0.5">
                        <span
                          className="cursor-pointer hover:text-zinc-200 select-none flex items-center gap-1"
                          onClick={() => handleSort(col)}
                        >
                          {col}
                          {sortColumn === col && (
                            sortAsc
                              ? <ArrowUp size={10} className="text-blue-400" />
                              : <ArrowDown size={10} className="text-blue-400" />
                          )}
                        </span>
                        <ColumnFilterDropdown
                          column={col}
                          table={selectedTable}
                          selected={filters[col] || []}
                          onChangeSelected={(vals) => setColumnFilter(col, vals)}
                        />
                      </div>
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
                    {visibleColumnEntries.map(({ col, idx: ci }) => {
                      const cell = row[ci];
                      return (
                      <td
                        key={`${idx}-${col}`}
                        className={`px-3 py-2 text-zinc-300 font-mono text-xs whitespace-pre-wrap break-words align-top ${getColumnWidthClass(col)}`}
                        title={cell}
                      >
                        {cell === "NULL" ? (
                          <span className="text-zinc-600 italic">null</span>
                        ) : (
                          cell
                        )}
                      </td>
                    );
                    })}
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
              {t("data.rowCount", { count: data.total })}
              {(search || activeFilterCount > 0) && ` ${t("data.filtered")}`}
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
                {t("data.pageOf", { current: page + 1, total: totalPages || 1 })}
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
          {t("data.storageNote")}{" "}
          <span
            className="text-blue-400 hover:text-blue-300 cursor-pointer underline underline-offset-2"
            onClick={() => navigate("/settings?highlight=log-retention")}
          >
            {t("data.settingsLink")}
          </span>.
        </span>
      </div>
    </div>
  );
}
