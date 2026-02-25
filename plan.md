# Download Organizer

## Goal
Desktop app that monitors user-configured folders (e.g. Downloads), and auto-handles files based on rules:
1. **Auto-delete** after a configured time period
2. **Auto-move** based on rules (filename keyword, file extension, regex pattern)
3. **Ignore** — leave file untouched

## Tech Stack
- **Rust** — core logic + backend
- **Tauri v2** — lightweight desktop shell (uses OS WebView, no Chromium)
- **React + TypeScript** — frontend UI
- **Tailwind CSS** — styling
- **notify** crate — OS-native file system watcher
- **serde + serde_json** — config serialization (settings → JSON file)
- **rusqlite** — SQLite for activity log, file index, undo history (all local, user owns the data)
- **chrono** — time handling for auto-delete
- **dirs** crate — default folder paths

## Architecture
```
┌─────────────────────────────────────┐
│           Tauri Shell               │
│  ┌───────────┐  ┌────────────────┐  │
│  │  React UI │  │  Rust Backend  │  │
│  │  - Config  │  │  - FileWatcher │  │
│  │  - Rules   │  │  - RuleEngine  │  │
│  │  - Logs    │  │  - Scheduler   │  │
│  └───────────┘  │  - ConfigMgr   │  │
│                 └────────────────┘  │
│           System Tray               │
└─────────────────────────────────────┘

Storage (all in %APPDATA%/download-organizer/):
  config.json  ← settings & rules (human-readable, editable)
  data.db      ← SQLite: activity_log, file_index, undo_history
```

## Data Storage Strategy
- **JSON** (`config.json`) for settings & rules — transparent, user can inspect/edit
- **SQLite** (`data.db`) for:
  - `activity_log` — file actions history (queryable, filterable)
  - `file_index` — tracked files with metadata, timestamps, pending actions
  - `undo_history` — recycle bin tracking for safe delete recovery
- All data 100% local, no cloud, no telemetry
- User can backup/delete both files freely
- SQLite is ACID-compliant (no corruption on crash)

## Detailed Plan

### Phase 1: Project Setup
- [x] Evaluate tech stack
- [ ] Init Tauri v2 project with React + TS frontend
- [ ] Configure Cargo.toml with dependencies: `notify`, `serde`, `serde_json`, `rusqlite`, `chrono`, `dirs`, `log`, `env_logger`
- [ ] Setup Tailwind CSS in frontend

### Phase 2: Core Backend (Rust)
- [ ] **Config module** (`src-tauri/src/config.rs`)
  - `AppConfig` struct: list of `WatchedFolder`
  - `WatchedFolder`: path, enabled, list of `Rule`
  - `Rule` enum variants:
    - `AutoDelete { after_days: u32 }`
    - `MoveByExtension { extensions: Vec<String>, destination: PathBuf }`
    - `MoveByKeyword { keywords: Vec<String>, destination: PathBuf }`
    - `MoveByRegex { pattern: String, destination: PathBuf }`
    - `Ignore`
  - Load/save config from `%APPDATA%/download-organizer/config.json`

- [ ] **Database module** (`src-tauri/src/db.rs`)
  - Init SQLite at `%APPDATA%/download-organizer/data.db`
  - Create tables: `activity_log`, `file_index`, `undo_history`
  - `activity_log`: id, file_path, action, rule_name, timestamp, result
  - `file_index`: id, file_path, folder_id, first_seen, size, pending_action, scheduled_at
  - `undo_history`: id, original_path, recycle_path, action, timestamp, expires_at
  - CRUD helpers for each table
  - Auto-prune old log entries (configurable retention)

- [ ] **File watcher module** (`src-tauri/src/watcher.rs`)
  - Use `notify` crate to watch configured folders
  - On new/modified file → pass to rule engine
  - Debounce events (files still downloading)

- [ ] **Rule engine** (`src-tauri/src/rules.rs`)
  - Match file against rules in priority order
  - Execute action: delete / move / ignore
  - Return action result for logging

- [ ] **Scheduler** (`src-tauri/src/scheduler.rs`)
  - Periodic scan for auto-delete (check file age vs rule threshold)
  - Run every N minutes (configurable)

- [ ] **Tauri commands** (`src-tauri/src/commands.rs`)
  - `get_config` / `save_config`
  - `get_watched_folders` / `add_watched_folder` / `remove_watched_folder`
  - `get_rules` / `add_rule` / `update_rule` / `delete_rule`
  - `get_activity_log` (with pagination + filters from SQLite)
  - `get_pending_actions` — files scheduled for delete/move
  - `undo_action` — restore from recycle/undo history
  - `scan_now` — manual trigger
  - `pick_folder` — native folder dialog

### Phase 3: Frontend (React + TS)
- [ ] **Layout**: sidebar nav + main content area
- [ ] **Dashboard page**: overview of watched folders, recent activity
- [ ] **Folders page**: add/remove/toggle watched folders
- [ ] **Rules page**: CRUD rules per folder, drag to reorder priority
- [ ] **Activity log page**: table of recent actions (file, action, time, result)
- [ ] **Settings page**: scan interval, startup with OS, minimize to tray

### Phase 4: System Tray & Polish
- [ ] System tray icon with context menu (show/hide, pause, quit)
- [ ] Auto-start with Windows (registry or startup folder)
- [ ] Minimize to tray on close
- [ ] Toast notifications on file actions (optional)

### Phase 5: Safety & Edge Cases
- [ ] Confirmation/undo for destructive actions (delete moves to recycle bin first)
- [ ] Skip locked/in-use files (retry later)
- [ ] Handle permission errors gracefully
- [ ] Debounce for files still being written/downloaded
- [ ] Max file size limit for moves (optional)
- [ ] Dry-run mode for testing rules