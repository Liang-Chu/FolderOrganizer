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
