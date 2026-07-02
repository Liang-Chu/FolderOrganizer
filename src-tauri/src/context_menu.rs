//! Windows Explorer right-click context menu registration.
//!
//! Writes per-user (HKCU) keys so folders and folder backgrounds get a
//! "Watch with Folder Organizer" entry. Managed by the app rather than the
//! installer so it works for both MSI and NSIS installs, survives updates,
//! and always points at the current executable. On Windows 11 the entry
//! appears under "Show more options" (classic menu).

use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;

const MENU_KEYS: [&str; 2] = [
    r"Software\Classes\Directory\shell\FolderOrganizer",
    r"Software\Classes\Directory\Background\shell\FolderOrganizer",
];

/// Bring the registry into line with the desired state. Idempotent.
pub fn sync(enabled: bool) -> Result<(), String> {
    if enabled {
        register()
    } else {
        unregister()
    }
}

fn register() -> Result<(), String> {
    let exe = std::env::current_exe()
        .map_err(|e| format!("Failed to resolve executable path: {}", e))?;
    let exe = exe.to_string_lossy();
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    for key_path in MENU_KEYS {
        let (key, _) = hkcu
            .create_subkey(key_path)
            .map_err(|e| format!("Failed to create registry key: {}", e))?;
        key.set_value("", &"Watch with Folder Organizer")
            .map_err(|e| format!("Failed to set menu label: {}", e))?;
        key.set_value("Icon", &format!("{},0", exe))
            .map_err(|e| format!("Failed to set menu icon: {}", e))?;
        let (cmd, _) = hkcu
            .create_subkey(format!(r"{}\command", key_path))
            .map_err(|e| format!("Failed to create command key: {}", e))?;
        // %V expands to the clicked folder (works for both Directory and Background)
        cmd.set_value("", &format!("\"{}\" --watch-folder \"%V\"", exe))
            .map_err(|e| format!("Failed to set command: {}", e))?;
    }
    Ok(())
}

fn unregister() -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    for key_path in MENU_KEYS {
        match hkcu.delete_subkey_all(key_path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("Failed to delete registry key: {}", e)),
        }
    }
    Ok(())
}
