use tauri::State;

use crate::config::{self, Rule};
use crate::db::RuleMetadata;
use super::AppState;

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
pub fn get_rule_metadata(
    state: State<AppState>,
    folder_id: String,
) -> Result<Vec<RuleMetadata>, String> {
    state
        .db
        .get_rule_metadata(&folder_id)
        .map_err(|e| e.to_string())
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
