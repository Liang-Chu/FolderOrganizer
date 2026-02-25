use rusqlite::{params, Connection, Result};
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
            ",
        )?;
        Ok(())
    }

    // ── Activity Log ────────────────────────────────────────

    pub fn insert_activity(
        &self,
        id: &str,
        file_path: &str,
        file_name: &str,
        action: &str,
        rule_name: Option<&str>,
        folder_id: Option<&str>,
        timestamp: &str,
        result: &str,
        details: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO activity_log (id, file_path, file_name, action, rule_name, folder_id, timestamp, result, details)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![id, file_path, file_name, action, rule_name, folder_id, timestamp, result, details],
        )?;
        Ok(())
    }

    pub fn get_activity_log(
        &self,
        limit: u32,
        offset: u32,
        folder_id: Option<&str>,
    ) -> Result<Vec<ActivityLogEntry>> {
        let conn = self.conn.lock().unwrap();
        let mut entries = Vec::new();

        if let Some(fid) = folder_id {
            let mut stmt = conn.prepare(
                "SELECT id, file_path, file_name, action, rule_name, folder_id, timestamp, result, details
                 FROM activity_log WHERE folder_id = ?1 ORDER BY timestamp DESC LIMIT ?2 OFFSET ?3",
            )?;
            let rows = stmt.query_map(params![fid, limit, offset], |row| {
                Ok(ActivityLogEntry {
                    id: row.get(0)?,
                    file_path: row.get(1)?,
                    file_name: row.get(2)?,
                    action: row.get(3)?,
                    rule_name: row.get(4)?,
                    folder_id: row.get(5)?,
                    timestamp: row.get(6)?,
                    result: row.get(7)?,
                    details: row.get(8)?,
                })
            })?;
            for row in rows {
                entries.push(row?);
            }
        } else {
            let mut stmt = conn.prepare(
                "SELECT id, file_path, file_name, action, rule_name, folder_id, timestamp, result, details
                 FROM activity_log ORDER BY timestamp DESC LIMIT ?1 OFFSET ?2",
            )?;
            let rows = stmt.query_map(params![limit, offset], |row| {
                Ok(ActivityLogEntry {
                    id: row.get(0)?,
                    file_path: row.get(1)?,
                    file_name: row.get(2)?,
                    action: row.get(3)?,
                    rule_name: row.get(4)?,
                    folder_id: row.get(5)?,
                    timestamp: row.get(6)?,
                    result: row.get(7)?,
                    details: row.get(8)?,
                })
            })?;
            for row in rows {
                entries.push(row?);
            }
        }

        Ok(entries)
    }

    pub fn prune_old_logs(&self, before: &str) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM activity_log WHERE timestamp < ?1",
            params![before],
        )
    }

    // ── File Index ──────────────────────────────────────────

    pub fn upsert_file(
        &self,
        id: &str,
        file_path: &str,
        folder_id: &str,
        file_name: &str,
        extension: Option<&str>,
        size_bytes: Option<i64>,
        first_seen: &str,
        last_modified: Option<&str>,
        pending_action: Option<&str>,
        scheduled_at: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO file_index (id, file_path, folder_id, file_name, extension, size_bytes, first_seen, last_modified, pending_action, scheduled_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(file_path) DO UPDATE SET
                last_modified = excluded.last_modified,
                size_bytes = excluded.size_bytes,
                pending_action = excluded.pending_action,
                scheduled_at = excluded.scheduled_at",
            params![id, file_path, folder_id, file_name, extension, size_bytes, first_seen, last_modified, pending_action, scheduled_at],
        )?;
        Ok(())
    }

    pub fn get_pending_files(&self) -> Result<Vec<FileIndexEntry>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, file_path, folder_id, file_name, extension, size_bytes, first_seen, last_modified, pending_action, scheduled_at
             FROM file_index WHERE pending_action IS NOT NULL ORDER BY scheduled_at ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(FileIndexEntry {
                id: row.get(0)?,
                file_path: row.get(1)?,
                folder_id: row.get(2)?,
                file_name: row.get(3)?,
                extension: row.get(4)?,
                size_bytes: row.get(5)?,
                first_seen: row.get(6)?,
                last_modified: row.get(7)?,
                pending_action: row.get(8)?,
                scheduled_at: row.get(9)?,
            })
        })?;
        let mut entries = Vec::new();
        for row in rows {
            entries.push(row?);
        }
        Ok(entries)
    }

    pub fn remove_file_by_path(&self, file_path: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM file_index WHERE file_path = ?1",
            params![file_path],
        )?;
        Ok(())
    }

    // ── Undo History ────────────────────────────────────────

    pub fn insert_undo(
        &self,
        id: &str,
        original_path: &str,
        current_path: Option<&str>,
        action: &str,
        timestamp: &str,
        expires_at: &str,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO undo_history (id, original_path, current_path, action, timestamp, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, original_path, current_path, action, timestamp, expires_at],
        )?;
        Ok(())
    }

    pub fn get_undo_entries(&self) -> Result<Vec<UndoEntry>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, original_path, current_path, action, timestamp, expires_at, restored
             FROM undo_history WHERE restored = 0 ORDER BY timestamp DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(UndoEntry {
                id: row.get(0)?,
                original_path: row.get(1)?,
                current_path: row.get(2)?,
                action: row.get(3)?,
                timestamp: row.get(4)?,
                expires_at: row.get(5)?,
                restored: row.get(6)?,
            })
        })?;
        let mut entries = Vec::new();
        for row in rows {
            entries.push(row?);
        }
        Ok(entries)
    }

    pub fn mark_restored(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE undo_history SET restored = 1 WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    }

    pub fn prune_expired_undo(&self, now: &str) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM undo_history WHERE expires_at < ?1 AND restored = 0",
            params![now],
        )
    }

    // ── Rule Metadata ───────────────────────────────────────

    pub fn insert_rule_metadata(
        &self,
        rule_id: &str,
        folder_id: &str,
        created_at: &str,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO rule_metadata (rule_id, folder_id, created_at) VALUES (?1, ?2, ?3)",
            params![rule_id, folder_id, created_at],
        )?;
        Ok(())
    }

    pub fn update_rule_triggered(&self, rule_id: &str, folder_id: &str, triggered_at: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE rule_metadata SET last_triggered_at = ?1 WHERE rule_id = ?2 AND folder_id = ?3",
            params![triggered_at, rule_id, folder_id],
        )?;
        Ok(())
    }

    pub fn get_rule_metadata(&self, folder_id: &str) -> Result<Vec<RuleMetadata>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT rule_id, folder_id, created_at, last_triggered_at FROM rule_metadata WHERE folder_id = ?1",
        )?;
        let rows = stmt.query_map(params![folder_id], |row| {
            Ok(RuleMetadata {
                rule_id: row.get(0)?,
                folder_id: row.get(1)?,
                created_at: row.get(2)?,
                last_triggered_at: row.get(3)?,
            })
        })?;
        let mut entries = Vec::new();
        for row in rows {
            entries.push(row?);
        }
        Ok(entries)
    }

    pub fn delete_rule_metadata(&self, rule_id: &str, folder_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM rule_metadata WHERE rule_id = ?1 AND folder_id = ?2",
            params![rule_id, folder_id],
        )?;
        Ok(())
    }

    // ── Storage Stats & Management ──────────────────────────

    /// Get the on-disk size of the database file in bytes.
    pub fn get_db_file_size(&self) -> u64 {
        let db_path = app_data_dir().join("data.db");
        std::fs::metadata(db_path).map(|m| m.len()).unwrap_or(0)
    }

    /// Get the size of the trash_staging directory in bytes.
    pub fn get_trash_staging_size(&self) -> u64 {
        let staging_dir = app_data_dir().join("trash_staging");
        if !staging_dir.exists() {
            return 0;
        }
        std::fs::read_dir(&staging_dir)
            .map(|entries| {
                entries
                    .flatten()
                    .filter_map(|e| e.metadata().ok())
                    .map(|m| m.len())
                    .sum()
            })
            .unwrap_or(0)
    }

    /// Get row counts for all tables.
    pub fn get_table_stats(&self) -> Result<Vec<TableStats>> {
        let conn = self.conn.lock().unwrap();
        let tables = ["activity_log", "file_index", "undo_history", "rule_metadata"];
        let mut stats = Vec::new();
        for table in &tables {
            let count: i64 = conn.query_row(
                &format!("SELECT COUNT(*) FROM {}", table),
                [],
                |row| row.get(0),
            )?;
            stats.push(TableStats {
                table_name: table.to_string(),
                row_count: count as u64,
            });
        }
        Ok(stats)
    }

    /// Query any table with pagination. Returns column names + rows as string arrays.
    pub fn query_table(
        &self,
        table: &str,
        limit: u32,
        offset: u32,
        search: Option<&str>,
    ) -> Result<TableQueryResult> {
        // Whitelist tables to prevent SQL injection
        let allowed_tables = ["activity_log", "file_index", "undo_history", "rule_metadata"];
        if !allowed_tables.contains(&table) {
            return Err(rusqlite::Error::InvalidParameterName(format!("Table '{}' not allowed", table)));
        }

        let conn = self.conn.lock().unwrap();

        // Get total count (with search filter if applicable)
        let (count_sql, query_sql) = if let Some(term) = search {
            let like = format!("%{}%", term.replace('%', "\\%").replace('_', "\\_"));
            // Search across all text columns — get column names first
            let col_names = self.get_column_names_inner(&conn, table)?;
            let where_clause: String = col_names
                .iter()
                .map(|c| format!("CAST({} AS TEXT) LIKE '{}' ESCAPE '\\'", c, like))
                .collect::<Vec<_>>()
                .join(" OR ");
            (
                format!("SELECT COUNT(*) FROM {} WHERE {}", table, where_clause),
                format!(
                    "SELECT * FROM {} WHERE {} ORDER BY rowid DESC LIMIT {} OFFSET {}",
                    table, where_clause, limit, offset
                ),
            )
        } else {
            (
                format!("SELECT COUNT(*) FROM {}", table),
                format!(
                    "SELECT * FROM {} ORDER BY rowid DESC LIMIT {} OFFSET {}",
                    table, limit, offset
                ),
            )
        };

        let total: i64 = conn.query_row(&count_sql, [], |row| row.get(0))?;

        let mut stmt = conn.prepare(&query_sql)?;
        let col_count = stmt.column_count();
        let columns: Vec<String> = (0..col_count)
            .map(|i| stmt.column_name(i).unwrap_or("?").to_string())
            .collect();

        let rows_iter = stmt.query_map([], |row| {
            let mut values = Vec::with_capacity(col_count);
            for i in 0..col_count {
                let val: String = row
                    .get::<_, Option<String>>(i)
                    .unwrap_or(None)
                    .unwrap_or_else(|| "NULL".to_string());
                values.push(val);
            }
            Ok(values)
        })?;

        let mut rows = Vec::new();
        for row in rows_iter {
            rows.push(row?);
        }

        Ok(TableQueryResult {
            columns,
            rows,
            total: total as u64,
        })
    }

    fn get_column_names_inner(&self, conn: &Connection, table: &str) -> Result<Vec<String>> {
        let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table))?;
        let cols = stmt.query_map([], |row| {
            let name: String = row.get(1)?;
            Ok(name)
        })?;
        let mut names = Vec::new();
        for col in cols {
            names.push(col?);
        }
        Ok(names)
    }

    /// Clear all rows from a specific table.
    pub fn clear_table(&self, table: &str) -> Result<u64> {
        let allowed_tables = ["activity_log", "file_index", "undo_history", "rule_metadata"];
        if !allowed_tables.contains(&table) {
            return Err(rusqlite::Error::InvalidParameterName(format!("Table '{}' not allowed", table)));
        }
        let conn = self.conn.lock().unwrap();
        let deleted = conn.execute(&format!("DELETE FROM {}", table), [])?;
        // Reclaim space
        conn.execute_batch("VACUUM")?;
        Ok(deleted as u64)
    }

    /// Prune oldest activity log entries to bring DB under the size limit.
    /// Returns number of rows deleted.
    pub fn enforce_size_limit(&self, max_bytes: u64) -> Result<u64> {
        let mut total_deleted = 0u64;
        let current_size = self.get_db_file_size();
        if max_bytes == 0 || current_size <= max_bytes {
            return Ok(0);
        }

        // Delete oldest activity_log entries in batches of 500
        loop {
            let size = self.get_db_file_size();
            if size <= max_bytes {
                break;
            }
            let conn = self.conn.lock().unwrap();
            let deleted = conn.execute(
                "DELETE FROM activity_log WHERE id IN (SELECT id FROM activity_log ORDER BY timestamp ASC LIMIT 500)",
                [],
            )?;
            drop(conn);
            if deleted == 0 {
                break;
            }
            total_deleted += deleted as u64;
        }

        // If still over, prune undo_history
        loop {
            let size = self.get_db_file_size();
            if size <= max_bytes {
                break;
            }
            let conn = self.conn.lock().unwrap();
            let deleted = conn.execute(
                "DELETE FROM undo_history WHERE id IN (SELECT id FROM undo_history ORDER BY timestamp ASC LIMIT 500)",
                [],
            )?;
            drop(conn);
            if deleted == 0 {
                break;
            }
            total_deleted += deleted as u64;
        }

        // Vacuum to reclaim space
        let conn = self.conn.lock().unwrap();
        conn.execute_batch("VACUUM").ok();

        Ok(total_deleted)
    }
}

// ── Structs for query results ───────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ActivityLogEntry {
    pub id: String,
    pub file_path: String,
    pub file_name: String,
    pub action: String,
    pub rule_name: Option<String>,
    pub folder_id: Option<String>,
    pub timestamp: String,
    pub result: String,
    pub details: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FileIndexEntry {
    pub id: String,
    pub file_path: String,
    pub folder_id: String,
    pub file_name: String,
    pub extension: Option<String>,
    pub size_bytes: Option<i64>,
    pub first_seen: String,
    pub last_modified: Option<String>,
    pub pending_action: Option<String>,
    pub scheduled_at: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct UndoEntry {
    pub id: String,
    pub original_path: String,
    pub current_path: Option<String>,
    pub action: String,
    pub timestamp: String,
    pub expires_at: String,
    pub restored: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RuleMetadata {
    pub rule_id: String,
    pub folder_id: String,
    pub created_at: String,
    pub last_triggered_at: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TableStats {
    pub table_name: String,
    pub row_count: u64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TableQueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub total: u64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DbStats {
    pub db_size_bytes: u64,
    pub trash_size_bytes: u64,
    pub tables: Vec<TableStats>,
}
