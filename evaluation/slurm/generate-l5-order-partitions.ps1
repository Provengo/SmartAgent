param(
  [string]$SourceProject = "evaluation/levels/L5-coupled-backups/guided/checkpoint-mid/rest-backup-controller",
  [string]$OutputRoot = "evaluation/levels/L5-coupled-backups/guided/order-partitions",
  [string]$Manifest = "evaluation/slurm/l5-order-partitions.manifest"
)

$ErrorActionPreference = "Stop"
$source = (Resolve-Path $SourceProject).Path
$modelRelative = "spec/js/model.js"
$items = @("503", "401", "504", "QUOTA")

function Get-Permutations([object[]]$remaining, [object[]]$prefix = @()) {
  if ($remaining.Count -eq 0) { return ,$prefix }
  $result = @()
  foreach ($item in $remaining) {
    $rest = @($remaining | Where-Object { $_ -ne $item })
    $result += @(Get-Permutations $rest ($prefix + $item))
  }
  return $result
}

New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
$manifestLines = @()
$index = 0
foreach ($order in @(Get-Permutations $items)) {
  $label = "order-{0:d2}-{1}" -f $index, (($order -join "-").ToLower())
  $destination = Join-Path $OutputRoot $label
  Copy-Item -Recurse -Force $source $destination
  $modelPath = Join-Path $destination $modelRelative
  $model = Get-Content -Raw $modelPath
  $arrayLiteral = '["' + ($order -join '","') + '"]'
  $model = $model.Replace("let disruptionOrder=null, disruptionIndex=0;", "let disruptionOrder=$arrayLiteral, disruptionIndex=0;")
  Set-Content -NoNewline -Encoding utf8 $modelPath $model
  $project = ($destination -replace '\\','/')
  $manifestLines += "$label|36|$project"
  $index++
}
[IO.File]::WriteAllText(
  (Join-Path (Get-Location) $Manifest),
  (($manifestLines -join "`n") + "`n"),
  [Text.UTF8Encoding]::new($false)
)
Write-Host "Generated $index exhaustive order partitions and $Manifest"
