use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};

use crate::config::AppConfig;
use crate::db::Database;
use crate::rules;

pub struct FileWatcher {
    debouncer: Option<notify_debouncer_mini::Debouncer<RecommendedWatcher>>,
}

impl FileWatcher {
    pub fn new() -> Self {
        Self { debouncer: None }
    }

    /// Start watching all enabled folders from config.
    /// Calls `on_file` callback for each new/modified file (debounced).
    pub fn start(
        &mut self,
        config: &AppConfig,
        db: Arc<Database>,
        config_arc: Arc<Mutex<AppConfig>>,
    ) -> Result<(), String> {
        // Stop previous watcher if running
        self.stop();

        let db_clone = db.clone();
        let config_for_callback = config_arc.clone();

        let mut debouncer = new_debouncer(
            Duration::from_secs(3), // 3s debounce — wait for downloads to finish
            move |events: Result<Vec<notify_debouncer_mini::DebouncedEvent>, notify::Error>| {
                if let Ok(events) = events {
                    let cfg = config_for_callback.lock().unwrap();
                    for event in events {
                        if event.kind == DebouncedEventKind::Any {
                            let path = &event.path;
                            // Only process files, not directories
                            if path.is_file() {
                                handle_file_event(path, &cfg, &db_clone);
                            }
                        }
                    }
                }
            },
        )
        .map_err(|e| format!("Failed to create file watcher: {}", e))?;

        for folder in &config.folders {
            if folder.enabled && folder.path.exists() {
                debouncer
                    .watcher()
                    .watch(&folder.path, RecursiveMode::NonRecursive)
                    .map_err(|e| {
                        format!("Failed to watch {}: {}", folder.path.display(), e)
                    })?;
                log::info!("Watching: {}", folder.path.display());
            }
        }

        self.debouncer = Some(debouncer);
        Ok(())
    }

    pub fn stop(&mut self) {
        self.debouncer = None;
        log::info!("File watcher stopped");
    }

    pub fn is_running(&self) -> bool {
        self.debouncer.is_some()
    }
}

fn handle_file_event(
    file_path: &std::path::Path,
    config: &AppConfig,
    db: &Database,
) {
    // Find which watched folder this file belongs to
    let folder = config.folders.iter().find(|f| {
        f.enabled
            && file_path
                .parent()
                .map(|p| p == f.path)
                .unwrap_or(false)
    });

    if let Some(folder) = folder {
        if let Some(result) = rules::evaluate_file(file_path, folder, db) {
            let now = chrono::Utc::now()
                .format("%Y-%m-%d %H:%M:%S")
                .to_string();
            let id = uuid::Uuid::new_v4().to_string();

            let _ = db.insert_activity(
                &id,
                &result.file_path,
                &result.file_name,
                &result.action,
                Some(&result.rule_name),
                Some(&folder.id),
                &now,
                if result.success { "success" } else { "error" },
                result.details.as_deref(),
            );

            log::info!(
                "[{}] {} → {} ({})",
                if result.success { "OK" } else { "ERR" },
                result.file_name,
                result.action,
                result.rule_name
            );
        }
    }
}
