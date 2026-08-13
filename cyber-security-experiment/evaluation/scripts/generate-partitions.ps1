param(
  [Parameter(Mandatory=$true)][string]$SourceProject,
  [Parameter(Mandatory=$true)][string]$OutputRoot,
  [Parameter(Mandatory=$true)][string]$Manifest,
  [int]$Depth = 42
)

$ErrorActionPreference = "Stop"
$source = (Resolve-Path $SourceProject).Path
$items = @("503", "401", "504", "EVICTION")

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
  if (Test-Path -LiteralPath $destination) {
    throw "Refusing to overwrite frozen partition: $destination"
  }
  Copy-Item -Recurse $source $destination
  $modelPath = Join-Path $destination "spec/js/model.js"
  $model = Get-Content -Raw $modelPath
  $arrayLiteral = '["' + ($order -join '","') + '"]'
  $needle = "let disruptionOrder=null, disruptionIndex=0;"
  if (!$model.Contains($needle)) { throw "Partition marker not found in $modelPath" }
  $model = $model.Replace($needle, "let disruptionOrder=$arrayLiteral, disruptionIndex=0;")
  [IO.File]::WriteAllText($modelPath, $model, [Text.UTF8Encoding]::new($false))
  $project = ($destination -replace '\\','/')
  $manifestLines += "$label|$Depth|$project"
  $index++
}
[IO.File]::WriteAllText((Join-Path (Get-Location) $Manifest),
  (($manifestLines -join "`n") + "`n"), [Text.UTF8Encoding]::new($false))
Write-Host "Generated $index partitions"
