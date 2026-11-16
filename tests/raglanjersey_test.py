#!/usr/bin/env python3
"""Raglan football jersey from a CLO 3D project (?g=raglanjersey): 5 pieces, plain white, prints land on the right side,
size chart = adult jersey preset (Arvion teamwear). See clo_jersey_common.py. Run a local server first: python3 -m http.server 8765"""
import sys
from clo_jersey_common import run

if __name__ == '__main__':
    try: run('raglanjersey', ['front', 'back', 'sleeveR', 'sleeveL', 'rib'], 'Raglan football jersey', 'jersey',
             [47, 50, 53, 56, 59, 62, 65], [68, 70, 72, 74, 76, 78, 80])
    except Exception as e: print('TEST_FAIL', e, file=sys.stderr); sys.exit(1)
