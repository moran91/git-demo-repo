#!/bin/zsh
# Unattended: restyle every food photo on Modal, fetch results, swap them into qareeb-dev, build the review page.
set -u
cd "$(dirname "$0")"
M=~/.venvs/qareeb-import/bin/modal
LOG=out/overnight.log; mkdir -p out
exec >> "$LOG" 2>&1
echo "== start $(date)"
for attempt in 1 2 3; do   # re-runs skip finished photos, so retries only redo failures
  caffeinate -i $M run restyle.py::main --jobs data/jobs.json && break
  echo "== attempt $attempt failed, retrying"; sleep 60
done
$M volume get --force qareeb-restyle out ./
while pgrep -f "import-1moment/import.ts" >/dev/null; do sleep 30; done
(cd ../../functions && npx tsx ../scripts/import-1moment/apply-restyle.ts --apply)
python3 review.py
echo "== done $(date)"
