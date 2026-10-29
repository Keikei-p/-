#requires -Version 5.1
<#
営業実績アプリ: existing encrypted .salesbak verification.
Never reads/writes production Firestore; optional restore is localhost demo ONLY.
Usage: powershell -NoProfile -File .\scripts\verify-sales-backup.ps1
       powershell -NoProfile -File .\scripts\verify-sales-backup.ps1 -RunLocalRestore
#>
param(
  [string]$BackupFile = "",
  [switch]$RunLocalRestore,
  [switch]$FindBackups
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$envNames = @("SALES_BACKUP_PASSPHRASE", "SALES_BACKUP_FILE",
  "GOOGLE_APPLICATION_CREDENTIALS", "GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT")
$savedEnv = @{}
foreach ($key in $envNames) {
  $savedEnv[$key] = [Environment]::GetEnvironmentVariable($key, "Process")
}
Push-Location $repoRoot
try {
  if ($FindBackups) {
    # Local filesystem search ONLY; no credentials, Firebase API or network calls.
    $folders = @(
      (Join-Path $HOME "Downloads"),
      (Join-Path $HOME "Documents"),
      (Join-Path $HOME "Desktop"),
      (Join-Path $HOME "OneDrive"),
      (Join-Path $HOME "OneDrive\Documents")
    ) | Select-Object -Unique
    $candidates = @(
      foreach ($folder in $folders) {
        if (Test-Path -LiteralPath $folder -PathType Container) {
          Get-ChildItem -LiteralPath $folder -Filter "*.salesbak" -File -Recurse -ErrorAction SilentlyContinue
        }
      }
    ) | Sort-Object FullName -Unique
    if ($candidates.Count -gt 0) {
      Write-Host "FOUND: existing .salesbak files (newest first):"
      $candidates | Sort-Object LastWriteTime -Descending | ForEach-Object { Write-Host $_.FullName }
    } else {
      Write-Host "NOT FOUND: no .salesbak file in the common Downloads/Documents/Desktop/OneDrive folders."
      Write-Host "This does NOT mean your Firestore data or other backups were deleted."
      Write-Host "Check other drives/external storage; a Firebase export or ZIP is NOT an encrypted .salesbak."
      Write-Host "Do NOT run the restore verifier without an existing .salesbak file."
    }
    return
  }
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js 22+ is required."
  }
  $versionString = (& node --version)
  $nodeMajor = [int]($versionString -replace "^v([0-9]+)\..*$", '$1')
  if ($nodeMajor -lt 22) { throw "BLOCK: Node.js 22 or newer is required." }
  if (-not $BackupFile) {
    $BackupFile = Read-Host "Absolute path of an existing encrypted backup file (.salesbak)"
  }
  # Pasting a command into the path prompt must fail cleanly, not with an
  # unhandled Windows Path.IsPathRooted invalid-character exception.
  $BackupFile = [string]$BackupFile
  $BackupFile = $BackupFile.Trim().Trim('"').Trim("'")
  $isAbsolute = $false
  try { $isAbsolute = [IO.Path]::IsPathRooted($BackupFile) } catch { $isAbsolute = $false }
  if (-not $BackupFile -or -not $isAbsolute -or
      -not $BackupFile.EndsWith(".salesbak", [StringComparison]::OrdinalIgnoreCase) -or
      -not (Test-Path -LiteralPath $BackupFile -PathType Leaf)) {
    throw "BLOCK: paste an existing full .salesbak file path, NOT a PowerShell command. Use -FindBackups to search common folders."
  }
  $file = (Resolve-Path -LiteralPath $BackupFile).Path
  $secure = Read-Host "Encrypted backup passphrase (hidden)" -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    $env:SALES_BACKUP_PASSPHRASE = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
  if (-not $env:SALES_BACKUP_PASSPHRASE -or
      $env:SALES_BACKUP_PASSPHRASE.Length -lt 20) {
    throw "BLOCK: backup passphrase must have at least 20 characters."
  }
  # Offline verify and audit MUST NOT inherit credentials to production.
  [Environment]::SetEnvironmentVariable("GOOGLE_APPLICATION_CREDENTIALS", $null, "Process")
  & node tools/readonly-backup/backup.mjs verify --file $file
  if ($LASTEXITCODE -ne 0) { throw "BLOCK: backup integrity verification failed." }
  & node tools/readonly-backup/backup.mjs audit --file $file
  if ($LASTEXITCODE -ne 0) { throw "BLOCK: backup counts/integrity mismatch." }
  Write-Host "PASS: local encrypted file integrity and archived count audit."
  Write-Host "NOT PROVEN: all live records captured, Auth/Storage, point-in-time consistency or restoration."
  if ($RunLocalRestore) {
    if (-not (Get-Command firebase -ErrorAction SilentlyContinue)) {
      throw "BLOCK: Firebase CLI is not installed. Install locally before optional emulator-only restoration."
    }
    $env:SALES_BACKUP_FILE = $file
    $env:GCLOUD_PROJECT = "demo-sales-restore"
    $env:GOOGLE_CLOUD_PROJECT = "demo-sales-restore"
    # No user-controlled path or token is interpolated into the shell command.
    # Firebase CLI starts its own local Firestore emulator; never cloud import.
    & firebase emulators:exec --only firestore --project demo-sales-restore "node scripts/restore-sales-from-env.mjs"
    if ($LASTEXITCODE -ne 0) { throw "BLOCK: isolated emulator restoration failed." }
    Write-Host "PASS: local emulator field/ID roundtrip; live Firestore was never modified."
  } else {
    Write-Host "For local restore verification, rerun with -RunLocalRestore after installing Firebase CLI."
  }
  Write-Host "STOP: production deletion / Rules deployment is NOT approved by these checks."
} finally {
  foreach ($key in $envNames) {
    [Environment]::SetEnvironmentVariable($key, $savedEnv[$key], "Process")
  }
  Pop-Location
}
