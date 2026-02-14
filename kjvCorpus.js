(function () {
  "use strict";

  window.Memorial = window.Memorial || {};

  const Utils = window.Memorial.Utils;

  // farskipper/kjv corpus format:
  // - keys: "Genesis 1:1"
  // - values: may contain "#" paragraph markers and bracketed [words] for italics (supplied words).
  //
  // Memorial policy:
  // - Fail explicitly if corpus cannot be loaded.
  // - Strip markup deterministically for rendering + theming (no interpretation).
  // - Reference is required; optional text is used only to verify an exact KJV match.

  function normalizeSpaces(s) {
    return String(s || "").replace(/\s+/g, " ").trim();
  }

  function stripKjvMarkup(raw) {
    // Deterministic: remove paragraph markers and bracket notation, preserving the words.
    // '#' -> space (future: paragraph layout)
    // '[word]' -> 'word'
    return normalizeSpaces(String(raw || "")
      .replace(/#/g, " ")
      .replace(/\[([^\]]+)\]/g, "$1"));
  }

  function normalizeTextForMatch(s) {
    // Match policy: ignore punctuation + case; keep alphanumerics/spaces.
    return String(s || "")
      .toUpperCase()
      .replace(/#/g, " ")
      .replace(/\[([^\]]+)\]/g, "$1")
      .replace(/[^A-Z0-9\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeBookToken(s) {
    // Uppercase, remove punctuation, collapse whitespace.
    return String(s || "")
      .toUpperCase()
      .replace(/[.\u2019']/g, "")     // dots + apostrophes
      .replace(/[^A-Z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function bookKeyCompact(s) {
    return normalizeBookToken(s).replace(/\s+/g, "");
  }

  // Canonical book names used by verses-1769.json (derived from corpus keys).
  const CANON_BOOKS = [
    "Genesis","Exodus","Leviticus","Numbers","Deuteronomy",
    "Joshua","Judges","Ruth",
    "1 Samuel","2 Samuel","1 Kings","2 Kings","1 Chronicles","2 Chronicles",
    "Ezra","Nehemiah","Esther","Job","Psalms","Proverbs","Ecclesiastes","Solomon's Song",
    "Isaiah","Jeremiah","Lamentations","Ezekiel","Daniel",
    "Hosea","Joel","Amos","Obadiah","Jonah","Micah","Nahum","Habakkuk","Zephaniah","Haggai","Zechariah","Malachi",
    "Matthew","Mark","Luke","John","Acts","Romans",
    "1 Corinthians","2 Corinthians","Galatians","Ephesians","Philippians","Colossians",
    "1 Thessalonians","2 Thessalonians","1 Timothy","2 Timothy","Titus","Philemon","Hebrews","James",
    "1 Peter","2 Peter","1 John","2 John","3 John","Jude","Revelation"
  ];

  // Build a deterministic alias map. We accept:
  // - Full canonical names (case/punct insensitive)
  // - Compact forms without spaces
  // - Common abbreviations
  // - Roman numeral variants for 1/2/3 books
  const BOOK_ALIASES = Object.create(null);

  function addAlias(alias, canon) {
    if (!alias) return;
    const key = bookKeyCompact(alias);
    if (!key) return;
    BOOK_ALIASES[key] = canon;
  }

  // Canonical self-aliases
  for (const canon of CANON_BOOKS) {
    addAlias(canon, canon);
    addAlias(canon.replace(/\s+/g, ""), canon);
  }

  // Special titles
  addAlias("Song of Solomon", "Solomon's Song");
  addAlias("Song of Songs", "Solomon's Song");
  addAlias("Canticles", "Solomon's Song");
  addAlias("Canticle of Canticles", "Solomon's Song");
  addAlias("SOS", "Solomon's Song");
  addAlias("Song", "Solomon's Song");

  addAlias("Psalm", "Psalms");
  addAlias("Psal", "Psalms");
  addAlias("Ps", "Psalms");
  addAlias("Psa", "Psalms");

  // Common abbreviations (deterministic, fixed table)
  const ABBR = {
    "GEN":"Genesis","GE":"Genesis","GN":"Genesis",
    "EXO":"Exodus","EX":"Exodus","EXOD":"Exodus",
    "LEV":"Leviticus","LV":"Leviticus",
    "NUM":"Numbers","NU":"Numbers","NM":"Numbers",
    "DEU":"Deuteronomy","DEUT":"Deuteronomy","DT":"Deuteronomy",
    "JOS":"Joshua","JOSH":"Joshua",
    "JDG":"Judges","JUDG":"Judges",
    "RUT":"Ruth","RU":"Ruth",
    "EZR":"Ezra",
    "NEH":"Nehemiah",
    "EST":"Esther",
    "JOB":"Job",
    "PRO":"Proverbs","PROV":"Proverbs",
    "ECC":"Ecclesiastes","EC":"Ecclesiastes",
    "ISA":"Isaiah",
    "JER":"Jeremiah",
    "LAM":"Lamentations",
    "EZE":"Ezekiel","EZEK":"Ezekiel",
    "DAN":"Daniel",
    "HOS":"Hosea",
    "JOL":"Joel",
    "AMO":"Amos",
    "OBA":"Obadiah",
    "JON":"Jonah",
    "MIC":"Micah",
    "NAH":"Nahum",
    "HAB":"Habakkuk",
    "ZEP":"Zephaniah",
    "HAG":"Haggai",
    "ZEC":"Zechariah",
    "MAL":"Malachi",
    "MAT":"Matthew","MATT":"Matthew",
    "MRK":"Mark","MAR":"Mark",
    "LUK":"Luke",
    "JHN":"John","JOH":"John",
    "ACT":"Acts",
    "ROM":"Romans",
    "GAL":"Galatians",
    "EPH":"Ephesians",
    "PHIL":"Philippians","PHP":"Philippians",
    "COL":"Colossians",
    "TIT":"Titus",
    "PHM":"Philemon","PHILEM":"Philemon",
    "HEB":"Hebrews",
    "JAS":"James",
    "JUD":"Jude",
    "REV":"Revelation","RE":"Revelation"
  };
  for (const a of Object.keys(ABBR)) addAlias(a, ABBR[a]);

  // Numbered books abbreviations
  function addNumbered(base, canon) {
    // base like "SAM", "KGS", "KI", "CHR", "COR", "TH", "TIM", "PET", "JN", etc.
    for (const n of [1,2,3]) {
      addAlias(`${n}${base}`, canon.replace(/^[123]\s+/, `${n} `));
      addAlias(`${n} ${base}`, canon.replace(/^[123]\s+/, `${n} `));
      addAlias(`${["I","II","III"][n-1]}${base}`, canon.replace(/^[123]\s+/, `${n} `));
      addAlias(`${["I","II","III"][n-1]} ${base}`, canon.replace(/^[123]\s+/, `${n} `));
    }
  }
  // Explicit numbered mappings
  addAlias("1SAM","1 Samuel"); addAlias("2SAM","2 Samuel");
  addAlias("1SA","1 Samuel"); addAlias("2SA","2 Samuel");
  addAlias("1KGS","1 Kings"); addAlias("2KGS","2 Kings");
  addAlias("1KI","1 Kings"); addAlias("2KI","2 Kings");
  addAlias("1CH","1 Chronicles"); addAlias("2CH","2 Chronicles");
  addAlias("1CHR","1 Chronicles"); addAlias("2CHR","2 Chronicles");
  addAlias("1COR","1 Corinthians"); addAlias("2COR","2 Corinthians");
  addAlias("1CO","1 Corinthians"); addAlias("2CO","2 Corinthians");
  addAlias("1TH","1 Thessalonians"); addAlias("2TH","2 Thessalonians");
  addAlias("1THES","1 Thessalonians"); addAlias("2THES","2 Thessalonians");
  addAlias("1TIM","1 Timothy"); addAlias("2TIM","2 Timothy");
  addAlias("1TI","1 Timothy"); addAlias("2TI","2 Timothy");
  addAlias("1PET","1 Peter"); addAlias("2PET","2 Peter");
  addAlias("1PE","1 Peter"); addAlias("2PE","2 Peter");
  addAlias("1JN","1 John"); addAlias("2JN","2 John"); addAlias("3JN","3 John");
  addAlias("1JOHN","1 John"); addAlias("2JOHN","2 John"); addAlias("3JOHN","3 John");

  class KJVCorpus {
    constructor({ url }) {
      this.url = url;
      this.verses = null; // object: key -> raw string
      this.ready = false;
      this.lastError = "";
    }

    async load() {
      const url = this.url;
      let res;
      try {
        res = await fetch(url, { cache: "no-store" });
      } catch (e) {
        throw new Error(`KJV corpus fetch failed. Expected at "${url}". Place farskipper/kjv json/verses-1769.json at assets/kjv/verses-1769.json.`);
      }
      if (!res.ok) {
        throw new Error(`KJV corpus missing or unreadable (${res.status}). Expected at "${url}". Place farskipper/kjv json/verses-1769.json at assets/kjv/verses-1769.json.`);
      }
      let data;
      try {
        data = await res.json();
      } catch (e) {
        throw new Error(`KJV corpus is not valid JSON at "${url}".`);
      }
      if (!data || typeof data !== "object") {
        throw new Error(`KJV corpus JSON did not parse into an object at "${url}".`);
      }

      // Quick sanity check
      if (!data["Genesis 1:1"]) {
        console.warn("KJV corpus loaded but Genesis 1:1 not found. Check corpus version.");
      }

      this.verses = data;
      this.ready = true;
      return true;
    }

    stripMarkup(raw) { return stripKjvMarkup(raw); }
    normalizeMatch(s) { return normalizeTextForMatch(s); }

    parseReference(refRaw) {
      const raw = String(refRaw || "").trim();
      if (!raw) return null;

      // Accept:
      // - "John 3:16"
      // - "1 John 3:16"
      // - "I John 3:16"
      // - optional range "John 3:16-18" (we resolve the full inclusive range)
      const m = raw.match(/^(.+?)\s+(\d+)\s*:\s*(\d+)(?:\s*-\s*(\d+))?\s*$/);
      if (!m) return null;

      const bookIn = m[1].trim();
      const chapter = parseInt(m[2], 10);
      const verse = parseInt(m[3], 10);
      const verseEnd = m[4] ? parseInt(m[4], 10) : null;
      if (!chapter || !verse) return null;

      // Normalize book token and map
      const compact = bookKeyCompact(bookIn);
      let canon = BOOK_ALIASES[compact] || null;

      // Additional deterministic handling for leading roman numerals with spaces
      if (!canon) {
        const tok = normalizeBookToken(bookIn);
        const tokCompact = tok.replace(/\s+/g, "");
        canon = BOOK_ALIASES[tokCompact] || null;
      }

      if (!canon) return null;

      return { book: canon, chapter, verse, verseEnd };
    }

    resolveByReference(parsed) {
      if (!this.ready || !this.verses) return null;

      this.lastError = "";

      const book = parsed.book;
      const chapter = parsed.chapter;
      const v0 = parsed.verse;
      const v1 = (parsed.verseEnd != null) ? parsed.verseEnd : parsed.verse;

      if (!chapter || !v0) {
        this.lastError = "Invalid reference (missing chapter/verse).";
        return null;
      }
      if (v1 < v0) {
        this.lastError = `Invalid range: end verse ${v1} is before start verse ${v0}.`;
        return null;
      }

      const corpusKeys = [];
      const rawParts = [];
      const textParts = [];

      for (let v = v0; v <= v1; v++) {
        const k = `${book} ${chapter}:${v}`;
        const raw = this.verses[k];
        if (!raw) {
          this.lastError = `Reference not found in local KJV corpus (1769): ${k}`;
          return null;
        }
        corpusKeys.push(k);
        rawParts.push(raw);
        textParts.push(stripKjvMarkup(raw));
      }

      const text = textParts.join(" ").replace(/\s+/g, " ").trim();
      const rawText = rawParts.join(" ").replace(/\s+/g, " ").trim();

      // Internal deterministic key for seeding etc.
      const keySuffix = (v1 !== v0) ? `${v0}-${v1}` : `${v0}`;
      const internalKey = `${book}|${chapter}|${keySuffix}`;

      const corpusKey = (v1 !== v0) ? `${book} ${chapter}:${v0}-${v1}` : `${book} ${chapter}:${v0}`;

      return {
        book,
        chapter,
        verse: v0,
        verseEnd: (v1 !== v0) ? v1 : null,
        key: internalKey,
        corpusKey,
        corpusKeys,
        rawText,
        text
      };
    }

    // -----------------------------
    // Verse index + Verse of the Day (fully local, deterministic)
    // -----------------------------
    _buildVerseIndex() {
      // Produces a stable, sorted list of atomic verses:
      // [{ book, chapter, verse, corpusKey, internalKey }]
      //
      // Sorting is canonical book order then chapter/verse to avoid relying on JSON key order.
      if (!this.ready || !this.verses) return [];
      const bookOrder = Object.create(null);
      for (let i = 0; i < CANON_BOOKS.length; i++) bookOrder[CANON_BOOKS[i]] = i;

      const out = [];
      const rx = /^(.+?)\s+(\d+):(\d+)$/;

      for (const corpusKey of Object.keys(this.verses)) {
        const m = corpusKey.match(rx);
        if (!m) continue;
        const book = m[1];
        const chapter = parseInt(m[2], 10);
        const verse = parseInt(m[3], 10);
        if (!book || !chapter || !verse) continue;

        // Internal key uses the same pipe format as the app playlist ("Book|Chapter|Verse").
        const internalKey = `${book}|${chapter}|${verse}`;
        out.push({ book, chapter, verse, corpusKey, internalKey });
      }

      out.sort((a, b) => {
        const ao = (bookOrder[a.book] !== undefined) ? bookOrder[a.book] : 999;
        const bo = (bookOrder[b.book] !== undefined) ? bookOrder[b.book] : 999;
        if (ao !== bo) return ao - bo;
        if (a.chapter !== b.chapter) return a.chapter - b.chapter;
        return a.verse - b.verse;
      });

      return out;
    }

    getVerseIndex() {
      // Cached, built once. Safe to call frequently.
      if (!this._verseIndex) this._verseIndex = this._buildVerseIndex();
      return this._verseIndex;
    }

    static isoDateInTimeZone({ date = new Date(), timeZone = "Europe/London" } = {}) {
      // Returns YYYY-MM-DD for the provided timeZone without depending on local machine timezone.
      // Using formatToParts avoids locale quirks.
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).formatToParts(date);

      const get = (t) => (parts.find(p => p.type === t) || {}).value;
      const y = get("year");
      const m = get("month");
      const d = get("day");
      return `${y}-${m}-${d}`;
    }

    getVerseOfDayKey({ date = new Date(), timeZone = "Europe/London", salt = "Memorial|VOTD|v1" } = {}) {
      const idx = this.getVerseIndex();
      if (!idx.length) return null;

      const iso = KJVCorpus.isoDateInTimeZone({ date, timeZone });

      // FNV-1a 32-bit on a short seed string → very fast and stable.
      const seed = `${salt}|${iso}`;
      const h = Utils.fnv1a32(seed);
      const pick = (h >>> 0) % idx.length;
      return idx[pick].internalKey;
    }

    getVerseOfDayResolved(opts = {}) {
      const key = this.getVerseOfDayKey(opts);
      if (!key) return null;

      const parts = key.split("|");
      if (parts.length < 3) return null;

      const book = parts[0];
      const chapter = parseInt(parts[1], 10);
      const verse = parseInt(parts[2], 10);

      const resolved = this.resolveByReference({ book, chapter, verse });
      if (resolved) resolved.key = key; // preserve atomic internal key
      return resolved;
    }


    getVerseOfDayResolvedSafe({ maxChars = Infinity, scanLimit = 256, ...opts } = {}) {
      // Ensures the returned verse fits overlay limits (character count).
      // Deterministic: scans forward from the day's pick (wraps around).
      const idx = this.getVerseIndex();
      if (!idx.length) return null;

      const key0 = this.getVerseOfDayKey(opts);
      if (!key0) return null;

      let start = idx.findIndex(v => v.internalKey === key0);
      if (start < 0) start = 0;

      const steps = Math.min(scanLimit, idx.length);
      for (let i = 0; i < steps; i++) {
        const cand = idx[(start + i) % idx.length];
        const resolved = this.resolveByReference({ book: cand.book, chapter: cand.chapter, verse: cand.verse });
        if (!resolved) continue;
        if ((resolved.text || "").length <= maxChars) {
          resolved.key = cand.internalKey;
          return resolved;
        }
      }
      return null;
    }



    verifyOptionalText(resolved, userText) {
      const provided = normalizeTextForMatch(userText);
      if (!provided) return { ok: true };
      const corpusNorm = normalizeTextForMatch(resolved.rawText);
      if (corpusNorm !== provided) {
        return { ok: false, message: "Resolution failed: provided verse text does not match the local KJV corpus (1769)." };
      }
      return { ok: true };
    }
  }

  Memorial.KJVCorpus = KJVCorpus;
})();