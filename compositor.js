(function () {
  "use strict";

  window.Memorial = window.Memorial || {};

  // Canvas draw helper: draw an image/video with "cover" scaling (object-fit: cover)
  function drawCover(ctx, src, dstW, dstH) {
    const sw = src.videoWidth || src.width || 0;
    const sh = src.videoHeight || src.height || 0;
    if (!sw || !sh) return false;

    const scale = Math.max(dstW / sw, dstH / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    const dx = (dstW - dw) / 2;
    const dy = (dstH - dh) / 2;

    ctx.drawImage(src, dx, dy, dw, dh);
    return true;
  }

  class Compositor {
    constructor({
      internalW, internalH,
      outW, outH,
      finalCanvasEl,
      bgVideo,
      hydraCanvas,
      modelCanvas,
      p5Mount,
      // Visual policy (match previous CSS)
      videoFilter = "brightness(0.72) contrast(0.92) saturate(0.85)",
      hydraBlendMode = "soft-light",
      hydraOpacity = 0.18
    }) {
      this.internalW = internalW;
      this.internalH = internalH;
      this.outW = outW;
      this.outH = outH;

      this.bgVideo = bgVideo;
      this.hydraCanvas = hydraCanvas;
      this.modelCanvas = modelCanvas;
      this.p5Mount = p5Mount;

      this.videoFilter = videoFilter;
      this.hydraBlendMode = hydraBlendMode;
      this.hydraOpacity = hydraOpacity;

      // Visible preview canvas (internal resolution)
      this.finalCanvas = finalCanvasEl;
      this.finalCanvas.width = internalW;
      this.finalCanvas.height = internalH;
      this.finalCtx = this.finalCanvas.getContext("2d", { alpha: false });

      // Offscreen capture canvas (output resolution)
      this.captureCanvas = document.createElement("canvas");
      this.captureCanvas.width = outW;
      this.captureCanvas.height = outH;
      this.captureCtx = this.captureCanvas.getContext("2d", { alpha: false });

      this.finalCtx.imageSmoothingEnabled = false;
      this.captureCtx.imageSmoothingEnabled = false;

      this._p5Canvas = null;
    }

    getCaptureCanvas() {
      return this.captureCanvas;
    }

    _getP5Canvas() {
      if (this._p5Canvas && this._p5Canvas.isConnected) return this._p5Canvas;
      this._p5Canvas = this.p5Mount ? this.p5Mount.querySelector("canvas") : null;
      return this._p5Canvas;
    }

    _drawFallback(ctx) {
      // Deterministic fallback: gemstone palette only (Crystal + Chalcedony)
      ctx.save();
      ctx.fillStyle = "#0E5E5E"; // Dark Crystal
      ctx.fillRect(0, 0, this.internalW, this.internalH);

      // Subtle hatch
      ctx.globalAlpha = 0.12;
      ctx.strokeStyle = "#145A83"; // Dark Chalcedony
      ctx.lineWidth = 1;
      for (let y = -this.internalW; y < this.internalH + this.internalW; y += 7) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(this.internalW, y + this.internalW);
        ctx.stroke();
      }
      ctx.restore();
    }

    render() {
      const ctx = this.finalCtx;
      ctx.clearRect(0, 0, this.internalW, this.internalH);

      // Background video (or fallback)
      let drewVideo = false;
      if (this.bgVideo && this.bgVideo.readyState >= 2) {
        ctx.save();
        ctx.filter = this.videoFilter;
        drewVideo = drawCover(ctx, this.bgVideo, this.internalW, this.internalH);
        ctx.restore();
      }
      if (!drewVideo) this._drawFallback(ctx);

      // Hydra midground (blend + opacity)
      if (this.hydraCanvas) {
        ctx.save();
        ctx.globalCompositeOperation = this.hydraBlendMode;
        ctx.globalAlpha = this.hydraOpacity;
        ctx.drawImage(this.hydraCanvas, 0, 0, this.internalW, this.internalH);
        ctx.restore();
      }

      // 3D model symbols
      if (this.modelCanvas) {
        ctx.save();
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1.0;
        ctx.drawImage(this.modelCanvas, 0, 0, this.internalW, this.internalH);
        ctx.restore();
      }

      // Foreground scripture (p5 canvas)
      const p5c = this._getP5Canvas();
      if (p5c) {
        ctx.save();
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1.0;
        ctx.drawImage(p5c, 0, 0, this.internalW, this.internalH);
        ctx.restore();
      }

      // Scale to capture canvas (nearest-neighbor)
      const octx = this.captureCtx;
      octx.clearRect(0, 0, this.outW, this.outH);
      octx.imageSmoothingEnabled = false;
      octx.drawImage(this.finalCanvas, 0, 0, this.outW, this.outH);
    }
  }

  window.Memorial.Compositor = Compositor;
})();