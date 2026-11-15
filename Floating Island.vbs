' Launches Floating Island without a console window.
Option Explicit

Dim fso, shell, root, exe
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

root = fso.GetParentFolderName(WScript.ScriptFullName)
exe = root & "\node_modules\electron\dist\electron.exe"

If Not fso.FileExists(exe) Then
  MsgBox "Floating Island is not installed yet." & vbCrLf & vbCrLf & _
         "Open a terminal in:" & vbCrLf & root & vbCrLf & _
         "and run: npm install", vbExclamation, "Floating Island"
  WScript.Quit 1
End If

shell.CurrentDirectory = root
' 0 = hidden window, False = don't wait for it to close.
shell.Run """" & exe & """ """ & root & """", 0, False
