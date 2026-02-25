use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use tauri::State;
use uuid::Uuid;

use crate::condition;
use crate::config::{self, AppConfig, Condition, Rule, WatchedFolder};
use crate::db::{ActivityLogEntry, Database, DbStats, FileIndexEntry, RuleMetadata, TableQueryResult, UndoEntry};
use crate::scheduler;
use crate::watcher::FileWatcher;

pub struct AppState {
    pub config: Arc<Mutex<AppConfig>>,
    pub db: Arc<Database>,
    pub watcher: Arc<Mutex<FileWatcher>>,
}

// ── Config Commands ─────────────────────────────────────────

#[tauri::command]
pub fn get_config(state: State<AppState>) -> Result<AppConfig, String> {
    let config = state.config.lock().map_err(|e| e.to_string())?;
    Ok(config.clone())
}

#[tauri::command]
pub fn save_config_cmd(state: State<AppState>, new_config: AppConfig) -> Result<(), String> {
    config::save_config(&new_config)?;
    let mut config = state.config.lock().map_err(|e| e.to_string())?;
    *config = new_config;
    Ok(())
}

// ── Folder Commands ─────────────────────────────────────────

#[tauri::command]
pub fn get_watched_folders(state: State<AppState>) -> Result<Vec<WatchedFolder>, String> {
    let config = state.config.lock().map_err(|e| e.to_string())?;
    Ok(config.folders.clone())
}

#[tauri::command]
pub fn add_watched_folder(state: State<AppState>, path: String) -> Result<WatchedFolder, String> {
    let mut config = state.config.lock().map_err(|e| e.to_string())?;

    let folder_path = PathBuf::from(&path);
    if !folder_path.exists() {
        return Err(format!("Folder does not exist: {}", path));
    }

    // Check for duplicates
    if config.folders.iter().any(|f| f.path == folder_path) {
        return Err("Folder is already being watched".to_string());
    }

    let folder = WatchedFolder {
        id: Uuid::new_v4().to_string(),
        path: folder_path,
        enabled: true,
        rules: Vec::new(),
    };

    config.folders.push(folder.clone());
    config::save_config(&config)?;

    Ok(folder)
}

#[tauri::command]
pub fn remove_watched_folder(state: State<AppState>, folder_id: String) -> Result<(), String> {
    let mut config = state.config.lock().map_err(|e| e.to_string())?;
    config.folders.retain(|f| f.id != folder_id);
    config::save_config(&config)?;
    Ok(())
}

#[tauri::command]
pub fn toggle_watched_folder(
    state: State<AppState>,
    folder_id: String,
    enabled: bool,
) -> Result<(), String> {
    let mut config = state.config.lock().map_err(|e| e.to_string())?;
    if let Some(folder) = config.folders.iter_mut().find(|f| f.id == folder_id) {
        folder.enabled = enabled;
    }
    config::save_config(&config)?;
    Ok(())
}

// ── Rule Commands ───────────────────────────────────────────

#[tauri::command]
pub fn get_rules(state: State<AppState>, folder_id: String) -> Result<Vec<Rule>, String> {
    let config = state.config.lock().map_err(|e| e.to_string())?;
    let folder = config
        .folders
        .iter()
        .find(|f| f.id == folder_id)
        .ok_or("Folder not found")?;
    Ok(folder.rules.clone())
}

#[tauri::command]
pub fn add_rule(state: State<AppState>, folder_id: String, rule: Rule) -> Result<(), String> {
    let mut config = state.config.lock().map_err(|e| e.to_string())?;
    let folder = config
        .folders
        .iter_mut()
        .find(|f| f.id == folder_id)
        .ok_or("Folder not found")?;
    let rule_id = rule.id.clone();
    folder.rules.push(rule);
    config::save_config(&config)?;
    // Record creation timestamp
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    let _ = state.db.insert_rule_metadata(&rule_id, &folder_id, &now);
    Ok(())
}

#[tauri::command]
pub fn update_rule(
    state: State<AppState>,
    folder_id: String,
    rule: Rule,
) -> Result<(), String> {
    let mut config = state.config.lock().map_err(|e| e.to_string())?;
    let folder = config
        .folders
        .iter_mut()
        .find(|f| f.id == folder_id)
        .ok_or("Folder not found")?;

    if let Some(existing) = folder.rules.iter_mut().find(|r| r.id() == rule.id()) {
        *existing = rule;
    } else {
        return Err("Rule not found".to_string());
    }

    config::save_config(&config)?;
    Ok(())
}

#[tauri::command]
pub fn delete_rule(
    state: State<AppState>,
    folder_id: String,
    rule_id: String,
) -> Result<(), String> {
    let mut config = state.config.lock().map_err(|e| e.to_string())?;
    let folder = config
        .folders
        .iter_mut()
        .find(|f| f.id == folder_id)
        .ok_or("Folder not found")?;
    folder.rules.retain(|r| r.id() != rule_id);
    config::save_config(&config)?;
    let _ = state.db.delete_rule_metadata(&rule_id, &folder_id);
    Ok(())
}

