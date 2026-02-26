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
pub struct RuleExecutionStats {
    pub rule_name: String,
    pub last_executed: Option<String>,
    pub executions_this_week: u32,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ScheduledDeletion {
    pub id: String,
    pub file_path: String,
    pub folder_id: String,
    pub rule_name: String,
    pub file_name: String,
    pub extension: Option<String>,
    pub size_bytes: Option<i64>,
    /// When the file was first scheduled
    pub scheduled_at: String,
    /// When the file should actually be deleted (scheduled_at + after_days)
    pub delete_after: String,
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
