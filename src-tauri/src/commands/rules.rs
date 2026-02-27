use tauri::State;

use crate::config::{self, Rule};
use crate::db::RuleMetadata;
use super::AppState;

/// A source rule reference: which folder it lives in and which rule ID to copy.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct RuleSource {
    pub folder_id: String,
    pub rule_id: String,
}

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

    // Capture old rule info before replacing
    let old_rule = folder
        .rules
        .iter()
        .find(|r| r.id() == rule.id())
        .cloned()
        .ok_or("Rule not found")?;

    let new_rule = rule.clone();
    if let Some(existing) = folder.rules.iter_mut().find(|r| r.id() == new_rule.id()) {
        *existing = new_rule;
    }

    config::save_config(&config)?;

    // Reconcile scheduled deletions when a rule changes
    match (&old_rule.action, &rule.action) {
        // Delete → Delete: if after_days changed, update all pending deletions
        (
            config::Action::Delete { after_days: old_days },
            config::Action::Delete { after_days: new_days },
        ) => {
            if old_days != new_days {
                let _ = state.db.update_scheduled_deletion_days(
                    &folder_id,
                    &rule.name,
                    *new_days,
                );
                log::info!(
                    "Updated scheduled deletions for rule '{}': {} days → {} days",
                    rule.name, old_days, new_days
                );
            }
            // If condition or name changed, remove old and rescan
            if old_rule.condition_text != rule.condition_text || old_rule.name != rule.name {
                let _ = state.db.remove_scheduled_deletions_by_rule(&folder_id, &old_rule.name);
            }
        }
        // Delete → Move: remove all scheduled deletions for this rule
        (config::Action::Delete { .. }, config::Action::Move { .. }) => {
            let _ = state.db.remove_scheduled_deletions_by_rule(&folder_id, &old_rule.name);
            log::info!(
                "Cleared scheduled deletions for rule '{}' (changed to Move)",
                old_rule.name
            );
        }
        // Move → Delete or Move → Move: nothing to reconcile for scheduled deletions
        _ => {}
    }

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

/// Copy rules from other folders into the target folder.
/// Each source rule gets a new UUID so it's an independent copy.
#[tauri::command]
pub fn copy_rules_to_folder(
    state: State<AppState>,
    target_folder_id: String,
    sources: Vec<RuleSource>,
) -> Result<u32, String> {
    let mut config = state.config.lock().map_err(|e| e.to_string())?;

    // Collect rule copies first (to avoid borrow conflicts)
    let mut copies: Vec<Rule> = Vec::new();
    for src in &sources {
        let folder = config
            .folders
            .iter()
            .find(|f| f.id == src.folder_id)
            .ok_or_else(|| format!("Source folder {} not found", src.folder_id))?;
        let rule = folder
            .rules
            .iter()
            .find(|r| r.id() == src.rule_id)
            .ok_or_else(|| format!("Rule {} not found in folder {}", src.rule_id, src.folder_id))?;
        let mut copy = rule.clone();
        copy.id = uuid::Uuid::new_v4().to_string();
        copies.push(copy);
    }

    let target = config
        .folders
        .iter_mut()
        .find(|f| f.id == target_folder_id)
        .ok_or("Target folder not found")?;

    let count = copies.len() as u32;
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();

    for copy in copies {
        let rule_id = copy.id.clone();
        target.rules.push(copy);
        let _ = state.db.insert_rule_metadata(&rule_id, &target_folder_id, &now);
    }

    config::save_config(&config)?;
    Ok(count)
}
