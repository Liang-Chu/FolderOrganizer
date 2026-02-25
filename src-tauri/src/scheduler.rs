use std::fs;
use std::path::Path;

use chrono::Utc;
use uuid::Uuid;

use crate::config::AppConfig;
use crate::db::Database;

/// Run a periodic scan: check for files scheduled for auto-delete.
pub fn run_scheduled_cleanup(
    config: &AppConfig,
    db: &Database,
) {
    let now = Utc::now();
    let now_str = now.format("%Y-%m-%d %H:%M:%S").to_string();

    // 1. Process pending auto-delete files whose scheduled_at has passed
    if let Ok(pending) = db.get_pending_files() {
        for entry in pending {
            if entry.pending_action.as_deref() == Some("auto_delete") {
                if let Some(ref scheduled) = entry.scheduled_at {
                    if scheduled.as_str() <= now_str.as_str() {
                        let path = Path::new(&entry.file_path);
                        if path.exists() {
                            // Move to a trash staging area instead of hard-deleting
                            let result = safe_delete(path, db, &now_str);
                            let _ = db.insert_activity(
                                &Uuid::new_v4().to_string(),
                                &entry.file_path,
                                &entry.file_name,
                                "auto_delete",
                                None,
                                Some(&entry.folder_id),
                                &now_str,
                                if result { "success" } else { "error" },
                                None,
                            );
                        }
                        // Remove from file index regardless (file gone or acted upon)
                        let _ = db.remove_file_by_path(&entry.file_path);
                    }
                }
            }
        }
    }

    // 2. Prune expired undo entries
    let _ = db.prune_expired_undo(&now_str);

    // 3. Prune old logs based on retention setting
    let retention_days = config.settings.log_retention_days;
    let cutoff = now - chrono::Duration::days(retention_days as i64);
    let cutoff_str = cutoff.format("%Y-%m-%d %H:%M:%S").to_string();
    let _ = db.prune_old_logs(&cutoff_str);

    // 4. Enforce storage size limit
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

    log::info!("Scheduled cleanup completed at {}", now_str);
}

/// Scan all enabled folders for existing files and index them.
/// This handles files that were added while the app was not running.
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

                let _file_name = path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                let _extension = path
                    .extension()
                    .map(|e| e.to_string_lossy().to_string());
                let _size = fs::metadata(&path).ok().map(|m| m.len() as i64);

                // Evaluate against rules
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

    log::info!("Initial folder scan completed");
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
