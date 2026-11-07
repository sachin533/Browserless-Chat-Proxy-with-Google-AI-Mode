<#
.SYNOPSIS
    Publishes the Google AI Mode API (and optionally the playground UI)
    through a Cloudflare Tunnel.

.DESCRIPTION
    Creates two "quick" tunnels (no Cloudflare account required):

        API  -> http://127.0.0.1:8000   the FastAPI backend
        UI   -> http://127.0.0.1:4173   the built playground (optional)

    The script builds the playground with the public API URL baked in, adds
    both public origins to CORS_ORIGINS in backend\.env and prints the two
    URLs.

    Quick tunnel URLs change every time the tunnel restarts - use a named
    tunnel for a permanent hostname (see docs\deployment.md).

.EXAMPLE
    .\scripts\publish.ps1                 # API + UI
    .\scripts\publish.ps1 -ApiOnly        # API only
    .\scripts\publish.ps1 -Stop           # stop both tunnels
#>
[CmdletBinding()]
param(
    [switch]$ApiOnly,
    [switch]$Stop
)

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Root 'backend'
$Frontend = Join-Path $Root 'frontend'
$Cloudflared = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
if (-not (Test-Path $Cloudflared)) {
    $Cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
}
if (-not $Cloudflared -or -not (Test-Path $Cloudflared)) {
    throw 'cloudflared was not found. Install it with: winget install --id Cloudflare.cloudflared'
}

function Stop-Tunnels {
    Get-CimInstance Win32_Process -Filter "Name like '%cloudflared%'" |
        ForEach-Object {
            Write-Host "Stopping cloudflared PID $($_.ProcessId)"
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }
}

if ($Stop) {
    Stop-Tunnels
    Write-Host 'Tunnels stopped.'
    exit 0
}

# ---------------------------------------------------------------------------
# 1. The backend must be running
# ---------------------------------------------------------------------------
try {
    Invoke-WebRequest -Uri 'http://127.0.0.1:8000/health' -UseBasicParsing -TimeoutSec 5 | Out-Null
} catch {
    throw 'The backend is not running on http://127.0.0.1:8000. Start it with: uvicorn app.main:app --port 8000'
}

# ---------------------------------------------------------------------------
# 2. API tunnel
# ---------------------------------------------------------------------------
$apiErr = Join-Path $env:TEMP 'gaim_tunnel_api.err'
Remove-Item $apiErr -ErrorAction SilentlyContinue
Write-Host 'Starting the API tunnel...'
Start-Process -FilePath $Cloudflared `
    -ArgumentList 'tunnel', '--url', 'http://127.0.0.1:8000', '--no-autoupdate' `
    -RedirectStandardOutput (Join-Path $env:TEMP 'gaim_tunnel_api.log') `
    -RedirectStandardError $apiErr -WindowStyle Hidden

function Get-TunnelUrl([string]$errFile) {
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 1
        $text = Get-Content $errFile -Raw -ErrorAction SilentlyContinue
        if ($text) {
            $match = [regex]::Match($text, 'https://[a-z0-9-]+\.trycloudflare\.com')
            if ($match.Success) { return $match.Value }
        }
    }
    throw "Could not read a tunnel URL from $errFile"
}

$apiUrl = Get-TunnelUrl $apiErr
Write-Host "API  : $apiUrl" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# 3. UI tunnel (optional)
# ---------------------------------------------------------------------------
$uiUrl = $null
if (-not $ApiOnly) {
    Write-Host 'Building the playground for the public API...'
    Push-Location $Frontend
    try {
        $env:VITE_API_BASE_URL = $apiUrl
        npm run build | Out-Null
    } finally {
        Remove-Item Env:\VITE_API_BASE_URL -ErrorAction SilentlyContinue
        Pop-Location
    }

    Get-CimInstance Win32_Process -Filter "Name like '%node%'" |
        Where-Object { $_.CommandLine -like '*vite*preview*' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

    Start-Process -FilePath 'npm.cmd' -ArgumentList 'run', 'preview' -WorkingDirectory $Frontend `
        -RedirectStandardOutput (Join-Path $env:TEMP 'gaim_tunnel_ui.log') `
        -RedirectStandardError (Join-Path $env:TEMP 'gaim_tunnel_ui.err') -WindowStyle Hidden
    Start-Sleep -Seconds 6

    $uiErr = Join-Path $env:TEMP 'gaim_tunnel_ui.err'
    Remove-Item $uiErr -ErrorAction SilentlyContinue
    Write-Host 'Starting the UI tunnel...'
    Start-Process -FilePath $Cloudflared `
        -ArgumentList 'tunnel', '--url', 'http://127.0.0.1:4173', '--no-autoupdate' `
        -RedirectStandardOutput (Join-Path $env:TEMP 'gaim_tunnel_ui2.log') `
        -RedirectStandardError $uiErr -WindowStyle Hidden
    $uiUrl = Get-TunnelUrl $uiErr
    Write-Host "UI   : $uiUrl" -ForegroundColor Cyan
}

# ---------------------------------------------------------------------------
# 4. Allow both public origins in CORS
# ---------------------------------------------------------------------------
$envFile = Join-Path $Backend '.env'
if (Test-Path $envFile) {
    $content = Get-Content $envFile -Raw
    $origins = @()
    if ($content -match 'CORS_ORIGINS=(.*)') { $origins = $matches[1] -split ',' }
    foreach ($origin in @($apiUrl, $uiUrl)) {
        if ($origin -and ($origins -notcontains $origin)) { $origins = @($origin) + $origins }
    }
    $content = [regex]::Replace($content, 'CORS_ORIGINS=.*', ('CORS_ORIGINS=' + ($origins -join ',')))
    Set-Content -Path $envFile -Value $content -NoNewline
    # Make the backend re-read the .env
    (Get-Item (Join-Path $Backend 'app\main.py')).LastWriteTime = Get-Date
    Write-Host 'CORS_ORIGINS updated.' -ForegroundColor DarkGray
}

Write-Host ''
Write-Host '  Public API : ' -NoNewline; Write-Host $apiUrl -ForegroundColor Green
if ($uiUrl) {
    Write-Host '  Public UI  : ' -NoNewline; Write-Host $uiUrl -ForegroundColor Green
}
Write-Host ''
Write-Host '  Swagger UI : ' -NoNewline; Write-Host "$apiUrl/docs" -ForegroundColor DarkGray
Write-Host '  Stop both  : .\scripts\publish.ps1 -Stop'
Write-Host ''
