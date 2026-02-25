use rusqlite::{params, Result};

use super::models::RuleMetadata;
use super::Database;

impl Database {
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

    pub fn update_rule_triggered(
        &self,
        rule_id: &str,
        folder_id: &str,
        triggered_at: &str,
    ) -> Result<()> {
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
}
