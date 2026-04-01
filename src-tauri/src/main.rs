// Prevents an additional console window on Windows (debug + release).
#![cfg_attr(windows, windows_subsystem = "windows")]

fn main() {
    folder_organizer_lib::run()
}
