"""Build data/jobs.json: one restyle job per food item photo (Morano and 1moment's own market skipped)."""
import json
SKIP = {'22', '65'}
BASE = 'https://dpelsox4eb9jh.cloudfront.net/product/'
d = json.load(open('data/stores.json'))
jobs = []
for sid, v in d.items():
    if sid in SKIP or v['store']['module_id'] != 2:
        continue
    for it in v['items']:
        im = it.get('image')
        if im and 'def' not in im:
            jobs.append({'key': f"{sid}-{it['id']}", 'url': BASE + im, 'name': it['name']})
json.dump(jobs, open('data/jobs.json', 'w'), ensure_ascii=False)
# sample: spread across stores
sample = [jobs[i] for i in range(0, len(jobs), len(jobs) // 6)][:6]
json.dump(sample, open('data/sample.json', 'w'), ensure_ascii=False)
print(len(jobs), [s['name'] for s in sample])
