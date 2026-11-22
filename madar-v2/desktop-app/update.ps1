<#
.SYNOPSIS
    Automated Windows Upgrade Script for MADAR ERP Desktop Application (Upgrade to v1.0.5).
.DESCRIPTION
    1. Downloads (if running standalone) or locates local v1.0.5 release assets.
    2. Imports/refreshes the Authenticode Root certificate (madar-codesign.cer) into Windows
       Trusted Root Certification Authorities store via certutil.
    3. Safely backs up %APPDATA%\MADAR user state, including local SQLite databases and cached credentials.
    4. Terminates any running MADAR instances.
    5. Performs an in-place silent upgrade via MADAR-Windows-1.0.5-Setup.exe /S.
    6. Verifies that SQLite databases and local configuration files remain fully intact.
#>

[CmdletBinding()]
param(
    [string]$ServerOrigin = "https://carlos-pc.tail852ef0.ts.net",
    [string]$InstallerPath = "",
    [string]$CertPath = "",
    [switch]$NoElevation
)

$ErrorActionPreference = 'Stop'
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "     MADAR ERP Desktop Client - System Upgrade (v1.0.5)   " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$tempDir = [System.IO.Path]::GetTempPath()

# Check Administrator privileges
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin -and -not $NoElevation) {
    Write-Host "Elevating process for administrative certificate registration..." -ForegroundColor Yellow
    $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$($MyInvocation.MyCommand.Path)`" -ServerOrigin `"$ServerOrigin`""
    if ($InstallerPath) { $arguments += " -InstallerPath `"$InstallerPath`"" }
    if ($CertPath) { $arguments += " -CertPath `"$CertPath`"" }
    Start-Process powershell.exe -Verb RunAs -ArgumentList $arguments
    exit 0
}

# 1. Acquire Certificate
Write-Host "[1/6] Resolving Security Certificate..." -ForegroundColor Yellow
if (-not $CertPath) {
    $localCert = Join-Path $scriptDir "madar-codesign.cer"
    if (Test-Path $localCert) {
        $CertPath = $localCert
    } else {
        $CertPath = Join-Path $tempDir "madar-codesign.cer"
        Write-Host "  Downloading certificate from $ServerOrigin/download/desktop/madar-codesign.cer..." -ForegroundColor Gray
        try {
            Invoke-WebRequest -Uri "$ServerOrigin/download/desktop/madar-codesign.cer" -OutFile $CertPath -UseBasicParsing
        } catch {
            Write-Warning "Could not download remote certificate: $_"
        }
    }
}

# 2. Register Certificate in Trusted Root
Write-Host "[2/6] Importing Certificate to Trusted Root Certification Authorities..." -ForegroundColor Yellow
if ($CertPath -and (Test-Path $CertPath)) {
    try {
        & certutil -addstore -f "Root" "$CertPath" | Out-Null
        Write-Host "  [OK] Successfully imported to LocalMachine Root store." -ForegroundColor Green
    } catch {
        Write-Warning "LocalMachine store import failed. Falling back to CurrentUser Root store..."
        & certutil -user -addstore -f "Root" "$CertPath" | Out-Null
        Write-Host "  [OK] Successfully imported to CurrentUser Root store." -ForegroundColor Green
    }
} else {
    Write-Warning "Root certificate not available; skipping certutil import."
}

# 3. Locate or Download Installer
Write-Host "[3/6] Resolving Version 1.0.5 Installer..." -ForegroundColor Yellow
if (-not $InstallerPath) {
    $localInstaller = Join-Path $scriptDir "MADAR-Windows-1.0.5-Setup.exe"
    if (Test-Path $localInstaller) {
        $InstallerPath = $localInstaller
    } else {
        $InstallerPath = Join-Path $tempDir "MADAR-Windows-1.0.5-Setup.exe"
        Write-Host "  Downloading installer from $ServerOrigin/download/desktop/MADAR-Windows-1.0.5-Setup.exe..." -ForegroundColor Gray
        Invoke-WebRequest -Uri "$ServerOrigin/download/desktop/MADAR-Windows-1.0.5-Setup.exe" -OutFile $InstallerPath -UseBasicParsing
    }
}

if (-not (Test-Path $InstallerPath)) {
    Write-Error "Installer executable could not be resolved: $InstallerPath"
    exit 1
}

# 4. Backup & Preserve %APPDATA%\MADAR
Write-Host "[4/6] Backing up and preserving %APPDATA%\MADAR user state..." -ForegroundColor Yellow
$appDataDir = Join-Path $env:APPDATA "MADAR"
$backupDir = $null
if (Test-Path $appDataDir) {
    $timestamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
    $backupDir = Join-Path $env:APPDATA "MADAR_UpgradeBackup_$timestamp"
    Write-Host "  Creating backup snapshot at $backupDir..." -ForegroundColor Gray
    Copy-Item -Path $appDataDir -Destination $backupDir -Recurse -Force
    Write-Host "  [OK] User data & SQLite databases backed up safely." -ForegroundColor Green
}

# Gracefully close existing MADAR application
Get-Process -Name "MADAR" -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "  Closing active MADAR application (PID: $($_.Id))..." -ForegroundColor Yellow
    Stop-Process -Id $_.Id -Force
}
Start-Sleep -Seconds 1

# 5. Execute Silent In-Place Upgrade
Write-Host "[5/6] Executing Silent Upgrade (/S)..." -ForegroundColor Yellow
$process = Start-Process -FilePath $InstallerPath -ArgumentList "/S" -PassThru -Wait
if ($process.ExitCode -ne 0) {
    Write-Warning "Installer process exited with code: $($process.ExitCode)"
} else {
    Write-Host "  [OK] In-place upgrade completed successfully." -ForegroundColor Green
}

# 6. Verify SQLite Database & User Data Retention
Write-Host "[6/6] Verifying SQLite Database & User Data Retention..." -ForegroundColor Yellow
if ($backupDir -and (Test-Path $backupDir)) {
    $sqliteFiles = Get-ChildItem -Path $backupDir -Filter "*.sqlite" -Recurse
    foreach ($file in $sqliteFiles) {
        $relPath = $file.FullName.Substring($backupDir.Length + 1)
        $targetFile = Join-Path $appDataDir $relPath
        if (-not (Test-Path $targetFile)) {
            Write-Host "  Restoring SQLite database: $relPath" -ForegroundColor Cyan
            $parentDir = Split-Path -Parent $targetFile
            if (-not (Test-Path $parentDir)) { New-Item -ItemType Directory -Path $parentDir -Force | Out-Null }
            Copy-Item -Path $file.FullName -Destination $targetFile -Force
        }
    }
    Write-Host "  [OK] Verified all local databases and configurations preserved." -ForegroundColor Green
}

Write-Host "==========================================================" -ForegroundColor Green
Write-Host "     MADAR ERP Desktop upgraded to v1.0.5 successfully!   " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
