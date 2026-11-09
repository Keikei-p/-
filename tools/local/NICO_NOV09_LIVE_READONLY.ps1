#Requires -Version 5.1
<#
NICO FACTORY / SALES RELEASE READ ONLY PC CHECK
ASCII only: Windows PowerShell 5.1 can parse it WITHOUT an UTF-8 BOM.
No deploy, no Rules, no IAM/billing changes, no production data writes.
Run IDs are identified by comparing the list BEFORE and AFTER dispatch.
Never use locale-sensitive timestamps to identify workflow runs.
#>
[CmdletBinding()]
param([switch]$NoBrowser)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = 'Keikei-p/-'
$project = 'sales-management-cc116'
$workflows = @(
  'nico-four-count-cli-region-readonly-20261108.yml',
  'nico-secondary-production-inventory-readonly.yml',
  'nico-managed-backup-restore-preflight-readonly.yml',
  'nico-partner-live-readonly-audit.yml'
)

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw 'GITHUB_CLI_NOT_INSTALLED'
}
& gh auth status 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'GITHUB_NOT_AUTHENTICATED' }

$headOutput = & gh api "repos/$repo/branches/main" --jq '.commit.sha'
if ($LASTEXITCODE -ne 0) { throw 'MAIN_SHA_UNAVAILABLE' }
$head = ([string]$headOutput).Trim()
if ($head -notmatch '^[0-9a-f]{40}$') { throw 'MAIN_SHA_INVALID' }

function Get-ReadOnlyRunList {
  param([Parameter(Mandatory=$true)][string]$Workflow)
  $raw = & gh run list --repo $repo --workflow $Workflow --event workflow_dispatch --branch main --limit 30 --json databaseId,headSha,status,conclusion
  if ($LASTEXITCODE -ne 0) { throw "RUN_LIST_FAILED: $Workflow" }
  $jsonText = ($raw -join '')
  if ([string]::IsNullOrWhiteSpace($jsonText)) { throw "RUN_LIST_EMPTY: $Workflow" }
  $decoded = ConvertFrom-Json -InputObject $jsonText
  return @($decoded)
}

Write-Host "NICO $project / READ ONLY / main=$($head.Substring(0,8))"
Write-Host 'LIVE FUNCTIONS / SECONDARY MEMBERS / BACKUPS / COUNT AUDIT. NO DEPLOY.'
$before = @{}
foreach ($wf in $workflows) {
  $previous = @(Get-ReadOnlyRunList -Workflow $wf)
  $before[$wf] = @($previous | ForEach-Object { [string]$_.databaseId })
}

foreach ($wf in $workflows) {
  Write-Host "START $wf"
  & gh workflow run $wf --repo $repo --ref main | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "WORKFLOW_DISPATCH_FAILED: $wf" }
}

$results = @()
foreach ($wf in $workflows) {
  $match = @()
  for ($i = 0; $i -lt 25; $i++) {
    $rows = @(Get-ReadOnlyRunList -Workflow $wf)
    $match = @($rows | Where-Object {
      $_.headSha -eq $head -and
      $null -ne $_.databaseId -and
      ([string]$_.databaseId -notin $before[$wf])
    })
    if ($match.Count -gt 1) {
      throw "AMBIGUOUS_NEW_WORKFLOW_RUNS: $wf"
    }
    if ($match.Count -eq 1) { break }
    Start-Sleep -Seconds 2
  }
  if ($match.Count -ne 1) { throw "NEW_RUN_NOT_FOUND: $wf" }
  $id = [string]$match[0].databaseId
  $results += [pscustomobject]@{
    Workflow = $wf
    RunId = $id
    Result = 'PENDING'
    URL = "https://github.com/$repo/actions/runs/$id"
  }
}

foreach ($job in $results) {
  Write-Host "WATCH $($job.Workflow): $($job.URL)"
  & gh run watch $job.RunId --repo $repo --exit-status
  $code = $LASTEXITCODE
  $raw = & gh run view $job.RunId --repo $repo --json conclusion,status
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($raw -join ''))) {
    $job.Result = 'UNVERIFIED'
    continue
  }
  $detail = ConvertFrom-Json -InputObject ($raw -join '')
  $job.Result = if ($code -eq 0 -and $detail.status -eq 'completed' -and
    $detail.conclusion -eq 'success') { 'PASS' } else { 'BLOCK' }
}

Write-Host ''
Write-Host '====== NICO RELEASE READ-ONLY RESULTS ======'
foreach ($job in $results) {
  Write-Host "$($job.Result) $($job.Workflow) $($job.URL)"
}
Write-Host 'PRODUCTION_DOCUMENT_WRITES=0 RULES_APPLIED=NO FUNCTIONS_DEPLOYED=NO'
Write-Host 'PASS IS NOT PROOF OF REAL ACCOUNT FINANCE GET/LIST DENIAL.'
if (-not $NoBrowser) {
  Start-Process 'https://nico-factory.web.app/finance-boundary-four.html'
  Start-Process 'https://nico-factory.web.app/partner-workspace.html'
}
$blocked = @($results | Where-Object { $_.Result -ne 'PASS' })
if ($blocked.Count -gt 0) {
  Write-Warning 'READ_ONLY_AUDIT_INCOMPLETE: Review the run URLs above.'
  exit 2
}
Write-Host 'ALL_READONLY_AUDITS_PASS / REAL_ACCOUNT_TESTS_STILL_REQUIRED'
exit 0
