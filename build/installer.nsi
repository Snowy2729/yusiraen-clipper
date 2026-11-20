Unicode true
!include "MUI2.nsh"
!define APP "Yusiraen Clipper"
!define VER "1.1.0"
!define EXE "Yusiraen Clipper.exe"
!define UNKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\YusiraenClipper"
Name "${APP}"
OutFile "..\dist\Yusiraen Clipper Kurulum.exe"
InstallDir "$LOCALAPPDATA\Programs\${APP}"
InstallDirRegKey HKCU "Software\YusiraenClipper" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "Yusiraen"
VIProductVersion "1.1.0.0"
VIAddVersionKey /LANG=1055 "ProductName" "${APP}"
VIAddVersionKey /LANG=1055 "FileDescription" "${APP} Kurulum"
VIAddVersionKey /LANG=1055 "FileVersion" "${VER}"
VIAddVersionKey /LANG=1055 "CompanyName" "Yusiraen"
VIAddVersionKey /LANG=1055 "LegalCopyright" "Yusiraen"

!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_WELCOMEFINISHPAGE_BITMAP "welcome.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "welcome.bmp"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP "header.bmp"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Yusiraen Clipper Kurulumu"
!define MUI_WELCOMEPAGE_TEXT "Kick yayınlarının sohbetini kaydeder, en iyi anları bulur ve otomatik klip alır.$\r$\n$\r$\nDevam etmek için İleri'ye tıkla."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Yusiraen Clipper'ı şimdi başlat"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Turkish"

Function .onInstSuccess
  IfSilent 0 +2
  Exec '"$INSTDIR\${EXE}"'
FunctionEnd

Section "Install"
  nsExec::Exec 'taskkill /F /IM "${EXE}"'
  Sleep 500
  SetOutPath "$INSTDIR"
  File /r "..\dist\win-unpacked\*.*"
  WriteUninstaller "$INSTDIR\Kaldir.exe"
  CreateShortcut "$DESKTOP\${APP}.lnk" "$INSTDIR\${EXE}"
  CreateDirectory "$SMPROGRAMS\${APP}"
  CreateShortcut "$SMPROGRAMS\${APP}\${APP}.lnk" "$INSTDIR\${EXE}"
  CreateShortcut "$SMPROGRAMS\${APP}\Kaldır.lnk" "$INSTDIR\Kaldir.exe"
  WriteRegStr HKCU "Software\YusiraenClipper" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNKEY}" "DisplayName" "${APP}"
  WriteRegStr HKCU "${UNKEY}" "DisplayVersion" "${VER}"
  WriteRegStr HKCU "${UNKEY}" "Publisher" "Yusiraen"
  WriteRegStr HKCU "${UNKEY}" "DisplayIcon" "$INSTDIR\${EXE}"
  WriteRegStr HKCU "${UNKEY}" "UninstallString" '"$INSTDIR\Kaldir.exe"'
  WriteRegDWORD HKCU "${UNKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNKEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /F /IM "${EXE}"'
  Sleep 500
  Delete "$DESKTOP\${APP}.lnk"
  RMDir /r "$SMPROGRAMS\${APP}"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNKEY}"
  DeleteRegKey HKCU "Software\YusiraenClipper"
SectionEnd
