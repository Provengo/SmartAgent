#!/bin/bash
#SBATCH --job-name=provengo-array
#SBATCH --partition=cpu
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=2
#SBATCH --mem=4G
#SBATCH --time=01:00:00
#SBATCH --output=/home/geraw/provengo-smart-agent/results/verify-%A_%a.out
#SBATCH --error=/home/geraw/provengo-smart-agent/results/verify-%A_%a.err

set -euo pipefail
: "${MANIFEST:?Set MANIFEST to an absolute remote manifest path}"
: "${BUNDLE_ROOT:?Set BUNDLE_ROOT to the extracted repository root}"

JAVA=/home/geraw/.conda/envs/provengo/bin/java
JAR=/home/geraw/provengo-smart-agent/bin/provengo-verification.jar
LINE=$(sed -n "$((SLURM_ARRAY_TASK_ID + 1))p" "$MANIFEST")
IFS='|' read -r LABEL DEPTH PROJECT <<< "$LINE"

echo "label=$LABEL"
echo "node=$(hostname)"
echo "depth=$DEPTH"
echo "project=$PROJECT"
START=$(date +%s)

"$JAVA" -jar "$JAR" --batch-mode --no-color verify \
  --max-depth "$DEPTH" \
  -o "/home/geraw/provengo-smart-agent/results/${SLURM_ARRAY_JOB_ID}_${SLURM_ARRAY_TASK_ID}-${LABEL}.html" \
  "$BUNDLE_ROOT/$PROJECT"

END=$(date +%s)
echo "elapsed_seconds=$((END-START))"
