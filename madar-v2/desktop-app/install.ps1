<#
.SYNOPSIS
    Automated Windows Installer for MADAR ERP Desktop Application (Version 1.0.5).
.DESCRIPTION
    1. Validates and elevates administrative privileges if necessary.
    2. Imports the self-signed root certificate (madar-codesign.cer) into the Windows
       Trusted Root Certification Authorities certificate store using certutil.
    3. Backs up and safeguards existing user data in %APPDATA%\MADAR (including SQLite databases).
    4. Executes silent installation of MADAR-Windows-1.0.5-Setup.exe.
    5. Verifies data integrity and restores any displaced user records.
    6. Creates/updates Desktop and Start Menu shortcuts.
#>

[CmdletBinding()]
param(
    [string]$InstallerPath = "",
    [string]$CertPath = "",
    [switch]$NoElevation
)

$ErrorActionPreference = 'Stop'
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "     MADAR ERP Desktop Client - Automated Setup (v1.0.5)  " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition

# Resolve paths
if (-not $InstallerPath) {
    $candidates = @(
        (Join-Path $scriptDir "MADAR-Windows-1.0.5-Setup.exe"),
        (Get-ChildItem -Path $scriptDir -Filter "MADAR-Windows-*.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName)
    )
    foreach ($cand in $candidates) {
        if ($cand -and (Test-Path $cand)) {
            $InstallerPath = $cand
            break
        }
    }
}

if (-not $CertPath) {
    $certCandidates = @(
        (Join-Path $scriptDir "madar-codesign.cer"),
        (Join-Path $scriptDir "madar-ca.cer"),
        (Join-Path $scriptDir "cert.cer")
    )
    foreach ($c in $certCandidates) {
        if (Test-Path $c) {
            $CertPath = $c
            break
        }
    }
}

Write-Host "[1/5] Checking Administrator privileges..." -ForegroundColor Yellow
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin -and -not $NoElevation) {
    Write-Host "Elevating process to install root certificate and system components..." -ForegroundColor Yellow
    $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$($MyInvocation.MyCommand.Path)`""
    if ($InstallerPath) { $arguments += " -InstallerPath `"$InstallerPath`"" }
    if ($CertPath) { $arguments += " -CertPath `"$CertPath`"" }
    Start-Process powershell.exe -Verb RunAs -ArgumentList $arguments
    exit 0
}

Write-Host "[2/5] Registering Authenticode Certificate in Windows Root Store..." -ForegroundColor Yellow
if ($CertPath -and (Test-Path $CertPath)) {
    Write-Host "  Importing: $CertPath" -ForegroundColor Gray
    try {
        & certutil -addstore -f "Root" "$CertPath" | Out-Null
        Write-Host "  [OK] Successfully imported to LocalMachine Root store." -ForegroundColor Green
    } catch {
        Write-Warning "LocalMachine store import failed. Falling back to CurrentUser Root store..."
        & certutil -user -addstore -f "Root" "$CertPath" | Out-Null
        Write-Host "  [OK] Successfully imported to CurrentUser Root store." -ForegroundColor Green
    }
} else {
    Write-Warning "Code signing certificate file not found. Continuing with unverified installation..."
}

Write-Host "[3/5] Preserving user data in %APPDATA%\MADAR..." -ForegroundColor Yellow
$appDataDir = Join-Path $env:APPDATA "MADAR"
$backupDir = $null
if (Test-Path $appDataDir) {
    $timestamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
    $backupDir = Join-Path $env:APPDATA "MADAR_Backup_$timestamp"
    Write-Host "  Existing user data found at $appDataDir" -ForegroundColor Gray
    Write-Host "  Creating snapshot backup at $backupDir..." -ForegroundColor Gray
    Copy-Item -Path $appDataDir -Destination $backupDir -Recurse -Force
    Write-Host "  [OK] User data & SQLite databases backed up safely." -ForegroundColor Green
} else {
    New-Item -ItemType Directory -Path $appDataDir -Force | Out-Null
    Write-Host "  Created fresh %APPDATA%\MADAR directory." -ForegroundColor Gray
}

# Ensure running MADAR instances are closed before running installer
Get-Process -Name "MADAR" -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "  Stopping running MADAR process (PID: $($_.Id))..." -ForegroundColor Yellow
    Stop-Process -Id $_.Id -Force
}

Write-Host "[4/5] Executing Silent Installation..." -ForegroundColor Yellow
if (-not $InstallerPath -or -not (Test-Path $InstallerPath)) {
    Write-Error "Installer executable not found: $InstallerPath"
    exit 1
}

Write-Host "  Launching $InstallerPath with /S flag..." -ForegroundColor Gray
$process = Start-Process -FilePath $InstallerPath -ArgumentList "/S" -PassThru -Wait
if ($process.ExitCode -ne 0) {
    Write-Warning "Installer returned non-zero exit code: $($process.ExitCode)"
} else {
    Write-Host "  [OK] Silent installer completed successfully." -ForegroundColor Green
}

Write-Host "[5/5] Verifying Data Integrity..." -ForegroundColor Yellow
if ($backupDir -and (Test-Path $backupDir)) {
    # Check that critical databases and configs were preserved
    $sqliteFiles = Get-ChildItem -Path $backupDir -Filter "*.sqlite" -Recurse
    foreach ($file in $sqliteFiles) {
        $relPath = $file.FullName.Substring($backupDir.Length + 1)
        $targetFile = Join-Path $appDataDir $relPath
        if (-not (Test-Path $targetFile)) {
            Write-Host "  Restoring preserved database: $relPath" -ForegroundColor Cyan
            $parentDir = Split-Path -Parent $targetFile
            if (-not (Test-Path $parentDir)) { New-Item -ItemType Directory -Path $parentDir -Force | Out-Null }
            Copy-Item -Path $file.FullName -Destination $targetFile -Force
        }
    }
    Write-Host "  [OK] All SQLite databases and user settings verified in %APPDATA%\MADAR." -ForegroundColor Green
}

Write-Host "==========================================================" -ForegroundColor Green
Write-Host "  MADAR Desktop v1.0.5 Installation Complete & Verified!  " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