#[tauri::command]
pub fn get_rule_metadata(state: State<AppState>, folder_id: String) -> Result<Vec<RuleMetadata>, String> {
    state.db.get_rule_metadata(&folder_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reorder_rules(
    state: State<AppState>,
    folder_id: String,
    rule_ids: Vec<String>,
) -> Result<(), String> {
    let mut config = state.config.lock().map_err(|e| e.to_string())?;
    let folder = config
        .folders
        .iter_mut()
        .find(|f| f.id == folder_id)
        .ok_or("Folder not found")?;

    let mut reordered = Vec::new();
    for id in &rule_ids {
        if let Some(rule) = folder.rules.iter().find(|r| r.id() == id) {
            reordered.push(rule.clone());
        }
    }
    folder.rules = reordered;
    config::save_config(&config)?;
    Ok(())
}

// ── Activity & Data Commands ────────────────────────────────

#[tauri::command]
pub fn get_activity_log(
    state: State<AppState>,
    limit: Option<u32>,
    offset: Option<u32>,
    folder_id: Option<String>,
) -> Result<Vec<ActivityLogEntry>, String> {
    let limit = limit.unwrap_or(50);
    let offset = offset.unwrap_or(0);
    state
        .db
        .get_activity_log(limit, offset, folder_id.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_pending_actions(state: State<AppState>) -> Result<Vec<FileIndexEntry>, String> {
    state.db.get_pending_files().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_undo_entries(state: State<AppState>) -> Result<Vec<UndoEntry>, String> {
    state.db.get_undo_entries().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn undo_action(state: State<AppState>, undo_id: String) -> Result<(), String> {
    let entries = state.db.get_undo_entries().map_err(|e| e.to_string())?;
    let entry = entries
        .iter()
        .find(|e| e.id == undo_id)
        .ok_or("Undo entry not found")?;

    if let Some(ref current_path) = entry.current_path {
        let from = std::path::Path::new(current_path);
        let to = std::path::Path::new(&entry.original_path);

        if from.exists() {
            // Ensure parent dir exists
            if let Some(parent) = to.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::rename(from, to).map_err(|e| e.to_string())?;
        }
    }

    state.db.mark_restored(&undo_id).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Watcher Control Commands ────────────────────────────────

/// Ensure a directory exists, creating it (and parents) if needed.
/// Opens a folder in the OS file explorer (bypasses plugin security scope).
#[tauri::command]
pub fn open_in_explorer(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("Path '{}' does not exist", path));
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open explorer: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open Finder: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open file manager: {}", e))?;
    }
    Ok(())
}

/// Returns a clear error if the drive letter doesn't exist.
#[tauri::command]
pub fn ensure_dir(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    // Check the root/drive exists first
    if let Some(root) = p.components().next() {
        let root_path = std::path::PathBuf::from(root.as_os_str());
        if !root_path.exists() {
            return Err(format!("Drive '{}' does not exist", root_path.display()));
        }
    }
    std::fs::create_dir_all(&path).map_err(|e| format!("Failed to create directory '{}': {}", path, e))
}

#[tauri::command]
pub fn scan_now(state: State<AppState>) -> Result<(), String> {
    let config = state.config.lock().map_err(|e| e.to_string())?;
    scheduler::scan_existing_files(&config, &state.db);
    Ok(())
}

#[tauri::command]
pub fn restart_watcher(state: State<AppState>) -> Result<(), String> {
    let config = state.config.lock().map_err(|e| e.to_string())?;
    let mut watcher = state.watcher.lock().map_err(|e| e.to_string())?;
    watcher.start(&config, state.db.clone(), state.config.clone())?;
    Ok(())
}

#[tauri::command]
pub fn stop_watcher(state: State<AppState>) -> Result<(), String> {
    let mut watcher = state.watcher.lock().map_err(|e| e.to_string())?;
    watcher.stop();
    Ok(())
}

#[tauri::command]
pub fn get_watcher_status(state: State<AppState>) -> Result<bool, String> {
    let watcher = state.watcher.lock().map_err(|e| e.to_string())?;
    Ok(watcher.is_running())
}

// ── Database Viewer Commands ────────────────────────────────

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
        .query_table(&table, limit.unwrap_or(50), offset.unwrap_or(0), search.as_deref())
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
    state.db.enforce_size_limit(max_bytes).map_err(|e| e.to_string())
}

/// Get the database file path for reference.
#[tauri::command]
pub fn get_db_path() -> String {
    crate::config::app_data_dir().join("data.db").to_string_lossy().to_string()
}

// ── Condition Commands ──────────────────────────────────────

/// Parse condition text syntax into a Condition tree.
/// Returns the parsed condition, or an error with a message.
#[tauri::command]
pub fn parse_condition_text(text: String) -> Result<Condition, String> {
    condition::parse(&text)
}

/// Serialize a Condition tree back to text syntax.
#[tauri::command]
pub fn condition_to_text(cond: Condition) -> Result<String, String> {
    Ok(condition::to_text(&cond))
}

/// Validate condition text and return any error.
#[tauri::command]
pub fn validate_condition_text(text: String) -> Result<(), String> {
    condition::validate_text(&text)
}

/// Test a condition against a sample filename (for the UI preview).
#[tauri::command]
pub fn test_condition(cond: Condition, file_name: String) -> Result<bool, String> {
    Ok(condition::evaluate(&cond, &file_name))
}
