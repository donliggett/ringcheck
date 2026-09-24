<#
.SYNOPSIS
  Sets up the RingCheck desktop hotkey (default Ctrl+Alt+R).

.DESCRIPTION
  Saves your RingCheck URL to desktop\ringcheck.local.json (git-ignored) and
  creates a Start Menu shortcut that runs desktop\ringcheck.ps1 hidden, with a
  global shortcut key. Copy a phone number, press the hotkey, and RingCheck
  opens with the lookup running.

.EXAMPLE
  .\desktop\install-hotkey.ps1 -Url https://ringcheck.example.com

.EXAMPLE
  .\desktop\install-hotkey.ps1 -Remove
#>
param(
    [string]$Url,
    [string]$Hotkey = 'CTRL+ALT+R',
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$lnk = Join-Path ([Environment]::GetFolderPath('Programs')) 'RingCheck.lnk'
$cfgPath = Join-Path $PSScriptRoot 'ringcheck.local.json'

if ($Remove) {
    if (Test-Path $lnk) { Remove-Item $lnk; Write-Host "Removed $lnk" }
    if (Test-Path $cfgPath) { Remove-Item $cfgPath; Write-Host "Removed $cfgPath" }
    return
}

if (-not $Url -or $Url -notmatch '^https://[A-Za-z0-9.-]+/?$') {
    throw 'Pass your RingCheck address, for example: -Url https://ringcheck.example.com'
}

$json = (@{ url = $Url.TrimEnd('/') } | ConvertTo-Json)
[System.IO.File]::WriteAllText($cfgPath, $json, (New-Object System.Text.UTF8Encoding $false))

$script = Join-Path $PSScriptRoot 'ringcheck.ps1'
$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($lnk)
$s.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$s.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
$s.WorkingDirectory = $PSScriptRoot
$s.WindowStyle = 7
$s.Hotkey = $Hotkey
$s.Description = 'Look up the phone number on the clipboard in RingCheck'
$s.Save()

Write-Host "Saved URL to $cfgPath"
Write-Host "Created $lnk with hotkey $Hotkey"
Write-Host 'Copy a phone number and press the hotkey to test it.'
