<#
.SYNOPSIS
  Writes your local wrangler.toml (git-ignored) for your own RingCheck deployment.

.DESCRIPTION
  Starts from wrangler.example.toml and fills in the values that belong to you.
  Run it again at any time with only the values you want to change.
  -TeamDomain and -Aud are only for a hostname-based Access application;
  Worker-level Access (Workers & Pages > ringcheck > Access) needs neither.

  Works in Windows PowerShell 5.1 and PowerShell 7 (pwsh) on macOS/Linux.

.EXAMPLE
  .\setup.ps1 -Hostname ringcheck.example.com -CreateKv

.EXAMPLE
  .\setup.ps1 -AllowedEmails you@example.com
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

function Invoke-Wrangler([string[]]$WranglerArgs, [switch]$StdoutOnly) {
    # Windows PowerShell 5.1 turns native stderr (npm notices, wrangler warnings)
    # into terminating errors under 'Stop', so run npx with 'Continue'.
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        if ($StdoutOnly) { $lines = & npx --yes wrangler @WranglerArgs 2>$null | ForEach-Object { "$_" } }
        else { $lines = & npx --yes wrangler @WranglerArgs 2>&1 | ForEach-Object { "$_" } }
        return @{ Code = $LASTEXITCODE; Text = ($lines -join "`n") }
    } finally {
        $ErrorActionPreference = $prev
    }
}

if ($CreateKv -and -not $KvId) {
    Write-Host 'Looking for an existing RINGCHECK_KV namespace...'
    $list = Invoke-Wrangler @('kv', 'namespace', 'list') -StdoutOnly
    $jsonStart = $list.Text.IndexOf('[')
    $jsonEnd = $list.Text.LastIndexOf(']')
    if ($list.Code -eq 0 -and $jsonStart -ge 0 -and $jsonEnd -gt $jsonStart) {
        $found = ($list.Text.Substring($jsonStart, $jsonEnd - $jsonStart + 1) | ConvertFrom-Json) |
            Where-Object { $_.title -eq 'RINGCHECK_KV' -or $_.title -like '*-RINGCHECK_KV' } |
            Select-Object -First 1
        if ($found) { $KvId = $found.id; Write-Host "Using existing namespace $($found.title)" }
    }
    if (-not $KvId) {
        Write-Host 'Creating KV namespace RINGCHECK_KV...'
        $made = Invoke-Wrangler @('kv', 'namespace', 'create', 'RINGCHECK_KV')
        $m = [regex]::Match($made.Text, '"?id"?\s*[=:]\s*"([0-9a-f]{32})"')
        if ($made.Code -ne 0 -or -not $m.Success) {
            Write-Host $made.Text
            throw 'Could not create or read the KV namespace. Run "npx wrangler kv namespace list" and pass the id with -KvId.'
        }
        $KvId = $m.Groups[1].Value
    }
}

if ($KvId) {
    if ($KvId -notmatch '^[0-9a-f]{32}$') { throw 'KvId should be a 32-character hex id' }
    $text = Set-TomlValue $text 'id' $KvId
}

[System.IO.File]::WriteAllText($target, $text, $utf8)

$left = @()
foreach ($k in '__HOSTNAME__', '__KV_NAMESPACE_ID__') {
    if ($text.Contains($k)) { $left += $k }
}
Write-Host 'wrangler.toml updated.'
if ($left.Count) {
    Write-Host ('Still to fill in: ' + ($left -join ', '))
} else {
    Write-Host 'Ready. Deploy with: npx wrangler deploy'
    Write-Host 'Then protect the Worker: Workers & Pages > ringcheck > Access > All traffic.'
}
