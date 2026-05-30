# The Lamp Background Video System (WoW terrain loops)

## Mandatory constraints
- Source: captured manually from https://noclip.website/
- World of Warcraft terrain only:
  - No NPCs, no characters, no UI, no prominent objects.
- Motion:
  - Slow, contemplative; minimal acceleration.
- Looping:
  - 6–12 seconds ideal.
  - Mark `loopSafe: false` if the clip is not safe.

## Capture guidance aligned with The Lamp pipeline
- Aspect: 9:16 vertical
- Internal compositor: 360×640 (pixelated intentionally)
- Presentation: 720×1280 @ ~24fps
- Tips:
  - Keep paths steady; avoid fast parallax and sharp turns.

## Structure
assets/video/
├── wow/
│   ├── classic/
│   ├── tbc/
│   └── wotlk/
└── _meta/
    └── videos.json

## Filename convention (no meaning encoded)
<map>_<region>_<vantage>_<motion>.mp4

All meaning lives in videos.json:
- theme tags
- palette weighting
- mood
- loop safety

## Runtime
- Deterministic selection from verse themes.
- Muted autoplay-safe; loops; cropped to 9:16.
- If missing, The Lamp runs with a deterministic fallback background.
