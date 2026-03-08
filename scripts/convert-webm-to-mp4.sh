#!/usr/bin/env bash
set -euo pipefail

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is not installed."
  echo "Install on macOS: brew install ffmpeg"
  exit 1
fi

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <input.webm> [output.mp4]"
  exit 1
fi

INPUT="$1"
if [[ ! -f "$INPUT" ]]; then
  echo "Input file not found: $INPUT"
  exit 1
fi

if [[ $# -ge 2 ]]; then
  OUTPUT="$2"
else
  OUTPUT="${INPUT%.*}.mp4"
fi

ffmpeg -y \
  -i "$INPUT" \
  -c:v libx264 \
  -preset slow \
  -crf 16 \
  -pix_fmt yuv420p \
  -movflags +faststart \
  -an \
  "$OUTPUT"

echo "MP4 created: $OUTPUT"
