; Custom NSIS installer script for ScriptureFlow
; Adds Windows Firewall rules so NDI discovery packets can reach the network.
; NDI uses multicast UDP for source discovery — without these rules, the source
; starts and streams but cannot be found by OBS, vMix, or other NDI receivers.

!macro customInstall
  ; Remove any stale rule first (ignore errors if it doesn't exist)
  nsExec::ExecToLog '"$SYSDIR\netsh.exe" advfirewall firewall delete rule name="ScriptureFlow NDI"'

  ; Allow inbound NDI traffic (receivers connecting to this source)
  nsExec::ExecToLog '"$SYSDIR\netsh.exe" advfirewall firewall add rule name="ScriptureFlow NDI" dir=in action=allow program="$INSTDIR\ScriptureFlow.exe" protocol=any'

  ; Allow outbound NDI traffic (discovery multicast + streaming)
  nsExec::ExecToLog '"$SYSDIR\netsh.exe" advfirewall firewall add rule name="ScriptureFlow NDI" dir=out action=allow program="$INSTDIR\ScriptureFlow.exe" protocol=any'

  ; Copy NDI runtime DLL into grandiose lookup locations.
  ; We do not delete bundled DLLs first, so install never ends up with
  ; an empty/native-missing state if runtime probing fails.
  nsExec::ExecToLog 'cmd /c if exist "$PROGRAMFILES64\NDI\NDI 6 Tools\Runtime\Processing.NDI.Lib.x64.dll" copy /Y "$PROGRAMFILES64\NDI\NDI 6 Tools\Runtime\Processing.NDI.Lib.x64.dll" "$INSTDIR\resources\app.asar.unpacked\node_modules\grandiose\build\Release\Processing.NDI.Lib.x64.dll"'
  nsExec::ExecToLog 'cmd /c if exist "$PROGRAMFILES64\NDI\NDI 6 Tools\Runtime\Processing.NDI.Lib.x64.dll" copy /Y "$PROGRAMFILES64\NDI\NDI 6 Tools\Runtime\Processing.NDI.Lib.x64.dll" "$INSTDIR\resources\app.asar.unpacked\node_modules\grandiose\lib\win_x64\Processing.NDI.Lib.x64.dll"'
  nsExec::ExecToLog 'cmd /c if exist "$PROGRAMFILES64\NDI\NDI 6 Tools\Router\Processing.NDI.Lib.x64.dll" copy /Y "$PROGRAMFILES64\NDI\NDI 6 Tools\Router\Processing.NDI.Lib.x64.dll" "$INSTDIR\resources\app.asar.unpacked\node_modules\grandiose\build\Release\Processing.NDI.Lib.x64.dll"'
  nsExec::ExecToLog 'cmd /c if exist "$PROGRAMFILES64\NDI\NDI 6 Tools\Router\Processing.NDI.Lib.x64.dll" copy /Y "$PROGRAMFILES64\NDI\NDI 6 Tools\Router\Processing.NDI.Lib.x64.dll" "$INSTDIR\resources\app.asar.unpacked\node_modules\grandiose\lib\win_x64\Processing.NDI.Lib.x64.dll"'
  nsExec::ExecToLog 'cmd /c if exist "$PROGRAMFILES64\NDI\NDI 6 Runtime\v6\Processing.NDI.Lib.x64.dll" copy /Y "$PROGRAMFILES64\NDI\NDI 6 Runtime\v6\Processing.NDI.Lib.x64.dll" "$INSTDIR\resources\app.asar.unpacked\node_modules\grandiose\build\Release\Processing.NDI.Lib.x64.dll"'
  nsExec::ExecToLog 'cmd /c if exist "$PROGRAMFILES64\NDI\NDI 6 Runtime\v6\Processing.NDI.Lib.x64.dll" copy /Y "$PROGRAMFILES64\NDI\NDI 6 Runtime\v6\Processing.NDI.Lib.x64.dll" "$INSTDIR\resources\app.asar.unpacked\node_modules\grandiose\lib\win_x64\Processing.NDI.Lib.x64.dll"'
  nsExec::ExecToLog 'cmd /c if exist "$PROGRAMFILES64\NDI\NDI 6 Runtime\Processing.NDI.Lib.x64.dll" copy /Y "$PROGRAMFILES64\NDI\NDI 6 Runtime\Processing.NDI.Lib.x64.dll" "$INSTDIR\resources\app.asar.unpacked\node_modules\grandiose\build\Release\Processing.NDI.Lib.x64.dll"'
  nsExec::ExecToLog 'cmd /c if exist "$PROGRAMFILES64\NDI\NDI 6 Runtime\Processing.NDI.Lib.x64.dll" copy /Y "$PROGRAMFILES64\NDI\NDI 6 Runtime\Processing.NDI.Lib.x64.dll" "$INSTDIR\resources\app.asar.unpacked\node_modules\grandiose\lib\win_x64\Processing.NDI.Lib.x64.dll"'
!macroend

!macro customUnInstall
  ; Clean up firewall rules when uninstalling
  nsExec::ExecToLog '"$SYSDIR\netsh.exe" advfirewall firewall delete rule name="ScriptureFlow NDI"'
!macroend
