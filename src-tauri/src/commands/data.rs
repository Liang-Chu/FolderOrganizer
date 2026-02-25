use tauri::State;

use crate::db::{ActivityLogEntry, FileIndexEntry, UndoEntry};
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
