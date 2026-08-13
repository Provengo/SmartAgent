param([Parameter(Mandatory=$true)][string]$Controller)

$ErrorActionPreference = "Stop"
$text = Get-Content -Raw -LiteralPath $Controller
$errors = @()

if (($text | Select-String -AllMatches -Pattern '\bbp\.registerBThread\s*\(|\bbthread\s*\(').Matches.Count -ne 1) {
  $errors += "controller must define exactly one b-thread"
}
if (($text | Select-String -AllMatches -Pattern '\bfunction\b').Matches.Count -ne 1) {
  $errors += "nested or helper functions are forbidden"
}
$checks = [ordered]@{
  '\b(let|const)\b' = 'use var only';
  '=>' = 'arrow functions are forbidden';
  '\bnew\s+RegExp\b|\bRegExp\s*\(' = 'RegExp is forbidden';
  '\.(match|matchAll|exec|test)\s*\(' = 'regex matching APIs are forbidden';
  '/\^|\$/[gimuy]*|/\[[^\r\n]+\]/[gimuy]*|/\([^\r\n]+\)/[gimuy]*' = 'regex literals are forbidden';
  '\bnew\s+(Map|Set|Date|Function)\b' = 'non-primitive state objects are forbidden';
}
foreach ($pattern in $checks.Keys) {
  if ($text -match $pattern) { $errors += $checks[$pattern] }
}

if ($errors.Count -gt 0) {
  $errors | Sort-Object -Unique | ForEach-Object { [Console]::Error.WriteLine($_) }
  exit 2
}
Write-Host "BPjs static compatibility gate passed"
