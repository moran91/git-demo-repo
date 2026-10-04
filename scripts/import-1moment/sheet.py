"""Before/after contact sheet for a job list: python sheet.py data/sample.json data/sample-sheet.jpg"""
import json, io, sys, urllib.request
from PIL import Image
jobs = json.load(open(sys.argv[1])); tiles = []
for j in jobs:
    a = Image.open(io.BytesIO(urllib.request.urlopen(urllib.request.Request(j['url'], headers={'User-Agent': 'Mozilla/5.0'})).read())).convert('RGB')
    a.thumbnail((400, 400)); A = Image.new('RGB', (400, 400), 'white'); A.paste(a, ((400 - a.width) // 2, (400 - a.height) // 2))
    b = Image.open(f"out/{j['key']}.webp").convert('RGB').resize((400, 400))
    t = Image.new('RGB', (810, 400), 'white'); t.paste(A, (0, 0)); t.paste(b, (410, 0)); tiles.append(t)
rows = (len(tiles) + 1) // 2
sheet = Image.new('RGB', (1630, rows * 410), 'white')
for i, t in enumerate(tiles): sheet.paste(t, ((i % 2) * 820, (i // 2) * 410))
sheet.save(sys.argv[2], quality=85)
