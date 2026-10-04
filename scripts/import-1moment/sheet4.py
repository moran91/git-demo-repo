"""studio | v1 plated | v2 result sheet: python sheet4.py keys.json out.jpg"""
import json, os, sys
from PIL import Image, ImageDraw
keys = json.load(open(sys.argv[1])); S = 170; cols = 3
rows = (len(keys) + cols - 1) // cols
sheet = Image.new('RGB', (cols * (3 * S + 14), rows * (S + 16)), 'white'); d = ImageDraw.Draw(sheet)
def tile(p):
    return Image.open(p).convert('RGB').resize((S, S)) if os.path.exists(p) else Image.new('RGB', (S, S), '#ddd')
for i, k in enumerate(keys):
    x = (i % cols) * (3 * S + 14); y = (i // cols) * (S + 16); m = json.load(open(f'meta2/{k}.json'))
    sheet.paste(tile(f'out/{k}.webp'), (x, y + 14)); sheet.paste(tile(f'plated/{k}.webp'), (x + S + 2, y + 14))
    sheet.paste(tile(f'plated2/{k}.webp') if m['final'] == 'plated' else tile(f'out/{k}.webp'), (x + 2 * S + 4, y + 14))
    d.text((x + 2, y + 1), f"{k} {m['plan'].get('food','?')} -> {m['final']} {m.get('serveware','')}", fill='black')
sheet.save(sys.argv[2], quality=80)
