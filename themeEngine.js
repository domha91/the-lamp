(function () {
  "use strict";

  window.Memorial = window.Memorial || {};

  const Utils = window.Memorial.Utils;

  const GEMSTONE_PALETTES = {
    bright: [
      { name: "Diamond", hex: "#C2C4C5" },
      { name: "Pearl", hex: "#C7C4B8" },
      { name: "Amber", hex: "#FDB73F" },
      { name: "Ligure", hex: "#FCB665" },
      { name: "Carbuncle", hex: "#FEB198" },
      { name: "Ruby", hex: "#F9AFC7" },
      { name: "Agate", hex: "#BAC0F9" },
      { name: "Crystal", hex: "#0DD5FE" },
      { name: "Jasper", hex: "#EFFFFF" },
      { name: "Sapphire", hex: "#4DA3FF" },
      { name: "Emerald", hex: "#29FF9A" },
      { name: "Topaz", hex: "#FFD34D" },
      { name: "Beryl", hex: "#3CFFE6" },
      { name: "Chalcedony", hex: "#8FF0FF" },
      { name: "Chrysolyte", hex: "#D7FF3A" },
      { name: "Chrysoprasus", hex: "#7DFFB2" },
      { name: "Sardonyx", hex: "#FF8A6B" },
      { name: "Sardius", hex: "#FF4D5A" },
      { name: "Jacinth", hex: "#FF7AE6" },
      { name: "Amethyst", hex: "#C77DFF" }
    ],
    dark: [
      { name: "Sardius", hex: "#A81919" },
      { name: "Vermilion", hex: "#894014" },
      { name: "Amber", hex: "#675210" },
      { name: "Topaz", hex: "#50590D" },
      { name: "Chrysolyte", hex: "#365E0E" },
      { name: "Emerald", hex: "#19620F" },
      { name: "Chrysoprasus", hex: "#0F6224" },
      { name: "Beryl", hex: "#0E6042" },
      { name: "Crystal", hex: "#0E5E5E" },
      { name: "Chalcedony", hex: "#145A83" },
      { name: "Sapphire", hex: "#1E48C7" },
      { name: "Jacinth", hex: "#3F25F6" },
      { name: "Purple", hex: "#751ECB" },
      { name: "Amethyst", hex: "#8F18A0" },
      { name: "Scarlet", hex: "#9C177A" },
      { name: "Crimson", hex: "#A3194D" }
    ]
  };

  function hexToRgb01(hex) {
    const h = hex.replace("#", "").trim();
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return { r: r / 255, g: g / 255, b: b / 255 };
  }
  function normalizeTextForMatch(s) {
    return (s || "")
      .toUpperCase()
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[^A-Z0-9'\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function hasWholeWord(haystackNorm, needleNorm) {
    const h = ` ${haystackNorm} `;
    const n = ` ${needleNorm} `;
    return h.indexOf(n) !== -1;
  }

  class ThemeEngine {
    constructor() {
      this.config = null;
      this.wowLocations = null;
      this.wowThemeToVideos = null;
      this.ready = false;
    }

    async init() {
      const res = await fetch("config/themes.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load config/themes.json (HTTP ${res.status})`);
      this.config = await res.json();

      // Optional: curated WoW location -> theme mapping.
      // Non-fatal if missing: selection will fall back to scored selection over all videos.
      try {
        const wr = await fetch("config/wowlocations.json", { cache: "no-store" });
        if (wr.ok) {
          this.wowLocations = await wr.json();
          this.wowThemeToVideos = new Map();
          for (const t of (this.wowLocations.themes || [])) {
            if (t && t.id && Array.isArray(t.videos) && t.videos.length) {
              this.wowThemeToVideos.set(t.id, t.videos.slice());
            }
          }
        }
      } catch (e) {
        this.wowLocations = null;
        this.wowThemeToVideos = null;
      }

      this.ready = true;
    }

    getPalettes() { return GEMSTONE_PALETTES; }

    pickPaletteSet(paletteWeights, moodHint) {
      const b = paletteWeights.bright || 0;
      const d = paletteWeights.dark || 0;
      if (b > d) return "bright";
      if (d > b) return "dark";
      if (moodHint === "dark") return "dark";
      if (moodHint === "light") return "bright";
      return "dark";
    }

    pickGemFromPalette(paletteSet, seedInt) {
      const arr = GEMSTONE_PALETTES[paletteSet];
      const idx = Math.abs(seedInt) % arr.length;
      return arr[idx];
    }

    deriveMoodFromVerseText(verseText) {
      const t = normalizeTextForMatch(verseText);
      const darkMarkers = ["WRATH", "HELL", "FIRE", "DARKNESS", "JUDGE", "JUDGMENT", "WICKED", "INIQUITY", "SIN"];
      const lightMarkers = ["LIGHT", "LOVE", "JOY", "PEACE", "GRACE", "MERCY", "LIFE", "GLORY"];

      let darkScore = 0, lightScore = 0;
      for (const m of darkMarkers) if (hasWholeWord(t, m)) darkScore++;
      for (const m of lightMarkers) if (hasWholeWord(t, m)) lightScore++;

      if (darkScore > lightScore) return "dark";
      if (lightScore > darkScore) return "light";
      return "neutral";
    }

    extractThemes({ book, chapter, verse, text }) {
      if (!this.ready) throw new Error("ThemeEngine not initialized.");

      const cfg = this.config;
      const debug = [];
      const themes = new Map();

      const verseNorm = normalizeTextForMatch(text);
      const refKeyChapter = `${book}|${chapter}`;

      // Tier 1 (fail-safe)
      for (const mt of cfg.tier1.metaThemes) {
        themes.set(mt.id, {
          id: mt.id,
          label: mt.label,
          tier: 1,
          weight: mt.baseWeight,
          sources: [`Tier 1 base (${mt.baseWeight})`]
        });
      }
      debug.push(`Tier 1: applied base meta-themes: ${cfg.tier1.metaThemes.map(t => t.id).join(", ")}`);

      // Tier 2: book defaults
      if (cfg.bookDefaults && cfg.bookDefaults[book]) {
        for (const bd of cfg.bookDefaults[book]) {
          this.#addTheme(themes, cfg, bd.theme, 2, bd.weight, bd.source || "book default");
          debug.push(`Tier 2 book default: ${book} -> ${bd.theme} (+${bd.weight})`);
        }
      }

      // Tier 2: chapter overrides
      if (cfg.chapterOverrides && cfg.chapterOverrides[refKeyChapter]) {
        for (const co of cfg.chapterOverrides[refKeyChapter]) {
          this.#addTheme(themes, cfg, co.theme, 2, co.weight, co.source || "chapter context");
          debug.push(`Tier 2 chapter override: ${refKeyChapter} -> ${co.theme} (+${co.weight})`);
        }
      }

      // Tier 2: keyword + phrase triggers
      const rawLower = (text || "").toLowerCase();

      for (const t2 of cfg.tier2.canonicalThemes) {
        // Keyword hits (whole-word, normalized)
        let hitCount = 0;
        for (const kw of (t2.keywords || [])) {
          const kwNorm = normalizeTextForMatch(kw);
          if (kwNorm.length < 2) continue;
          if (hasWholeWord(verseNorm, kwNorm)) hitCount++;
        }
        if (hitCount > 0) {
          const add = Math.min(0.6, 0.18 * hitCount);
          this.#addTheme(themes, cfg, t2.id, 2, add, `keyword hits (${hitCount})`);
          debug.push(`Tier 2 keyword: ${t2.id} matched ${hitCount} (+${add.toFixed(2)})`);
        }

        // Phrase hits (substring match, deterministic, used to disambiguate cases like John 3:19)
        let phraseHits = 0;
        for (const ph of (t2.phrases || [])) {
          const p = (ph || "").toLowerCase().trim();
          if (p.length < 3) continue;
          if (rawLower.indexOf(p) !== -1) phraseHits++;
        }
        if (phraseHits > 0) {
          const add = Math.min(0.9, 0.32 * phraseHits);
          this.#addTheme(themes, cfg, t2.id, 2, add, `phrase hits (${phraseHits})`);
          debug.push(`Tier 2 phrase: ${t2.id} matched ${phraseHits} (+${add.toFixed(2)})`);
        }
      }

      // Grammar cues (non-interpretive; used as visual pacing hints)
      const gr = cfg.grammarRules || {};
      const imperativeHits = this.#countImperativeHints(verseNorm, gr.imperativeHints || []);
      if (imperativeHits > 0) {
        this.#boostTheme(themes, "human_response", 0.08 * imperativeHits, `grammar imperative hits (${imperativeHits})`);
        debug.push(`Grammar: imperative hints ${imperativeHits} (boost human_response)`);
      }

      const promiseHits = this.#countPhraseHits(text, gr.promiseMarkers || []);
      if (promiseHits > 0) {
        const add = Math.min(0.35, 0.12 * promiseHits);
        this.#addTheme(themes, cfg, "promise", 2, add, `grammar promise markers (${promiseHits})`);
        debug.push(`Grammar: promise markers ${promiseHits} (+${add.toFixed(2)} to promise)`);
      }

      const declHits = this.#countPhraseHits(text, gr.declarationMarkers || []);
      if (declHits > 0) {
        this.#boostTheme(themes, "revelation", 0.06 * declHits, `grammar declaration markers (${declHits})`);
        debug.push(`Grammar: declaration markers ${declHits} (boost revelation)`);
      }

      if (themes.size === 0) {
        const fallback = cfg.tier1.fallbackOrder[0] || "revelation";
        themes.set(fallback, { id: fallback, label: fallback, tier: 1, weight: 0.22, sources: ["Tier 1 fallback"] });
        debug.push(`Guarantee: fallback applied -> ${fallback}`);
      }

      const mood = this.deriveMoodFromVerseText(text);
      debug.push(`Mood heuristic: ${mood}`);

      // Palette weighting aggregation
      const paletteWeights = { bright: 0.5, dark: 0.5 };
      for (const theme of themes.values()) {
        const t2cfg = this.#getTier2Config(cfg, theme.id);
        if (t2cfg && t2cfg.paletteBias) {
          paletteWeights.bright += (t2cfg.paletteBias.bright || 0) * theme.weight;
          paletteWeights.dark += (t2cfg.paletteBias.dark || 0) * theme.weight;
        }
      }
      const sum = paletteWeights.bright + paletteWeights.dark;
      paletteWeights.bright = Utils.clamp01(paletteWeights.bright / sum);
      paletteWeights.dark = Utils.clamp01(paletteWeights.dark / sum);

      return {
        themes: Array.from(themes.values()).sort((a, b) => (b.weight - a.weight) || (a.id < b.id ? -1 : 1)),
        mood,
        paletteWeights,
        debug
      };
    }

    getHydraFamilyForThemeId(themeId) {
      if (!this.ready) return "calm";
      const t2 = this.#getTier2Config(this.config, themeId);
      return (t2 && t2.hydraFamily) ? t2.hydraFamily : "calm";
    }


    getCuratedVideoCandidates(themes, opts) {
      // Returns { ids: string[] | null, debug: string[] }.
      // ids is null if no curated mapping is available (caller may fall back to scored selection over the full library).
      if (!this.ready) return { ids: null, debug: ["ThemeEngine not ready (curation unavailable)."] };
      if (!this.wowThemeToVideos) return { ids: null, debug: ["No config/wowlocations.json loaded (curation unavailable)."] };

      const o = opts || {};
      const minWeight = (typeof o.minWeight === "number") ? o.minWeight : 0.30;
      const maxThemes = (typeof o.maxThemes === "number") ? o.maxThemes : 3;

      const ids = new Set();
      const debug = [];

      const pickedThemeIds = [];
      for (const t of (themes || [])) {
        if (!t || !t.id) continue;
        if (pickedThemeIds.length >= maxThemes) break;
        if (t.weight >= minWeight || pickedThemeIds.length === 0) pickedThemeIds.push(t.id);
      }

      debug.push(`Curation: considering themes -> ${pickedThemeIds.join(", ") || "(none)"}`);

      for (const tid of pickedThemeIds) {
        const vids = this.wowThemeToVideos.get(tid);
        if (Array.isArray(vids) && vids.length) {
          for (const v of vids) ids.add(v);
          debug.push(`Curation: ${tid} contributed ${vids.length} videos`);
        }
      }

      if (ids.size === 0) {
        const fb = (this.config && this.config.tier1 && Array.isArray(this.config.tier1.fallbackOrder))
          ? this.config.tier1.fallbackOrder[0]
          : null;
        if (fb) {
          const fvids = this.wowThemeToVideos.get(fb);
          if (Array.isArray(fvids) && fvids.length) {
            for (const v of fvids) ids.add(v);
            debug.push(`Curation: fallback -> ${fb} contributed ${fvids.length} videos`);
          }
        }
      }

      if (ids.size === 0) {
        return { ids: [], debug: debug.concat(["Curation: no videos found for themes or fallback."]) };
      }

      // Sort for determinism (selection still uses seedRef downstream).
      return { ids: Array.from(ids).sort(), debug };
    }

    #getTier2Config(cfg, themeId) {
      return (cfg.tier2.canonicalThemes || []).find(t => t.id === themeId) || null;
    }

    #addTheme(map, cfg, themeId, tier, weight, source) {
      const existing = map.get(themeId);
      const label = this.#resolveLabel(cfg, themeId);
      if (!existing) {
        map.set(themeId, { id: themeId, label, tier, weight, sources: [source] });
      } else {
        existing.weight += weight;
        existing.sources.push(source);
        existing.tier = Math.min(existing.tier, tier);
      }
    }

    #boostTheme(map, themeId, addWeight, source) {
      const existing = map.get(themeId);
      if (existing) {
        existing.weight += addWeight;
        existing.sources.push(source);
      } else {
        map.set(themeId, { id: themeId, label: themeId, tier: 1, weight: addWeight, sources: [source] });
      }
    }

    #resolveLabel(cfg, themeId) {
      const t1 = (cfg.tier1.metaThemes || []).find(t => t.id === themeId);
      if (t1) return t1.label;
      const t2 = (cfg.tier2.canonicalThemes || []).find(t => t.id === themeId);
      if (t2) return t2.label;
      return themeId;
    }

    #countImperativeHints(verseNorm, hints) {
      let hits = 0;
      for (const w of hints) {
        const wn = normalizeTextForMatch(w);
        if (wn && hasWholeWord(verseNorm, wn)) hits++;
      }
      return hits;
    }

    #countPhraseHits(raw, phrases) {
      const t = (raw || "").toLowerCase();
      let hits = 0;
      for (const p of phrases) {
        const pl = (p || "").toLowerCase();
        if (pl.length < 2) continue;
        if (t.indexOf(pl) !== -1) hits++;
      }
      return hits;
    }
  }

  Memorial.ThemeEngine = ThemeEngine;
  Memorial.GEMSTONE_PALETTES = GEMSTONE_PALETTES;
  Memorial.hexToRgb01 = hexToRgb01;
})();
