(function () {
  "use strict";

  window.Memorial = window.Memorial || {};

  const Utils = window.Memorial.Utils;
  function fnv1a32(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  class VideoManager {
    constructor() {
      this.meta = null;
      this.ready = false;
    }

    async init() {
      const res = await fetch("assets/video/_meta/videos.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load assets/video/_meta/videos.json (HTTP ${res.status})`);
      this.meta = await res.json();
      this.ready = true;
    }

    listVideos() {
      return (this.meta && this.meta.videos) ? this.meta.videos.slice() : [];
    }

    selectVideo({ themes, mood, paletteWeights, seedRef, candidateIds }) {
      if (!this.ready) throw new Error("VideoManager not initialized.");

      const videosAll = this.listVideos();
      if (videosAll.length === 0) return null;

      // Drop clips explicitly marked non-loop-safe.
      let videos = videosAll.filter(v => v.loopSafe !== false);
      if (videos.length === 0) return null;

      // Optional hard constraint: restrict selection to an explicit curated set.
      // If provided and yields no candidates, we return null (caller may render deterministic fallback).
      if (Array.isArray(candidateIds)) {
        const allow = new Set(candidateIds);
        const constrained = videos.filter(v => allow.has(v.id));
        if (constrained.length === 0) return null;
        videos = constrained;
      }

      const themeWeight = new Map();
      for (const t of themes) themeWeight.set(t.id, t.weight);

      let best = null;

      for (const v of videos) {
        let score = 0;

        for (const tag of (v.themeTags || [])) {
          if (themeWeight.has(tag)) score += themeWeight.get(tag) * 1.25;
        }

        if (v.mood === mood) score += 0.35;
        else if (v.mood === "neutral") score += 0.15;

        if (v.paletteWeight) {
          const b = Utils.clamp01(v.paletteWeight.bright || 0.5);
          const d = Utils.clamp01(v.paletteWeight.dark || 0.5);
          const align =
            (1 - Math.abs((paletteWeights.bright || 0.5) - b)) +
            (1 - Math.abs((paletteWeights.dark || 0.5) - d));
          score += 0.20 * align;
        }

        if (v.loopSafe === false) score -= 0.25;

        const tie = fnv1a32(`${seedRef}::${v.id}`) / 0xffffffff;

        if (!best || score > best.score || (score === best.score && tie > best.tie)) {
          best = { video: v, score, tie };
        }
      }

      return best ? best.video : null;
    }

    static fnv1a32(str) { return fnv1a32(str); }
  }

  Memorial.VideoManager = VideoManager;
})();
