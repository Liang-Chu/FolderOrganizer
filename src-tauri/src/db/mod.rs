use rusqlite::{Connection, Result};
use std::sync::Mutex;

use crate::config::app_data_dir;

pub struct Database {
    pub conn: Mutex<Connection>,
}

impl Database {
    pub fn new() -> Result<Self> {
        let db_path = app_data_dir().join("data.db");
        let conn = Connection::open(db_path)?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.init_tables()?;
        Ok(db)
    }

    fn init_tables(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS activity_log (
                id          TEXT PRIMARY KEY,
                file_path   TEXT NOT NULL,
                file_name   TEXT NOT NULL,
                action      TEXT NOT NULL,
                rule_name   TEXT,
                folder_id   TEXT,
                timestamp   TEXT NOT NULL,
                result      TEXT NOT NULL,
                details     TEXT
            );

            CREATE TABLE IF NOT EXISTS file_index (
                id              TEXT PRIMARY KEY,
                file_path       TEXT NOT NULL UNIQUE,
                folder_id       TEXT NOT NULL,
                file_name       TEXT NOT NULL,
                extension       TEXT,
                size_bytes      INTEGER,
                first_seen      TEXT NOT NULL,
                last_modified   TEXT,
                pending_action  TEXT,
                scheduled_at    TEXT
            );

            CREATE TABLE IF NOT EXISTS undo_history (
                id              TEXT PRIMARY KEY,
                original_path   TEXT NOT NULL,
                current_path    TEXT,
                action          TEXT NOT NULL,
                timestamp       TEXT NOT NULL,
                expires_at      TEXT NOT NULL,
                restored        INTEGER NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity_log(timestamp);
            CREATE INDEX IF NOT EXISTS idx_activity_folder ON activity_log(folder_id);
            CREATE INDEX IF NOT EXISTS idx_file_index_folder ON file_index(folder_id);
            CREATE INDEX IF NOT EXISTS idx_file_index_pending ON file_index(pending_action);
            CREATE INDEX IF NOT EXISTS idx_undo_expires ON undo_history(expires_at);

            CREATE TABLE IF NOT EXISTS rule_metadata (
                rule_id         TEXT NOT NULL,
                folder_id       TEXT NOT NULL,
                created_at      TEXT NOT NULL,
                last_triggered_at TEXT,
                PRIMARY KEY (rule_id, folder_id)
            );

            CREATE TABLE IF NOT EXISTS scheduled_deletions (
                id              TEXT PRIMARY KEY,
                file_path       TEXT NOT NULL UNIQUE,
                folder_id       TEXT NOT NULL,
                rule_name       TEXT NOT NULL,
                file_name       TEXT NOT NULL,
                extension       TEXT,
                size_bytes      INTEGER,
                scheduled_at    TEXT NOT NULL,
                delete_after    TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_sched_del_after ON scheduled_deletions(delete_after);
            CREATE INDEX IF NOT EXISTS idx_sched_del_folder ON scheduled_deletions(folder_id);
            ",
        )?;
        Ok(())
    }
}

// ── Sub-modules ─────────────────────────────────────────────

mod activity;
mod file_index;
mod metadata;
mod models;
mod scheduled_deletions;
mod storage;
mod undo;

// ── Re-exports ──────────────────────────────────────────────

pub use models::{
    ActivityLogEntry, DbStats, FileIndexEntry, RuleMetadata, ScheduledDeletion, TableQueryResult,
    UndoEntry,
};
