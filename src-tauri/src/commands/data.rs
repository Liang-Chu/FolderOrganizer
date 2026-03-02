use tauri::{Emitter, State};

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

    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let file_name = std::path::Path::new(&entry.original_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    if entry.current_path.is_none() {
        let _ = state.db.insert_activity(
            &uuid::Uuid::new_v4().to_string(),
            &entry.original_path,
            &file_name,
            "undo",
            None,
            None,
            &now,
            "error",
            Some("Undo is unavailable for recycle-bin deletions"),
        );
        return Err("Undo is unavailable for recycle-bin deletions".to_string());
    }

    if let Some(ref current_path) = entry.current_path {
        let from = std::path::Path::new(current_path);
        let to = std::path::Path::new(&entry.original_path);

        if !from.exists() {
            let _ = state.db.insert_activity(
                &uuid::Uuid::new_v4().to_string(),
                &entry.original_path,
                &file_name,
                "undo",
                None,
                None,
                &now,
                "error",
                Some("Undo source file no longer exists"),
            );
            return Err("Undo source file no longer exists".to_string());
        }

        // Ensure parent dir exists
        if let Some(parent) = to.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::rename(from, to).map_err(|e| e.to_string())?;
    }

    state
        .db
        .mark_restored(&undo_id)
        .map_err(|e| e.to_string())?;

    let _ = state.db.insert_activity(
        &uuid::Uuid::new_v4().to_string(),
        &entry.original_path,
        &file_name,
        "undo",
        None,
        None,
        &now,
        "success",
        Some("Undo restored file to original location"),
    );

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
    app: tauri::AppHandle,
    state: State<AppState>,
    deletion_id: String,
) -> Result<(), String> {
    state
        .db
        .cancel_scheduled_deletion(&deletion_id)
        .map_err(|e| e.to_string())?;
    let _ = app.emit("dashboard-data-changed", ());
    Ok(())
}

/// Manually run all due deletions now. Returns count of files deleted.
#[tauri::command]
pub fn run_deletions(app: tauri::AppHandle, state: State<AppState>) -> Result<u32, String> {
    let config = {
        let guard = state.config.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };
    let count = scheduler::process_due_deletions_with_config(&state.db, Some(&config));
    let _ = app.emit("dashboard-data-changed", ());
    Ok(count)
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
