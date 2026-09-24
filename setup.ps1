<#
.SYNOPSIS
  Writes your local wrangler.toml (git-ignored) for your own RingCheck deployment.

.DESCRIPTION
  Starts from wrangler.example.toml and fills in the values that belong to you.
  Run it again at any time with only the values you want to change; for
  example, add -Aud once Cloudflare Access is set up.

  Works in Windows PowerShell 5.1 and PowerShell 7 (pwsh) on macOS/Linux.

.EXAMPLE
  .\setup.ps1 -Hostname ringcheck.example.com -TeamDomain https://myteam.cloudflareaccess.com -CreateKv

.EXAMPLE
  .\setup.ps1 -Aud 0123abcd...   # after Access is set up
#>
param(
    [string]$Hostname,
    [string]$TeamDomain,
    [string]$Aud,
    [string]$AllowedEmails,
    [string]$KvId,
    [switch]$CreateKv
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$target = Join-Path $PSScriptRoot 'wrangler.toml'
$template = Join-Path $PSScriptRoot 'wrangler.example.toml'
$utf8 = New-Object System.Text.UTF8Encoding $false

if (-not (Test-Path $target)) {
    Copy-Item $template $target
    Write-Host 'Created wrangler.toml from wrangler.example.toml'
}
$text = [System.IO.File]::ReadAllText($target)

function Set-TomlValue([string]$body, [string]$key, [string]$value) {
    $pattern = '(?m)^(\s*' + [regex]::Escape($key) + '\s*=\s*)"[^"]*"'
    if ($body -notmatch $pattern) { throw "Could not find '$key' in wrangler.toml" }
    $re = New-Object System.Text.RegularExpressions.Regex $pattern
    $evaluator = [System.Text.RegularExpressions.MatchEvaluator]({ param($m) $m.Groups[1].Value + '"' + $value + '"' }.GetNewClosure())
    return $re.Replace($body, $evaluator, 1)
}

if ($Hostname) {
    if ($Hostname -notmatch '^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$') { throw 'Hostname should look like ringcheck.example.com' }
    $text = Set-TomlValue $text 'pattern' $Hostname.ToLower()
}
if ($TeamDomain) {
    $TeamDomain = $TeamDomain.TrimEnd('/')
    if ($TeamDomain -notmatch '^https://[a-z0-9-]+\.cloudflareaccess\.com$') { throw 'TeamDomain should look like https://your-team.cloudflareaccess.com' }
    $text = Set-TomlValue $text 'TEAM_DOMAIN' $TeamDomain
}
if ($Aud) {
    if ($Aud -notmatch '^[0-9a-f]{32,128}$') { throw 'Aud should be the hex AUD tag from the Access application' }
    $text = Set-TomlValue $text 'POLICY_AUD' $Aud
}
if ($PSBoundParameters.ContainsKey('AllowedEmails')) {
    $text = Set-TomlValue $text 'ALLOWED_EMAILS' $AllowedEmails
}

if ($CreateKv -and -not $KvId) {
    Write-Host 'Creating KV namespace RINGCHECK_KV...'
    $out = (& npx wrangler kv namespace create RINGCHECK_KV 2>&1 | Out-String)
    $m = [regex]::Match($out, '[0-9a-f]{32}')
    if (-not $m.Success) { Write-Host $out; throw 'Could not read the namespace id; pass it with -KvId' }
    $KvId = $m.Value
}
if ($KvId) {
    if ($KvId -notmatch '^[0-9a-f]{32}$') { throw 'KvId should be a 32-character hex id' }
    $text = Set-TomlValue $text 'id' $KvId
}

[System.IO.File]::WriteAllText($target, $text, $utf8)

$left = @()
foreach ($k in '__HOSTNAME__', '__KV_NAMESPACE_ID__', '__TEAM_DOMAIN__', '__POLICY_AUD__') {
    if ($text.Contains($k)) { $left += $k }
}
Write-Host 'wrangler.toml updated.'
if ($left.Count) {
    Write-Host ('Still to fill in: ' + ($left -join ', '))
    if ($left -contains '__POLICY_AUD__') {
        Write-Host 'The API stays locked (403) until POLICY_AUD is set. That is expected before Access is set up.'
    }
} else {
    Write-Host 'All values set. Deploy with: npx wrangler deploy'
}
