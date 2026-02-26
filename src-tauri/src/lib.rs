mod commands;
mod condition;
mod config;
mod db;
mod rules;
mod scheduler;
mod watcher;

use std::sync::{Arc, Mutex};

use chrono::Timelike;
use commands::AppState;
use tauri::Manager;

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

    // Start periodic scheduler in background (maintenance + daily deletion check)
    let scheduler_config = config_arc.clone();
    let scheduler_db = db_arc.clone();
    std::thread::spawn(move || {
        let mut last_deletion_day: Option<u32> = None;
        loop {
            let (interval, deletion_hour) = {
                let cfg = scheduler_config.lock().unwrap();
                // Enforce minimum 1 minute interval
                (cfg.settings.scan_interval_minutes.max(1), cfg.settings.deletion_time_hour)
            };
            std::thread::sleep(std::time::Duration::from_secs(
                (interval as u64) * 60,
            ));

            // Run maintenance (log pruning, undo cleanup, storage enforcement)
            {
                let cfg = scheduler_config.lock().unwrap();
                scheduler::run_scheduled_cleanup(&cfg, &scheduler_db);
            }

            // Check if it's time to run daily deletions
            let now = chrono::Local::now();
            let today = now.format("%j").to_string().parse::<u32>().unwrap_or(0); // day of year
            let current_hour = now.hour();

            if current_hour >= deletion_hour && last_deletion_day != Some(today) {
                log::info!("Running daily scheduled deletions (hour: {}, configured: {})", current_hour, deletion_hour);
                scheduler::process_due_deletions(&scheduler_db);
                last_deletion_day = Some(today);
            }
        }
    });

    let tray_config = config_arc.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
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
            commands::toggle_watch_subdirectories,
            commands::get_folder_whitelist,
            commands::set_folder_whitelist,
            commands::get_rules,
            commands::add_rule,
            commands::update_rule,
            commands::delete_rule,
            commands::get_rule_metadata,
            commands::reorder_rules,
            commands::copy_rules_to_folder,
            commands::get_activity_log,
            commands::get_pending_actions,
            commands::get_undo_entries,
            commands::undo_action,
            commands::get_scheduled_deletions,
            commands::cancel_scheduled_deletion,
            commands::run_deletions,
            commands::get_rule_execution_stats,
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
        .setup(move |app| {
            // ── System tray ──
            let show_i = tauri::menu::MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let quit_i = tauri::menu::MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let tray_menu = tauri::menu::MenuBuilder::new(app)
                .item(&show_i)
                .separator()
                .item(&quit_i)
                .build()?;

            let _tray = tauri::tray::TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().unwrap())
                .menu(&tray_menu)
                .tooltip("Folder Organizer")
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { .. } = event {
                        if let Some(w) = tray.app_handle().get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                    }
                })
                .on_menu_event(|app_handle, event| {
                    match event.id.as_ref() {
                        "show" => {
                            if let Some(w) = app_handle.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                        "quit" => {
                            app_handle.exit(0);
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            // ── Minimize-to-tray: intercept window close ──
            let cfg_for_close = tray_config.clone();
            if let Some(window) = app.get_webview_window("main") {
                let win_handle = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        let should_minimize = {
                            cfg_for_close.lock().map(|c| c.settings.minimize_to_tray).unwrap_or(false)
                        };
                        if should_minimize {
                            api.prevent_close();
                            let _ = win_handle.hide();
                        }
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
