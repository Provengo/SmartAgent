param(
  [Parameter(Mandatory=$true)][string]$Workspace,
  [Parameter(Mandatory=$true)][string]$PromptFile,
  [Parameter(Mandatory=$true)][string]$EventLog,
  [Parameter(Mandatory=$true)][string]$LastMessage,
  [string]$Model = "gpt-5.6-terra"
)

$ErrorActionPreference = "Stop"
$prompt = Get-Content -Raw -LiteralPath $PromptFile
$ErrorActionPreference = "Continue"
$prompt | codex exec --model $Model --approve-for-me `
  --ignore-user-config --skip-git-repo-check --json --cd $Workspace `
  --output-last-message $LastMessage - 2>&1 | Tee-Object -FilePath $EventLog
$exitCode = $LASTEXITCODE
$started = Get-Content -LiteralPath $EventLog | Select-String '"type":"thread.started"' | Select-Object -First 1
if ($started) {
  $threadId = ($started.Line | ConvertFrom-Json).thread_id
  [IO.File]::WriteAllText((Join-Path $Workspace "thread-id.txt"), $threadId,
    [Text.UTF8Encoding]::new($false))
}
exit $exitCode
