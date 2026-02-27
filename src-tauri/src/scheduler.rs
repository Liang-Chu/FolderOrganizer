use std::fs;
use std::path::Path;

use chrono::Utc;
use uuid::Uuid;

use crate::config::AppConfig;
use crate::db::Database;

/// Run the periodic maintenance tasks (log pruning, undo cleanup, storage enforcement).
/// This runs on the scan_interval_minutes schedule. It does NOT run deletions —
/// deletions are handled by `process_due_deletions` on a daily schedule.
pub fn run_scheduled_cleanup(
    config: &AppConfig,
    db: &Database,
) {
    let now = Utc::now();
    let now_str = now.format("%Y-%m-%d %H:%M:%S").to_string();

    // 1. Prune expired undo entries
    let _ = db.prune_expired_undo(&now_str);

    // 2. Prune old logs based on retention setting
    let retention_days = config.settings.log_retention_days;
    let cutoff = now - chrono::Duration::days(retention_days as i64);
    let cutoff_str = cutoff.format("%Y-%m-%d %H:%M:%S").to_string();
    let _ = db.prune_old_logs(&cutoff_str);

    // 3. Enforce storage size limit
    let max_mb = config.settings.max_storage_mb;
    if max_mb > 0 {
        let max_bytes = (max_mb as u64) * 1024 * 1024;
        match db.enforce_size_limit(max_bytes) {
            Ok(pruned) if pruned > 0 => {
                log::info!("Pruned {} rows to keep DB under {} MB", pruned, max_mb);
            }
            _ => {}
        }
    }

    // 4. Clean up scheduled_deletions for files that no longer exist
    if let Ok(all_scheduled) = db.get_scheduled_deletions() {
        for entry in all_scheduled {
            if !Path::new(&entry.file_path).exists() {
                let _ = db.remove_scheduled_deletion_by_path(&entry.file_path);
            }
        }
    }

    log::info!("Scheduled cleanup completed at {}", now_str);
}

/// Process all due scheduled deletions (where delete_after <= now).
/// Called either by the daily timer or manually by the user via `run_deletions`.
/// Returns the number of files successfully deleted.
pub fn process_due_deletions(db: &Database) -> u32 {
    let now = Utc::now();
    let now_str = now.format("%Y-%m-%d %H:%M:%S").to_string();
    let mut count = 0u32;

    match db.get_due_deletions(&now_str) {
        Ok(due) => {
            for entry in due {
                let path = Path::new(&entry.file_path);
                if path.exists() {
                    let success = safe_delete(path, db, &now_str);
                    // Log the actual deletion to activity_log
                    let _ = db.insert_activity(
                        &Uuid::new_v4().to_string(),
                        &entry.file_path,
                        &entry.file_name,
                        "auto_delete",
                        Some(&entry.rule_name),
                        Some(&entry.folder_id),
                        &now_str,
                        if success { "success" } else { "error" },
                        if success {
                            Some("File sent to Recycle Bin")
                        } else {
                            Some("Failed to delete file")
                        },
                    );
                    if success {
                        count += 1;
                        // Only remove scheduled_deletion if deletion succeeded
                        let _ = db.remove_scheduled_deletion_by_path(&entry.file_path);
                    }
                    // If deletion failed, keep scheduled_deletion for retry
                } else {
                    // File no longer exists, remove scheduled_deletion
                    let _ = db.remove_scheduled_deletion_by_path(&entry.file_path);
                }
            }
        }
        Err(e) => {
            log::error!("Failed to query due deletions: {}", e);
        }
    }

    if count > 0 {
        log::info!("Processed {} due deletions", count);
    }
    count
}

