# Piece-coloured sheet for view.py: python3 sheet.py pattern.json out.png
import json, sys
from PIL import Image, ImageDraw
P = json.load(open(sys.argv[1])); S = P['sheetCm']; k = 16
im = Image.new('RGB', (int(S*k), int(S*k)), (255, 0, 255)); d = ImageDraw.Draw(im)
col = {'front': (220, 60, 60), 'back': (60, 90, 220), 'sleeveR': (240, 200, 40), 'sleeveL': (240, 140, 40), 'rib': (40, 180, 80)}
for p in P['pieces']:
    d.polygon([(x*k, y*k) for x, y in p['outline']], fill=col.get(p['id'], (200, 200, 200)))
    for i in range(0, int(S), 5):  # 5 cm grid inside pieces to see stretch
        pass
im.save(sys.argv[2])
