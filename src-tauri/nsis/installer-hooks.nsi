; Folder Organizer — NSIS installer hooks

!macro CUSTOM_INSTALL
  ; Context-menu registration is managed by the app itself
  ; (src-tauri/src/context_menu.rs): the user is asked on first startup and
  ; can toggle it in Settings. Registering here would re-enable it on every
  ; update and would not cover MSI installs.
!macroend

!macro CUSTOM_UNINSTALL
  ; Remove context menu entries on uninstall
  DeleteRegKey HKCU "Software\Classes\Directory\shell\FolderOrganizer"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\FolderOrganizer"
!macroend
