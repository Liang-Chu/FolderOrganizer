use std::fs;
use std::path::Path;

use chrono::Utc;
use uuid::Uuid;

use crate::condition;
use crate::config::{Action, Rule, WatchedFolder};
use crate::db::Database;

#[derive(Debug, Clone, serde::Serialize)]
pub struct RuleActionResult {
    pub file_path: String,
    pub file_name: String,
    pub action: String,
    pub rule_name: String,
    pub success: bool,
    pub details: Option<String>,
}

/// Evaluate a single file against a folder's rules (in priority order).
/// First matching rule wins. Returns the action result, or None if no match.
pub fn evaluate_file(
    file_path: &Path,
    folder: &WatchedFolder,
    db: &Database,
) -> Option<RuleActionResult> {
    let file_name = file_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    for rule in &folder.rules {
        if !rule.is_enabled() {
            continue;
        }

        // Test condition tree against filename
        if !condition::evaluate(&rule.condition, &file_name) {
            continue;
        }

        // Condition matched — execute the action
        return Some(execute_action(file_path, &file_name, rule, folder, db));
    }

    None
}

fn execute_action(
    file_path: &Path,
    file_name: &str,
    rule: &Rule,
    folder: &WatchedFolder,
    db: &Database,
) -> RuleActionResult {
    match &rule.action {
        Action::Move { destination } => {
            execute_move(file_path, destination, file_name, &rule.name)
        }

        Action::Delete { after_days } => {
            let now = Utc::now();
            let scheduled = now + chrono::Duration::days(*after_days as i64);
            let extension = file_path
                .extension()
                .map(|e| e.to_string_lossy().to_string());
            let size = fs::metadata(file_path).ok().map(|m| m.len() as i64);

            let _ = db.upsert_file(
                &Uuid::new_v4().to_string(),
                &file_path.to_string_lossy(),
                &folder.id,
                file_name,
                extension.as_deref(),
                size,
                &now.format("%Y-%m-%d %H:%M:%S").to_string(),
                None,
                Some("auto_delete"),
                Some(&scheduled.format("%Y-%m-%d %H:%M:%S").to_string()),
            );

            RuleActionResult {
                file_path: file_path.to_string_lossy().to_string(),
                file_name: file_name.to_string(),
                action: "scheduled_delete".to_string(),
                rule_name: rule.name.clone(),
                success: true,
                details: Some(format!("Scheduled for deletion in {} days", after_days)),
            }
        }

        Action::Ignore => RuleActionResult {
            file_path: file_path.to_string_lossy().to_string(),
            file_name: file_name.to_string(),
            action: "ignored".to_string(),
            rule_name: rule.name.clone(),
            success: true,
            details: None,
        },
    }
}

fn execute_move(
    file_path: &Path,
    destination: &Path,
    file_name: &str,
    rule_name: &str,
) -> RuleActionResult {
    if let Err(e) = fs::create_dir_all(destination) {
        return RuleActionResult {
            file_path: file_path.to_string_lossy().to_string(),
            file_name: file_name.to_string(),
            action: "move".to_string(),
            rule_name: rule_name.to_string(),
            success: false,
            details: Some(format!("Failed to create destination: {}", e)),
        };
    }

    let dest_file = destination.join(file_name);
    let final_dest = if dest_file.exists() {
        let stem = file_path.file_stem().unwrap_or_default().to_string_lossy();
        let ext = file_path
            .extension()
            .map(|e| format!(".{}", e.to_string_lossy()))
            .unwrap_or_default();
        let mut counter = 1;
        loop {
            let candidate = destination.join(format!("{} ({}){}", stem, counter, ext));
            if !candidate.exists() {
                break candidate;
            }
            counter += 1;
        }
    } else {
        dest_file
    };

    match fs::rename(file_path, &final_dest) {
        Ok(_) => RuleActionResult {
            file_path: file_path.to_string_lossy().to_string(),
            file_name: file_name.to_string(),
            action: "moved".to_string(),
            rule_name: rule_name.to_string(),
            success: true,
            details: Some(format!("Moved to {}", final_dest.display())),
        },
        Err(e) => {
            match fs::copy(file_path, &final_dest) {
                Ok(_) => {
                    let _ = fs::remove_file(file_path);
                    RuleActionResult {
                        file_path: file_path.to_string_lossy().to_string(),
                        file_name: file_name.to_string(),
                        action: "moved".to_string(),
                        rule_name: rule_name.to_string(),
                        success: true,
                        details: Some(format!("Moved to {}", final_dest.display())),
                    }
                }
                Err(copy_err) => RuleActionResult {
                    file_path: file_path.to_string_lossy().to_string(),
                    file_name: file_name.to_string(),
                    action: "move".to_string(),
                    rule_name: rule_name.to_string(),
                    success: false,
                    details: Some(format!(
                        "Move failed: {}, copy failed: {}",
                        e, copy_err
                    )),
                },
            }
        }
    }
}
