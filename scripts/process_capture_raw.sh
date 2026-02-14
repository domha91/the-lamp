#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

IN_DIR="_capture_raw"
OUT_ROOT="assets/video/wow"

mkdir -p "$OUT_ROOT/classic" "$OUT_ROOT/tbc" "$OUT_ROOT/wotlk"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing dependency: $1"; exit 1; }; }
need ffmpeg

# Decide expansion from filename prefix (zone)
expansion_for() {
  local base="$1"

  # TBC zones / areas in your capture set
  if [[ "$base" =~ ^(azuremist_isles|eversong_woods|hellfire_peninsula|nagrand|shadowmoon_valley|terokkar_forest|terrokar_forest|zangarmarsh|caverns_of_time|blades_edge|sunstrider_isle) ]]; then
    echo "tbc"; return
  fi

  # WotLK zones / areas
  if [[ "$base" =~ ^(borean_tundra|borean_tunda|crystalsong_forest|dragonblight|grizzly_hills|howling_fjord|icecrown|sholazar_basin|storm_peaks|wintergrasp|zul_drak) ]]; then
    echo "wotlk"; return
  fi

  # Everything else treated as classic-era (includes GM island / emerald dream / hyjal captures)
  echo "classic"
}

# Video filter: force CFR 24, keep as-is resolution unless you *need* to force 720x1280.
VF_BASE='fps=24,format=yuv420p'

# If you want to force 720x1280, replace VF_BASE with this:
# VF_BASE='fps=24,scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,format=yuv420p'

encode_static() {
  local in="$1" out="$2"
  ffmpeg -y -i "$in" -an \
    -vf "$VF_BASE" \
    -c:v libx264 -crf 18 -preset veryfast \
    -movflags +faststart \
    "$out"
}

encode_pingpong() {
  local in="$1" out="$2"
  # forward + reverse (drop audio)
  ffmpeg -y -i "$in" -an \
    -filter_complex "[0:v]${VF_BASE},split[vf][vr];[vr]reverse[rev];[vf][rev]concat=n=2:v=1:a=0[v]" \
    -map "[v]" \
    -c:v libx264 -crf 18 -preset veryfast \
    -movflags +faststart \
    "$out"
}

shopt -s nullglob
for f in "$IN_DIR"/*.mkv; do
  bn="$(basename "$f")"
  base="${bn%.mkv}"

  exp="$(expansion_for "$base")"
  out="$OUT_ROOT/$exp/${base}.mp4"

  if [[ -f "$out" ]]; then
    echo "SKIP (exists): $out"
    continue
  fi

  echo "PROCESS: $bn -> $out"

  if [[ "$base" == *dollyin* ]]; then
    encode_pingpong "$f" "$out"
  else
    encode_static "$f" "$out"
  fi
done

echo "Done."
