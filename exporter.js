(function () {
  "use strict";

  window.Memorial = window.Memorial || {};

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function downloadBlob(blob, filename) {
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function loadScriptOnce(src) {
    if (document.querySelector(`script[data-memorial-src="${src}"]`)) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.dataset.memorialSrc = src;
      s.onload = () => resolve();
      s.onerror = (e) => reject(new Error(`Failed to load script: ${src}`));
      document.head.appendChild(s);
    });
  }

  class Exporter {
    constructor({ internalW, internalH, outW, outH, fps, bgVideo, hydraCanvas, modelCanvas, p5Mount, audioEngine, onStatus, captureCanvas, renderFrame }) {
      this.internalW = internalW;
      this.internalH = internalH;
      this.outW = outW;
      this.outH = outH;
      this.fps = fps;

      this.bgVideo = bgVideo;
      this.hydraCanvas = hydraCanvas;
      this.modelCanvas = modelCanvas;
      this.p5Mount = p5Mount;
      this.audioEngine = audioEngine;

      this.onStatus = typeof onStatus === "function" ? onStatus : () => {};

      this.captureCanvas = captureCanvas || null;
      this.renderFrame = (typeof renderFrame === "function") ? renderFrame : null;

      this.internalCanvas = document.createElement("canvas");
      this.internalCanvas.width = internalW;
      this.internalCanvas.height = internalH;
      this.internalCtx = this.internalCanvas.getContext("2d", { alpha: true });

      this.outCanvas = document.createElement("canvas");
      this.outCanvas.width = outW;
      this.outCanvas.height = outH;
      this.outCtx = this.outCanvas.getContext("2d", { alpha: false });

      // Critical: keep intentional pixelation
      this.internalCtx.imageSmoothingEnabled = false;
      this.outCtx.imageSmoothingEnabled = false;
    }

    getP5Canvas() {
      return this.p5Mount ? this.p5Mount.querySelector("canvas") : null;
    }

    async resetAVToZero() {
      // Reset background video
      try {
        if (this.bgVideo) {
          this.bgVideo.currentTime = 0;

          // Attempt play; some browsers require a prior user gesture (already true in your UI flow)
          await this.bgVideo.play().catch(() => {});

          // Wait until we have a decoded frame available (prevents "first frame only" glitches)
          if (this.bgVideo.readyState < 2) {
            await new Promise((resolve) => {
              const done = () => resolve();
              this.bgVideo.addEventListener("loadeddata", done, { once: true });
              this.bgVideo.addEventListener("canplay", done, { once: true });
              setTimeout(done, 500); // hard safety cap
            });
          }
        }
      } catch (_) {}

      // Reset audio to 0
      try {
        if (this.audioEngine) this.audioEngine.resetToZero();
      } catch (_) {}
    }

    compositeFrame() {
      const ctx = this.internalCtx;
      ctx.clearRect(0, 0, this.internalW, this.internalH);

      // Background video
      if (this.bgVideo && this.bgVideo.readyState >= 2) {
        ctx.drawImage(this.bgVideo, 0, 0, this.internalW, this.internalH);
      }

      // Hydra
      if (this.hydraCanvas) {
        ctx.drawImage(this.hydraCanvas, 0, 0, this.internalW, this.internalH);
      }

      // Models
      if (this.modelCanvas) {
        ctx.drawImage(this.modelCanvas, 0, 0, this.internalW, this.internalH);
      }

      // Scripture (p5 canvas)
      const p5c = this.getP5Canvas();
      if (p5c) {
        ctx.drawImage(p5c, 0, 0, this.internalW, this.internalH);
      }

      // Scale to output
      this.outCtx.clearRect(0, 0, this.outW, this.outH);
      this.outCtx.drawImage(this.internalCanvas, 0, 0, this.outW, this.outH);
    }

    pickRecorderMime() {
      const candidates = [
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
        'video/mp4;codecs=avc1.4D401E,mp4a.40.2',
        'video/mp4;codecs=avc1.640028,mp4a.40.2',
        'video/mp4',
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm' 
      ];
      for (const t of candidates) {
        try {
          if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) return t;
        } catch (_) {}
      }
      return "";
    }

    async exportMp4({ seconds }) {
      const durSec = Math.max(1, Math.min(180, Number(seconds || 12)));
      const durMs = durSec * 1000;

      this.onStatus("Preparing export…");
      await this.resetAVToZero();
      await sleep(80);

      if (this.renderFrame) this.renderFrame(); else this.compositeFrame();

      // Build stream: video from canvas + audio from AudioEngine destination
      const srcCanvas = this.captureCanvas || this.outCanvas;
      const videoStream = srcCanvas.captureStream(this.fps);
      const audioStream = (this.audioEngine && this.audioEngine.getExportStream)
        ? this.audioEngine.getExportStream()
        : new MediaStream();

      const tracks = [
        ...videoStream.getVideoTracks(),
        ...audioStream.getAudioTracks()
      ];
      const mixed = new MediaStream(tracks);

      const mimeType = this.pickRecorderMime();
      if (!mimeType) throw new Error("MediaRecorder unsupported in this browser.");

      this.onStatus(`Recording (${durSec}s)…`);

      const chunks = [];
      // Use a small timeslice to reduce the chance of a truncated WebM (which can make ffmpeg.wasm throw
      // "internal data stream error" sporadically when decoding).
      const rec = new MediaRecorder(mixed, mimeType ? { mimeType } : undefined);
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

      const startMs = performance.now();
      let raf = 0;

      const renderLoop = () => {
        if (this.renderFrame) this.renderFrame(); else this.compositeFrame();
        const now = performance.now();
        if (now - startMs >= durMs) return;
        raf = requestAnimationFrame(renderLoop);
      };

      const stopped = new Promise((resolve) => {
        rec.onstop = () => resolve();
      });

      rec.start(250);
      raf = requestAnimationFrame(renderLoop);

      await sleep(durMs);
      try { rec.requestData(); } catch (_) {}
      await sleep(40);
      try { rec.stop(); } catch (_) {}
      try { cancelAnimationFrame(raf); } catch (_) {}
      await stopped;

      if (!chunks.length) {
        throw new Error("Recording produced no data (chunks empty). Try again after starting audio/video first.");
      }

      const blob = new Blob(chunks, { type: rec.mimeType || mimeType || "video/webm" });

      // If we got MP4 directly, download immediately.
      if ((blob.type || "").includes("mp4")) {
        this.onStatus("Export ready (MP4). Downloading…");
        downloadBlob(blob, "memorial_export.mp4");
        this.onStatus("Export complete.");
        return;
      }

      // Otherwise transcode WebM → MP4 in-browser using ffmpeg.wasm
      this.onStatus("Transcoding WebM → MP4 (in-browser)…");

      // Modern Chromium (including Brave) disables SharedArrayBuffer unless the page is crossOriginIsolated
      // (COOP+COEP headers). ffmpeg.wasm builds may reference SharedArrayBuffer even when configured for
      // single-thread operation. If SharedArrayBuffer is unavailable, we cannot reliably transcode in-browser.
      // In that case, export the WebM immediately and avoid throwing a hard error.
      if (typeof SharedArrayBuffer === "undefined" || !window.crossOriginIsolated) {
        const hint = "MP4 transcode is blocked because SharedArrayBuffer is unavailable (page not cross-origin isolated).";
        console.warn(hint);
        this.onStatus(hint + " Downloading WebM instead…");
        downloadBlob(blob, "memorial_export.webm");
        this.onStatus("Export complete (WebM). To convert to MP4 locally: ffmpeg -i memorial_export.webm -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart memorial_export.mp4");
        return;
      }

      // Use known working UMD wrapper + SINGLE-THREAD core (no SharedArrayBuffer / COOP/COEP required).
      // IMPORTANT: Do NOT use @ffmpeg/core-mt here; Brave will throw "SharedArrayBuffer is not defined" unless
      // the page is crossOriginIsolated.
      await loadScriptOnce("https://unpkg.com/@ffmpeg/ffmpeg@0.10.0/dist/ffmpeg.min.js");

      if (!window.FFmpeg || !window.FFmpeg.createFFmpeg) {
        throw new Error("FFmpeg.wasm failed to load (FFmpeg global missing).");
      }

      const { createFFmpeg, fetchFile } = window.FFmpeg;

      const ffmpeg = createFFmpeg({
        log: false,
        // Single-thread core (doesn't require SharedArrayBuffer)
        corePath: "https://unpkg.com/@ffmpeg/core@0.10.0/dist/ffmpeg-core.js"
      });

      await ffmpeg.load();

      ffmpeg.FS("writeFile", "input.webm", await fetchFile(blob));

      // Try H.264/AAC first (best for Shorts/Reels/TikTok). If unavailable, fall back to MPEG-4.
      let outBytes = null;
      try {
        await ffmpeg.run(
          "-err_detect", "ignore_err",
          "-fflags", "+genpts",
          "-i", "input.webm",
          "-c:v", "libx264",
          "-pix_fmt", "yuv420p",
          "-r", String(this.fps),
          "-c:a", "aac",
          "-b:a", "192k",
          "-movflags", "+faststart",
          "output.mp4"
        );
        outBytes = ffmpeg.FS("readFile", "output.mp4");
      } catch (e) {
        console.warn("H.264 encode failed; falling back to MPEG-4:", e);
        await ffmpeg.run(
          "-err_detect", "ignore_err",
          "-fflags", "+genpts",
          "-i", "input.webm",
          "-c:v", "mpeg4",
          "-q:v", "4",
          "-r", String(this.fps),
          "-c:a", "aac",
          "-b:a", "192k",
          "-movflags", "+faststart",
          "output.mp4"
        );
        outBytes = ffmpeg.FS("readFile", "output.mp4");
      }

      const mp4Blob = new Blob([outBytes.buffer], { type: "video/mp4" });
      this.onStatus("Export ready (MP4). Downloading…");
      downloadBlob(mp4Blob, "memorial_export.mp4");
      this.onStatus("Export complete.");
    }
  }

  window.Memorial.Exporter = Exporter;
})();
