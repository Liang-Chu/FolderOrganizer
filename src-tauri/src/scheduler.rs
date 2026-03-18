use std::fs;
use std::collections::HashSet;
use std::path::Path;

use chrono::Utc;
use uuid::Uuid;

use crate::config::AppConfig;
use crate::db::Database;
use crate::rules::{is_whitelisted, friendly_io_error, friendly_trash_error};

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

/// Process due scheduled actions with optional config validation.
/// Handles both scheduled deletions and scheduled moves.
pub fn process_due_deletions_with_config(
    db: &Database,
    config: Option<&AppConfig>,
) -> u32 {
    let now = Utc::now();
    let now_str = now.format("%Y-%m-%d %H:%M:%S").to_string();
    let mut count = 0u32;
    // Track file paths already consumed by a destructive action in this batch
    let mut consumed_paths: HashSet<String> = HashSet::new();

    match db.get_due_deletions(&now_str) {
        Ok(due) => {
            for entry in due {
                // Skip if this file was already consumed by an earlier destructive action
                if consumed_paths.contains(&entry.file_path) {
                    continue;
                }

                if let Some(cfg) = config {
                    let folder = cfg.folders.iter().find(|f| f.id == entry.folder_id);
                    let should_run = match folder {
                        Some(f) if f.enabled => {
                            // Check folder-level whitelist
                            if is_whitelisted(&entry.file_name, &f.whitelist) {
                                false
                            } else {
                                f.rules.iter().any(|r| {
                                    r.is_enabled()
                                        && r.name == entry.rule_name
                                        // Check rule-level whitelist
                                        && !is_whitelisted(&entry.file_name, &r.whitelist)
                                        && match (&r.action, entry.action_type.as_str()) {
                                            (crate::config::Action::Delete { .. }, "delete") => true,
                                            (crate::config::Action::Move { .. }, "move") => true,
                                            _ => false,
                                        }
                                })
                            }
                        }
                        _ => false,
                    };

                    if !should_run {
                        let _ = db.cancel_scheduled_deletion(&entry.id);
                        continue;
                    }
                }

                let path = Path::new(&entry.file_path);
                if !path.exists() {
                    // File is gone — remove ALL scheduled entries for this path
                    let _ = db.remove_scheduled_deletion_by_path(&entry.file_path);
                    consumed_paths.insert(entry.file_path.clone());
                    continue;
                }

                let is_move = entry.action_type == "move";
                let result = if is_move {
                    execute_scheduled_move(path, &entry, db, &now_str)
                } else {
                    safe_delete(path, db, &now_str, "auto_delete")
                };
                let success = result.is_ok();

                let action_label = if is_move {
                    if entry.keep_source { "auto_copy" } else { "auto_move" }
                } else {
                    "auto_delete"
                };
                let detail = if is_move {
                    let verb = if entry.keep_source { "copied" } else { "moved" };
                    match &result {
                        Ok(_) => format!("File {} to {}", verb, entry.move_destination.as_deref().unwrap_or("?")),
                        Err(err) => format!("Failed to {} file: {}", if entry.keep_source { "copy" } else { "move" }, err),
                    }
                } else {
                    match &result {
                        Ok(_) => "File sent to Recycle Bin".to_string(),
                        Err(err) => format!("Failed to delete file: {}", err),
                    }
                };

                let _ = db.insert_activity(
                    &Uuid::new_v4().to_string(),
                    &entry.file_path,
                    &entry.file_name,
                    action_label,
                    Some(&entry.rule_name),
                    Some(&entry.folder_id),
                    &now_str,
                    if success { "success" } else { "error" },
                    Some(&detail),
                );
                if success {
                    count += 1;
                    if is_move && entry.keep_source {
                        // Copy mode: only remove this specific entry — other rules' entries survive
                        let _ = db.cancel_scheduled_deletion(&entry.id);
                    } else {
                        // Destructive action (delete or cut-move): file is gone, remove all entries
                        let _ = db.remove_scheduled_deletion_by_path(&entry.file_path);
                        consumed_paths.insert(entry.file_path.clone());
                    }
                }
            }
        }
        Err(e) => {
            log::error!("Failed to query due scheduled actions: {}", e);
        }
    }

    if count > 0 {
        log::info!("Processed {} due scheduled actions", count);
    }
    count
}

