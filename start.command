#!/bin/bash
cd "$(dirname "$0")" || exit 1
( sleep 1; open "http://localhost:8765/" ) &
python3 -m http.server 8765
