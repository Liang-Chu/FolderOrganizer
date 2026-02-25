use tauri::State;

use crate::db::{DbStats, TableQueryResult};
use super::AppState;

/// Get overall database stats: file size, trash size, per-table row counts.
#[tauri::command]
pub fn get_db_stats(state: State<AppState>) -> Result<DbStats, String> {
    let tables = state.db.get_table_stats().map_err(|e| e.to_string())?;
    Ok(DbStats {
        db_size_bytes: state.db.get_db_file_size(),
        trash_size_bytes: state.db.get_trash_staging_size(),
        tables,
    })
}

/// Query a specific table with pagination and optional search.
#[tauri::command]
pub fn query_db_table(
    state: State<AppState>,
    table: String,
    limit: Option<u32>,
    offset: Option<u32>,
    search: Option<String>,
) -> Result<TableQueryResult, String> {
    state
        .db
        .query_table(
            &table,
            limit.unwrap_or(50),
            offset.unwrap_or(0),
            search.as_deref(),
        )
        .map_err(|e| e.to_string())
}

/// Clear all rows from a table. Returns number deleted.
#[tauri::command]
pub fn clear_db_table(state: State<AppState>, table: String) -> Result<u64, String> {
    state.db.clear_table(&table).map_err(|e| e.to_string())
}

/// Enforce the storage size limit (prunes oldest data). Returns rows pruned.
#[tauri::command]
pub fn enforce_storage_limit(state: State<AppState>) -> Result<u64, String> {
    let max_mb = {
        let config = state.config.lock().map_err(|e| e.to_string())?;
        config.settings.max_storage_mb
    };
    let max_bytes = (max_mb as u64) * 1024 * 1024;
    state
        .db
        .enforce_size_limit(max_bytes)
        .map_err(|e| e.to_string())
}

/// Get the database file path for reference.
#[tauri::command]
pub fn get_db_path() -> String {
    crate::config::app_data_dir()
        .join("data.db")
        .to_string_lossy()
        .to_string()
}
