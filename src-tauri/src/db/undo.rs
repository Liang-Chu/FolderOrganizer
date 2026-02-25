use rusqlite::{params, Result};

use super::models::UndoEntry;
use super::Database;

impl Database {
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
}
