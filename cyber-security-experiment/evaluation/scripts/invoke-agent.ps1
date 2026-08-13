param(
  [Parameter(Mandatory=$true)][string]$Workspace,
  [Parameter(Mandatory=$true)][string]$PromptFile,
  [Parameter(Mandatory=$true)][string]$EventLog,
  [Parameter(Mandatory=$true)][string]$LastMessage,
  [string]$Model = "gpt-5.6-terra"
)

$ErrorActionPreference = "Stop"
$prompt = Get-Content -Raw -LiteralPath $PromptFile
$ErrorActionPreference = "Continue" # Codex emits non-fatal shell-snapshot warnings on stderr.
$prompt | codex exec --model $Model --dangerously-bypass-approvals-and-sandbox `
  --ignore-user-config --ephemeral --skip-git-repo-check --json `
  --cd $Workspace --output-last-message $LastMessage - 2>&1 |
  Tee-Object -FilePath $EventLog
exit $LASTEXITCODE
