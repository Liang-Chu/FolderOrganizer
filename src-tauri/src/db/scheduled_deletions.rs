use rusqlite::{params, Result};

use super::models::ScheduledDeletion;
use super::Database;

impl Database {
    /// Insert or update a scheduled deletion. If the file is already scheduled,
    /// this is a no-op (keeps the original schedule).
    pub fn upsert_scheduled_deletion(
        &self,
        id: &str,
        file_path: &str,
        folder_id: &str,
        rule_name: &str,
        file_name: &str,
        extension: Option<&str>,
        size_bytes: Option<i64>,
        scheduled_at: &str,
        delete_after: &str,
    ) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        // Only insert if file_path doesn't already exist (ignore on conflict)
        let rows = conn.execute(
            "INSERT INTO scheduled_deletions (id, file_path, folder_id, rule_name, file_name, extension, size_bytes, scheduled_at, delete_after)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(file_path) DO NOTHING",
            params![id, file_path, folder_id, rule_name, file_name, extension, size_bytes, scheduled_at, delete_after],
        )?;
        // rows == 1 means newly inserted, 0 means it already existed
        Ok(rows > 0)
    }

    /// Check whether a file is already scheduled for deletion.
    #[allow(dead_code)]
    pub fn is_file_scheduled(&self, file_path: &str) -> bool {
        let conn = self.conn.lock().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM scheduled_deletions WHERE file_path = ?1",
                params![file_path],
                |row| row.get(0),
            )
            .unwrap_or(0);
        count > 0
    }

    /// Get all scheduled deletions (ordered by delete_after ascending).
    pub fn get_scheduled_deletions(&self) -> Result<Vec<ScheduledDeletion>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, file_path, folder_id, rule_name, file_name, extension, size_bytes, scheduled_at, delete_after
             FROM scheduled_deletions ORDER BY delete_after ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ScheduledDeletion {
                id: row.get(0)?,
                file_path: row.get(1)?,
                folder_id: row.get(2)?,
                rule_name: row.get(3)?,
                file_name: row.get(4)?,
                extension: row.get(5)?,
                size_bytes: row.get(6)?,
                scheduled_at: row.get(7)?,
                delete_after: row.get(8)?,
            })
        })?;
        let mut entries = Vec::new();
        for row in rows {
            entries.push(row?);
        }
        Ok(entries)
    }

    /// Get scheduled deletions whose delete_after time has passed.
    pub fn get_due_deletions(&self, now: &str) -> Result<Vec<ScheduledDeletion>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, file_path, folder_id, rule_name, file_name, extension, size_bytes, scheduled_at, delete_after
             FROM scheduled_deletions WHERE delete_after <= ?1 ORDER BY delete_after ASC",
        )?;
        let rows = stmt.query_map(params![now], |row| {
            Ok(ScheduledDeletion {
                id: row.get(0)?,
                file_path: row.get(1)?,
                folder_id: row.get(2)?,
                rule_name: row.get(3)?,
                file_name: row.get(4)?,
                extension: row.get(5)?,
                size_bytes: row.get(6)?,
                scheduled_at: row.get(7)?,
                delete_after: row.get(8)?,
            })
        })?;
        let mut entries = Vec::new();
        for row in rows {
            entries.push(row?);
        }
        Ok(entries)
    }

    /// Remove a scheduled deletion by ID (cancel it).
    pub fn cancel_scheduled_deletion(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM scheduled_deletions WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    }

    /// Remove a scheduled deletion by file path.
    pub fn remove_scheduled_deletion_by_path(&self, file_path: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM scheduled_deletions WHERE file_path = ?1",
            params![file_path],
        )?;
        Ok(())
    }
}
