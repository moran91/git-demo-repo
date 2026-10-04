#!/bin/zsh
# Unattended v2 replating. Waits for the new Modal billing month (free credits reset), then plans, replates
# and judges every photo, swaps passing results in (plated2.webp) and sends the rest back to the studio photo.
set -u
cd "$(dirname "$0")"
M=~/.venvs/qareeb-import/bin/modal
mkdir -p plated2 meta2
LOG=plated2/replate2.log
exec >> "$LOG" 2>&1
START=${START:-"2026-10-01 03:30"}
echo "== waiting for $START ($(date))"
while [[ $(date +%s) -lt $(date -j -f "%Y-%m-%d %H:%M" "$START" +%s) ]]; do sleep 300; done
echo "== start $(date)"
for attempt in $(seq 1 12); do   # finished keys are skipped, so a retry (e.g. after a usage-limit stop) resumes
  caffeinate -i $M run restyle.py::replate2 --jobs data/jobs.json && break
  echo "== attempt $attempt failed $(date), retrying in 30 min"; sleep 1800
done
rm -rf plated2/*.webp meta2
$M volume get --force qareeb-restyle plated2 ./
$M volume get --force qareeb-restyle meta2 ./
(cd ../../functions && npx tsx ../scripts/import-1moment/apply-restyle.ts --variant=plated2 --apply)
python3 review.py plated2
echo "== done $(date)"
