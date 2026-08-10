#!/bin/bash
#SBATCH --job-name=provengo-smoke
#SBATCH --partition=debug
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=1
#SBATCH --mem=2G
#SBATCH --time=00:05:00
#SBATCH --output=/home/geraw/provengo-smart-agent/results/smoke-%j.out
#SBATCH --error=/home/geraw/provengo-smart-agent/results/smoke-%j.err

set -euo pipefail
JAVA=/home/geraw/.conda/envs/provengo/bin/java
JAR=/home/geraw/provengo-smart-agent/bin/provengo-verification.jar

hostname
"$JAVA" -version
"$JAVA" -jar "$JAR" --batch-mode --no-color --version
