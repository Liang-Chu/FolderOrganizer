import { invoke } from "@tauri-apps/api/core";
import type {
  AppConfig,
  WatchedFolder,
  Rule,
  Condition,
  ActivityLogEntry,
  FileIndexEntry,
  UndoEntry,
  RuleMetadata,
  DbStats,
  TableQueryResult,
} from "./types";

// ── Config ──────────────────────────────────────────────────

export const getConfig = () => invoke<AppConfig>("get_config");

export const saveConfig = (newConfig: AppConfig) =>
  invoke<void>("save_config_cmd", { newConfig });

// ── Folders ─────────────────────────────────────────────────

export const getWatchedFolders = () =>
  invoke<WatchedFolder[]>("get_watched_folders");

export const addWatchedFolder = (path: string) =>
  invoke<WatchedFolder>("add_watched_folder", { path });

export const removeWatchedFolder = (folderId: string) =>
  invoke<void>("remove_watched_folder", { folderId });

export const toggleWatchedFolder = (folderId: string, enabled: boolean) =>
  invoke<void>("toggle_watched_folder", { folderId, enabled });

// ── Rules ───────────────────────────────────────────────────

export const getRules = (folderId: string) =>
  invoke<Rule[]>("get_rules", { folderId });

export const addRule = (folderId: string, rule: Rule) =>
  invoke<void>("add_rule", { folderId, rule });

export const updateRule = (folderId: string, rule: Rule) =>
  invoke<void>("update_rule", { folderId, rule });

export const deleteRule = (folderId: string, ruleId: string) =>
  invoke<void>("delete_rule", { folderId, ruleId });

export const reorderRules = (folderId: string, ruleIds: string[]) =>
  invoke<void>("reorder_rules", { folderId, ruleIds });

// ── Activity & Data ─────────────────────────────────────────

export const getActivityLog = (
  limit?: number,
  offset?: number,
  folderId?: string
) =>
  invoke<ActivityLogEntry[]>("get_activity_log", { limit, offset, folderId });

export const getPendingActions = () =>
  invoke<FileIndexEntry[]>("get_pending_actions");

export const getUndoEntries = () => invoke<UndoEntry[]>("get_undo_entries");

export const undoAction = (undoId: string) =>
  invoke<void>("undo_action", { undoId });

// ── Watcher Control ─────────────────────────────────────────

export const scanNow = () => invoke<void>("scan_now");

export const restartWatcher = () => invoke<void>("restart_watcher");

export const stopWatcher = () => invoke<void>("stop_watcher");

export const getWatcherStatus = () => invoke<boolean>("get_watcher_status");

// ── Condition Helpers ───────────────────────────────────────

/** Parse condition text syntax (e.g. `*.pdf AND *invoice*`) into a Condition tree. */
export const parseConditionText = (text: string) =>
  invoke<Condition>("parse_condition_text", { text });

/** Serialize a Condition tree back to text syntax. */
export const conditionToText = (cond: Condition) =>
  invoke<string>("condition_to_text", { cond });

/** Validate condition text; resolves if valid, rejects with error message. */
export const validateConditionText = (text: string) =>
  invoke<void>("validate_condition_text", { text });

/** Test a condition against a filename (for live preview in the UI). */
export const testCondition = (cond: Condition, fileName: string) =>
  invoke<boolean>("test_condition", { cond, fileName });

/** Ensure a directory exists (creates it and parents if needed). */
export const ensureDir = (path: string) =>
  invoke<void>("ensure_dir", { path });

/** Open a folder in the OS file explorer. */
export const openInExplorer = (path: string) =>
  invoke<void>("open_in_explorer", { path });

// ── Rule Metadata ───────────────────────────────────────────

/** Get metadata (created_at, last_triggered_at) for all rules in a folder. */
export const getRuleMetadata = (folderId: string) =>
  invoke<RuleMetadata[]>("get_rule_metadata", { folderId });

// ── Database Viewer ─────────────────────────────────────────

/** Get DB stats: file size, trash size, per-table row counts. */
export const getDbStats = () => invoke<DbStats>("get_db_stats");

/** Query a specific table with pagination and optional search. */
export const queryDbTable = (
  table: string,
  limit?: number,
  offset?: number,
  search?: string
) =>
  invoke<TableQueryResult>("query_db_table", { table, limit, offset, search });

/** Clear all rows from a specific table. Returns count deleted. */
export const clearDbTable = (table: string) =>
  invoke<number>("clear_db_table", { table });

/** Enforce the storage size limit now. Returns rows pruned. */
export const enforceStorageLimit = () =>
  invoke<number>("enforce_storage_limit");

/** Get the database file path. */
export const getDbPath = () => invoke<string>("get_db_path");
