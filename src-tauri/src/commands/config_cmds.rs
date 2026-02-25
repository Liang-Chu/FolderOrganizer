use std::fs;
use std::path::PathBuf;

use tauri::State;

use crate::config::{self, AppConfig};
use super::AppState;

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

/// Export current config to a user-specified file path.
#[tauri::command]
pub fn export_config(state: State<AppState>, path: String) -> Result<(), String> {
    let config = state.config.lock().map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(&*config).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| format!("Failed to write config: {}", e))?;
    Ok(())
}

/// Import config from a user-specified file path. Validates JSON before applying.
#[tauri::command]
pub fn import_config(state: State<AppState>, path: String) -> Result<(), String> {
    let file_path = PathBuf::from(&path);
    if !file_path.exists() {
        return Err("File not found".to_string());
    }

    let data = config::read_file_strip_bom(&file_path)?;

    // Validate the JSON parses as a valid AppConfig
    let imported: AppConfig = serde_json::from_str(&data)
        .map_err(|e| format!("Invalid config format: {}", e))?;

    // Save to the actual config location (always as clean UTF-8)
    config::save_config(&imported)?;

    // Update in-memory state
    let mut config = state.config.lock().map_err(|e| e.to_string())?;
    *config = imported;

    Ok(())
}

/// Get the config file path so the user knows where it lives.
#[tauri::command]
pub fn get_config_path() -> String {
    config::app_data_dir().join("config.json").to_string_lossy().to_string()
}
