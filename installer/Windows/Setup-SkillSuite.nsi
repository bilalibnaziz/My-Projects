; NSIS Script for Skill Suite v1.0
!define PRODUCT_NAME "Skill Suite"
!define PRODUCT_VERSION "1.0.0"
!define PRODUCT_PUBLISHER "Skill Scale Creative Technologies"
!define PRODUCT_DIR_REGKEY "Software\Microsoft\Windows\CurrentVersion\App Paths\SkillSuite"
!define PRODUCT_UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\SkillSuite"

Name "${PRODUCT_NAME} ${PRODUCT_VERSION}"
OutFile "SkillSuite-v1.0-Setup.exe"
InstallDir "$LOCALAPPDATA\Programs\SkillSuite"
RequestExecutionLevel user
ShowInstDetails show

Section "Skill Photo" SEC01
  SetOutPath "$INSTDIR\SkillPhoto"
  File /r "SkillPhoto-v1.0-Windows\*.*"
  CreateShortCut "$DESKTOP\Skill Photo.lnk" "$INSTDIR\SkillPhoto\SkillPhoto.bat" "" "$INSTDIR\SkillPhoto\icon.ico" 0
  CreateDirectory "$SMPROGRAMS\Skill Suite"
  CreateShortCut "$SMPROGRAMS\Skill Suite\Skill Photo.lnk" "$INSTDIR\SkillPhoto\SkillPhoto.bat" "" "$INSTDIR\SkillPhoto\icon.ico" 0
SectionEnd

Section "Skill Vector" SEC02
  SetOutPath "$INSTDIR\SkillVector"
  File /r "SkillVector-v1.0-Windows\*.*"
  CreateShortCut "$DESKTOP\Skill Vector.lnk" "$INSTDIR\SkillVector\SkillVector.bat" "" "$INSTDIR\SkillVector\icon.ico" 0
  CreateShortCut "$SMPROGRAMS\Skill Suite\Skill Vector.lnk" "$INSTDIR\SkillVector\SkillVector.bat" "" "$INSTDIR\SkillVector\icon.ico" 0
SectionEnd

Section "Skill Motion" SEC03
  SetOutPath "$INSTDIR\SkillMotion"
  File /r "SkillMotion-v1.0-Windows\*.*"
  CreateShortCut "$DESKTOP\Skill Motion.lnk" "$INSTDIR\SkillMotion\SkillMotion.bat" "" "$INSTDIR\SkillMotion\icon.ico" 0
  CreateShortCut "$SMPROGRAMS\Skill Suite\Skill Motion.lnk" "$INSTDIR\SkillMotion\SkillMotion.bat" "" "$INSTDIR\SkillMotion\icon.ico" 0
SectionEnd

Section -Post
  WriteUninstaller "$INSTDIR\uninst.exe"
  CreateShortCut "$SMPROGRAMS\Skill Suite\Uninstall Skill Suite.lnk" "$INSTDIR\uninst.exe"
SectionEnd

Section Uninstall
  RMDir /r "$INSTDIR"
  Delete "$DESKTOP\Skill Photo.lnk"
  Delete "$DESKTOP\Skill Vector.lnk"
  Delete "$DESKTOP\Skill Motion.lnk"
  RMDir /r "$SMPROGRAMS\Skill Suite"
SectionEnd
