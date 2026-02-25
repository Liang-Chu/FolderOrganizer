use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// Get the app data directory: %APPDATA%/download-organizer/
pub fn app_data_dir() -> PathBuf {
    let dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("download-organizer");
    fs::create_dir_all(&dir).ok();
    dir
}

fn config_path() -> PathBuf {
    app_data_dir().join("config.json")
}

// ── Data types ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub folders: Vec<WatchedFolder>,
    pub settings: AppSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    /// Minutes between periodic scans
    pub scan_interval_minutes: u32,
    /// Start app with Windows
    pub start_with_os: bool,
    /// Minimize to tray on close
    pub minimize_to_tray: bool,
    /// Show toast notifications on actions
    pub notifications_enabled: bool,
    /// Days to keep activity log entries
    pub log_retention_days: u32,
    /// Maximum database size in MB (0 = unlimited)
    #[serde(default = "default_max_storage_mb")]
    pub max_storage_mb: u32,
    /// Default root directory for sorted files (Move destinations are relative to this)
    #[serde(default = "default_sort_root")]
    pub default_sort_root: PathBuf,
}

fn default_sort_root() -> PathBuf {
    PathBuf::from(r"D:\sorted")
}

fn default_max_storage_mb() -> u32 {
    2048
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            scan_interval_minutes: 5,
            start_with_os: false,
            minimize_to_tray: true,
            notifications_enabled: true,
            log_retention_days: 30,
            max_storage_mb: default_max_storage_mb(),
            default_sort_root: default_sort_root(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchedFolder {
    pub id: String,
    pub path: PathBuf,
    pub enabled: bool,
    pub rules: Vec<Rule>,
}

// ── Composable Rule System ──────────────────────────────────

/// A rule combines a condition tree with an action.
/// Conditions are composable with AND/OR/NOT.
/// The `condition_text` field stores the human-readable wildcard syntax.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rule {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub enabled: bool,
    pub condition: Condition,
    /// Human-readable text form: `*.pdf AND *invoice*`
    /// Kept in sync with `condition` — either can be the source of truth.
    #[serde(default)]
    pub condition_text: String,
    pub action: Action,
}

impl Rule {
    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled
    }
}

/// Condition tree — composable file matchers.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum Condition {
    /// Glob/wildcard pattern: `*.pdf`, `invoice*`, `*report*`
    /// Uses `*` (any chars) and `?` (single char). Case-insensitive.
    Glob { pattern: String },
    /// Regex pattern for power users: `^IMG_\d+\.jpg$`
    Regex { pattern: String },
    /// All sub-conditions must match
    And { conditions: Vec<Condition> },
    /// Any sub-condition must match
    Or { conditions: Vec<Condition> },
    /// Negates the inner condition
    Not { condition: Box<Condition> },
    /// Always matches (used as default / catch-all)
    Always,
}

/// What to do when the condition matches.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum Action {
    /// Move file to destination folder
    Move { destination: PathBuf },
    /// Schedule file for deletion after N days (0 = immediate on next scan)
    Delete { after_days: u32 },
    /// Do nothing — skip this file
    Ignore,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            folders: Vec::new(),
            settings: AppSettings::default(),
        }
    }
}

// ── Load / Save ─────────────────────────────────────────────

pub fn load_config() -> AppConfig {
    let path = config_path();
    if path.exists() {
        let data = fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        let config = AppConfig::default();
        save_config(&config).ok();
        config
    }
}

pub fn save_config(config: &AppConfig) -> Result<(), String> {
    let path = config_path();
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}
