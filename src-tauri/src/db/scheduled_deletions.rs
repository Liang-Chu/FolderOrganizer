use rusqlite::{params, Result};

use super::models::ScheduledDeletion;
use super::Database;

impl Database {
    /// Insert or update a scheduled action keyed on (file_path, rule_name).
    /// Multiple rules can independently schedule actions on the same file.
    /// If the same rule already scheduled this file, this is a no-op (keeps the original schedule).
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
        action_type: &str,
        move_destination: Option<&str>,
        keep_source: bool,
        rule_priority: u32,
    ) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        // Check if entry already exists for this file+rule to distinguish insert from update
        let already_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM scheduled_deletions WHERE file_path = ?1 AND rule_name = ?2",
                params![file_path, rule_name],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0) > 0;
        conn.execute(
            "INSERT INTO scheduled_deletions (id, file_path, folder_id, rule_name, file_name, extension, size_bytes, scheduled_at, delete_after, action_type, move_destination, keep_source, rule_priority)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
             ON CONFLICT(file_path, rule_name) DO UPDATE SET
               action_type = excluded.action_type,
               move_destination = excluded.move_destination,
               keep_source = excluded.keep_source,
               rule_priority = excluded.rule_priority",
            params![id, file_path, folder_id, rule_name, file_name, extension, size_bytes, scheduled_at, delete_after, action_type, move_destination, keep_source, rule_priority],
        )?;
        Ok(!already_exists)
    }

    /// Check whether a file is already scheduled.
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

    /// Get all scheduled actions (ordered by delete_after ascending, then rule priority).
    pub fn get_scheduled_deletions(&self) -> Result<Vec<ScheduledDeletion>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, file_path, folder_id, rule_name, file_name, extension, size_bytes, scheduled_at, delete_after,
                    COALESCE(action_type, 'delete'), move_destination, COALESCE(keep_source, 0), COALESCE(rule_priority, 0)
             FROM scheduled_deletions ORDER BY delete_after ASC, rule_priority ASC",
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
                action_type: row.get(9)?,
                move_destination: row.get(10)?,
                keep_source: row.get::<_, i32>(11).unwrap_or(0) != 0,
                rule_priority: row.get::<_, u32>(12).unwrap_or(0),
            })
        })?;
        let mut entries = Vec::new();
        for row in rows {
            entries.push(row?);
        }
        Ok(entries)
    }

    /// Get scheduled actions whose execute time has passed.
    /// Ordered by delete_after ASC, then rule_priority ASC (top-of-list rule wins ties).
    pub fn get_due_deletions(&self, now: &str) -> Result<Vec<ScheduledDeletion>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, file_path, folder_id, rule_name, file_name, extension, size_bytes, scheduled_at, delete_after,
                    COALESCE(action_type, 'delete'), move_destination, COALESCE(keep_source, 0), COALESCE(rule_priority, 0)
             FROM scheduled_deletions WHERE delete_after <= ?1 ORDER BY delete_after ASC, rule_priority ASC",
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
                action_type: row.get(9)?,
                move_destination: row.get(10)?,
                keep_source: row.get::<_, i32>(11).unwrap_or(0) != 0,
                rule_priority: row.get::<_, u32>(12).unwrap_or(0),
            })
        })?;
        let mut entries = Vec::new();
        for row in rows {
            entries.push(row?);
        }
        Ok(entries)
    }

    /// Remove a scheduled action by ID (cancel it).
    pub fn cancel_scheduled_deletion(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM scheduled_deletions WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    }

    /// Remove a scheduled action by file path.
    pub fn remove_scheduled_deletion_by_path(&self, file_path: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM scheduled_deletions WHERE file_path = ?1",
            params![file_path],
        )?;
        Ok(())
    }

    /// Remove all destructive (non-keep_source) scheduled entries for a file,
    /// except the one belonging to the given rule name.
    /// Used to clean up losing rules when the winner changes.
    pub fn remove_losers_for_file(&self, file_path: &str, winner_rule_name: &str) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM scheduled_deletions WHERE file_path = ?1 AND rule_name != ?2 AND keep_source = 0",
            params![file_path, winner_rule_name],
        )
    }

    /// Remove all scheduled actions for a specific rule in a folder.
    pub fn remove_scheduled_deletions_by_rule(&self, folder_id: &str, rule_name: &str) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM scheduled_deletions WHERE folder_id = ?1 AND rule_name = ?2",
            params![folder_id, rule_name],
        )
    }

    /// Remove all scheduled actions for a folder.
    pub fn remove_scheduled_deletions_by_folder(&self, folder_id: &str) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM scheduled_deletions WHERE folder_id = ?1",
            params![folder_id],
        )
    }

    /// Remove scheduled entries for a folder whose source files no longer exist on disk.
    /// Returns the number of entries removed.
    pub fn cleanup_missing_files_for_folder(&self, folder_id: &str) -> usize {
        let entries = match self.get_scheduled_deletions() {
            Ok(e) => e,
            Err(_) => return 0,
        };
        let mut removed = 0usize;
        for entry in entries {
            if entry.folder_id == folder_id && !std::path::Path::new(&entry.file_path).exists() {
                let _ = self.remove_scheduled_deletion_by_path(&entry.file_path);
                removed += 1;
            }
        }
        removed
    }

    /// Update the execute-after timestamp for all scheduled actions of a specific rule in a folder.
    /// Recalculates delete_after = scheduled_at + new delay_minutes.
    pub fn update_scheduled_deletion_delay(
        &self,
        folder_id: &str,
        rule_name: &str,
        delay_minutes: u32,
    ) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE scheduled_deletions
             SET delete_after = datetime(scheduled_at, '+' || ?3 || ' minutes')
             WHERE folder_id = ?1 AND rule_name = ?2",
            params![folder_id, rule_name, delay_minutes],
        )
    }
}
