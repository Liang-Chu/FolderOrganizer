use std::path::PathBuf;

use tauri::State;
use uuid::Uuid;

use crate::config::{self, WatchedFolder};
use super::AppState;

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