/// Execute a scheduled move action.
/// Returns Ok on success, Err with a human-readable message on failure.
fn execute_scheduled_move(
    file_path: &Path,
    entry: &crate::db::ScheduledDeletion,
    db: &Database,
    now_str: &str,
) -> Result<(), String> {
    let destination_str = match &entry.move_destination {
        Some(d) => d.clone(),
        None => {
            log::error!("Scheduled move for {} has no destination", entry.file_path);
            return Err("No destination configured".to_string());
        }
    };
    let destination = Path::new(&destination_str);
    if let Err(e) = fs::create_dir_all(destination) {
        log::error!("Failed to create destination {}: {}", destination.display(), e);
        return Err(format!("Failed to create destination: {}", friendly_io_error(&e)));
    }

    let file_name = file_path.file_name().unwrap_or_default();
    let dest_file = destination.join(file_name);
    let final_dest = if dest_file.exists() {
        let stem = file_path.file_stem().unwrap_or_default().to_string_lossy();
        let ext_str = if file_path.is_file() {
            file_path.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default()
        } else {
            String::new()
        };
        let mut counter = 1;
        loop {
            let candidate = destination.join(format!("{} ({}){}", stem, counter, ext_str));
            if !candidate.exists() {
                break candidate;
            }
            counter += 1;
        }
    } else {
        dest_file
    };

    let keep_source = entry.keep_source;
    let undo_action = if keep_source { "auto_copy" } else { "auto_move" };

    // Copy mode: always copy, never remove source
    if keep_source {
        let copy_result = if file_path.is_dir() {
            crate::rules::copy_dir_recursive(file_path, &final_dest).map(|_| ())
        } else {
            fs::copy(file_path, &final_dest).map(|_| ())
        };
        return match copy_result {
            Ok(_) => {
                let expires = Utc::now() + chrono::Duration::days(7);
                let _ = db.insert_undo(
                    &Uuid::new_v4().to_string(),
                    &file_path.to_string_lossy(),
                    Some(&final_dest.to_string_lossy()),
                    undo_action,
                    now_str,
                    &expires.format("%Y-%m-%d %H:%M:%S").to_string(),
                );
                Ok(())
            }
            Err(e) => {
                log::error!("Failed to copy {}: {}", file_path.display(), e);
                Err(format!("Copy failed: {}", friendly_io_error(&e)))
            }
        };
    }

    // Cut mode: try rename first, fallback to copy + delete
    match fs::rename(file_path, &final_dest) {
        Ok(_) => {
            let expires = Utc::now() + chrono::Duration::days(7);
            let _ = db.insert_undo(
                &Uuid::new_v4().to_string(),
                &file_path.to_string_lossy(),
                Some(&final_dest.to_string_lossy()),
                undo_action,
                now_str,
                &expires.format("%Y-%m-%d %H:%M:%S").to_string(),
            );
            Ok(())
        }
        Err(_) => {
            if file_path.is_dir() {
                match crate::rules::copy_dir_recursive(file_path, &final_dest) {
                    Ok(_) => {
                        if let Err(rm_err) = fs::remove_dir_all(file_path) {
                            log::warn!("Copied dir to {} but failed to remove source: {}", final_dest.display(), rm_err);
                        }
                        let expires = Utc::now() + chrono::Duration::days(7);
                        let _ = db.insert_undo(
                            &Uuid::new_v4().to_string(),
                            &file_path.to_string_lossy(),
                            Some(&final_dest.to_string_lossy()),
                            undo_action,
                            now_str,
                            &expires.format("%Y-%m-%d %H:%M:%S").to_string(),
                        );
                        Ok(())
                    }
                    Err(e) => {
                        log::error!("Failed to move dir {}: {}", file_path.display(), e);
                        Err(format!("Move failed: {}", friendly_io_error(&e)))
                    }
                }
            } else {
                // Cross-device: try copy + delete
                match fs::copy(file_path, &final_dest) {
                    Ok(_) => {
                        if let Err(rm_err) = fs::remove_file(file_path) {
                            log::warn!("Copied file to {} but failed to remove source: {}", final_dest.display(), rm_err);
                        }
                        let expires = Utc::now() + chrono::Duration::days(7);
                        let _ = db.insert_undo(
                            &Uuid::new_v4().to_string(),
                            &file_path.to_string_lossy(),
                            Some(&final_dest.to_string_lossy()),
                            undo_action,
                            now_str,
                            &expires.format("%Y-%m-%d %H:%M:%S").to_string(),
                        );
                        Ok(())
                    }
                    Err(e) => {
                        log::error!("Failed to move {}: {}", file_path.display(), e);
                        Err(format!("Move failed: {}", friendly_io_error(&e)))
                    }
                }
            }
        }
    }
}

