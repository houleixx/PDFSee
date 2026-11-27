; Keep the ProgID from previous PDFSee versions so existing choices can resolve.
!define PDFSEE_PDF_PROGID "PDF 文档"
!define PDFSEE_CAPABILITIES "Software\PDFSee\Capabilities"

!macro customInstall
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PDFSEE_PDF_PROGID}" "" "PDF 文档"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PDFSEE_PDF_PROGID}\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PDFSEE_PDF_PROGID}\shell\open\command" "" '"$appExe" "%1"'
  WriteRegNone SHELL_CONTEXT "Software\Classes\.pdf\OpenWithProgids" "${PDFSEE_PDF_PROGID}"
  WriteRegStr SHELL_CONTEXT "${PDFSEE_CAPABILITIES}" "ApplicationName" "PDFSee"
  WriteRegStr SHELL_CONTEXT "${PDFSEE_CAPABILITIES}" "ApplicationDescription" "PDFSee PDF reader"
  WriteRegStr SHELL_CONTEXT "${PDFSEE_CAPABILITIES}\FileAssociations" ".pdf" "${PDFSEE_PDF_PROGID}"
  WriteRegStr SHELL_CONTEXT "Software\RegisteredApplications" "PDFSee" "${PDFSEE_CAPABILITIES}"
  System::Call 'shell32::SHChangeNotify(i, i, i, i) v (0x08000000, 0, 0, 0)'
!macroend

!macro customUnInstall
  DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "PDFSee"
  DeleteRegKey SHELL_CONTEXT "${PDFSEE_CAPABILITIES}"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.pdf\OpenWithProgids" "${PDFSEE_PDF_PROGID}"
  ${ifNot} ${isUpdated}
    ReadRegStr $0 SHELL_CONTEXT "Software\Classes\.pdf" ""
    StrCmp $0 "${PDFSEE_PDF_PROGID}" 0 +2
    DeleteRegValue SHELL_CONTEXT "Software\Classes\.pdf" ""
  ${endIf}
  DeleteRegKey SHELL_CONTEXT "Software\Classes\${PDFSEE_PDF_PROGID}"
!macroend
