use rusqlite::{Connection, Result};

use crate::config::app_data_dir;
use super::models::{TableStats, TableQueryResult};
use super::Database;

impl Database {
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
            return Err(rusqlite::Error::InvalidParameterName(format!(
                "Table '{}' not allowed",
                table
            )));
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
            return Err(rusqlite::Error::InvalidParameterName(format!(
                "Table '{}' not allowed",
                table
            )));
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
