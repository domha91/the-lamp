(function () {
  "use strict";

  window.TheLamp = window.TheLamp || {};

  // Overlay orchestrates model appearances (timing + cycling) while keeping the renderer policy restrained.
  class OverlayLayer {
    constructor({ el, modelLayer }) {
      this.el = el;
      this.modelLayer = modelLayer;

      this.enabled = true;

      // Current verse + model plan
      this.currentVerseKey = "";
      this.modelCyclePlan = null; // { models:[...], intervalMs:number }

      // Cycle state
      this.cycleStarted = false;
      this.cycleIndex = 0;
      this.nextSwitchMs = 0;

      // Policy: wait until text reveal passes threshold before starting cycle
      this.revealThreshold = 0.65;
    }

    setEnabled(enabled) {
      this.enabled = !!enabled;
      if (!this.enabled) {
        this.modelLayer.clear();
        this.cycleStarted = false;
      }
    }

    onNewVerse({ verseKey, modelCyclePlan }) {
      this.currentVerseKey = verseKey || "";
      this.modelCyclePlan = modelCyclePlan || null;

      this.cycleStarted = false;
      this.cycleIndex = 0;
      this.nextSwitchMs = 0;

      // Clear any previous model immediately on verse change.
      this.modelLayer.clear();
    }

    // Deterministic 0..1 float from verseKey + index (no Math.random; stable per verse)
    #rand01(i) {
      const fnv = (TheLamp.VideoManager && TheLamp.VideoManager.fnv1a32) ? TheLamp.VideoManager.fnv1a32 : null;
      if (!fnv) return 0.5;
      const h = fnv(`${this.currentVerseKey}::modelCycle::${i}`);
      return (h >>> 0) / 0xffffffff;
    }

    #computeRect(vpW, vpH, i, fullW, fullH) {
      const pad = 10;

      // Reserve a bottom band for symbols so scripture stays unobscured.
      // Note: WebGL scissor/viewport origin is bottom-left.
      const bandH = Math.floor(fullH * 0.36);

      // Deterministic per-cycle randomness.
      const r1 = this.#rand01(i * 7 + 1);
      const r2 = this.#rand01(i * 7 + 2);
      const r3 = this.#rand01(i * 7 + 3);

      // X: full width (with padding), keeping the viewport fully on-canvas.
      const xMin = pad;
      const xMax = Math.max(xMin, fullW - vpW - pad);
      const x = Math.floor(xMin + (xMax - xMin) * r1);

      // Y: within the bottom band, but not flush to the bottom edge.
      // We keep the full viewport inside the band so the symbol never overlaps scripture.
      const yMin = Math.min(Math.max(pad + 18, pad), Math.max(pad, bandH - vpH - pad));
      const yMax = Math.max(yMin, bandH - vpH - pad);

      // Triangular-ish distribution centred around mid-band (more “natural” variation than uniform).
      const t = (r2 + r3) * 0.5;
      const y = Math.floor(yMin + (yMax - yMin) * t);

      return { x, y, w: vpW, h: vpH };
    }


    async #switchToNext(nowMs) {
      const plan = this.modelCyclePlan;
      if (!plan || !plan.models || plan.models.length === 0) return;

      const meta = plan.models[this.cycleIndex % plan.models.length];
      const interval = Math.max(5000, Math.min(20000, plan.intervalMs || 15000));

      // Viewport sizing: restrained; small variation each cycle.
      const r = this.#rand01(this.cycleIndex);
      const vpBase = 120;
      const vpVar = 40;
      const vpW = Math.floor(vpBase + r * vpVar);
      const vpH = vpW; // square viewport feels “iconic” and stable

      const rect = this.#computeRect(vpW, vpH, this.cycleIndex, this.modelLayer.width, this.modelLayer.height);

      // Fade timings tied to interval (but capped).
      const fadeInMs = Math.min(2000, Math.floor(interval * 0.22));
      const fadeOutMs = Math.min(2200, Math.floor(interval * 0.24));
      const onScreenMs = Math.max(1000, interval - fadeOutMs); // modelLayer handles fade out tail

      // Slow spin (subtle), deterministic per cycle.
      const spinY = 0.0006 + this.#rand01(this.cycleIndex * 7 + 3) * 0.0012;

      await this.modelLayer.showModel(meta, nowMs, {
        rect,
        fadeInMs,
        fadeOutMs,
        onScreenMs,
        spinY
      });

      this.cycleIndex += 1;
      this.nextSwitchMs = nowMs + interval;
    }

    async tick({ nowMs, revealProgress, audioFeatures }) {
      // Always update renderer so it clears properly.
      if (!this.enabled) {
        this.modelLayer.update(nowMs, audioFeatures);
        return;
      }

      const plan = this.modelCyclePlan;
      if (!plan || !plan.models || plan.models.length === 0) {
        this.modelLayer.update(nowMs, audioFeatures);
        return;
      }

      // Wait for reveal threshold, then start cycling indefinitely for this verse.
      if (!this.cycleStarted) {
        if (revealProgress >= this.revealThreshold) {
          this.cycleStarted = true;
          this.nextSwitchMs = 0; // force immediate first switch
        } else {
          this.modelLayer.update(nowMs, audioFeatures);
          return;
        }
      }

      // Switch when time comes, or if model cleared early.
      if (this.nextSwitchMs === 0 || nowMs >= this.nextSwitchMs || !this.modelLayer.isActive()) {
        await this.#switchToNext(nowMs);
      }

      this.modelLayer.update(nowMs, audioFeatures);
    }
  }

  TheLamp.OverlayLayer = OverlayLayer;
})();
