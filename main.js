(function () {
  "use strict";

  window.TheLamp = window.TheLamp || {};

  // -----------------------------
  // KJV corpus (local only; fail explicitly if missing)
  // -----------------------------
  const KJV_CORPUS_URL = "assets/kjv/verses-1769.json";

  const Utils = window.TheLamp.Utils;



// -----------------------------
  // AudioEngine: mic OR uploaded file, plus export stream
  // -----------------------------
  // mic OR uploaded file, plus export stream
  // -----------------------------
  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.analyser = null;
      this.freqData = null;
      this.timeData = null;

      this.micStream = null;

      this.audioEl = null;
      this.audioSrcNode = null;
      this.fileUrl = null;

      this.dest = null; // MediaStreamDestination for export
      this.enabled = false;
      this.mode = "none"; // "none" | "mic" | "file"

      this.amp = 0; this.low = 0; this.mid = 0; this.high = 0;
    }

    async ensureCtx() {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (this.ctx.state !== "running") {
        await this.ctx.resume().catch(() => {});
      }
      if (!this.analyser) {
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 1024;
        this.analyser.smoothingTimeConstant = 0.85;
        this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
        this.timeData = new Uint8Array(this.analyser.fftSize);
      }
      if (!this.dest) {
        this.dest = this.ctx.createMediaStreamDestination();
      }
    }

    stop() {
      this.enabled = false;
      this.mode = "none";

      try { if (this.micStream) for (const t of this.micStream.getTracks()) t.stop(); } catch (_) {}
      this.micStream = null;

      try {
        if (this.audioEl) {
          this.audioEl.pause();
          this.audioEl.remove();
        }
      } catch (_) {}
      this.audioEl = null;

      try { if (this.audioSrcNode) this.audioSrcNode.disconnect(); } catch (_) {}
      this.audioSrcNode = null;

      try { if (this.fileUrl) URL.revokeObjectURL(this.fileUrl); } catch (_) {}
      this.fileUrl = null;

      try { if (this.analyser) this.analyser.disconnect(); } catch (_) {}
      this.analyser = null;

      try { if (this.dest) this.dest.disconnect(); } catch (_) {}
      this.dest = null;

      try { if (this.ctx) this.ctx.close(); } catch (_) {}
      this.ctx = null;

      this.freqData = null;
      this.timeData = null;
    }

    async startMic() {
      await this.ensureCtx();

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("getUserMedia not supported in this browser.");
      }

      // Stop any existing mode first
      if (this.mode !== "none") this.stop();
      await this.ensureCtx();

      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false
      });

      const source = this.ctx.createMediaStreamSource(this.micStream);

      // Mic -> analyser + export destination (NOT to speakers)
      source.connect(this.analyser);
      source.connect(this.dest);

      this.enabled = true;
      this.mode = "mic";
    }

    async useFile(file) {
      if (!file) throw new Error("No audio file selected.");
      await this.ensureCtx();

      // Stop existing mode first
      if (this.mode !== "none") this.stop();
      await this.ensureCtx();

      this.audioEl = document.createElement("audio");
      this.audioEl.style.position = "fixed";
      this.audioEl.style.left = "-9999px";
      this.audioEl.style.top = "-9999px";
      this.audioEl.loop = true;
      this.audioEl.preload = "auto";
      this.fileUrl = URL.createObjectURL(file);
      this.audioEl.src = this.fileUrl;

      document.body.appendChild(this.audioEl);

      this.audioSrcNode = this.ctx.createMediaElementSource(this.audioEl);

      // File -> analyser + export destination + speakers (so you can monitor)
      this.audioSrcNode.connect(this.analyser);
      this.audioSrcNode.connect(this.dest);
      this.audioSrcNode.connect(this.ctx.destination);

      await this.audioEl.play();

      this.enabled = true;
      this.mode = "file";
    }

    resetToZero() {
      if (this.audioEl) {
        try { this.audioEl.currentTime = 0; } catch (_) {}
      }
    }

    getExportStream() {
      return this.dest ? this.dest.stream : new MediaStream();
    }

    tick() {
      if (!this.enabled || !this.analyser || !this.timeData || !this.freqData) {
        const t = performance.now() * 0.001;
        this.amp  = 0.08 + 0.02 * (0.5 + 0.5 * Math.sin(t * 0.6));
        this.low  = 0.10 + 0.03 * (0.5 + 0.5 * Math.sin(t * 0.35));
        this.mid  = 0.08 + 0.03 * (0.5 + 0.5 * Math.sin(t * 0.45));
        this.high = 0.07 + 0.02 * (0.5 + 0.5 * Math.sin(t * 0.55));
        return;
      }

      this.analyser.getByteTimeDomainData(this.timeData);
      this.analyser.getByteFrequencyData(this.freqData);

      let sumSq = 0;
      for (let i = 0; i < this.timeData.length; i++) {
        const v = (this.timeData[i] - 128) / 128;
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / this.timeData.length);
      const amp = Math.min(1, rms * 2.0);

      const n = this.freqData.length;
      const loEnd = Math.floor(n * 0.18);
      const midEnd = Math.floor(n * 0.52);

      let lo = 0, mid = 0, hi = 0;
      for (let i = 0; i < n; i++) {
        const v = this.freqData[i] / 255;
        if (i < loEnd) lo += v;
        else if (i < midEnd) mid += v;
        else hi += v;
      }

      lo /= Math.max(1, loEnd);
      mid /= Math.max(1, (midEnd - loEnd));
      hi /= Math.max(1, (n - midEnd));

      const s = 0.18;
      this.amp  = this.amp  + (amp - this.amp)  * s;
      this.low  = this.low  + (lo  - this.low)  * s;
      this.mid  = this.mid  + (mid - this.mid)  * s;
      this.high = this.high + (hi  - this.high) * s;
    }

    features() {
      return { enabled: this.enabled, amp: this.amp, low: this.low, mid: this.mid, high: this.high, mode: this.mode };
    }
  }

  // -----------------------------
  // Scripture renderer (p5): KJV1611 font, full-justified column, transparent layer
  // -----------------------------
  class ScriptureRenderer {
    constructor({ mountEl, width, height }) {
      this.mountEl = mountEl;
      this.width = width;
      this.height = height;

      this.p5 = null;
      this.font = null; // legacy (p5.loadFont)
      this.fontReady = false;
      this.fontReadyDeadlineMs = 0;

      this.current = null;
      this.layout = null;

      this.reveal = { startMs: 0, cps: 15, wobble: 0.6 };
      this.lastRevealProgress = 0;

      this.palette = {
        set: "dark",
        text:   { name: "Jasper",  hex: "#EFFFFF" },
        shadow: { name: "Crystal", hex: "#0E5E5E" },
        accent: { name: "Sapphire", hex: "#4DA3FF" }
      };
    }

    init() {
      const self = this;

      this.p5 = new window.p5(function (p) {
        // Prefer CSS @font-face. p5.loadFont is sensitive to font MIME / async failure.
        p.preload = function () { /* no-op */ };

        p.setup = function () {
          p.pixelDensity(1);
          const c = p.createCanvas(self.width, self.height);
          c.parent(self.mountEl);

          // Gate layout until the KJV1611 font is actually available.
          // If the font never loads (e.g., blocked), we fail open after ~800ms.
          self.fontReady = false;
          self.fontReadyDeadlineMs = performance.now() + 800;
          try {
            if (document.fonts && document.fonts.load) {
              document.fonts.load("32px KJV1611").then(() => {
                self.fontReady = true;
                self.layout = null;
              }).catch(() => {
                self.fontReady = true;
              });
            } else {
              self.fontReady = true;
            }
          } catch (_) {
            self.fontReady = true;
          }

          p.clear();
          p.textAlign(p.LEFT, p.TOP);
          p.noStroke();
        };

        function textMetrics(fontSize) {
          p.textSize(fontSize);
          const asc = p.textAscent();
          const desc = p.textDescent();
          const lh = (asc + desc) * 1.12;
          return { asc, desc, lh };
        }

        function splitWords(s) {
          return String(s || "")
            .replace(/\s+/g, " ")
            .trim()
            .split(" ")
            .filter(Boolean);
        }

        function measureSpace(fontSize) {
          p.textSize(fontSize);
          // Some browsers/fonts return ~0 for a normal space; NBSP tends to be more reliable.
          let w = p.textWidth("\u00A0");
          if (!isFinite(w) || w < 0.5) w = p.textWidth(" ");
          if (!isFinite(w) || w < 0.5) {
            // Deterministic fallback: a fraction of a common glyph width, clamped.
            w = Math.max(1, p.textWidth("i") * 0.35);
          }
          return w;
        }

        function wrapWordsToLines(words, maxW, fontSize) {
          p.textSize(fontSize);

          const lines = [];
          let cur = [];
          let curW = 0;

          const spaceW = measureSpace(fontSize);

          for (const w of words) {
            const wW = p.textWidth(w);
            if (cur.length === 0) {
              cur.push(w);
              curW = wW;
              continue;
            }
            const nextW = curW + spaceW + wW;
            if (nextW <= maxW) {
              cur.push(w);
              curW = nextW;
            } else {
              lines.push(cur);
              cur = [w];
              curW = wW;
            }
          }
          if (cur.length) lines.push(cur);
          return lines;
        }

        function measureHeight(ref, body, maxW, pad, bodySize, refSize) {
          const refM = textMetrics(refSize);
          const bodyM = textMetrics(bodySize);

          const refH = ref ? (refM.lh * 1.05) : 0;
          const gap = ref ? Math.max(6, Math.floor(bodySize * 0.35)) : 0;

          const bodyWords = splitWords(body);
          const canonicalText = bodyWords.join(" ");
          const bodyLines = wrapWordsToLines(bodyWords, maxW, bodySize);

          const bodyH = bodyLines.length * bodyM.lh;

          const total = pad + refH + gap + bodyH + pad;
          return {
            total,
            refH,
            gap,
            bodyWords,
            canonicalText,
            bodyLines,
            bodyLh: bodyM.lh,
            refLh: refM.lh,
            spaceW: measureSpace(bodySize)
          };
        }

        function pickMaxChars(w, h) {
          // Deterministic limit based on the *usable* scripture area.
          // We reserve a bottom band for symbol rendering so scripture stays readable.
          const reservedBottom = Math.floor(h * 0.36);
          const usableH = Math.max(200, h - reservedBottom);
          const area = w * usableH;
          let est = Math.round((area / 250) / 50) * 50;
          est = Math.max(400, Math.min(1200, est));
          return est;
        }

        function computeLayout(ref, body) {
          const pad = 18;
          const maxW = self.width - pad * 2;
          const reservedBottom = Math.floor(self.height * 0.36);
          const usableH = Math.max(200, self.height - reservedBottom);

          const maxChars = pickMaxChars(self.width, self.height);
          let bodyUse = String(body || "");
          let trimmed = false;
          if (bodyUse.length > maxChars) {
            bodyUse = bodyUse.slice(0, Math.max(0, maxChars - 1)) + "…";
            trimmed = true;
          }

          // Try largest font size that fits.
          let best = null;
          for (let bodySize = 34; bodySize >= 14; bodySize--) {
            const refSize = Math.max(12, Math.floor(bodySize * 0.72));
            const m = measureHeight(ref, bodyUse, maxW, pad, bodySize, refSize);
            if (m.total <= usableH) {
              best = { pad, maxW, usableH, reservedBottom, bodySize, refSize, bodyText: bodyUse, trimmed, ...m };
              break;
            }
          }
          if (!best) {
            const bodySize = 14;
            const refSize = 12;
            const m = measureHeight(ref, bodyUse, maxW, pad, bodySize, refSize);
            best = { pad, maxW, usableH, reservedBottom, bodySize, refSize, bodyText: bodyUse, trimmed, ...m };
          }
          return best;
        }

        function computeLinePositions(words, x, maxW, fontSize, justify) {
          p.textSize(fontSize);
          const spaceW = measureSpace(fontSize);
          const widths = words.map(w => p.textWidth(w));
          const gaps = Math.max(0, words.length - 1);
          const wordsW = widths.reduce((a, b) => a + b, 0);
          const baseW = wordsW + gaps * spaceW;
          const extra = (justify && gaps > 0) ? Math.max(0, maxW - baseW) : 0;
          const addPerGap = (justify && gaps > 0) ? (extra / gaps) : 0;

          const pos = [];
          let cx = x;
          for (let i = 0; i < words.length; i++) {
            pos.push(cx);
            cx += widths[i];
            if (i < words.length - 1) cx += spaceW + addPerGap;
          }
          return { pos, spaceW, addPerGap };
        }

        function drawLineVisible(words, visibleParts, x, y, maxW, fontSize, justify) {
          if (!words || words.length === 0) return;
          const { pos } = computeLinePositions(words, x, maxW, fontSize, justify);
          for (let i = 0; i < words.length; i++) {
            const part = visibleParts && visibleParts[i] ? visibleParts[i] : "";
            if (part) p.text(part, pos[i], y);
          }
        }

        p.draw = function () {
          p.clear();

          if (!self.current) {
            self.lastRevealProgress = 0;
            return;
          }

          // If the font hasn't resolved yet, avoid measuring/layout churn.
          if (!self.fontReady && performance.now() < self.fontReadyDeadlineMs) {
            return;
          }
          self.fontReady = true;

          // Use CSS @font-face family name.
          p.textFont("KJV1611");

          const t = performance.now();
          const elapsed = Math.max(0, (t - self.reveal.startMs) / 1000);

          // Compute layout once per verse (based on full verse text, not the revealed substring)
          if (!self.layout) {
            self.layout = computeLayout(self.current.ref, self.current.text);
          }

          const L = self.layout;
          const fullText = L.canonicalText || (L.bodyWords ? L.bodyWords.join(" ") : String(L.bodyText || ""));
          const charsToShow = Math.floor(elapsed * self.reveal.cps);
          const shownCount = Math.min(fullText.length, charsToShow);
          self.lastRevealProgress = fullText.length > 0 ? (shownCount / fullText.length) : 0;

          // restrained wobble
          const wob = self.reveal.wobble;
          const wobX = wob * Math.sin(t * 0.0017);
          const wobY = wob * Math.sin(t * 0.0013);

          const x0 = L.pad + wobX;
          let y = L.pad + wobY;

          // Reference (not justified)
          p.textSize(L.refSize);

          // Shadow then foreground
          p.fill(self.palette.shadow.hex);
          p.text(self.current.ref, x0 + 1, y + 1);

          p.fill(self.palette.accent.hex);
          p.text(self.current.ref, x0, y);

          y += (self.current.ref ? (L.refLh * 1.05 + L.gap) : 0);

          // Body: stable wrap + justify (no reflow during type-on)
          const words = L.bodyWords || splitWords(L.bodyText);
          const lines = L.bodyLines || wrapWordsToLines(words, L.maxW, L.bodySize);

          // Compute visible substring per word (spaces count as 1 char between words)
          const visible = new Array(words.length).fill("");
          let remaining = shownCount;
          for (let i = 0; i < words.length; i++) {
            const w = words[i];
            if (remaining <= 0) break;
            if (remaining >= w.length) {
              visible[i] = w;
              remaining -= w.length;
              if (i < words.length - 1 && remaining > 0) remaining -= 1; // space
            } else {
              visible[i] = w.slice(0, remaining);
              remaining = 0;
              break;
            }
          }

          // Build per-line visible arrays aligned with layout word order
          const renderLines = [];
          let wi = 0;
          for (let li = 0; li < lines.length; li++) {
            const lineWords = lines[li];
            const lineParts = [];
            for (let j = 0; j < lineWords.length; j++) {
              lineParts.push(visible[wi] || "");
              wi++;
            }
            renderLines.push({ words: lineWords, parts: lineParts, justify: (li !== lines.length - 1) });
          }

          // Shadow pass
          p.fill(self.palette.shadow.hex);
          let yy = y + 1;
          for (const line of renderLines) {
            drawLineVisible(line.words, line.parts, x0 + 1, yy, L.maxW, L.bodySize, line.justify);
            yy += L.bodyLh;
          }

          // Foreground pass
          p.fill(self.palette.text.hex);
          yy = y;
          for (const line of renderLines) {
            drawLineVisible(line.words, line.parts, x0, yy, L.maxW, L.bodySize, line.justify);
            yy += L.bodyLh;
          }
        };
      }, this.mountEl);
    }

    setPalette({ paletteSet, textGem, shadowGem, accentGem }) {
      this.palette.set = paletteSet;
      this.palette.text = textGem;
      this.palette.shadow = shadowGem;
      this.palette.accent = accentGem;
    }

    showVerse({ ref, text }, { cps }) {
      this.current = { ref, text };
      this.layout = null; // recompute layout per verse
      this.reveal.startMs = performance.now();
      this.reveal.cps = cps;
      this.lastRevealProgress = 0;
    }

    getRevealProgress() {
      return this.lastRevealProgress;
    }

    clear() {
      this.current = null;
      this.layout = null;
      this.lastRevealProgress = 0;
    }
  }

  // -----------------------------
  // App
  // -----------------------------
  class TheLampApp {
    constructor() {
      this.INTERNAL_W = 360;
      this.INTERNAL_H = 640;

      this.settings = {
        verseDurationMs: 9000,
        typeCps: 18
      };

      // KJV corpus (loaded during init)
      this.kjv = null;


      this.el = {
        stage: document.getElementById("stage"),
        bgVideo: document.getElementById("bgVideo"),
        hydraCanvas: document.getElementById("hydraCanvas"),
        modelCanvas: document.getElementById("modelCanvas"),
        overlayLayer: document.getElementById("overlayLayer"),
        p5Mount: document.getElementById("p5Mount"),
        finalCanvas: document.getElementById("finalCanvas"),
        fallbackBg: document.getElementById("fallbackBg"),

        status: document.getElementById("status"),
        diag: document.getElementById("diag"),

        inputRef: document.getElementById("inputRef"),
        inputText: document.getElementById("inputText"),
        btnResolve: document.getElementById("btnResolve"),
        btnUseResolved: document.getElementById("btnUseResolved"),
        btnNextVerse: document.getElementById("btnNextVerse"),

        // Verse of the Day (deterministic)
        votdLabel: document.getElementById("votdLabel"),
        btnUseVotd: document.getElementById("btnUseVotd"),

        btnStartShow: document.getElementById("btnStartShow"),
        btnStopShow: document.getElementById("btnStopShow"),

        toggleLowPower: document.getElementById("toggleLowPower"),
        toggleSymbols: document.getElementById("toggleSymbols"),
        donateLink: document.getElementById("donateLink"),

        // Audio/export UI
        inputAudio: document.getElementById("inputAudio"),
        btnUseUploadedAudio: document.getElementById("btnUseUploadedAudio"),
        btnStartAudioMic: document.getElementById("btnStartAudioMic"),
        btnStopAudio: document.getElementById("btnStopAudio"),
        exportSeconds: document.getElementById("exportSeconds"),
        btnResetAV: document.getElementById("btnResetAV"),
        btnExportMp4: document.getElementById("btnExportMp4")
      };

      this.themeEngine = new TheLamp.ThemeEngine();
      this.videoManager = new TheLamp.VideoManager();
      this.modelManager = new TheLamp.ModelManager();

      this.modelLayer = new TheLamp.ModelLayer({
        canvasEl: this.el.modelCanvas,
        width: this.INTERNAL_W,
        height: this.INTERNAL_H
      });

      this.hydraLayer = new TheLamp.HydraLayer({
        canvasEl: this.el.hydraCanvas,
        width: this.INTERNAL_W,
        height: this.INTERNAL_H
      });

      this.overlay = new TheLamp.OverlayLayer({ el: this.el.overlayLayer, modelLayer: this.modelLayer });

      this.audio = new AudioEngine();

      this.scripture = new ScriptureRenderer({
        mountEl: this.el.p5Mount,
        width: this.INTERNAL_W,
        height: this.INTERNAL_H
      });


      this.compositor = new TheLamp.Compositor({
        internalW: this.INTERNAL_W,
        internalH: this.INTERNAL_H,
        outW: 720,
        outH: 1280,
        finalCanvasEl: this.el.finalCanvas,
        bgVideo: this.el.bgVideo,
        hydraCanvas: this.el.hydraCanvas,
        modelCanvas: this.el.modelCanvas,
        p5Mount: this.el.p5Mount,
        // Match previous CSS policy for the layers
        videoFilter: "brightness(0.72) contrast(0.92) saturate(0.85)",
        hydraBlendMode: "soft-light",
        hydraOpacity: 0.18
      });

      this.exporter = new TheLamp.Exporter({
        internalW: this.INTERNAL_W,
        internalH: this.INTERNAL_H,
        outW: 720,
        outH: 1280,
        fps: 24,
        bgVideo: this.el.bgVideo,
        hydraCanvas: this.el.hydraCanvas,
        modelCanvas: this.el.modelCanvas,
        p5Mount: this.el.p5Mount,
        audioEngine: this.audio,
        onStatus: (m) => this.#status(m),
        captureCanvas: this.compositor.getCaptureCanvas(),
        renderFrame: () => this.compositor.render()
      });

      this.show = {
        running: false,
        playlist: [
          "Genesis|1|1",
          "Genesis|1|3",
          "John|1|1",
          "John|3|16",
          "John|3|19",
          "Ephesians|2|8",
          "Romans|12|2",
          "Proverbs|18|10",
          "Psalm|23|1",
          "Psalm|27|8",
          "Psalm|29|4",
          "Isaiah|53|5",
          "Revelation|21|4"
        ],
        idx: 0,
        nextVerseAt: 0,
        resolvedOverride: null,
        verseOfDayResolved: null,
        verseOfDayIso: ""
      };

      this.currentContext = null;
      this.lastDiag = "";
      this.lastVideoId = "";
    }

    async init() {
      this.#status("Initializing…");
      this.#status("Loading KJV corpus…");

      if (!TheLamp.KJVCorpus) {
        throw new Error("KJVCorpus module missing (kjvCorpus.js not loaded).");
      }
      this.kjv = new TheLamp.KJVCorpus({ url: KJV_CORPUS_URL });
      await this.kjv.load();
      TheLamp.kjv = this.kjv;


      this.scripture.init();

      try {
        await this.themeEngine.init();
        await this.videoManager.init();
        await this.modelManager.init();
      } catch (e) {
        console.error(e);
        this.#status(`Config load failed: ${e.message}`);
      }

      try {
        this.hydraLayer.init({ lowPower: this.el.toggleLowPower.checked });
      } catch (e) {
        console.error(e);
        this.#status(`Hydra init failed (non-fatal): ${e.message}`);
      }

      try {
        this.modelLayer.init({ lowPower: this.el.toggleLowPower.checked });
      } catch (e) {
        console.error(e);
      }

      this.overlay.setEnabled(this.el.toggleSymbols.checked);

      this.el.bgVideo.addEventListener("error", () => {
        this.el.fallbackBg.style.opacity = "0.9";
        this.#status("Background video failed to load. Using fallback background. See console for details.");
        console.warn("Video error:", this.el.bgVideo.error);
      });

      // UI wiring
      this.el.btnResolve.addEventListener("click", () => this.onResolve());
      this.el.btnUseResolved.addEventListener("click", () => this.useResolvedAsCurrent());
      this.el.btnNextVerse.addEventListener("click", () => this.nextVerseManual());
      if (this.el.btnUseVotd) this.el.btnUseVotd.addEventListener("click", () => this.useVotdAsCurrent());

      this.el.btnStartShow.addEventListener("click", () => this.startShow());
      this.el.btnStopShow.addEventListener("click", () => this.stopShow());

      this.el.btnStartAudioMic.addEventListener("click", async () => {
        try {
          await this.audio.startMic();
          this.#status("Audio started (mic). Feeding Hydra and symbols subtly.");
        } catch (e) {
          console.error(e);
          this.#status(`Mic start failed: ${e.message}`);
        }
      });

      this.el.btnUseUploadedAudio.addEventListener("click", async () => {
        try {
          const f = this.el.inputAudio.files && this.el.inputAudio.files[0];
          if (!f) {
            this.#status("Select an audio file first.");
            return;
          }
          await this.audio.useFile(f);
          this.#status("Audio started (uploaded file). Feeding Hydra and symbols subtly.");
        } catch (e) {
          console.error(e);
          this.#status(`Audio file start failed: ${e.message}`);
        }
      });

      this.el.btnStopAudio.addEventListener("click", () => {
        this.audio.stop();
        this.#status("Audio stopped.");
      });

      this.el.btnResetAV.addEventListener("click", async () => {
        try {
          await this.exporter.resetAVToZero();
          this.#status("Reset A/V to 0.");
        } catch (e) {
          console.error(e);
          this.#status(`Reset failed: ${e.message}`);
        }
      });

      this.el.btnExportMp4.addEventListener("click", async () => {
        try {
          const sec = Number(this.el.exportSeconds.value || 12);
          await this.exporter.exportMp4({ seconds: sec });
        } catch (e) {
          console.error(e);
          this.#status(`Export failed: ${e.message}`);
        }
      });

      this.el.toggleLowPower.addEventListener("change", () => {
        try {
          const lp = this.el.toggleLowPower.checked;
          this.hydraLayer.setLowPower(lp);
          this.modelLayer.setLowPower(lp);
          this.#status(lp ? "Low-power enabled." : "Low-power disabled.");
        } catch (e) {
          console.error(e);
          this.#status(`Low-power toggle failed: ${e.message}`);
        }
      });

      this.el.toggleSymbols.addEventListener("change", () => {
        this.overlay.setEnabled(this.el.toggleSymbols.checked);
      });

      this.fitStageToViewport();
      window.addEventListener("resize", () => this.fitStageToViewport());

      await this.initVerseOfDay();

      // Initial verse: Verse of the Day if available, otherwise playlist[0]
      if (this.show.verseOfDayResolved) this.applyResolvedVerse(this.show.verseOfDayResolved);
      else this.applyVerseByKey(this.show.playlist[this.show.idx]);

      // Main loop
      const tick = async () => {
        this.audio.tick();
        const f = this.audio.features();
        this.hydraLayer.setAudioFeatures(f);

        const now = performance.now();

        if (this.show.running && now >= this.show.nextVerseAt) {
          this.advancePlaylist();
        }

        const reveal = this.scripture.getRevealProgress();
        await this.overlay.tick({ nowMs: now, revealProgress: reveal, audioFeatures: f });

        this.updateDiagnostics(f);
        // Authoritative render (preview + export)
        this.compositor.render();
        requestAnimationFrame(() => tick());
      };
      requestAnimationFrame(() => tick());

      this.#status("Ready.");
    }

    fitStageToViewport() {
      const pad = 24;
      const vw = Math.max(1, window.innerWidth - pad);
      const vh = Math.max(1, Math.min(window.innerHeight * 0.62, window.innerHeight - 220));
      const scale = Math.min(vw / this.INTERNAL_W, vh / this.INTERNAL_H);
      const safe = Math.max(1, Math.floor(scale * 1000) / 1000);
      this.el.stage.style.transform = `scale(${safe})`;
    }

    
    // -----------------------------
    // Verse of the Day (deterministic; local-only)
    // -----------------------------
    async initVerseOfDay() {
      if (!this.kjv || !this.kjv.ready) return;

      const iso = Utils.isoDateInTimeZone({ date: new Date(), timeZone: "Europe/London" });
      this.show.verseOfDayIso = iso;

      const maxChars = this.#maxScriptureChars();
      const resolved = this.kjv.getVerseOfDayResolvedSafe({ maxChars, timeZone: "Europe/London" });
      this.show.verseOfDayResolved = resolved || null;

      if (this.el.votdLabel) {
        this.el.votdLabel.textContent = resolved
          ? `${resolved.reference || this.#formatRef(resolved)}`
          : "Unavailable";
      }
    }

    useVotdAsCurrent() {
      if (!this.kjv || !this.kjv.ready) {
        this.#status("Verse of the Day unavailable: KJV corpus not loaded.");
        return;
      }

      // If not computed yet (or label still loading), compute now.
      if (!this.show.verseOfDayResolved) {
        const maxChars = this.#maxScriptureChars();
        this.show.verseOfDayResolved = this.kjv.getVerseOfDayResolvedSafe({ maxChars, timeZone: "Europe/London" }) || null;
      }

      const resolved = this.show.verseOfDayResolved;
      if (!resolved) {
        this.#status("Verse of the Day unavailable.");
        return;
      }

      // Populate the resolve input so the UI reflects what is being displayed.
      const ref = resolved.reference || this.#formatRef(resolved);
      if (this.el.inputRef) this.el.inputRef.value = ref;
      if (this.el.inputText) this.el.inputText.value = "";

      this.applyResolvedVerse(resolved);
      this.#status(`Loaded Verse of the Day: ${ref}`);
    }

onResolve() {
      const refRaw = this.el.inputRef.value;
      const textRaw = this.el.inputText.value;

      const hasRef = !!(refRaw || "").trim();
      const hasText = !!(textRaw || "").trim();

      if (!hasRef) {
        this.#status("Resolution failed: reference is required (e.g., 'John 3:16' or 'John 3:16-18'). Optional text is verification only.");
        return;
      }
      if (!this.kjv || !this.kjv.ready) {
        this.#status("Resolution failed: KJV corpus not loaded.");
        return;
      }

      const parsed = this.kjv.parseReference(refRaw);
      if (!parsed) {
        this.#status("Resolution failed: could not parse reference. Use format like 'John 3:16' or 'John 3:16-18'.");
        return;
      }

      const resolved = this.kjv.resolveByReference(parsed);
      if (!resolved) {
        this.#status(this.kjv.lastError ? `Resolution failed: ${this.kjv.lastError}` : "Resolution failed: reference not found in local KJV corpus (1769).");
        return;
      }

      // Enforce readability limit (also keeps scripture out of the symbol band).
      const maxChars = this.#maxScriptureChars();
      const textLen = (resolved.text || "").length;
      if (textLen > maxChars) {
        this.#status(`Resolution failed: scripture too long for overlay (${textLen} chars > limit ${maxChars}). Reduce the verse range.`);
        return;
      }

      if (hasText) {
        const check = this.kjv.verifyOptionalText(resolved, textRaw);
        if (!check.ok) {
          this.#status(check.message);
          return;
        }
      }

      this.show.resolvedOverride = resolved;
      this.#status(`Resolved: ${this.#formatRef(resolved)} (ready to use).`);
    }

    useResolvedAsCurrent() {
      if (!this.show.resolvedOverride) {
        this.#status("Nothing resolved yet.");
        return;
      }
      this.applyResolvedVerse(this.show.resolvedOverride);
      this.#status(`Using resolved verse: ${this.#formatRef(this.show.resolvedOverride)}`);
    }

    nextVerseManual() {
      if (this.show.running) return;
      this.advancePlaylist();
    }

    startShow() {
      if (this.show.running) return;
      this.show.running = true;

      this.#playVideoSafe();

      const now = performance.now();
      this.show.nextVerseAt = now + this.settings.verseDurationMs;

      this.#status("Show running (hands-off).");
    }

    stopShow() {
      this.show.running = false;
      this.#status("Show stopped.");
    }

    advancePlaylist() {
      this.show.idx = (this.show.idx + 1) % this.show.playlist.length;
      this.applyVerseByKey(this.show.playlist[this.show.idx]);

      this.show.nextVerseAt = performance.now() + this.settings.verseDurationMs;
    }

    applyVerseByKey(key) {
      // key is internal format "Book|Chapter|Verse" used for deterministic playlist/seeding.
      const parts = String(key || "").split("|");
      if (parts.length < 3) {
        this.#status(`Playlist verse key invalid: ${key}`);
        return;
      }

      const bookKey = parts[0];
      const chapter = parseInt(parts[1], 10);
      const verse = parseInt(parts[2], 10);

      const book = (bookKey === "Psalm") ? "Psalms" : bookKey;

      if (!this.kjv || !this.kjv.ready) {
        this.#status("Cannot apply verse: KJV corpus not loaded.");
        return;
      }

      const resolved = this.kjv.resolveByReference({ book, chapter, verse });
      if (!resolved) {
        this.#status(`Playlist verse missing from KJV corpus: ${book} ${chapter}:${verse}`);
        return;
      }

      // Preserve the original internal key for determinism
      resolved.key = `${bookKey}|${chapter}|${verse}`;

      this.applyResolvedVerse(resolved);
    }

    applyResolvedVerse(resolved) {
      const ref = this.#formatRef(resolved);

      // Enforce readability limit before doing any theming/layout work.
      const maxChars = this.#maxScriptureChars();
      const textLen = (resolved.text || "").length;
      if (textLen > maxChars) {
        this.#status(`Cannot render: scripture too long for overlay (${textLen} chars > limit ${maxChars}). Reduce the verse range.`);
        return;
      }

      let extracted;
      try {
        extracted = this.themeEngine.extractThemes({
          book: resolved.book,
          chapter: resolved.chapter,
          verse: resolved.verse,
          text: resolved.text
        });
      } catch (e) {
        console.error(e);
        this.#status(`Theme extraction failed: ${e.message}`);
        extracted = {
          themes: [{ id: "revelation", label: "Revelation", tier: 1, weight: 0.22, sources: ["Tier 1 fallback"] }],
          mood: "neutral",
          paletteWeights: { bright: 0.5, dark: 0.5 },
          debug: ["Theme engine not ready; fallback applied."]
        };
      }

      const seedRef = `${resolved.key}`;
      const seedInt = Utils.fnv1a32(seedRef);
      const mood = extracted.mood;

      const paletteSet = this.themeEngine.pickPaletteSet(extracted.paletteWeights, mood);
      const primaryGem = this.themeEngine.pickGemFromPalette(paletteSet, seedInt);
      const secondaryGem = this.themeEngine.pickGemFromPalette(paletteSet, seedInt + 7);

      document.documentElement.style.setProperty("--accent", primaryGem.hex);

      const primary = { ...primaryGem, rgb01: TheLamp.hexToRgb01(primaryGem.hex) };
      const secondary = { ...secondaryGem, rgb01: TheLamp.hexToRgb01(secondaryGem.hex) };

      const topTheme = extracted.themes[0] || { id: "revelation" };
      const hydraFamily = this.themeEngine.getHydraFamilyForThemeId(topTheme.id);

      // Curated WoW background candidates (from config/wowlocations.json), if available.
      const curated = this.themeEngine.getCuratedVideoCandidates(extracted.themes, { minWeight: 0.30, maxThemes: 3 });
      if (curated && Array.isArray(curated.debug) && extracted && Array.isArray(extracted.debug)) {
        extracted.debug = extracted.debug.concat(curated.debug);
      }

      let chosenVideo = null;
      try {
        chosenVideo = this.videoManager.selectVideo({
          themes: extracted.themes,
          mood,
          paletteWeights: extracted.paletteWeights,
          seedRef,
          candidateIds: (curated ? curated.ids : null)
        });
      } catch (e) {
        console.warn("Video selection failed:", e);
      }

      let chosenModel = null;
      try {
        chosenModel = this.modelManager.selectModel({
          themes: extracted.themes,
          mood,
          paletteWeights: extracted.paletteWeights,
          seedRef
        });
      } catch (e) {
        console.warn("Model selection failed (non-fatal):", e);
      }

      let modelCyclePlan = null;
      try {
        modelCyclePlan = this.modelManager.buildCyclePlan({
          themes: extracted.themes,
          mood,
          paletteWeights: extracted.paletteWeights,
          seedRef
        });
      } catch (e) {
        console.warn("Model cycle plan failed (non-fatal):", e);
      }

      this.applyVideo(chosenVideo);

      try {
        this.hydraLayer.setPalette({ paletteSet, primary, secondary });
        this.hydraLayer.setExternalVideoSource(this.el.bgVideo);
        this.hydraLayer.applyPresetFamily({ family: hydraFamily, seedInt });
      } catch (e) {
        console.warn("Hydra mapping failed (non-fatal):", e);
      }

      try { this.modelLayer.setPalette({ primary, secondary }); } catch (_) {}

      this.overlay.onNewVerse({ verseKey: resolved.key, modelCyclePlan });

      this.scripture.setPalette({
        paletteSet,
        textGem: { name: "Jasper", hex: "#EFFFFF" },
        shadowGem: { name: "Crystal", hex: "#0E5E5E" },
        accentGem: primaryGem
      });

      this.scripture.showVerse({ ref, text: resolved.text }, { cps: this.settings.typeCps });

      this.currentContext = {
        resolved,
        extracted,
        paletteSet,
        primaryGem,
        secondaryGem,
        hydraFamily,
        seedRef,
        seedInt,
        chosenVideo,
        chosenModel,
        modelCyclePlan
      };

      this.#status(`Now showing: ${ref}`);
    }

    applyVideo(videoMeta) {
      if (!videoMeta) {
        this.el.bgVideo.removeAttribute("src");
        this.el.bgVideo.load();
        this.el.fallbackBg.style.opacity = "0.9";
        this.lastVideoId = "(none)";
        return;
      }

      this.el.fallbackBg.style.opacity = "0";
      this.el.bgVideo.src = videoMeta.path;
      this.el.bgVideo.load();
      this.lastVideoId = videoMeta.id;

      this.#playVideoSafe();
    }

    async #playVideoSafe() {
      try { await this.el.bgVideo.play(); } catch (_) {}
    }

    updateDiagnostics(audioFeatures) {
      if (!this.currentContext) return;

      const c = this.currentContext;
      const t = c.extracted;

      const lines = [];
      lines.push(`Resolved: ${this.#formatRef(c.resolved)}`);
      lines.push(`Key: ${c.resolved.key}`);
      lines.push(`Mood: ${t.mood}`);
      lines.push(`PaletteWeights: bright=${t.paletteWeights.bright.toFixed(3)} dark=${t.paletteWeights.dark.toFixed(3)}`);
      lines.push(`PaletteSet: ${c.paletteSet}`);
      lines.push(`Accent: ${c.primaryGem.name} ${c.primaryGem.hex}`);
      lines.push(`Secondary: ${c.secondaryGem.name} ${c.secondaryGem.hex}`);
      lines.push(`HydraFamily: ${c.hydraFamily}`);
      lines.push(`HydraPreset: ${this.hydraLayer.getCurrentPresetId()}`);
      lines.push(`Video: ${this.lastVideoId}`);
      lines.push(`Model candidate: ${c.chosenModel ? c.chosenModel.id : "(none)"}`);
      lines.push(`Model cycle: ${c.modelCyclePlan ? (c.modelCyclePlan.models.length + " @ " + Math.round((c.modelCyclePlan.intervalMs || 0)/1000) + "s") : "0"}`);
      lines.push(`Model active: ${this.modelLayer.isActive() ? "yes" : "no"}`);
      lines.push("");

      lines.push("Themes (sorted by weight):");
      for (const th of t.themes) {
        lines.push(`- [Tier ${th.tier}] ${th.id} (${th.label}) weight=${th.weight.toFixed(3)} source=${th.sources.join("; ")}`);
      }

      lines.push("");
      lines.push("Audio features:");
      const f = audioFeatures || this.audio.features();
      lines.push(`- enabled=${f.enabled} mode=${f.mode || "n/a"} amp=${f.amp.toFixed(3)} low=${f.low.toFixed(3)} mid=${f.mid.toFixed(3)} high=${f.high.toFixed(3)}`);

      const out = lines.join("\n");
      if (out !== this.lastDiag) {
        this.el.diag.textContent = out;
        this.lastDiag = out;
      }
    }

    #pickMaxChars(w, h) {
      // Keep in sync with ScriptureRenderer.pickMaxChars() so resolve-time limits match render-time limits.
      const area = w * h;
      let est = Math.round((area / 250) / 50) * 50;
      est = Math.max(400, Math.min(1200, est));
      return est;
    }

    #scriptureReservedBottomPx() {
      // Reserve bottom band for the symbol viewport so scripture remains legible and unobscured.
      return Math.floor(this.INTERNAL_H * 0.36);
    }

    #maxScriptureChars() {
      const usableH = Math.max(200, this.INTERNAL_H - this.#scriptureReservedBottomPx());
      return this.#pickMaxChars(this.INTERNAL_W, usableH);
    }

    #formatRef(resolved) {
      const v0 = resolved.verse;
      const v1 = resolved.verseEnd;
      if (typeof v1 === "number" && v1 > v0) return `${resolved.book} ${resolved.chapter}:${v0}-${v1}`;
      return `${resolved.book} ${resolved.chapter}:${v0}`;
    }

    #status(msg) {
      this.el.status.textContent = msg;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const app = new TheLampApp();
    TheLamp.app = app;
    app.init().catch(err => {
      console.error(err);
      const status = document.getElementById("status");
      if (status) status.textContent = `Fatal init error: ${err.message}`;
    });
  });
})();
