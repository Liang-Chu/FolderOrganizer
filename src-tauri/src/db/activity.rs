use rusqlite::{params, Result};

use super::models::ActivityLogEntry;
use super::Database;

impl Database {
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
}
