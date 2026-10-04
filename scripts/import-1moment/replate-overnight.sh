#!/bin/zsh
# Unattended: replate every studio photo onto Morano serveware, fetch results, swap them into qareeb-dev, build the review page.
set -u
cd "$(dirname "$0")"
M=~/.venvs/qareeb-import/bin/modal
LOG=plated/replate.log; mkdir -p plated meta
exec >> "$LOG" 2>&1
echo "== start $(date)"
for attempt in 1 2 3; do   # finished keys are skipped, so a retry only redoes what is missing
  caffeinate -i $M run restyle.py::replate --jobs data/jobs.json --mode ref && break
  echo "== attempt $attempt failed, retrying"; sleep 60
done
$M volume get --force qareeb-restyle plated ./
$M volume get --force qareeb-restyle meta ./
(cd ../../functions && npx tsx ../scripts/import-1moment/apply-restyle.ts --variant=plated --apply)
python3 review.py plated
echo "== done $(date)"
