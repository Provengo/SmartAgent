param([Parameter(Mandatory=$true)][string]$Strategy)

$text = Get-Content -Raw -LiteralPath $Strategy
$errors = @()
if (($text | Select-String -AllMatches -Pattern '\bregisterIncidentController\s*\(').Matches.Count -ne 1) {
  $errors += "strategy must register exactly one controller"
}
if (($text | Select-String -AllMatches -Pattern '\bfunction\b').Matches.Count -ne 1) {
  $errors += "nested/helper functions are forbidden"
}
$checks = [ordered]@{
  '\b(let|const)\b'='use var only';
  '=>'='arrow functions are forbidden';
  '\b(bp|bthread|Provengo|verify|model.?check)\b'='formal-runtime references are forbidden';
  '\bnew\s+RegExp\b|\bRegExp\s*\('='RegExp is forbidden';
  '\.(match|matchAll|exec|test)\s*\('='regex APIs are forbidden';
  '/\^|\$/[gimuy]*|/\[[^\r\n]+\]/[gimuy]*|/\([^\r\n]+\)/[gimuy]*'='regex literals are forbidden';
  '\bnew\s+(Map|Set|Date|Function)\b'='non-primitive state objects are forbidden';
  '\b(require|fetch|XMLHttpRequest|Packages|java)\b'='external access is forbidden';
}
foreach($pattern in $checks.Keys){if($text -match $pattern){$errors += $checks[$pattern]}}
if($errors.Count){$errors|Sort-Object -Unique|ForEach-Object{[Console]::Error.WriteLine($_)};exit 2}
Write-Host "Neutral strategy gate passed"