/// Scan all enabled folders for existing files and evaluate rules.
/// This handles files that were added while the app was not running.
/// Delete rules log a "scheduled" activity entry so that "last run" stats update.
/// Move rules execute immediately and log to activity.
/// Returns the number of files processed (matched by any rule).
pub fn scan_existing_files(
    config: &AppConfig,
    db: &Database,
) -> u32 {
    let now_str = Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let mut total_processed = 0u32;

    for folder in &config.folders {
        if !folder.enabled || !folder.path.exists() {
            continue;
        }

        let needs_recursive = folder.watch_subdirectories
            || folder.rules.iter().any(|r| r.match_subdirectories);

        let files = collect_files(&folder.path, needs_recursive);

        for path in files {
            // Catch panics per-file to prevent one bad file from crashing the entire scan
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                crate::rules::evaluate_file_full(&path, folder, db)
            }));

            match result {
                Ok(crate::rules::EvalOutcome::Action(action_result)) => {
                    let _ = db.insert_activity(
                        &Uuid::new_v4().to_string(),
                        &action_result.file_path,
                        &action_result.file_name,
                        &action_result.action,
                        Some(&action_result.rule_name),
                        Some(&folder.id),
                        &now_str,
                        if action_result.success { "success" } else { "error" },
                        action_result.details.as_deref(),
                    );
                    total_processed += 1;
                }
                Ok(crate::rules::EvalOutcome::Scheduled { file_path, file_name, rule_name, newly_inserted }) => {
                    // Only log activity for newly scheduled files (avoid spam on re-scans)
                    if newly_inserted {
                        let _ = db.insert_activity(
                            &Uuid::new_v4().to_string(),
                            &file_path,
                            &file_name,
                            "scheduled",
                            Some(&rule_name),
                            Some(&folder.id),
                            &now_str,
                            "success",
                            Some("File scheduled for deletion"),
                        );
                    }
                    total_processed += 1;
                }
                Ok(crate::rules::EvalOutcome::NoMatch) => {
                    // No rule matched — nothing to do
                }
                Err(e) => {
                    log::error!("Panic while processing file {}: {:?}", path.display(), e);
                }
            }
        }
    }

    log::info!("Folder scan completed ({} files processed)", total_processed);
    total_processed
}

/// Scan a single folder for existing files and evaluate rules.
/// Returns the number of files processed (matched by any rule).
pub fn scan_single_folder(
    config: &AppConfig,
    db: &Database,
    folder_id: &str,
) -> u32 {
    let now_str = Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let mut total_processed = 0u32;

    let folder = match config.folders.iter().find(|f| f.id == folder_id) {
        Some(f) => f,
        None => return 0,
    };

    if !folder.enabled || !folder.path.exists() {
        return 0;
    }

    let needs_recursive = folder.watch_subdirectories
        || folder.rules.iter().any(|r| r.match_subdirectories);

    let files = collect_files(&folder.path, needs_recursive);

    for path in files {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            crate::rules::evaluate_file_full(&path, folder, db)
        }));

        match result {
            Ok(crate::rules::EvalOutcome::Action(action_result)) => {
                let _ = db.insert_activity(
                    &Uuid::new_v4().to_string(),
                    &action_result.file_path,
                    &action_result.file_name,
                    &action_result.action,
                    Some(&action_result.rule_name),
                    Some(&folder.id),
                    &now_str,
                    if action_result.success { "success" } else { "error" },
                    action_result.details.as_deref(),
                );
                total_processed += 1;
            }
            Ok(crate::rules::EvalOutcome::Scheduled { file_path, file_name, rule_name, newly_inserted }) => {
                if newly_inserted {
                    let _ = db.insert_activity(
                        &Uuid::new_v4().to_string(),
                        &file_path,
                        &file_name,
                        "scheduled",
                        Some(&rule_name),
                        Some(&folder.id),
                        &now_str,
                        "success",
                        Some("File scheduled for deletion"),
                    );
                }
                total_processed += 1;
            }
            Ok(crate::rules::EvalOutcome::NoMatch) => {}
            Err(e) => {
                log::error!("Panic while processing file {}: {:?}", path.display(), e);
            }
        }
    }

    log::info!("Single folder scan completed for {} ({} files processed)", folder_id, total_processed);
    total_processed
}

/// Collect all files from a directory, optionally recursing into subdirectories.
/// Handles errors gracefully — skips unreadable directories.
fn collect_files(dir: &Path, recursive: bool) -> Vec<std::path::PathBuf> {
    let mut files = Vec::new();
    collect_files_inner(dir, recursive, &mut files);
    files
}

fn collect_files_inner(dir: &Path, recursive: bool, files: &mut Vec<std::path::PathBuf>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) => {
            log::warn!("Failed to read directory {}: {}", dir.display(), e);
            return;
        }
    };

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        if path.is_file() {
            files.push(path);
        } else if recursive && path.is_dir() {
            collect_files_inner(&path, true, files);
        }
    }
}

/// Safe delete: send file to the OS recycle bin.
/// Returns true on success.
fn safe_delete(file_path: &Path, db: &Database, now_str: &str) -> bool {
    match trash::delete(file_path) {
        Ok(_) => {
            // Undo expires in 7 days (user can restore from Recycle Bin)
            let expires = Utc::now() + chrono::Duration::days(7);
            let _ = db.insert_undo(
                &Uuid::new_v4().to_string(),
                &file_path.to_string_lossy(),
                None, // no staged path — it's in the OS recycle bin
                "auto_delete",
                now_str,
                &expires.format("%Y-%m-%d %H:%M:%S").to_string(),
            );
            true
        }
        Err(e) => {
            log::error!("Failed to recycle {}: {}", file_path.display(), e);
            false
        }
    }
}
