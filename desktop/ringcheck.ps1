# RingCheck desktop launcher (Windows PowerShell 5.1+)
# Opens RingCheck with the phone number on the clipboard already filled in.
# Run desktop\install-hotkey.ps1 once to set your URL and the Ctrl+Alt+R shortcut.

$ErrorActionPreference = 'Stop'
$cfgPath = Join-Path $PSScriptRoot 'ringcheck.local.json'

if (-not (Test-Path $cfgPath)) {
    Add-Type -AssemblyName PresentationFramework
    [void][System.Windows.MessageBox]::Show(
        "RingCheck isn't set up on this PC yet.`n`nRun: desktop\install-hotkey.ps1 -Url https://your-ringcheck-host",
        'RingCheck')
    exit 1
}

$url = ((Get-Content -Path $cfgPath -Raw) | ConvertFrom-Json).url.TrimEnd('/') + '/'
$raw = Get-Clipboard -Raw
$digits = ([string]$raw) -replace '\D', ''
if ($digits.Length -eq 11 -and $digits.StartsWith('1')) { $digits = $digits.Substring(1) }
if ($digits.Length -eq 10) { $url = $url + '?n=' + $digits }
Start-Process $url
