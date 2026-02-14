# Memorial 3D Symbol Models (Biblical theme accents)

## Where to store models
assets/models/
├── symbols/
│   └── glb/
│       ├── scroll_open_01.glb
│       ├── candle_01.glb
│       └── tower_01.glb
└── _meta/
    └── models.json

## Mandatory rules
- Models are *accents only*.
- The Scripture text must remain absolutely paramount:
  - models appear only after most text has revealed (default 65–72%)
  - small viewport placement in a corner
  - low opacity (≤ 0.22 default)
  - enforced cooldown across verses
- Prohibited imagery must never be used:
  - cherubs, anthropomorphic gods, skulls, coins, occult symbols.

## Format
Use GLB (binary glTF). Keep geometry low-poly.

## Metadata
All meaning lives in `assets/models/_meta/models.json`:
- themeTags drive deterministic selection
- spawnPolicy enforces restraint and timing
- renderHints control anchor and viewport size
