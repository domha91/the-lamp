# KJV corpus (local)

The Lamp uses a **local KJV-only** corpus (no Bible APIs).

## Source
This project expects the JSON format from the public-domain repository:
- `farskipper/kjv` → `json/verses-1769.json`

That file is an object whose keys look like:

- `"John 3:16"`

and whose values are the verse text (may include `#` paragraph markers and bracketed `[words]`).

## Where to put it
Copy the file to:

- `assets/kjv/verses-1769.json`

Optional (not used yet):
- `assets/kjv/layout-1769.json`

## Notes
- The Lamp currently renders plain text. The corpus markers are stripped deterministically.
- Verse resolution is deterministic: by reference, or by an exact text match against the local corpus.
