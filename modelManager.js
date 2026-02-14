(function () {
  "use strict";

  window.Memorial = window.Memorial || {};

  const Utils = window.Memorial.Utils;
  class ModelManager {
    constructor() {
      this.meta = null;
      this.ready = false;
    }

    async init() {
      const res = await fetch("assets/models/_meta/models.json", { cache: "no-store" });
      if (!res.ok) {
        // Non-fatal: models are optional.
        console.warn(`Models meta missing or failed to load (HTTP ${res.status}). Symbols will be unavailable.`);
        this.meta = { models: [] };
        this.ready = true;
        return;
      }
      this.meta = await res.json();
      this.ready = true;
    }

    listModels() {
      return (this.meta && this.meta.models) ? this.meta.models.slice() : [];
    }

    selectModel({ themes, mood, paletteWeights, seedRef }) {
      if (!this.ready) throw new Error("ModelManager not initialized.");

      const models = this.listModels().filter(m => m.safe !== false);
      if (models.length === 0) return null;

      const themeWeight = new Map();
      for (const t of (themes || [])) themeWeight.set(t.id, t.weight);

      const dominantThemeId = (themes && themes[0] && themes[0].id) ? themes[0].id : null;

      // Only enforce “dominant theme must match” if the model library actually contains a model
      // for the dominant theme. Otherwise allow models for strong secondary themes (e.g. Beginning).
      const dominantHasModel = dominantThemeId
        ? models.some(mm => (mm.themeTags || []).indexOf(dominantThemeId) !== -1)
        : false;

      // Prevent “incidental mention” models: require at least one matching tag with weight >= threshold.
      // If we only have Tier 1 themes (lower base weights), lower the threshold so the fail-safe can still show symbols.
      const maxThemeWeight = Math.max(0, ...(themes || []).map(t => (t && typeof t.weight === "number") ? t.weight : 0));
      let minTagWeight = 0.35;
      if (maxThemeWeight > 0 && maxThemeWeight < minTagWeight) {
        minTagWeight = Math.max(0.12, maxThemeWeight * 0.6);
      }

      let best = null;

      for (const m of models) {
        const tags = (m.themeTags || []);
        let matchScore = 0;
        let maxMatch = 0;

        for (const tag of tags) {
          if (themeWeight.has(tag)) {
            const w = themeWeight.get(tag);
            matchScore += w * 1.2;
            if (w > maxMatch) maxMatch = w;
          }
        }

        // No meaningful theme match -> not eligible.
        if (matchScore <= 0 || maxMatch < minTagWeight) continue;

        // Restraint policy (conditional).
        if (dominantHasModel && dominantThemeId && tags.indexOf(dominantThemeId) === -1) continue;

        let score = matchScore;

        if (m.mood === mood) score += 0.25;
        else if (m.mood === "neutral") score += 0.12;

        if (m.paletteWeight) {
          const b = Utils.clamp01(m.paletteWeight.bright || 0.5);
          const d = Utils.clamp01(m.paletteWeight.dark || 0.5);
          const align =
            (1 - Math.abs((paletteWeights.bright || 0.5) - b)) +
            (1 - Math.abs((paletteWeights.dark || 0.5) - d));
          score += 0.15 * align;
        }

        const tie = Memorial.VideoManager.fnv1a32(`${seedRef}::model::${m.id}`) / 0xffffffff;

        if (!best || score > best.score || (score === best.score && tie > best.tie)) {
          best = { model: m, score, tie };
        }
      }

      return best ? best.model : null;
    }

    // Build an ordered cycle plan of models for the current verse.
    // Goal: ~4 appearances per theme per minute, capped to keep motion restrained.
    // Returns: { models: [modelMeta...], intervalMs } or null.
    buildCyclePlan({ themes, mood, paletteWeights, seedRef }) {
      if (!this.ready) throw new Error("ModelManager not initialized.");

      const models = this.listModels().filter(m => m.safe !== false);
      if (models.length === 0) return null;

      const themeWeight = new Map();
      for (const t of (themes || [])) themeWeight.set(t.id, t.weight);

      // Prefer Tier 2 themes when available; otherwise use the full list.
      const isTier2 = (t) => {
        if (t == null) return false;
        if (t.tier === 2) return true;
        const s = String(t.tier || "");
        return s.indexOf("2") !== -1;
      };

      const allThemes = (themes || []).slice();
      const tier2 = allThemes.filter(isTier2);
      const baseThemes = tier2.length ? tier2 : allThemes;

      // Require meaningful weight so we don't spawn symbols from incidental matches.
      // If we're effectively in Tier 1 only, allow lower weights so we still get a restrained symbol cycle.
      const maxThemeWeight = Math.max(0, ...(baseThemes || []).map(t => (t && typeof t.weight === "number") ? t.weight : 0));
      let minTagWeight = 0.35;
      if (maxThemeWeight > 0 && maxThemeWeight < minTagWeight) {
        minTagWeight = Math.max(0.12, maxThemeWeight * 0.6);
      }
      const eligibleThemes = baseThemes.filter(t => (t.weight || 0) >= minTagWeight);

      // Score helper (similar to selectModel, but per-theme).
      const scoreFor = (m, themeId) => {
        let s = (themeWeight.get(themeId) || 0) * 1.2;

        if (m.mood === mood) s += 0.25;
        else if (m.mood === "neutral") s += 0.12;

        if (m.paletteWeight) {
          const b = Utils.clamp01(m.paletteWeight.bright || 0.5);
          const d = Utils.clamp01(m.paletteWeight.dark || 0.5);
          const align =
            (1 - Math.abs((paletteWeights.bright || 0.5) - b)) +
            (1 - Math.abs((paletteWeights.dark || 0.5) - d));
          s += 0.15 * align;
        }
        return s;
      };

      const fnv = Memorial.VideoManager && Memorial.VideoManager.fnv1a32
        ? Memorial.VideoManager.fnv1a32
        : (() => 0);

      // Collect models per eligible theme.
      const perTheme = [];
      for (const t of eligibleThemes) {
        const themeId = t.id;
        const bucket = models.filter(m => (m.themeTags || []).indexOf(themeId) !== -1);
        if (bucket.length === 0) continue;

        // Sort by score + deterministic tie.
        bucket.sort((a, b) => {
          const sa = scoreFor(a, themeId);
          const sb = scoreFor(b, themeId);
          if (sb !== sa) return sb - sa;
          const ta = fnv(`${seedRef}::cycle::${themeId}::${a.id}`) >>> 0;
          const tb = fnv(`${seedRef}::cycle::${themeId}::${b.id}`) >>> 0;
          return tb - ta;
        });

        perTheme.push({ theme: t, models: bucket });
      }

      // If nothing matched (e.g. models.json tags don't align), fall back to the single best model.
      if (perTheme.length === 0) {
        const one = this.selectModel({ themes, mood, paletteWeights, seedRef });
        return one ? { models: [one], intervalMs: 15000 } : null;
      }

      // Build a restrained cycle list.
      const PER_THEME_PER_MIN = 4;
      const MAX_SLOTS = 12; // cap overall motion (>=5s per model)
      const desiredTotal = perTheme.length * PER_THEME_PER_MIN;
      const slotCount = Math.max(1, Math.min(desiredTotal, MAX_SLOTS));

      // Round-robin interleave (highest-weight themes are earlier in 'themes' already).
      const cycle = [];
      for (let pass = 0; pass < PER_THEME_PER_MIN && cycle.length < slotCount; pass++) {
        for (const g of perTheme) {
          if (cycle.length >= slotCount) break;
          const arr = g.models;
          if (!arr || arr.length === 0) continue;
          let pick = arr[pass % arr.length];

          // Avoid identical consecutive picks if possible.
          if (cycle.length > 0 && pick && cycle[cycle.length - 1] && pick.id === cycle[cycle.length - 1].id && arr.length > 1) {
            pick = arr[(pass + 1) % arr.length];
          }
          cycle.push(pick);
        }
      }

      const intervalMs = Math.floor(60000 / Math.max(1, cycle.length));
      return { models: cycle, intervalMs };
    }
  }

  Memorial.ModelManager = ModelManager;
})();
