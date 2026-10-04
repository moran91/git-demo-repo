"""Studio vs plated sheet: python sheet3.py data/plate-sample.json data/plate-sheet.jpg"""
import json, os, sys
from PIL import Image, ImageDraw
jobs = json.load(open(sys.argv[1])); tiles = []
for j in jobs:
    k = j['key']; m = json.load(open(f'meta/{k}.json'))
    a = Image.open(f'out/{k}.webp').convert('RGB').resize((380, 380))
    b = Image.open(f'plated/{k}.webp').convert('RGB').resize((380, 380)) if os.path.exists(f'plated/{k}.webp') else Image.new('RGB', (380, 380), '#ddd')
    t = Image.new('RGB', (770, 400), 'white'); t.paste(a, (0, 20)); t.paste(b, (390, 20))
    ImageDraw.Draw(t).text((4, 4), f"{k} {m['category']} {m['texture']} -> {m['serveware']}", fill='black'); tiles.append(t)
rows = (len(tiles) + 1) // 2
sheet = Image.new('RGB', (1550, rows * 405), 'white')
for i, t in enumerate(tiles): sheet.paste(t, ((i % 2) * 780, (i // 2) * 405))
sheet.save(sys.argv[2], quality=82)
