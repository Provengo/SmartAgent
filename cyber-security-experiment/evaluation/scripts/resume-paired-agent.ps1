param(
  [Parameter(Mandatory=$true)][string]$Workspace,
  [Parameter(Mandatory=$true)][string]$PromptFile,
  [Parameter(Mandatory=$true)][string]$EventLog,
  [Parameter(Mandatory=$true)][string]$LastMessage,
  [string]$Model = "gpt-5.6-terra"
)

$ErrorActionPreference = "Stop"
$threadId = (Get-Content -Raw -LiteralPath (Join-Path $Workspace "thread-id.txt")).Trim()
if (!$threadId) { throw "Missing thread id for paired continuation" }
$prompt = Get-Content -Raw -LiteralPath $PromptFile
$ErrorActionPreference = "Continue"
$prompt | codex exec resume --model $Model `
  --ignore-user-config --skip-git-repo-check --json `
  --output-last-message $LastMessage $threadId - 2>&1 | Tee-Object -FilePath $EventLog
exit $LASTEXITCODE
