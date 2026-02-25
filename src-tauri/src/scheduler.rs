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
                            Some("File moved to trash staging (recoverable for 7 days)")
                        } else {
                            Some("Failed to delete file")
                        },
                    );
                    if success {
                        count += 1;
                    }
                }
                // Remove from scheduled_deletions regardless (file gone or acted upon)
                let _ = db.remove_scheduled_deletion_by_path(&entry.file_path);
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
/// Delete rules silently schedule files (no activity log spam).
/// Move rules execute immediately and log to activity.
pub fn scan_existing_files(
    config: &AppConfig,
    db: &Database,
) {
    let now_str = Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    for folder in &config.folders {
        if !folder.enabled || !folder.path.exists() {
            continue;
        }

        if let Ok(entries) = fs::read_dir(&folder.path) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }

                // evaluate_file now returns None for Delete rules (they silently schedule).
                // It only returns Some for Move rules that actually execute.
                if let Some(result) = crate::rules::evaluate_file(&path, folder, db) {
                    let _ = db.insert_activity(
                        &Uuid::new_v4().to_string(),
                        &result.file_path,
                        &result.file_name,
                        &result.action,
                        Some(&result.rule_name),
                        Some(&folder.id),
                        &now_str,
                        if result.success { "success" } else { "error" },
                        result.details.as_deref(),
                    );
                }
            }
        }
    }

    log::info!("Folder scan completed");
}

/// Safe delete: move file to a staging dir so it can be undone.
/// Returns true on success.
fn safe_delete(file_path: &Path, db: &Database, now_str: &str) -> bool {
    let staging_dir = crate::config::app_data_dir().join("trash_staging");
    if fs::create_dir_all(&staging_dir).is_err() {
        return false;
    }

    let file_name = file_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let staged_name = format!("{}_{}", Uuid::new_v4(), file_name);
    let staged_path = staging_dir.join(&staged_name);

    match fs::rename(file_path, &staged_path) {
        Ok(_) => {
            // Undo expires in 7 days
            let expires = Utc::now() + chrono::Duration::days(7);
            let _ = db.insert_undo(
                &Uuid::new_v4().to_string(),
                &file_path.to_string_lossy(),
                Some(&staged_path.to_string_lossy()),
                "auto_delete",
                now_str,
                &expires.format("%Y-%m-%d %H:%M:%S").to_string(),
            );
            true
        }
        Err(e) => {
            log::error!("Failed to stage-delete {}: {}", file_path.display(), e);
            false
        }
    }
}
