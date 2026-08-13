param([string]$Strategy = "strategy.js", [int]$Depth = 42)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $root "test-neutral-strategy.ps1") -Strategy (Join-Path $root $Strategy)
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$project = Join-Path $root "development-model"
$model = (Get-Content -Raw (Join-Path $root "open-attacker.js")) + "`n" +
         (Get-Content -Raw (Join-Path $root "neutral-runtime.js")) + "`n" +
         (Get-Content -Raw (Join-Path $root $Strategy))
$model = $model.Replace("let disruptionOrder=null, disruptionIndex=0;",
  'let disruptionOrder=["503","401","504","EVICTION"], disruptionIndex=0;')
[IO.File]::WriteAllText((Join-Path $project "spec\js\model.js"), $model,
  [Text.UTF8Encoding]::new($false))

& java -jar (Join-Path $root "bin\provengo-verification.jar") `
  --batch-mode --no-color verify --max-depth $Depth `
  -o (Join-Path $root "development-counterexample.html") $project 2>&1 |
  Tee-Object -FilePath (Join-Path $root "development-verification.log")
exit $LASTEXITCODE
