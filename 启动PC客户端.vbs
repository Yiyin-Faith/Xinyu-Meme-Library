Option Explicit
Dim fs, sh, root, exe
Set fs = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
root = fs.GetParentFolderName(WScript.ScriptFullName)
exe = fs.BuildPath(root, "release\win-unpacked\xinyu-meme-library.exe")
If Not fs.FileExists(exe) Then
  MsgBox "Client missing. Run npm run desktop:pack first.", 48, "心语表情库"
  WScript.Quit 1
End If
sh.CurrentDirectory = root
sh.Environment("PROCESS").Remove "ELECTRON_RUN_AS_NODE"
sh.Run Chr(34) & exe & Chr(34), 1, False
