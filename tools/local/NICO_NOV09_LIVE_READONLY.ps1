#Requires -Version 5.1
<#
  NICO FACTORY / Nov 9 release GO-NO-GO evidence.
  No deploy, billing/IAM/Rules changes, user creation, or business-data writes.
  Only launches four reviewed GET-only GitHub Actions on main.
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
  throw 'GitHub CLI (gh) が見つかりません。gh auth login を使えるPCで実行してください。'
}
& gh auth status 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw 'GitHub未ログインです。gh auth login を先に行ってください。'
}
$headText = & gh api "repos/$repo/branches/main" --jq '.commit.sha'
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($headText)) {
  throw 'mainを取得できません。GitHubログインとリポジトリアクセスを確認してください。'
}
$head = ([string]$headText).Trim()
if ($head -notmatch '^[0-9a-f]{40}$') { throw '不正なmainコミットです。' }
$began = [DateTimeOffset]::UtcNow.AddMinutes(-2)
Write-Host "NICO $project / READ ONLY / main=$($head.Substring(0,8))"
Write-Host '本番Functions/兼務者/バックアップ/件数の読み取り監査のみ。配備・書換えなし。'
$dispatched = @()
foreach ($wf in $workflows) {
  Write-Host "START $wf"
  & gh workflow run $wf --repo $repo --ref main | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "WORKFLOW_DISPATCH_FAILED: $wf" }
  $dispatched += $wf
}
$results = @()
foreach ($wf in $dispatched) {
  $found = $null
  for ($i = 0; $i -lt 24; $i++) {
    $raw = & gh run list --repo $repo --workflow $wf --event workflow_dispatch --branch main --limit 15 --json databaseId,headSha,createdAt,status,conclusion
    if ($LASTEXITCODE -ne 0) { throw "RUN_LIST_FAILED: $wf" }
    $rows = @($raw | ConvertFrom-Json)
    $found = @($rows | Where-Object {
      $_.headSha -eq $head -and
      [DateTimeOffset]::Parse([string]$_.createdAt) -ge $began
    } | Sort-Object -Property databaseId -Descending | Select-Object -First 1)
    if ($found.Count -gt 0) { $found = $found[0]; break }
    Start-Sleep -Seconds 3
  }
  if ($null -eq $found -or -not $found.databaseId) {
    throw "RUN_NOT_FOUND: $wf (GitHub Actions一覧で検索してください)"
  }
  $results += [pscustomobject]@{
    Workflow = $wf
    RunId = [string]$found.databaseId
    Result = 'PENDING'
    URL = "https://github.com/$repo/actions/runs/$($found.databaseId)"
  }
}
foreach ($job in $results) {
  Write-Host "WATCH $($job.Workflow): $($job.URL)"
  & gh run watch $job.RunId --repo $repo --exit-status
  $code = $LASTEXITCODE
  $raw = & gh run view $job.RunId --repo $repo --json conclusion,status
  if ($LASTEXITCODE -ne 0) {
    $job.Result = 'UNVERIFIED'
  } else {
    $detail = ($raw | ConvertFrom-Json)
    $job.Result = if ($code -eq 0 -and $detail.status -eq 'completed' -and
      $detail.conclusion -eq 'success') { 'PASS' } else { 'BLOCK' }
  }
}
Write-Host ''
Write-Host '====== NICO RELEASE READ-ONLY RESULTS ======'
foreach ($job in $results) {
  Write-Host "$($job.Result) $($job.Workflow) $($job.URL)"
}
Write-Host 'PRODUCTION_DOCUMENT_WRITES=0 RULES_APPLIED=NO FUNCTIONS_DEPLOYED=NO'
Write-Host 'PASSでも実アカウントのGET/LIST拒否・件数入力成功の証明ではありません。'
if (-not $NoBrowser) {
  Start-Process 'https://nico-factory.web.app/finance-boundary-four.html'
  Start-Process 'https://nico-factory.web.app/partner-workspace.html'
}
$blocked = @($results | Where-Object { $_.Result -ne 'PASS' })
if ($blocked.Count -gt 0) {
  Write-Warning '監査に未合格があります。上記URLの失敗ステップを確認してください。'
  exit 2
}
Write-Host 'ALL_READONLY_AUDITS_PASS / 実アカウント検証とRules切替は別工程'
exit 0
