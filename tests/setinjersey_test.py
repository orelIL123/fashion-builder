#!/usr/bin/env python3
"""Football jersey with set-in sleeves from a CLO 3D project (?g=setinjersey; old ?g=womenjersey links redirect here): 19 pieces
(front, upper/lower back, sleeves, cuffs, yokes, side, underarm and neck panels), plain white, prints land on the right side,
size chart = adult jersey preset (Arvion teamwear). See clo_jersey_common.py. Run a local server first: python3 -m http.server 8765"""
import sys
from clo_jersey_common import run

IDS = ['front', 'back', 'backLow', 'sleeveR', 'sleeveL', 'yokeR', 'yokeL', 'sideR', 'sideL', 'sideLowR', 'sideLowL',
       'neckR', 'neckL', 'uaRF', 'uaRB', 'uaLF', 'uaLB', 'cuffR', 'cuffL']
if __name__ == '__main__':
    try: run('setinjersey', IDS, 'Football jersey · set-in sleeve', 'jersey',
             [47, 50, 53, 56, 59, 62, 65], [68, 70, 72, 74, 76, 78, 80])
    except Exception as e: print('TEST_FAIL', e, file=sys.stderr); sys.exit(1)
