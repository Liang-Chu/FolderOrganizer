// Mirrors Rust types from config.rs and db.rs

export interface AppConfig {
  folders: WatchedFolder[];
  settings: AppSettings;
}

export interface AppSettings {
  scan_interval_minutes: number;
  start_with_os: boolean;
  minimize_to_tray: boolean;
  notifications_enabled: boolean;
  log_retention_days: number;
  /** Maximum database size in MB (0 = unlimited) */
  max_storage_mb: number;
  /** Default root directory for sorted files (Move destinations resolve relative to this) */
  default_sort_root: string;
}

export interface WatchedFolder {
  id: string;
  path: string;
  enabled: boolean;
  rules: Rule[];
  /** Glob patterns for files that should never be processed in this folder */
  whitelist: string[];
}

// ── Composable Rule System ──────────────────────────────────

export interface Rule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  condition: Condition;
  /** Human-readable text form: `*.pdf AND *invoice*` */
  condition_text: string;
  action: Action;
  /** Glob patterns for files this rule should skip. Move destination is auto-whitelisted. */
  whitelist: string[];
}

/**
 * Condition tree — composable file matchers.
 * Tagged union using `type` discriminant (matches Rust serde).
 *
 * Wildcard syntax examples:
 *   *.pdf                  — glob
 *   *.jpg OR *.png         — or
 *   *.pdf AND *invoice*    — and
 *   NOT *.tmp              — not
 *   /^IMG_\d+/             — regex
 *   (*.pdf OR *.docx) AND *report*  — grouped
 */
export type Condition =
  | { type: "Glob"; pattern: string }
  | { type: "Regex"; pattern: string }
  | { type: "And"; conditions: Condition[] }
  | { type: "Or"; conditions: Condition[] }
  | { type: "Not"; condition: Condition }
  | { type: "Always" };

/**
 * What to do when the condition matches.
 * Tagged union using `type` discriminant.
 */
export type Action =
  | { type: "Move"; destination: string }
  | { type: "Delete"; after_days: number };

export interface ActivityLogEntry {
  id: string;
  file_path: string;
  file_name: string;
  action: string;
  rule_name: string | null;
  folder_id: string | null;
  timestamp: string;
  result: string;
  details: string | null;
}

export interface FileIndexEntry {
  id: string;
  file_path: string;
  folder_id: string;
  file_name: string;
  extension: string | null;
  size_bytes: number | null;
  first_seen: string;
  last_modified: string | null;
  pending_action: string | null;
  scheduled_at: string | null;
}

export interface UndoEntry {
  id: string;
  original_path: string;
  current_path: string | null;
  action: string;
  timestamp: string;
  expires_at: string;
  restored: boolean;
}

export interface RuleMetadata {
  rule_id: string;
  folder_id: string;
  created_at: string;
  last_triggered_at: string | null;
}

export interface TableStats {
  table_name: string;
  row_count: number;
}

export interface TableQueryResult {
  columns: string[];
  rows: string[][];
  total: number;
}

export interface DbStats {
  db_size_bytes: number;
  trash_size_bytes: number;
  tables: TableStats[];
}
