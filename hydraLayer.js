(function () {
  "use strict";

  window.Memorial = window.Memorial || {};

  const Utils = window.Memorial.Utils;
  class HydraLayer {
    constructor({ canvasEl, width, height }) {
      this.canvasEl = canvasEl;
      this.width = width;
      this.height = height;

      this.hydra = null;
      this.h = null;
      this.globalMode = false;

      this.audio = { enabled: false, amp: 0, low: 0, mid: 0, high: 0 };

      this.palette = {
        set: "dark",
        primary: { name: "Crystal", hex: "#0E5E5E", rgb01: { r: 0, g: 0, b: 0 } },
        secondary: { name: "Jasper", hex: "#EFFFFF", rgb01: { r: 0, g: 0, b: 0 } }
      };

      this.lowPower = false;
      this.currentPresetId = "calm_ink";
    }

    init({ lowPower }) {
      this.lowPower = !!lowPower;

      const HydraCtor = window.Hydra || window.HydraSynth;
      if (!HydraCtor) throw new Error("Hydra-synth not found.");


      this.canvasEl.width = this.width;
      this.canvasEl.height = this.height;

      const precision = this.lowPower ? "lowp" : null;

      try {
        this.hydra = new HydraCtor({
          canvas: this.canvasEl,
          width: this.width,
          height: this.height,
          makeGlobal: false,
          detectAudio: false,
          autoLoop: true,
          precision
        });
        this.h = this.hydra.synth;
        this.globalMode = false;
      } catch (e) {
        console.warn("Hydra non-global mode failed; falling back to global.", e);
        this.hydra = new HydraCtor({
          canvas: this.canvasEl,
          width: this.width,
          height: this.height,
          makeGlobal: true,
          detectAudio: false,
          autoLoop: true,
          precision
        });
        this.h = null;
        this.globalMode = true;
      }

      this.applyPresetById("calm_ink");
    }

    setLowPower(enabled) {
      this.init({ lowPower: !!enabled });
    }

    setAudioFeatures({ amp, low, mid, high, enabled }) {
      this.audio.enabled = !!enabled;
      this.audio.amp = Utils.clamp01(amp);
      this.audio.low = Utils.clamp01(low);
      this.audio.mid = Utils.clamp01(mid);
      this.audio.high = Utils.clamp01(high);
    }

    setPalette({ paletteSet, primary, secondary }) {
      this.palette.set = paletteSet;
      this.palette.primary = primary;
      this.palette.secondary = secondary;
    }

    setExternalVideoSource(videoEl) {
      if (!videoEl) return;

      const init = () => {
        try {
          if (this.globalMode) window.s0.init({ src: videoEl });
          else if (this.h && this.h.s0) this.h.s0.init({ src: videoEl });
        } catch (e) {
          console.warn("Hydra video source init failed (non-fatal).", e);
        }
      };

      // Avoid "texImage2D: no video" by waiting for the first decoded frame.
      if (videoEl.readyState >= 2) {
        init();
        return;
      }

      const onReady = () => init();
      try {
        videoEl.addEventListener("loadeddata", onReady, { once: true });
        videoEl.addEventListener("canplay", onReady, { once: true });
      } catch (_) {
        // Fallback: attempt init on next tick.
        setTimeout(init, 0);
      }
    }

    applyPresetFamily({ family, seedInt }) {
      const presets = this.#presetsForFamily(family);
      const idx = Math.abs(seedInt) % presets.length;
      this.applyPresetById(presets[idx]);
    }

    applyPresetById(presetId) {
      this.currentPresetId = presetId;

      try {
        if (this.globalMode) { if (typeof window.hush === "function") window.hush(); }
        else if (this.h && typeof this.h.hush === "function") { this.h.hush(); }
      } catch (_) {}

      const fn = this.#presetImpl(presetId);
      fn();
    }

    getCurrentPresetId() { return this.currentPresetId; }

    #presetsForFamily(family) {
      const map = {
        calm: ["calm_ink", "calm_grain"],
        genesis: ["genesis_mist", "genesis_rings"],
        light: ["light_lamp", "light_prism"],
        lament: ["lament_ash", "lament_wound"],
        scroll: ["scroll_lines", "scroll_watermark"],
        promise: ["promise_breath", "promise_banner"],
        kingdom: ["kingdom_crest", "kingdom_tiles"],
        judgment: ["judgment_coals", "judgment_storm"],
        redemption: ["redemption_river", "redemption_crosshatch"],
        resurrection: ["resurrection_dawn", "resurrection_lift"],
        worship: ["worship_psalm", "worship_hymn"],
        presence: ["presence_near", "presence_veil"]
      };
      return map[family] || map.calm;
    }

    #presetImpl(id) {
      const H = this.globalMode ? window : (this.h || {});
      const audio = this.audio;
      const p = this.palette.primary.rgb01;
      const s = this.palette.secondary.rgb01;

      // Conservative audio hooks (quieting policy).
      const a = () => (audio.enabled ? audio.amp : 0.08);
      const low = () => (audio.enabled ? audio.low : 0.10);
      const mid = () => (audio.enabled ? audio.mid : 0.09);
      const high = () => (audio.enabled ? audio.high : 0.08);

      const poster = () => (this.lowPower ? 4 : 6) + Math.floor(high() * 4);

      const presets = {
        calm_ink: () => {
          H.noise(2.0, 0.14)
            .posterize(poster)
            .contrast(1.08)
            .color(p.r, p.g, p.b)
            .modulate(H.osc(4, 0.02, 1.0), () => 0.08 + mid() * 0.18)
            .out(H.o0);
          H.render(H.o0);
        },

        calm_grain: () => {
          H.osc(3.0, 0.015, 1.02)
            .kaleid(2)
            .modulate(H.noise(1.2, 0.10), () => 0.08 + a() * 0.20)
            .posterize(poster)
            .color(s.r, s.g, s.b)
            .out(H.o0);
          H.render(H.o0);
        },

        genesis_mist: () => {
          H.gradient(0.18)
            .modulate(H.noise(1.0, 0.20), () => 0.14 + low() * 0.22)
            .posterize(poster)
            .color(s.r, s.g, s.b)
            .out(H.o0);
          H.render(H.o0);
        },

        genesis_rings: () => {
          H.osc(() => 5 + mid() * 8, 0.02, 1.0)
            .kaleid(3)
            .posterize(poster)
            .color(p.r, p.g, p.b)
            .out(H.o0);
          H.render(H.o0);
        },

        light_lamp: () => {
          H.osc(() => 7 + high() * 10, 0.02, 1.15)
            .modulate(H.noise(1.8, 0.12), () => 0.07 + a() * 0.16)
            .posterize(poster)
            .color(s.r, s.g, s.b)
            .out(H.o0);
          H.render(H.o0);
        },

        light_prism: () => {
          H.voronoi(() => 7 + high() * 8, 0.22, () => 2 + mid() * 2)
            .posterize(poster)
            .color(p.r, p.g, p.b)
            .out(H.o0);
          H.render(H.o0);
        },

        lament_ash: () => {
          H.noise(3.2, 0.20)
            .contrast(1.18)
            .posterize(poster)
            .color(p.r, p.g, p.b)
            .diff(H.osc(2.0, 0.01, 1.0), () => 0.10 + a() * 0.18)
            .out(H.o0);
          H.render(H.o0);
        },

        lament_wound: () => {
          H.osc(2.0, 0.015, 0.92)
            .modulate(H.voronoi(4, 0.20, 2), () => 0.09 + mid() * 0.18)
            .posterize(poster)
            .color(p.r, p.g, p.b)
            .out(H.o0);
          H.render(H.o0);
        },

        scroll_lines: () => {
          H.shape(4, 0.32, 0.02)
            .repeatX(3)
            .repeatY(6)
            .posterize(poster)
            .color(s.r, s.g, s.b)
            .blend(H.noise(1.2, 0.08).color(p.r, p.g, p.b), 0.15)
            .out(H.o0);
          H.render(H.o0);
        },

        scroll_watermark: () => {
          H.gradient(0.5)
            .modulate(H.osc(2, 0.01, 1.0), () => 0.06 + a() * 0.12)
            .posterize(poster)
            .color(p.r, p.g, p.b)
            .out(H.o0);
          H.render(H.o0);
        },

        promise_breath: () => {
          H.noise(1.2, 0.16)
            .modulate(H.osc(3.0, 0.01, 1.0), () => 0.08 + low() * 0.16)
            .posterize(poster)
            .color(s.r, s.g, s.b)
            .out(H.o0);
          H.render(H.o0);
        },

        promise_banner: () => {
          H.osc(() => 3.5 + low() * 4, 0.01, 1.0)
            .posterize(poster)
            .color(p.r, p.g, p.b)
            .out(H.o0);
          H.render(H.o0);
        },

        kingdom_crest: () => {
          H.shape(3, 0.40, 0.03)
            .kaleid(3)
            .posterize(poster)
            .color(s.r, s.g, s.b)
            .out(H.o0);
          H.render(H.o0);
        },

        kingdom_tiles: () => {
          H.voronoi(6, 0.20, 2)
            .posterize(poster)
            .color(p.r, p.g, p.b)
            .out(H.o0);
          H.render(H.o0);
        },

        judgment_coals: () => {
          H.noise(4.0, 0.20)
            .thresh(() => 0.58 - a() * 0.10, 0.08)
            .posterize(poster)
            .color(p.r, p.g, p.b)
            .out(H.o0);
          H.render(H.o0);
        },

        judgment_storm: () => {
          H.osc(1.8, 0.015, 0.95)
            .modulate(H.noise(4.0, 0.18), () => 0.12 + mid() * 0.20)
            .posterize(poster)
            .color(p.r, p.g, p.b)
            .out(H.o0);
          H.render(H.o0);
        },

        redemption_river: () => {
          const base = H.src(H.s0).contrast(1.03).saturate(0.9);
          base
            .modulate(H.noise(1.4, 0.10), () => 0.06 + low() * 0.14)
            .posterize(poster)
            .color(s.r, s.g, s.b)
            .out(H.o0);
          H.render(H.o0);
        },

        redemption_crosshatch: () => {
          H.shape(4, 0.28, 0.02)
            .repeatX(4)
            .repeatY(7)
            .diff(H.shape(4, 0.28, 0.02).repeatX(4).repeatY(7).rotate(0.0), 0.25)
            .posterize(poster)
            .color(p.r, p.g, p.b)
            .out(H.o0);
          H.render(H.o0);
        },

        resurrection_dawn: () => {
          H.gradient(0.35)
            .add(H.osc(2.0, 0.01, 1.0).luma(0.65, 0.1), () => 0.08 + a() * 0.14)
            .posterize(poster)
            .color(s.r, s.g, s.b)
            .out(H.o0);
          H.render(H.o0);
        },

        resurrection_lift: () => {
          H.osc(3.0, 0.015, 1.0)
            .modulate(H.voronoi(5, 0.20, 2), () => 0.08 + high() * 0.14)
            .posterize(poster)
            .color(s.r, s.g, s.b)
            .out(H.o0);
          H.render(H.o0);
        },

        worship_psalm: () => {
          H.osc(() => 4 + mid() * 4, 0.01, 1.0)
            .kaleid(4)
            .posterize(poster)
            .color(s.r, s.g, s.b)
            .out(H.o0);
          H.render(H.o0);
        },

        worship_hymn: () => {
          H.voronoi(7, 0.20, 2)
            .posterize(poster)
            .color(p.r, p.g, p.b)
            .out(H.o0);
          H.render(H.o0);
        },

        presence_near: () => {
          H.noise(1.0, 0.14)
            .modulate(H.src(H.s0), () => 0.06 + low() * 0.12)
            .posterize(poster)
            .color(p.r, p.g, p.b)
            .out(H.o0);
          H.render(H.o0);
        },

        presence_veil: () => {
          H.gradient(0.30)
            .modulate(H.noise(2.0, 0.10), () => 0.08 + mid() * 0.14)
            .posterize(poster)
            .color(p.r, p.g, p.b)
            .out(H.o0);
          H.render(H.o0);
        }
      };

      return presets[id] || presets.calm_ink;
    }
  }

  Memorial.HydraLayer = HydraLayer;
})();
