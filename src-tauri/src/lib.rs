mod commands;
mod condition;
mod config;
mod db;
mod rules;
mod scheduler;
mod watcher;

use std::sync::{Arc, Mutex};

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    let app_config = config::load_config();
    let database =
        db::Database::new().expect("Failed to initialize database");

    let config_arc = Arc::new(Mutex::new(app_config.clone()));
    let db_arc = Arc::new(database);

    let mut file_watcher = watcher::FileWatcher::new();
    // Start watching folders on launch
    if let Err(e) = file_watcher.start(&app_config, db_arc.clone(), config_arc.clone()) {
        log::warn!("Failed to start file watcher on launch: {}", e);
    }

    // Run initial scan for files added while app was closed
    scheduler::scan_existing_files(&app_config, &db_arc);

    let state = AppState {
        config: config_arc.clone(),
        db: db_arc.clone(),
        watcher: Arc::new(Mutex::new(file_watcher)),
    };

    // Start periodic scheduler in background
    let scheduler_config = config_arc.clone();
    let scheduler_db = db_arc.clone();
    std::thread::spawn(move || {
        loop {
            let interval = {
                let cfg = scheduler_config.lock().unwrap();
                cfg.settings.scan_interval_minutes
            };
            std::thread::sleep(std::time::Duration::from_secs(
                (interval as u64) * 60,
            ));
            let cfg = scheduler_config.lock().unwrap();
            scheduler::run_scheduled_cleanup(&cfg, &scheduler_db);
        }
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_config_cmd,
            commands::export_config,
            commands::import_config,
            commands::get_config_path,
            commands::get_watched_folders,
            commands::add_watched_folder,
            commands::remove_watched_folder,
            commands::toggle_watched_folder,
            commands::get_folder_whitelist,
            commands::set_folder_whitelist,
            commands::get_rules,
            commands::add_rule,
            commands::update_rule,
            commands::delete_rule,
            commands::get_rule_metadata,
            commands::reorder_rules,
            commands::get_activity_log,
            commands::get_pending_actions,
            commands::get_undo_entries,
            commands::undo_action,
            commands::scan_now,
            commands::ensure_dir,
            commands::open_in_explorer,
            commands::restart_watcher,
            commands::stop_watcher,
            commands::get_watcher_status,
            commands::parse_condition_text,
            commands::condition_to_text,
            commands::validate_condition_text,
            commands::test_condition,
            commands::get_db_stats,
            commands::query_db_table,
            commands::clear_db_table,
            commands::enforce_storage_limit,
            commands::get_db_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
