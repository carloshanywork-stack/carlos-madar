# MADAR storage migration — Windows (PowerShell).
#
# Mirrors the Linux script: copy active storage and a separate verified
# pre-migration backup to the second drive, then replace the old path with a
# junction. The backup is a sibling of the active storage directory, not inside
# the live storage tree.
#
# Run from the repository root (or anywhere; the root is detected from git):
#   powershell -ExecutionPolicy Bypass -File madar-v2\scripts\migrate-storage-to-d.ps1
# Dry run (shows what would happen, copies nothing):
#   .\migrate-storage-to-d.ps1 -DryRun

[CmdletBinding()]
param(
  [string]$TargetRoot = 'D:\madar-storage',
  [string]$BackupPath = '',
  [string[]]$Pm2Apps = @('madar-v2', 'madar-autodeploy'),
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$repoRoot = (& git -C $PSScriptRoot rev-parse --show-toplevel).Trim()
$src = Join-Path $repoRoot 'storage'
$dest = $TargetRoot
$backup = if ($BackupPath.Trim()) { $BackupPath } else {
  Join-Path (Split-Path $dest -Parent) 'storage_pre_migration_backup'
}
$localHold = Join-Path $repoRoot ".storage-pre-migration-hold-$PID"

Write-Host "[migrate-storage] repo: $repoRoot"
Write-Host "[migrate-storage] source: $src"
Write-Host "[migrate-storage] active destination (second drive): $dest"
Write-Host "[migrate-storage] pre-migration backup (second drive): $backup"

if (-not (Test-Path -LiteralPath $src -PathType Container)) { throw "storage folder not found: $src" }
$srcItem = Get-Item -LiteralPath $src -Force
if ($srcItem.LinkType) { Write-Host "[migrate-storage] storage is already a link ($($srcItem.LinkType)); nothing to do."; exit 0 }
if (Test-Path -LiteralPath $backup) { throw "backup path already exists, refusing to overwrite it: $backup" }
if (Test-Path -LiteralPath $localHold) { throw "temporary safety path already exists: $localHold" }
if (-not (Test-Path -LiteralPath (Split-Path $dest))) { throw "drive not found or path invalid: $dest" }
$destFull = [IO.Path]::GetFullPath($dest).TrimEnd('\')
$backupFull = [IO.Path]::GetFullPath($backup).TrimEnd('\')
if ($destFull.Equals($backupFull, [StringComparison]::OrdinalIgnoreCase)
    -or $backupFull.StartsWith("$destFull\", [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Pre-migration backup must be separate from and outside the active storage directory.'
}
if ($destFull.StartsWith("$backupFull\", [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Active storage cannot be nested inside the pre-migration backup directory.'
}
if (-not ([IO.Path]::GetPathRoot($destFull).Equals([IO.Path]::GetPathRoot($backupFull), [StringComparison]::OrdinalIgnoreCase))) {
  throw 'Active storage and pre-migration backup must be on the same second-storage drive.'
}
if ([IO.Path]::GetPathRoot($destFull).Equals([IO.Path]::GetPathRoot([IO.Path]::GetFullPath($repoRoot)), [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Target drive must be different from the repository drive.'
}

if ($DryRun) {
  Write-Host "[dry-run] would stop PM2 apps: $($Pm2Apps -join ', ')"
  Write-Host "[dry-run] would copy and verify active storage: $src -> $dest"
  Write-Host "[dry-run] would copy and verify pre-migration backup: $src -> $backup"
  Write-Host "[dry-run] would install junction: $src -> $dest"
  Write-Host "[dry-run] would restart PM2 apps: $($Pm2Apps -join ', ')"
  exit 0
}

if (-not (Test-Path -LiteralPath $dest)) { New-Item -ItemType Directory -Path $dest | Out-Null }
if (-not (Test-Path -LiteralPath $backup)) { New-Item -ItemType Directory -Path $backup | Out-Null }

# --- 1. Stop the application -------------------------------------------------
& pm2 stop @Pm2Apps 2>$null
if ($LASTEXITCODE -ne 0) { Write-Warning '[migrate-storage] pm2 stop did not complete; check apps manually' }

# --- 2. Copy active data and pre-migration backup ----------------------------
function Copy-StorageTree($target) {
  Write-Host "[migrate-storage] robocopy $src -> $target"
  & robocopy $src $target /E /COPYALL /R:2 /W:2 /LOG+:C:\madar-storage-migration.log
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed with code $LASTEXITCODE (see C:\madar-storage-migration.log); original untouched" }
}

Copy-StorageTree $dest
Copy-StorageTree $backup

function Get-StorageManifest($path) {
  $files = (Get-ChildItem -LiteralPath $path -Recurse -File -Force)
  $bytes = ($files | Measure-Object -Property Length -Sum).Sum
  if ($null -eq $bytes) { $bytes = 0 }
  $root = [IO.Path]::GetFullPath($path).TrimEnd('\') + '\'
  $entries = @($files | Sort-Object FullName | ForEach-Object {
    [pscustomobject]@{
      RelativePath = $_.FullName.Substring($root.Length)
      Length = $_.Length
      Sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    }
  })
  [pscustomobject]@{ Files = $files.Count; Bytes = [long]$bytes; Entries = $entries }
}

function Assert-StorageCopy($target, $label) {
  $sourceManifest = Get-StorageManifest $src
  $targetManifest = Get-StorageManifest $target
  Write-Host "[migrate-storage] $label files: source=$($sourceManifest.Files) destination=$($targetManifest.Files)"
  Write-Host "[migrate-storage] $label bytes: source=$($sourceManifest.Bytes) destination=$($targetManifest.Bytes)"
  if ($sourceManifest.Files -ne $targetManifest.Files) { throw "$label file count mismatch; original untouched" }
  if ($sourceManifest.Bytes -ne $targetManifest.Bytes) { throw "$label byte total mismatch; original untouched" }
  for ($index = 0; $index -lt $sourceManifest.Entries.Count; $index++) {
    $sourceEntry = $sourceManifest.Entries[$index]
    $targetEntry = $targetManifest.Entries[$index]
    if ($sourceEntry.RelativePath -cne $targetEntry.RelativePath
        -or $sourceEntry.Length -ne $targetEntry.Length
        -or $sourceEntry.Sha256 -cne $targetEntry.Sha256) {
      throw "$label SHA-256/path mismatch at file index $index; original untouched"
    }
  }
  Write-Host "[migrate-storage] $label per-file SHA-256 verification passed"
}

Assert-StorageCopy $dest 'active storage'
Assert-StorageCopy $backup 'pre-migration backup'

# --- 3. Rename original, create junction -------------------------------------
Move-Item -LiteralPath $src -Destination $localHold
try {
  New-Item -ItemType Junction -Path $src -Target $dest | Out-Null
  if (-not (Test-Path -LiteralPath (Join-Path $src 'Areas'))) { throw "junction read check failed: $src\Areas is not visible" }
} catch {
  if (Test-Path -LiteralPath $src) { [IO.Directory]::Delete($src) }
  Move-Item -LiteralPath $localHold -Destination $src
  throw
}
Write-Host "[migrate-storage] bridge created: $src -> $dest"

# The original local copy is removed only after both second-drive copies passed
# per-file SHA-256 verification and the new junction read check. The retained
# pre-migration backup remains at $backup.
try { Remove-Item -LiteralPath $localHold -Recurse -Force }
catch { Write-Warning "Temporary source copy remains at $localHold; verified backup remains on the second drive at $backup" }

# --- 4. Restart application and probe health ----------------------------------
& pm2 start @Pm2Apps 2>$null
try { (Invoke-WebRequest -Uri 'http://127.0.0.1:3000/api/health' -TimeoutSec 5 -UseBasicParsing).StatusCode }
catch { Write-Warning '[migrate-storage] health check failed; see pm2 logs madar-v2' }

Write-Host "[migrate-storage] done. Pre-migration backup kept on the second drive at: $backup"
