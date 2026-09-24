<#
.SYNOPSIS
  Writes your local wrangler.toml (git-ignored) for your own RingCheck deployment.

.DESCRIPTION
  Starts from wrangler.example.toml and fills in the values that belong to you.
  Run it again at any time with only the values you want to change.
  After Access protects the Worker, -DetectAccess reads your Access team
  domain and AUD tag from the login redirect so the Worker can verify logins.

  Works in Windows PowerShell 5.1 and PowerShell 7 (pwsh) on macOS/Linux.

.EXAMPLE
  .\setup.ps1 -Hostname ringcheck.example.com -CreateKv

.EXAMPLE
  .\setup.ps1 -DetectAccess -AllowedEmails you@example.com
#>
param(
    [string]$Hostname,
    [string]$TeamDomain,
    [string]$Aud,
    [string]$AllowedEmails,
    [string]$KvId,
    [switch]$CreateKv,
    [switch]$DetectAccess
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

if ($DetectAccess) {
    $hostNow = $Hostname
    if (-not $hostNow) { $hostNow = [regex]::Match($text, '(?m)^\s*pattern\s*=\s*"([^"]*)"').Groups[1].Value }
    if (-not $hostNow -or $hostNow.StartsWith('__')) { throw 'Set -Hostname and deploy before using -DetectAccess' }
    $curl = 'curl'
    if ($env:OS -eq 'Windows_NT') { $curl = 'curl.exe' }
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $headers = (& $curl -s -I "https://$hostNow/" 2>$null) -join "`n" } finally { $ErrorActionPreference = $prev }
    $loc = [regex]::Match($headers, '(?im)^location:\s*(https://([a-z0-9-]+)\.cloudflareaccess\.com/\S*)')
    if (-not $loc.Success) {
        throw "https://$hostNow/ did not redirect to a Cloudflare Access login. Protect the Worker (Access tab, All traffic) and try again."
    }
    $kid = [regex]::Match($loc.Groups[1].Value, '[?&]kid=([0-9a-f]{32,128})')
    if (-not $kid.Success) { throw 'Found the Access login but no AUD tag in it. Copy the tag from Zero Trust and pass -Aud.' }
    $TeamDomain = 'https://' + $loc.Groups[2].Value + '.cloudflareaccess.com'
    $Aud = $kid.Groups[1].Value
    Write-Host "Detected Access team $TeamDomain and its AUD tag."
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
    if ($text.Contains('__POLICY_AUD__')) {
        Write-Host 'Then protect the Worker (Workers & Pages > ringcheck > Access > All traffic)'
        Write-Host 'and run: .\setup.ps1 -DetectAccess, then deploy again.'
    }
}
