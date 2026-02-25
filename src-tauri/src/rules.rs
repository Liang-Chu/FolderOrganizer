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

/// Check if a filename matches any glob pattern in a whitelist.
fn is_whitelisted(file_name: &str, whitelist: &[String]) -> bool {
    let name_lower = file_name.to_lowercase();
    for pattern in whitelist {
        if glob_match(&pattern.to_lowercase(), &name_lower) {
            return true;
        }
    }
    false
}

/// Simple glob matching (same logic as condition.rs glob matcher).
fn glob_match(pattern: &str, text: &str) -> bool {
    let p = pattern.chars().peekable();
    let t = text.chars().peekable();
    glob_match_impl(&p.collect::<Vec<_>>(), &t.collect::<Vec<_>>(), 0, 0)
}

fn glob_match_impl(pattern: &[char], text: &[char], pi: usize, ti: usize) -> bool {
    let (mut pi, mut ti) = (pi, ti);
    while pi < pattern.len() && ti < text.len() {
        match pattern[pi] {
            '*' => {
                // Try matching rest of pattern at every position
                for i in ti..=text.len() {
                    if glob_match_impl(pattern, text, pi + 1, i) {
                        return true;
                    }
                }
                return false;
            }
            '?' => {
                pi += 1;
                ti += 1;
            }
            c => {
                if c != text[ti] {
                    return false;
                }
                pi += 1;
                ti += 1;
            }
        }
    }
    // Consume trailing wildcards
    while pi < pattern.len() && pattern[pi] == '*' {
        pi += 1;
    }
    pi == pattern.len() && ti == text.len()
}

/// Check if a file is inside a given directory (the Move destination).
/// Used to auto-whitelist files already at the destination.
fn is_file_in_dir(file_path: &Path, dir: &Path) -> bool {
    if let (Ok(file_canon), Ok(dir_canon)) = (file_path.canonicalize(), dir.canonicalize()) {
        file_canon.starts_with(&dir_canon)
    } else {
        // Fallback: simple prefix check
        file_path.starts_with(dir)
    }
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

    // Check folder-level whitelist first
    if is_whitelisted(&file_name, &folder.whitelist) {
        return None;
    }

    for rule in &folder.rules {
        if !rule.is_enabled() {
            continue;
        }

        // Check rule-level whitelist
        if is_whitelisted(&file_name, &rule.whitelist) {
            continue;
        }

        // Auto-whitelist: if this is a Move rule, skip files already in the destination
        if let Action::Move { ref destination } = rule.action {
            if is_file_in_dir(file_path, destination) {
                continue;
            }
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
