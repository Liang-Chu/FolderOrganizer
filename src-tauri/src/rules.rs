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

/// Result of evaluating a file against folder rules.
pub enum EvalOutcome {
    /// A move/immediate action was executed.
    Action(RuleActionResult),
    /// A deletion or move was scheduled (new or already existed).
    Scheduled {
        file_path: String,
        file_name: String,
        rule_name: String,
        newly_inserted: bool,
        action_type: String,
        details: Option<String>,
    },
    /// No rule matched this file.
    NoMatch,
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
/// Returns full outcome including scheduled deletions.
pub fn evaluate_file_full(
    file_path: &Path,
    folder: &WatchedFolder,
    db: &Database,
) -> EvalOutcome {
    let file_name = file_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    // Check folder-level whitelist first
    if is_whitelisted(&file_name, &folder.whitelist) {
        return EvalOutcome::NoMatch;
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
        if let Action::Move { ref destination, .. } = rule.action {
            if is_file_in_dir(file_path, destination) {
                continue;
            }
        }

        // Matching behavior:
        //   - match_subdirectories=true  → evaluate against relative file path
        //   - match_subdirectories=false → evaluate against the entry name (filename or folder name).
        //     Folders and files that are direct children of the watched folder are matched by name.
        let matched = if rule.match_subdirectories {
            let relative_path = file_path
                .strip_prefix(&folder.path)
                .unwrap_or(file_path)
                .to_string_lossy()
                .replace('\\', "/");
            condition::evaluate(&rule.condition, &relative_path)
        } else {
            // file_name is the last component — works for both files and directories
            condition::evaluate(&rule.condition, &file_name)
        };

        if !matched {
            continue;
        }

        // Condition matched — execute the action
        match &rule.action {
            Action::Move { delay_minutes, keep_source, .. } if *delay_minutes > 0 => {
                // Scheduled move
                let destination = if let Action::Move { ref destination, .. } = rule.action {
                    destination.to_string_lossy().to_string()
                } else {
                    unreachable!()
                };
                let newly_inserted = schedule_action(
                    file_path, &file_name, rule, folder, db, *delay_minutes, "move", Some(&destination), *keep_source,
                );
                return EvalOutcome::Scheduled {
                    file_path: file_path.to_string_lossy().to_string(),
                    file_name: file_name.clone(),
                    rule_name: rule.name.clone(),
                    newly_inserted,
                    action_type: "scheduled_move".to_string(),
                    details: Some(format!("→ {}", destination)),
                };
            }
            Action::Move { .. } => {
                return EvalOutcome::Action(execute_action(file_path, &file_name, rule, folder, db));
            }
            Action::Delete { delay_minutes, .. } => {
                let newly_inserted = schedule_action(
                    file_path, &file_name, rule, folder, db, *delay_minutes, "delete", None, false,
                );
                return EvalOutcome::Scheduled {
                    file_path: file_path.to_string_lossy().to_string(),
                    file_name: file_name.clone(),
                    rule_name: rule.name.clone(),
                    newly_inserted,
                    action_type: "scheduled_delete".to_string(),
                    details: None,
                };
            }
        }
    }

    EvalOutcome::NoMatch
}

/// Schedule a file for a future action (delete or move) by inserting into the scheduled_deletions table.
/// Uses upsert so re-scans don't create duplicates.
/// Returns true if a new entry was inserted, false if already scheduled.
fn schedule_action(
    file_path: &Path,
    file_name: &str,
    rule: &Rule,
    folder: &WatchedFolder,
    db: &Database,
    delay_minutes: u32,
    action_type: &str,
    move_destination: Option<&str>,
    keep_source: bool,
) -> bool {
    let now = Utc::now();
    let execute_after = now + chrono::Duration::minutes(delay_minutes as i64);
    let extension = file_path
        .extension()
        .map(|e| e.to_string_lossy().to_string());
    let size = fs::metadata(file_path).ok().map(|m| m.len() as i64);

    let inserted = db.upsert_scheduled_deletion(
        &Uuid::new_v4().to_string(),
        &file_path.to_string_lossy(),
        &folder.id,
        &rule.name,
        file_name,
        extension.as_deref(),
        size,
        &now.format("%Y-%m-%d %H:%M:%S").to_string(),
        &execute_after.format("%Y-%m-%d %H:%M:%S").to_string(),
        action_type,
        move_destination,
        keep_source,
    );

    match inserted {
        Ok(true) => {
            log::info!(
                "Scheduled {}: {} (after {} minutes, rule: {})",
                action_type, file_name, delay_minutes, rule.name
            );
            true
        }
        Ok(false) => {
            // Already scheduled — silent no-op
            false
        }
        Err(e) => {
            log::error!("Failed to schedule {} for {}: {}", action_type, file_name, e);
            false
        }
    }
}

fn execute_action(
    file_path: &Path,
    file_name: &str,
    rule: &Rule,
    _folder: &WatchedFolder,
    _db: &Database,
) -> RuleActionResult {
    match &rule.action {
        Action::Move { destination, keep_source, .. } => {
            execute_move(file_path, destination, file_name, &rule.name, *keep_source)
        }
        Action::Delete { .. } => {
            // This branch should not be reached — Delete is handled by schedule_deletion
            unreachable!("Delete actions are handled by schedule_deletion, not execute_action")
        }
    }
}

fn execute_move(
    file_path: &Path,
    destination: &Path,
    file_name: &str,
    rule_name: &str,
    keep_source: bool,
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
        let ext = if file_path.is_file() {
            file_path
                .extension()
                .map(|e| format!(".{}", e.to_string_lossy()))
                .unwrap_or_default()
        } else {
            String::new()
        };
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

    let action_label = if keep_source { "copied" } else { "moved" };
    let action_verb = if keep_source { "Copied" } else { "Moved" };

    // Copy mode: always copy, never remove source
    if keep_source {
        let copy_result = if file_path.is_dir() {
            copy_dir_recursive(file_path, &final_dest).map(|_| ())
        } else {
            fs::copy(file_path, &final_dest).map(|_| ())
        };
        return match copy_result {
            Ok(_) => RuleActionResult {
                file_path: file_path.to_string_lossy().to_string(),
                file_name: file_name.to_string(),
                action: action_label.to_string(),
                rule_name: rule_name.to_string(),
                success: true,
                details: Some(format!("{} to {}", action_verb, final_dest.display())),
            },
            Err(e) => RuleActionResult {
                file_path: file_path.to_string_lossy().to_string(),
                file_name: file_name.to_string(),
                action: "copy".to_string(),
                rule_name: rule_name.to_string(),
                success: false,
                details: Some(format!("Copy failed: {}", e)),
            },
        };
    }

    // Cut mode: try rename first (atomic), fallback to copy + delete
    match fs::rename(file_path, &final_dest) {
        Ok(_) => RuleActionResult {
            file_path: file_path.to_string_lossy().to_string(),
            file_name: file_name.to_string(),
            action: action_label.to_string(),
            rule_name: rule_name.to_string(),
            success: true,
            details: Some(format!("{} to {}", action_verb, final_dest.display())),
        },
        Err(e) => {
            if file_path.is_dir() {
                // Directory cross-device move: recursive copy then remove
                match copy_dir_recursive(file_path, &final_dest) {
                    Ok(_) => {
                        if let Err(rm_err) = fs::remove_dir_all(file_path) {
                            log::warn!("Copied dir to {} but failed to remove source: {}", final_dest.display(), rm_err);
                        }
                        RuleActionResult {
                            file_path: file_path.to_string_lossy().to_string(),
                            file_name: file_name.to_string(),
                            action: action_label.to_string(),
                            rule_name: rule_name.to_string(),
                            success: true,
                            details: Some(format!("{} to {}", action_verb, final_dest.display())),
                        }
                    }
                    Err(copy_err) => RuleActionResult {
                        file_path: file_path.to_string_lossy().to_string(),
                        file_name: file_name.to_string(),
                        action: "move".to_string(),
                        rule_name: rule_name.to_string(),
                        success: false,
                        details: Some(format!(
                            "Move failed: {}, dir copy failed: {}",
                            e, copy_err
                        )),
                    },
                }
            } else {
                match fs::copy(file_path, &final_dest) {
                    Ok(_) => {
                        if let Err(rm_err) = fs::remove_file(file_path) {
                            log::warn!("Copied file to {} but failed to remove source: {}", final_dest.display(), rm_err);
                        }
                        RuleActionResult {
                            file_path: file_path.to_string_lossy().to_string(),
                            file_name: file_name.to_string(),
                            action: action_label.to_string(),
                            rule_name: rule_name.to_string(),
                            success: true,
                            details: Some(format!("{} to {}", action_verb, final_dest.display())),
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
}

/// Recursively copy a directory and all its contents to a new location.
pub fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}
