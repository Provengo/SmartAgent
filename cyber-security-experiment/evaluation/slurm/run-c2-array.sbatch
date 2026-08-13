#!/bin/bash
#SBATCH --job-name=cyber-c2
#SBATCH --partition=cpu
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=2
#SBATCH --mem=8G
#SBATCH --time=02:00:00
#SBATCH --output=/home/geraw/provengo-smart-agent/results/c2-20260813/verify-%A_%a.out
#SBATCH --error=/home/geraw/provengo-smart-agent/results/c2-20260813/verify-%A_%a.err

set -euo pipefail
: "${MANIFEST:?Set MANIFEST}"
: "${BUNDLE_ROOT:?Set BUNDLE_ROOT}"
JAVA=/home/geraw/.conda/envs/provengo/bin/java
JAR=/home/geraw/provengo-smart-agent/bin/provengo-verification.jar
LINE=$(sed -n "$((SLURM_ARRAY_TASK_ID + 1))p" "$MANIFEST")
IFS='|' read -r LABEL DEPTH PROJECT <<< "$LINE"
echo "label=$LABEL"
echo "node=$(hostname)"
echo "depth=$DEPTH"
echo "project=$PROJECT"
START=$(date +%s)
"$JAVA" -jar "$JAR" --batch-mode --no-color verify --max-depth "$DEPTH" \
  -o "/home/geraw/provengo-smart-agent/results/c2-20260813/${SLURM_ARRAY_JOB_ID}_${SLURM_ARRAY_TASK_ID}-${LABEL}.html" \
  "$BUNDLE_ROOT/$PROJECT"
echo "elapsed_seconds=$(($(date +%s)-START))"
