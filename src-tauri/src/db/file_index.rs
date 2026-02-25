use rusqlite::{params, Result};

use super::models::FileIndexEntry;
use super::Database;

impl Database {
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
}
