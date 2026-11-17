## Install script for MADAR Windows desktop
# Prompt user for installation folder (default to %LOCALAPPDATA%\Madar)
$default = "$env:LOCALAPPDATA\Madar"
$installPath = Read-Host "Enter installation folder (default: $default)"
if ([string]::IsNullOrWhiteSpace($installPath)) {
    $installPath = $default
}

# Ensure the folder exists
if (-not (Test-Path $installPath)) {
    New-Item -ItemType Directory -Path $installPath -Force | Out-Null
}

# Extract bundled app files (assumes they are placed in a sub‑folder named 'app')
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Copy-Item -Recurse -Force "${scriptDir}\app\*" $installPath

# Add the code signing certificate to Trusted Root (requires admin rights)
$certPath = Join-Path $scriptDir "madar-codesign.cer"
if (-not (Test-Path $certPath)) {
    $certPath = Join-Path $scriptDir "cert.cer"
}
if (Test-Path $certPath) {
    Write-Host "Adding certificate to Trusted Root…"
    certutil -addstore -f "Root" $certPath
}

# Create a desktop shortcut for the installed app
$shortcutPath = "$env:USERPROFILE\Desktop\Madar.lnk"
$ws = New-Object -ComObject WScript.Shell
$shortcut = $ws.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "${installPath}\Madar.exe"
$shortcut.WorkingDirectory = $installPath
$shortcut.Save()