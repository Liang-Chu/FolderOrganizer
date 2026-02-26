use tauri::State;

use crate::db::{ActivityLogEntry, FileIndexEntry, RuleExecutionStats, ScheduledDeletion, UndoEntry};
use crate::scheduler;
use super::AppState;

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

    state
        .db
        .mark_restored(&undo_id)
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Scheduled Deletions ─────────────────────────────────────

/// Get all files currently scheduled for deletion.
#[tauri::command]
pub fn get_scheduled_deletions(state: State<AppState>) -> Result<Vec<ScheduledDeletion>, String> {
    state
        .db
        .get_scheduled_deletions()
        .map_err(|e| e.to_string())
}

/// Cancel a scheduled deletion by ID.
#[tauri::command]
pub fn cancel_scheduled_deletion(
    state: State<AppState>,
    deletion_id: String,
) -> Result<(), String> {
    state
        .db
        .cancel_scheduled_deletion(&deletion_id)
        .map_err(|e| e.to_string())
}

/// Manually run all due deletions now. Returns count of files deleted.
#[tauri::command]
pub fn run_deletions(state: State<AppState>) -> Result<u32, String> {
    Ok(scheduler::process_due_deletions(&state.db))
}

/// Get execution stats (last run + weekly count) for each rule in a folder.
#[tauri::command]
pub fn get_rule_execution_stats(
    state: State<AppState>,
    folder_id: String,
) -> Result<Vec<RuleExecutionStats>, String> {
    let since = chrono::Utc::now()
        .checked_sub_signed(chrono::Duration::days(7))
        .unwrap_or(chrono::Utc::now())
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();
    state
        .db
        .get_rule_execution_stats(&folder_id, &since)
        .map_err(|e| e.to_string())
}
