#!/usr/bin/env python3
"""Women's football jersey from a CLO 3D project (?g=womenjersey): 19 pieces (front, upper/lower back, sleeves, cuffs, yokes,
side, underarm and neck panels), plain white, prints land on the right side, size chart = women's jersey preset (MAJOR).
See clo_jersey_common.py. Run a local server first: python3 -m http.server 8765"""
import sys
from clo_jersey_common import run

IDS = ['front', 'back', 'backLow', 'sleeveR', 'sleeveL', 'yokeR', 'yokeL', 'sideR', 'sideL', 'sideLowR', 'sideLowL',
       'neckR', 'neckL', 'uaRF', 'uaRB', 'uaLF', 'uaLB', 'cuffR', 'cuffL']
if __name__ == '__main__':
    try: run('womenjersey', IDS, "Women's football jersey", 'jerseyWomen',
             [44.5, 47, 49.5, 52, 54.5, 57, 59.5], [59.5, 63, 65.5, 68, 70, 72, 73.5])
    except Exception as e: print('TEST_FAIL', e, file=sys.stderr); sys.exit(1)
