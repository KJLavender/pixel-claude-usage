# Start the usage server hidden every time you log in to Windows.
# Run once:   powershell -ExecutionPolicy Bypass -File install-autostart.ps1
# Remove:     powershell -ExecutionPolicy Bypass -File install-autostart.ps1 -Remove
param([switch]$Remove)

$startup = [Environment]::GetFolderPath('Startup')
$vbs = Join-Path $startup 'pixel-claude-usage.vbs'

if ($Remove) {
  Remove-Item $vbs -ErrorAction SilentlyContinue
  Write-Host "Removed autostart."
  exit
}

$dir = $PSScriptRoot
$node = (Get-Command node).Source
@"
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "$dir"
sh.Run """$node"" server.mjs", 0, False
"@ | Set-Content -Encoding ASCII $vbs

Write-Host "Autostart installed: $vbs"
Write-Host "It will start next time you log in. To start now, double-click start.bat."
