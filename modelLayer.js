(function () {
  "use strict";

  window.Memorial = window.Memorial || {};

  const Utils = window.Memorial.Utils;
  // Map anchor -> viewport position (pixel coords within 360x640 internal canvas).
  function viewportRect(anchor, vpW, vpH, fullW, fullH) {
    const pad = 10;
    if (anchor === "lowerRight") return { x: fullW - vpW - pad, y: pad, w: vpW, h: vpH };
    if (anchor === "lowerLeft")  return { x: pad, y: pad, w: vpW, h: vpH };
    if (anchor === "upperRight") return { x: fullW - vpW - pad, y: fullH - vpH - pad, w: vpW, h: vpH };
    if (anchor === "upperLeft")  return { x: pad, y: fullH - vpH - pad, w: vpW, h: vpH };
    return { x: fullW - vpW - pad, y: pad, w: vpW, h: vpH };
  }


  class ModelLayer {
    constructor({ canvasEl, width, height }) {
      this.canvasEl = canvasEl;
      this.width = width;
      this.height = height;

      this.renderer = null;
      this.scene = null;
      this.camera = null;
      this.lightA = null;
      this.lightB = null;

      this.loader = null;
      this.cache = new Map(); // path -> gltf

      this.lowPower = false;

      this.palette = {
        primary: { name: "Sapphire", hex: "#4DA3FF", rgb01: { r: 0.3, g: 0.6, b: 1.0 } },
        secondary: { name: "Crystal", hex: "#0E5E5E", rgb01: { r: 0.05, g: 0.36, b: 0.36 } }
      };

      // Active model state
      this.active = {
        meta: null,
        object3d: null,
        startMs: 0,
        endMs: 0,
        fadeInMs: 600,
        fadeOutMs: 700,
        baseOpacity: 0.2,
        anchor: "lowerRight",
        vpW: 160,
        vpH: 160
      };
    }

    init({ lowPower }) {
      this.lowPower = !!lowPower;

      // If three.js or GLTFLoader missing, we run silently without symbols.
	    if (!window.THREE || !window.THREE.GLTFLoader) {
	      // three.js is loaded via an importmap + module script. Depending on network/cache timing,
	      // this init can fire before the module finishes. Retry for a short window.
	      this._threeRetryCount = (this._threeRetryCount || 0);
	      if (this._threeRetryCount === 0) {
	        console.warn("three.js or GLTFLoader not ready yet. Retrying…");
	      }
	      // Prefer a readiness promise if available.
	      const ready = window.__MemorialThreeReady;
	      if (ready && typeof ready.then === "function") {
	        this._threeRetryCount++;
	        ready.then(() => setTimeout(() => this.init({ lowPower }), 0)).catch(() => {});
	        return;
	      }
	      if (this._threeRetryCount < 50) {
	        this._threeRetryCount++;
	        setTimeout(() => this.init({ lowPower }), 100);
	        return;
	      }
	      console.warn("three.js or GLTFLoader missing. Symbols will be unavailable.");
	      return;
	    }

      this.canvasEl.width = this.width;
      this.canvasEl.height = this.height;

      this.renderer = new window.THREE.WebGLRenderer({
        canvas: this.canvasEl,
        alpha: true,
        antialias: false,
        powerPreference: this.lowPower ? "low-power" : "default"
      });
      this.renderer.setSize(this.width, this.height, false);
      this.renderer.setPixelRatio(1);
      this.renderer.autoClear = true;

      this.scene = new window.THREE.Scene();

      // Small, stable camera. We render in a small viewport, not full-frame.
      this.camera = new window.THREE.PerspectiveCamera(35, 1, 0.01, 20);
      this.camera.position.set(0, 0.8, 2.2);
      this.camera.lookAt(0, 0.55, 0);

      // Subtle lighting so the object has form but stays quiet.
      this.lightA = new window.THREE.DirectionalLight(0xffffff, 0.55);
      this.lightA.position.set(1, 2, 1);
      this.scene.add(this.lightA);

      this.lightB = new window.THREE.AmbientLight(0xffffff, 0.35);
      this.scene.add(this.lightB);

      this.loader = new window.THREE.GLTFLoader();

      this.clear();
      this.render(); // clear once
    }

    setLowPower(enabled) {
      this.init({ lowPower: !!enabled });
    }

    setPalette({ primary, secondary }) {
      this.palette.primary = primary;
      this.palette.secondary = secondary;
    }

    clear() {
      if (this.active.object3d && this.scene) {
        this.scene.remove(this.active.object3d);
      }
      this.active.meta = null;
      this.active.object3d = null;
      this.active.startMs = 0;
      this.active.endMs = 0;
    }

    async showModel(modelMeta, nowMs, overrides = {}) {
      if (!this.renderer || !this.scene || !this.loader) return;

      // Remove any existing model (max 1 on screen by design).
      this.clear();

      if (!modelMeta || !modelMeta.path) return;

      const sp = modelMeta.spawnPolicy || {};
      const rh = modelMeta.renderHints || {};

      const ov = overrides || {};

      this.active.meta = modelMeta;
      this.active.startMs = nowMs;
      this.active.fadeInMs = ov.fadeInMs ?? (sp.fadeInMs ?? 600);
      this.active.fadeOutMs = ov.fadeOutMs ?? (sp.fadeOutMs ?? 700);
      this.active.baseOpacity = ov.baseOpacity ?? (rh.opacity ?? 0.2);

      // Subtle per-cycle spin; overlay can override.
      this.active.spinY = ov.spinY ?? (rh.spinY ?? null);

      // Viewport policy:
      // - default uses renderHints anchor/viewport
      // - overlay may pass an explicit scissor/viewport rect (keeps models out of text region)
      this.active.anchor = rh.screenAnchor || "lowerRight";
      const vp = rh.viewportPx || [160, 160];
      this.active.vpW = vp[0];
      this.active.vpH = vp[1];
      this.active.rect = (ov.rect && typeof ov.rect.x === "number") ? ov.rect : null;
      if (this.active.rect) {
        this.active.vpW = this.active.rect.w;
        this.active.vpH = this.active.rect.h;
      }

      const onMs = ov.onScreenMs ?? (sp.onScreenMs ?? 4200);
      this.active.endMs = nowMs + onMs;

      try {
        const gltf = await this.#loadGltf(modelMeta.path);

        // Clone for safety (we may show same model later with different materials).
        const obj = gltf.scene.clone(true);

        // Apply restrained material override: gemstone-only color.
        this.#applyGemstoneMaterial(obj);

        // Deterministic initial transform from metadata (no random).
        const rot = rh.rotation || [0, 0, 0];
        obj.rotation.set(rot[0], rot[1], rot[2]);

        const scale = rh.scale ?? 1.0;
        obj.scale.setScalar(scale);

        // Fit to view (simple bounding normalization).
        this.#normalizeToUnit(obj);

        this.active.object3d = obj;
        this.scene.add(obj);
      } catch (e) {
        console.warn("Model load failed (non-fatal):", modelMeta.path, e);
        this.clear();
      }
    }

    update(nowMs, audioFeatures) {
      if (!this.renderer || !this.scene || !this.camera) return;

      // Always clear the full canvas each frame.
      this.renderer.setScissorTest(false);
      this.renderer.clear();

      if (!this.active.object3d || !this.active.meta) return;

      // Fade logic
      const a = this.#alpha(nowMs);
      if (a <= 0.001) {
        if (nowMs > this.active.endMs + this.active.fadeOutMs) this.clear();
        return;
      }

      // Extremely subtle motion only; no “busy” animation.
      // Audio may modulate slightly, but capped hard.
      const af = audioFeatures || { enabled: false, amp: 0, low: 0, mid: 0, high: 0 };
      const amp = Utils.clamp01(af.enabled ? af.amp : 0.08);

      const t = nowMs * 0.001;
      const wob = 0.03 + amp * 0.04; // intentionally small
      const baseSpin = (typeof this.active.spinY === "number") ? this.active.spinY : 0.001;
      this.active.object3d.rotation.y += baseSpin + wob * 0.0012;

      // Update material opacity each frame
      this.#setOpacity(this.active.object3d, a);

      // Render only in a small viewport corner (quieting policy)
      const rect = this.active.rect || viewportRect(this.active.anchor, this.active.vpW, this.active.vpH, this.width, this.height);

      this.renderer.setScissorTest(true);
      this.renderer.setScissor(rect.x, rect.y, rect.w, rect.h);
      this.renderer.setViewport(rect.x, rect.y, rect.w, rect.h);

      // Camera aspect is per-viewport
      this.camera.aspect = rect.w / rect.h;
      this.camera.updateProjectionMatrix();

      this.renderer.render(this.scene, this.camera);
    }

    render() {
      if (!this.renderer || !this.scene || !this.camera) return;
      this.renderer.setScissorTest(false);
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);
    }

    isActive() {
      return !!this.active.object3d;
    }

    // ---------------------------
    // Internals
    // ---------------------------

    #alpha(nowMs) {
      const start = this.active.startMs;
      const end = this.active.endMs;
      const fin = this.active.fadeInMs;
      const fout = this.active.fadeOutMs;
      const base = this.active.baseOpacity;

      if (nowMs < start) return 0;

      let a = base;

      if (nowMs < start + fin) {
        const x = (nowMs - start) / Math.max(1, fin);
        a *= Utils.clamp01(x);
      } else if (nowMs > end) {
        const x = 1 - (nowMs - end) / Math.max(1, fout);
        a *= Utils.clamp01(x);
      }

      return Utils.clamp01(a);
    }

    async #loadGltf(path) {
      if (this.cache.has(path)) return this.cache.get(path);

      const gltf = await new Promise((resolve, reject) => {
        this.loader.load(
          path,
          (g) => resolve(g),
          undefined,
          (err) => reject(err)
        );
      });

      this.cache.set(path, gltf);
      return gltf;
    }

    #applyGemstoneMaterial(obj) {
      const color = new window.THREE.Color(this.palette.primary.hex);
      const mat = new window.THREE.MeshLambertMaterial({
        color,
        transparent: true,
        opacity: 0.2,
        depthWrite: false
      });

      obj.traverse((node) => {
        if (node && node.isMesh) {
          node.material = mat;
          node.castShadow = false;
          node.receiveShadow = false;
        }
      });
    }

    #setOpacity(obj, opacity) {
      obj.traverse((node) => {
        if (node && node.isMesh && node.material) {
          node.material.opacity = opacity;
          node.material.transparent = true;
          node.material.depthWrite = false;
        }
      });
    }

    #normalizeToUnit(obj) {
      // Fit model into a roughly consistent viewing volume so different symbols feel cohesive.
      const box = new window.THREE.Box3().setFromObject(obj);
      const size = new window.THREE.Vector3();
      box.getSize(size);

      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const scale = 1 / maxDim;
      obj.scale.multiplyScalar(scale);

      // Center it
      const center = new window.THREE.Vector3();
      box.setFromObject(obj);
      box.getCenter(center);
      obj.position.sub(center);

      // Lift a little so it doesn't sit “on the floor” visually
      obj.position.y += 0.2;
    }
  }

  Memorial.ModelLayer = ModelLayer;
})();
