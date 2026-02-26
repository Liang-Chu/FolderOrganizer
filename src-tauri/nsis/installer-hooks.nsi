; Folder Organizer — NSIS installer hooks
; Adds right-click "Watch with Folder Organizer" context menu for folders
; Launches the app after installation

!macro CUSTOM_INSTALL
  ; Register right-click context menu for folders
  WriteRegStr HKCU "Software\Classes\Directory\shell\FolderOrganizer" "" "Watch with Folder Organizer"
  WriteRegStr HKCU "Software\Classes\Directory\shell\FolderOrganizer" "Icon" "$INSTDIR\Folder Organizer.exe,0"
  WriteRegStr HKCU "Software\Classes\Directory\shell\FolderOrganizer\command" "" '"$INSTDIR\Folder Organizer.exe" --watch-folder "%V"'

  ; Also add to directory background (right-click in empty space inside a folder)
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\FolderOrganizer" "" "Watch with Folder Organizer"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\FolderOrganizer" "Icon" "$INSTDIR\Folder Organizer.exe,0"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\FolderOrganizer\command" "" '"$INSTDIR\Folder Organizer.exe" --watch-folder "%V"'
!macroend

!macro CUSTOM_UNINSTALL
  ; Remove context menu entries on uninstall
  DeleteRegKey HKCU "Software\Classes\Directory\shell\FolderOrganizer"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\FolderOrganizer"
!macroend
