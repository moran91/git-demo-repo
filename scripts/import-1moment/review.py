"""Build out/review.html: before/after for every restyled photo; tick the bad ones and copy the list."""
import json, os, html, sys
VARIANT = sys.argv[1] if len(sys.argv) > 1 else "out"
jobs = {j['key']: j for j in json.load(open('data/jobs.json'))}
keys = sorted(k[:-5] for k in os.listdir(VARIANT) if k.endswith('.webp'))
if VARIANT == 'plated2':
    rej = set(open('data/v2-my-rejects.txt').read().split())
    keys = [k for k in keys if k not in rej]
cards = ''.join(
    f'<label class=c><input type=checkbox value="{k}"><img src="{"../out/" + k + ".webp" if VARIANT != "out" else html.escape(jobs[k]["url"])}" loading=lazy><img src="{k}.webp" loading=lazy><span>{html.escape(jobs[k]["name"])} · {k}</span></label>'
    for k in keys if k in jobs)
open(f'{VARIANT}/review.html', 'w').write(f'''<!doctype html><meta charset=utf-8><title>Restyle review</title>
<style>body{{font:13px system-ui;margin:16px;background:#faf7f2}}.g{{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px}}
.c{{display:grid;grid-template-columns:1fr 1fr;gap:4px;background:#fff;padding:6px;border-radius:8px;border:2px solid transparent}}.c img{{width:100%;aspect-ratio:1;object-fit:cover;border-radius:4px}}
.c span{{grid-column:1/-1}}.c input{{position:absolute;opacity:0}}.c:has(input:checked){{border-color:#c33;background:#fee}}
#bar{{position:sticky;top:0;background:#faf7f2;padding:8px 0;display:flex;gap:8px;align-items:center}}textarea{{flex:1;height:34px}}</style>
<div id=bar><b>{len(keys)} photos</b> — click the bad ones, then send me this list:<textarea id=t readonly></textarea></div><div class=g>{cards}</div>
<script>document.addEventListener('change',()=>{{t.value=[...document.querySelectorAll('input:checked')].map(i=>i.value).join(' ')}})</script>''')
print(f'{VARIANT}/review.html', len(keys))