/// Immediately process selected scheduled actions by IDs (ignores due date).
/// Handles both deletions and moves. Returns the number of files successfully processed.
pub fn process_selected_deletions_now(
    db: &Database,
    deletion_ids: &[String],
) -> u32 {
    if deletion_ids.is_empty() {
        return 0;
    }

    let selected: HashSet<&str> = deletion_ids.iter().map(String::as_str).collect();
    let now = Utc::now();
    let now_str = now.format("%Y-%m-%d %H:%M:%S").to_string();
    let mut count = 0u32;

    match db.get_scheduled_deletions() {
        Ok(all) => {
            for entry in all.into_iter().filter(|e| selected.contains(e.id.as_str())) {
                let path = Path::new(&entry.file_path);
                let is_move = entry.action_type == "move";

                if path.exists() {
                    let result = if is_move {
                        execute_scheduled_move(path, &entry, db, &now_str)
                    } else {
                        safe_delete(path, db, &now_str, "manual_delete_now")
                    };
                    let success = result.is_ok();

                    let action_label = if is_move {
                        if entry.keep_source { "manual_copy_now" } else { "manual_move_now" }
                    } else {
                        "manual_delete_now"
                    };
                    let detail = if is_move {
                        let verb = if entry.keep_source { "copied" } else { "moved" };
                        match &result {
                            Ok(_) => format!("File {} to {}", verb, entry.move_destination.as_deref().unwrap_or("?")),
                            Err(err) => format!("Failed to {} file: {}", if entry.keep_source { "copy" } else { "move" }, err),
                        }
                    } else {
                        match &result {
                            Ok(_) => "File deleted immediately from scheduled list".to_string(),
                            Err(err) => format!("Failed to delete file: {}", err),
                        }
                    };

                    let _ = db.insert_activity(
                        &Uuid::new_v4().to_string(),
                        &entry.file_path,
                        &entry.file_name,
                        action_label,
                        Some(&entry.rule_name),
                        Some(&entry.folder_id),
                        &now_str,
                        if success { "success" } else { "error" },
                        Some(&detail),
                    );

                    if success {
                        count += 1;
                        let _ = db.remove_scheduled_deletion_by_path(&entry.file_path);
                    }
                } else {
                    let _ = db.remove_scheduled_deletion_by_path(&entry.file_path);
                    let _ = db.insert_activity(
                        &Uuid::new_v4().to_string(),
                        &entry.file_path,
                        &entry.file_name,
                        if is_move { "manual_move_now" } else { "manual_delete_now" },
                        Some(&entry.rule_name),
                        Some(&entry.folder_id),
                        &now_str,
                        "error",
                        Some("File no longer exists; removed from scheduled list"),
                    );
                }
            }
        }
        Err(e) => {
            log::error!("Failed to query scheduled deletions: {}", e);
        }
    }

    if count > 0 {
        log::info!("Processed {} immediate selected actions", count);
    }
    count
}

/// Scan all enabled folders for existing files and evaluate rules.
/// This handles files that were added while the app was not running.
/// Scheduled actions (delete/move with delay) log a "scheduled" activity entry.
/// Immediate actions (move without delay) execute and log to activity.
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
                Ok(crate::rules::EvalOutcome::Scheduled { file_path, file_name, rule_name, newly_inserted, action_type, details }) => {
                    // Only log activity for newly scheduled files (avoid spam on re-scans)
                    if newly_inserted {
                        let base = if action_type.contains("move") {
                            "File scheduled for move"
                        } else {
                            "File scheduled for deletion"
                        };
                        let detail = match details {
                            Some(ref d) => format!("{} {}", base, d),
                            None => base.to_string(),
                        };
                        let _ = db.insert_activity(
                            &Uuid::new_v4().to_string(),
                            &file_path,
                            &file_name,
                            "scheduled",
                            Some(&rule_name),
                            Some(&folder.id),
                            &now_str,
                            "success",
                            Some(&detail),
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

    // Clean up scheduled entries for files that no longer exist
    for folder in &config.folders {
        if !folder.enabled {
            continue;
        }
        let removed = db.cleanup_missing_files_for_folder(&folder.id);
        if removed > 0 {
            log::info!("Cleaned up {} stale scheduled entries for folder {}", removed, folder.path.display());
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
            Ok(crate::rules::EvalOutcome::Scheduled { file_path, file_name, rule_name, newly_inserted, action_type, details }) => {
                if newly_inserted {
                    let base = if action_type.contains("move") {
                        "File scheduled for move"
                    } else {
                        "File scheduled for deletion"
                    };
                    let detail = match details {
                        Some(ref d) => format!("{} {}", base, d),
                        None => base.to_string(),
                    };
                    let _ = db.insert_activity(
                        &Uuid::new_v4().to_string(),
                        &file_path,
                        &file_name,
                        "scheduled",
                        Some(&rule_name),
                        Some(&folder.id),
                        &now_str,
                        "success",
                        Some(&detail),
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

    // Clean up scheduled entries for files that no longer exist in this folder
    let removed = db.cleanup_missing_files_for_folder(&folder.id);
    if removed > 0 {
        log::info!("Cleaned up {} stale scheduled entries for folder {}", removed, folder.path.display());
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
        } else if path.is_dir() {
            // Always include child directories as entries so folder-name rules can match them
            files.push(path.clone());
            if recursive {
                collect_files_inner(&path, true, files);
            }
        }
    }
}

/// Safe delete: send file to the OS recycle bin.
/// Returns Ok on success, Err with a human-readable message on failure.
fn safe_delete(file_path: &Path, db: &Database, now_str: &str, undo_action: &str) -> Result<(), String> {
    match trash::delete(file_path) {
        Ok(_) => {
            // Undo expires in 7 days (user can restore from Recycle Bin)
            let expires = Utc::now() + chrono::Duration::days(7);
            let _ = db.insert_undo(
                &Uuid::new_v4().to_string(),
                &file_path.to_string_lossy(),
                None, // no staged path — it's in the OS recycle bin
                undo_action,
                now_str,
                &expires.format("%Y-%m-%d %H:%M:%S").to_string(),
            );
            Ok(())
        }
        Err(e) => {
            log::error!("Failed to recycle {}: {}", file_path.display(), e);
            Err(format!("Recycle failed: {}", friendly_trash_error(&e)))
        }
    }
}
