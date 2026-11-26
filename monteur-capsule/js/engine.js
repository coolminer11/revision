// engine.js — playback (program + source views) and real-time export.
import { store, program, buildProgram, locate, srcToOut, partOutStart, partById, partRange, clipById, auxVideosAt, on, emit } from "./state.js";
import { renderFrame, renderThumbnail } from "./render.js";
import { getVideo, getImage, getAudio, allMediaElements } from "./media.js";
import * as A from "./audio.js";

const PREVIEW_W = 1280, PREVIEW_H = 720;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isVideoSpan = s => !!(s && (s.type === "talk" || s.type === "extract") && s.clipId);
const NO_VOICE = { clear: false, denoise: 0 };

function waitEvent(el, events, ms) {
  return new Promise(resolve => {
    let done = false;
    const fin = ok => { if (done) return; done = true; clearTimeout(timer); for (const e of events) el.removeEventListener(e, on1); el.removeEventListener("error", onErr); resolve(ok); };
    const on1 = () => fin(true), onErr = () => fin(false);
    for (const e of events) el.addEventListener(e, on1);
    el.addEventListener("error", onErr);
    const timer = setTimeout(() => fin(false), ms);
  });
}
async function seekEl(v, t, ms = 8000) {
  if (!v) return false;
  if (v.readyState < 1 && !(await waitEvent(v, ["loadedmetadata"], ms))) return false;
  if (isFinite(v.duration) && v.duration > 0) t = clamp(t, 0, Math.max(0, v.duration - 0.005));
  if (Math.abs(v.currentTime - t) < 0.0015 && !v.seeking) {
    if (v.readyState < 2) await waitEvent(v, ["loadeddata", "canplay"], ms);
    return true;
  }
  const p = waitEvent(v, ["seeked"], ms);
  v.currentTime = t;
  return p;
}
async function waitReady(v, ms = 5000) {
  if (!v || v.readyState >= 3) return true;
  return waitEvent(v, ["canplay", "canplaythrough"], ms);
}
function pickMime(fps) {
  const list = [
    fps > 30 ? "video/mp4;codecs=avc1.64002a,mp4a.40.2" : "video/mp4;codecs=avc1.640028,mp4a.40.2",
    "video/mp4;codecs=avc1.4d002a,mp4a.40.2", "video/mp4;codecs=avc1,mp4a.40.2",
    "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4",
  ];
  return list.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
}
function setRate(el, r) { if (el && Math.abs(el.playbackRate - r) > 1e-3) { try { el.playbackRate = r; } catch (e) { } } el && (el.preservesPitch = true); }
function loopDiff(cur, want, dur, loop) {
  let d = cur - want;
  if (loop && isFinite(dur) && dur > 0) { d = ((d % dur) + dur) % dur; if (d > dur / 2) d -= dur; }
  return d;
}

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    canvas.width = PREVIEW_W; canvas.height = PREVIEW_H;
    this._view = "program"; this._partId = null;
    this._prog = program(); this._seq = this._prog;
    this._t = 0; this._srcT = 0; this._si = 0;
    this._playing = false; this._rate = 1;
    this._mainEl = null; this._musicEl = null;
    this._wallRef = 0; this._wall0 = performance.now();
    this._prefetched = -1; this._nextEl = null;
    this._exporting = false; this._starting = false; this._job = null; this._lastUrl = null;
    this._lastEmitT = -1; this._renderErr = null;

    on("any", kind => this._onChange(kind));
    on("style", () => { if (!this._exporting) A.setMaster((+store.project.style.masterVolume || 100) / 100); });
    on("mediaElementRemoved", d => { if (d && d.el) { A.unwire(d.el); if (this._mainEl === d.el) this._mainEl = null; if (this._musicEl === d.el) this._musicEl = null; } });

    const loop = () => {
      requestAnimationFrame(loop);
      if (this._exporting) return;
      if (this._playing) this._tick(performance.now());
      this._renderPreview();
      if (this._playing || this._t !== this._lastEmitT) { this._lastEmitT = this._t; emit("time", { t: this._t, duration: this.duration, view: this._view, playing: this._playing }); }
    };
    requestAnimationFrame(loop);
  }

  /* ---------------- public getters ---------------- */
  get time() { return this._t; }
  get duration() { return this._seq ? this._seq.duration : 0; }
  get playing() { return this._playing; }
  get view() { return this._view; }
  get exporting() { return this._exporting; }
  get rate() { return this._rate; }

  /* ---------------- sequence helpers ---------------- */
  _sourceSeq(part) {
    if (!part) return { spans: [], duration: 0 };
    const clip = clipById(part.clipId);
    const D = part.type === "card" ? Math.max(0.5, +part.dur || 2) : ((clip && clip.duration) || part.out || 0);
    if (!(D > 0)) return { spans: [], duration: 0 };
    return {
      spans: [{ i: 0, type: part.type, partId: part.id, clipId: part.type === "card" ? null : part.clipId, auto: false, srcStart: 0, srcEnd: D, speed: 1, outStart: 0, outEnd: D, firstOfPart: true, memberIndex: 0, title: part.title, sub: part.sub }],
      duration: D,
    };
  }
  _cur() {
    const seq = this._seq;
    if (!seq.spans.length) return null;
    const s = seq.spans[this._si];
    if (s && this._t >= s.outStart - 1e-3 && this._t <= s.outEnd + 1e-3) {
      const local = clamp(this._t - s.outStart, 0, s.outEnd - s.outStart);
      const srcT = this._playing && this._mainEl ? clamp(this._srcT, s.srcStart, s.srcEnd) : s.srcStart + local * s.speed;
      return { span: s, local, srcT };
    }
    const loc = locate(seq, this._t);
    if (loc) this._si = loc.span.i;
    return loc;
  }
  _outTFor(span, srcT) {
    if (this._view === "program") return span ? span.outStart + (srcT - span.srcStart) / span.speed : this._t;
    const o = span ? srcToOut(this._prog, span.partId, srcT) : null;
    return o == null ? (span ? partOutStart(this._prog, span.partId) : 0) : o;
  }

  currentFrameInfo() {
    const c = this._cur();
    if (!c) return { span: null, srcT: 0, local: 0, outT: this._view === "program" ? this._t : 0, part: null };
    return { span: c.span, srcT: c.srcT, local: c.local, outT: this._outTFor(c.span, c.srcT), part: partById(c.span.partId) };
  }

  /* ---------------- rendering ---------------- */
  _frame(span, local, srcT, outT, exporting) {
    const p = store.project;
    return {
      project: p, style: p.style,
      span, local, srcT, outT,
      slides: store.slides, slideTitles: store.slideTitles,
      getVideo: this._frameGetVideo(span), getImage,
      bgImage: store.bgImage, logoImage: store.logoImage,
      wall: (performance.now() - this._wall0) / 1000,
      exporting: !!exporting,
      duration: this._prog.duration,
      part: span ? partById(span.partId) : null,
      view: exporting ? "program" : this._view,
    };
  }
  /** getVideo for render: (clipId,"main") returns the element actually playing the span (preview may alternate two elements). */
  _frameGetVideo(span) {
    const el = this._mainEl, id0 = span && span.clipId;
    if (!el || !id0 || el.dataset.clipId !== id0) return getVideo;
    return (id, role = "main") => (role === "main" && id === id0) ? el : getVideo(id, role);
  }
  _elFor(span) {
    if (!isVideoSpan(span)) return null;
    if (this._mainEl && this._mainEl.dataset.clipId === span.clipId && this._mainEl.isConnected) return this._mainEl;
    return getVideo(span.clipId, "main");
  }
  _draw(ctx, W, H, f) {
    try { renderFrame(ctx, W, H, f); this._renderErr = null; }
    catch (e) {
      if (!this._renderErr) console.error("renderFrame", e);
      this._renderErr = e;
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.filter = "none";
      ctx.fillStyle = "#111"; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#f66"; ctx.font = `${Math.round(H / 30)}px system-ui,sans-serif`; ctx.fillText("Erreur d'affichage : " + (e.message || e), W * 0.04, H * 0.1);
      ctx.restore();
    }
  }
  _renderPreview() {
    const c = this._cur();
    const W = this.canvas.width, H = this.canvas.height;
    if (!c) { this._draw(this.ctx, W, H, this._frame(null, 0, 0, 0, false)); return; }
    this._draw(this.ctx, W, H, this._frame(c.span, c.local, c.srcT, this._outTFor(c.span, c.srcT), false));
  }
  renderNow() { if (!this._exporting) this._renderPreview(); }

  /* ---------------- audio helpers ---------------- */
  _applyMainAudio(span, v) {
    const part = partById(span.partId);
    if (A.wire(v)) {
      A.setClipVolume(v, part ? (part.volume ?? 1) : 1);
      A.setVoice(v, (part && part.voice) || NO_VOICE);
    } else v.volume = clamp(part ? (part.volume ?? 1) : 1, 0, 1);
  }
  _musicTime(outT, el) {
    const d = el.duration;
    if (!isFinite(d) || d <= 0) return outT;
    if (store.project.music.loop) return outT % d;
    return outT < d - 0.05 ? outT : null;
  }
  _syncMusic(playing, outT, exporting = false) {
    const m = store.project.music;
    const el = m.clipId && this._view === "program" ? getAudio(m.clipId) : null;
    if (this._musicEl && this._musicEl !== el) this._musicEl.pause();
    this._musicEl = el;
    if (!el) return;
    const wired = A.wire(el, "music");
    A.setMusicParams({ volume: m.volume, duck: m.duck });
    if (!wired) el.volume = clamp(+m.volume || 0, 0, 1);
    el.loop = !!m.loop;
    const D = this._prog.duration;
    let env = 1;
    if (+m.fadeIn > 0) env = Math.min(env, outT / m.fadeIn);
    if (+m.fadeOut > 0) env = Math.min(env, (D - outT) / m.fadeOut);
    // equal-power curve: audible right away, smooth ending (a linear gain ramp sounds silent for the first ~third)
    A.setMusicEnvelope(Math.sin(clamp(env, 0, 1) * Math.PI / 2));
    const want = this._musicTime(outT, el);
    if (want == null) { if (!el.paused) el.pause(); return; }
    if (playing) {
      setRate(el, exporting ? 1 : this._rate);
      const diff = loopDiff(el.currentTime, want, el.duration, el.loop);
      if (el.paused) { if (Math.abs(diff) > 0.05) el.currentTime = want; el.play().catch(() => { }); }
      else if (Math.abs(diff) > 0.3 && !el.seeking) el.currentTime = want;
    } else if (!el.paused) el.pause();
  }
  /** Keep secondary videos in sync; pause every element not needed. */
  _syncAux(span, srcT, playing, exporting = false, tol = 0.25) {
    const keep = new Set();
    if (this._mainEl) keep.add(this._mainEl);
    if (this._musicEl) keep.add(this._musicEl);
    if (this._nextEl) keep.add(this._nextEl);
    const list = span ? auxVideosAt(span, srcT) : [];
    const part = span ? partById(span.partId) : null;
    for (const d of list) {
      const v = getVideo(d.clipId, d.role);
      if (!v || v === this._mainEl) continue;
      keep.add(v);
      v.loop = !!d.loop;
      setRate(v, d.rate * (exporting ? 1 : this._rate));
      if (A.wire(v)) { A.setClipVolume(v, d.volume); A.setVoice(v, d.role === "camB" && part ? part.voice || NO_VOICE : NO_VOICE); }
      else v.volume = clamp(+d.volume || 0, 0, 1);
      const diff = loopDiff(v.currentTime, d.time, v.duration, d.loop);
      if (playing) {
        if (!v.seeking && Math.abs(diff) > tol) v.currentTime = d.time;
        if (v.paused && !v.ended) v.play().catch(() => { });
      } else {
        if (!v.paused) v.pause();
        if (!v.seeking && Math.abs(diff) > 0.02) v.currentTime = d.time;
      }
    }
    for (const el of allMediaElements()) if (!keep.has(el) && !el.paused) el.pause();
    return list;
  }

  /* ---------------- playback ---------------- */
  _enterSpan(i, srcT, tol, now = performance.now()) {
    const seq = this._seq;
    const span = seq.spans[i];
    if (!span) { this._t = seq.duration; this.pause(); return; }
    this._si = i; this._prefetched = -1;
    const start = srcT == null ? span.srcStart : clamp(srcT, span.srcStart, span.srcEnd);
    let v = null;
    if (isVideoSpan(span)) {
      const nx = this._nextEl;
      v = nx && nx.isConnected && nx.dataset.clipId === span.clipId && Math.abs(nx.currentTime - start) < 0.05 ? nx : this._elFor(span);
    }
    this._nextEl = null;
    A.setVoiceExpected(!!v);
    if (this._mainEl && this._mainEl !== v) this._mainEl.pause();
    this._mainEl = v;
    this._srcT = start;
    this._t = span.outStart + (start - span.srcStart) / span.speed;
    if (v) {
      this._applyMainAudio(span, v);
      setRate(v, span.speed * this._rate);
      if (Math.abs(v.currentTime - start) > tol) v.currentTime = start;
      if (this._playing) v.play().catch(e => { if (e && e.name !== "AbortError") emit("mediaWarning", { message: "Lecture impossible : " + e.message }); });
    } else {
      this._wallRef = now - ((start - span.srcStart) / span.speed) * 1000 / this._rate;
    }
  }
  _tick(now) {
    const seq = this._seq;
    let span = seq.spans[this._si];
    if (!span) { this.pause(); return; }
    let srcT;
    const v = this._mainEl;
    if (v) {
      srcT = v.currentTime;
      if (v.ended || srcT >= span.srcEnd - 0.01) {
        if (this._view === "source") { this._t = seq.duration; this._srcT = span.srcEnd; this.pause(); return; }
        this._enterSpan(this._si + 1, null, 0.15, now);
        if (!this._playing) return;
        span = seq.spans[this._si]; if (!span) return;
        srcT = this._srcT;
      } else if (v.paused && !v.seeking && v.readyState >= 2) v.play().catch(() => { });
      srcT = clamp(srcT, span.srcStart, span.srcEnd);
    } else {
      const local = (now - this._wallRef) / 1000 * this._rate;
      if (local >= span.outEnd - span.outStart) {
        if (this._view === "source" || this._si + 1 >= seq.spans.length) { this._t = seq.duration; this.pause(); return; }
        this._enterSpan(this._si + 1, null, 0.15, now);
        return;
      }
      srcT = span.srcStart + local * span.speed;
    }
    this._srcT = srcT;
    this._t = span.outStart + (srcT - span.srcStart) / span.speed;
    // pre-seek the next span's element; a cut inside the same clip uses a second element ("mainAlt") so it is seamless
    if (this._view === "program" && this._prefetched !== this._si && span.outEnd - this._t < 2) {
      const nx = seq.spans[this._si + 1];
      let nv = null;
      if (isVideoSpan(nx)) {
        const cur = this._mainEl;
        if (cur && cur.dataset.clipId === nx.clipId) {
          if (Math.abs(nx.srcStart - span.srcEnd) > 1e-3) nv = getVideo(nx.clipId, cur.dataset.role === "mainAlt" ? "main" : "mainAlt");
        } else nv = getVideo(nx.clipId, "main");
      }
      if (nv) {
        if (!nv.paused) nv.pause();
        if (Math.abs(nv.currentTime - nx.srcStart) > 0.02) nv.currentTime = nx.srcStart;
        if (A.wire(nv)) this._applyMainAudio(nx, nv);
      }
      this._nextEl = nv;
      this._prefetched = this._si;
    }
    this._syncAux(span, srcT, true);
    if (this._view === "program") this._syncMusic(true, this._t);
  }
  _showPaused() {
    const c = this._cur();
    if (!c) { this._mainEl && this._mainEl.pause(); this._mainEl = null; this._syncAux(null, 0, false); return; }
    const { span, srcT } = c;
    const v = this._elFor(span);
    if (this._mainEl && this._mainEl !== v) this._mainEl.pause();
    this._mainEl = v;
    this._srcT = srcT;
    if (v) {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - srcT) > 0.001) v.currentTime = srcT;
    }
    this._syncAux(span, srcT, false);
    this._syncMusic(false, this._outTFor(span, srcT));
    this._renderPreview();
  }

  play() {
    if (this._exporting || this._playing) return;
    if (!this._seq.spans.length) return;
    A.ensureAudio();
    A.setMaster((+store.project.style.masterVolume || 100) / 100);
    A.setMonitor(true);
    if (this._t >= this.duration - 0.03) this._t = 0;
    this._playing = true;
    const loc = locate(this._seq, this._t);
    this._enterSpan(loc.span.i, loc.srcT, 0.01);
    emit("playstate", { playing: true });
  }
  pause() {
    const was = this._playing;
    this._playing = false;
    for (const el of allMediaElements()) if (!el.paused) el.pause();
    if (this._mainEl && !this._exporting) {
      // freeze on the exact frame shown
      const s = this._seq.spans[this._si];
      if (s && isVideoSpan(s)) { this._srcT = clamp(this._mainEl.currentTime, s.srcStart, s.srcEnd); this._t = clamp(s.outStart + (this._srcT - s.srcStart) / s.speed, 0, this.duration); }
    }
    if (!this._exporting) this._showPaused();
    if (was) emit("playstate", { playing: false });
  }
  toggle() { this._playing ? this.pause() : this.play(); }
  seek(t) {
    if (this._exporting) return;
    this._t = clamp(+t || 0, 0, this.duration);
    if (this._playing) {
      const loc = locate(this._seq, this._t);
      if (!loc) return this.pause();
      this._enterSpan(loc.span.i, loc.srcT, 0.01);
      this._syncAux(loc.span, loc.srcT, true);
    } else {
      const loc = locate(this._seq, this._t);
      if (loc) this._si = loc.span.i;
      this._showPaused();
    }
  }
  nudge(dt) { this.seek(this._t + dt); }
  setRate(r) {
    const now = performance.now();
    const old = this._rate;
    this._rate = clamp(+r || 1, 0.25, 4);
    const span = this._seq.spans[this._si];
    if (!span) return;
    if (this._mainEl) setRate(this._mainEl, span.speed * this._rate);
    else if (this._playing) { const local = (now - this._wallRef) / 1000 * old; this._wallRef = now - local * 1000 / this._rate; }
  }
  setView(view, partId) {
    if (this._exporting) return;
    if (this._playing) this.pause();
    this._prog = program();
    if (view === "source") {
      const part = partById(partId || this._partId || store.selectedPartId);
      if (!part) return;
      let st = part.type === "card" ? 0 : partRange(part)[0];
      if (this._view === "program") {
        const info = this.currentFrameInfo();
        if (info.span && info.span.partId === part.id && (info.span.type === "talk" || info.span.type === "extract")) st = info.srcT;
      } else if (this._partId === part.id) st = this._t;
      this._view = "source"; this._partId = part.id; store.view = "source";
      this._seq = this._sourceSeq(part);
      this._t = clamp(st, 0, this._seq.duration);
    } else {
      let ot = this._t;
      if (this._view === "source") {
        const part = partById(this._partId);
        const o = part ? srcToOut(this._prog, part.id, this._t) : null;
        ot = o != null ? o : (part ? partOutStart(this._prog, part.id) : 0);
      }
      this._view = "program"; store.view = "program";
      this._seq = this._prog;
      this._t = clamp(ot, 0, this._seq.duration);
    }
    this._si = 0;
    const loc = locate(this._seq, this._t); if (loc) this._si = loc.span.i;
    this._showPaused();
    emit("view", { view: this._view, partId: this._partId });
  }

  _onChange(kind) {
    if (this._exporting) return;
    if (kind !== "project" && kind !== "media") { if (!this._playing) this._renderPreview(); return; }
    const oldSeq = this._seq, oldSpan = oldSeq.spans[this._si], oldSrcT = this._srcT;
    this._prog = program();
    if (this._view === "source") {
      const part = partById(this._partId);
      if (!part) { this._view = "source"; this.setView("program"); return; }
      this._seq = this._sourceSeq(part);
      this._t = clamp(this._t, 0, this._seq.duration);
    } else {
      let nt = this._t;
      if (oldSpan && isVideoSpan(oldSpan)) { const o = srcToOut(this._prog, oldSpan.partId, oldSrcT); if (o != null) nt = o; }
      this._seq = this._prog;
      this._t = clamp(nt, 0, this._seq.duration);
    }
    const loc = locate(this._seq, this._t);
    if (!loc) { if (this._playing) this.pause(); else this._showPaused(); return; }
    this._si = loc.span.i;
    if (this._playing) this._enterSpan(loc.span.i, loc.srcT, 0.15);
    else this._showPaused();
  }

  /* ---------------- thumbnail ---------------- */
  async _prepareFrame(span, srcT) {
    if (isVideoSpan(span)) await seekEl(getVideo(span.clipId, "main"), srcT, 5000);
    await Promise.all(auxVideosAt(span, srcT).map(d => { const v = getVideo(d.clipId, d.role); if (v) v.pause(); return seekEl(v, d.time, 5000); }));
  }
  async thumbnailBlob() {
    if (this._exporting) throw new Error("Attends la fin de l'export.");
    if (this._playing) this.pause();
    const prog = this._prog = program();
    const outT = clamp(+store.project.thumbnail.outT || 0, 0, prog.duration);
    const loc = locate(prog, outT);
    const c = document.createElement("canvas"); c.width = 1280; c.height = 720;
    const cx = c.getContext("2d");
    if (this._mainEl) { this._mainEl.pause(); this._mainEl = null; }
    if (loc) await this._prepareFrame(loc.span, loc.srcT);
    const f = this._frame(loc ? loc.span : null, loc ? loc.local : 0, loc ? loc.srcT : 0, outT, false);
    f.view = "program";
    try { renderThumbnail(cx, 1280, 720, f, store.project.thumbnail); }
    catch (e) { console.error(e); throw new Error("Impossible de dessiner la miniature : " + e.message); }
    const blob = await new Promise(r => c.toBlob(r, "image/png"));
    c.width = c.height = 0;
    this._showPaused();
    if (!blob) throw new Error("Impossible de créer l'image.");
    return blob;
  }

  /* ---------------- export ---------------- */
  cancelExport() {
    const j = this._job;
    if (!j) return;
    j.cancelled = true;
    j.wake && j.wake();
  }
  async exportVideo({ onProgress, onStatus } = {}) {
    if (this._exporting || this._starting) throw new Error("Un export est déjà en cours.");
    this._starting = true;
    try { return await this._export(onProgress || (() => { }), onStatus || (() => { })); }
    finally { this._starting = false; }
  }

  async _export(onProgress, onStatus) {
    if (this._playing) this.pause();
    const prog = buildProgram();
    this._prog = prog;
    if (!prog.spans.length || prog.duration < 0.1) throw new Error("La séquence est vide : ajoute au moins une partie.");
    const missing = new Set();
    for (const s of prog.spans) if (isVideoSpan(s)) { const c = clipById(s.clipId); if (!c || !c.linked || !getVideo(s.clipId, "main")) missing.add(c ? c.fileName : "clip supprimé"); }
    if (missing.size) throw new Error("Ré-importe ces fichiers avant d'exporter : " + [...missing].join(", "));
    if (!window.MediaRecorder || !this.canvas.captureStream) throw new Error("Ton navigateur ne permet pas l'export. Utilise Chrome ou Edge sur ordinateur.");
    const st = store.project.style;
    const fps = +st.fps >= 50 ? 60 : 30;
    const H = String(st.res) === "720" ? 720 : 1080, W = Math.round(H * 16 / 9);
    const mime = pickMime(fps);
    if (!mime) throw new Error("Aucun format vidéo disponible pour l'export dans ce navigateur.");
    const ac = A.ensureAudio();
    if (!ac) throw new Error("Le son (Web Audio) n'est pas disponible dans ce navigateur.");
    try { await ac.resume(); } catch (e) { }
    await A.audioReady();
    A.resetDucking();
    if (ac.state !== "running") throw new Error("Le son est bloqué par le navigateur : clique dans la page puis relance l'export.");
    if (this._lastUrl) { URL.revokeObjectURL(this._lastUrl); this._lastUrl = null; }

    const job = this._job = { cancelled: false, error: null, wake: null };
    const fail = msg => { if (!job.error) job.error = msg; job.cancelled = true; job.wake && job.wake(); };
    this._exporting = true; store.exporting = true;
    if (this._view !== "program") { this._view = "program"; store.view = "program"; emit("view", { view: "program", partId: this._partId }); }
    this._seq = prog;
    emit("exportstate", { exporting: true });
    for (const el of allMediaElements()) el.pause();
    this.canvas.width = W; this.canvas.height = H;
    const ctx = this.ctx;
    A.setMaster((+st.masterVolume || 100) / 100);
    A.setMonitor(!!st.monitor);
    onStatus("Préparation de l'export…");

    const vStream = this.canvas.captureStream(fps);
    const stream = new MediaStream([...vStream.getVideoTracks(), ...A.recordStream().getAudioTracks()]);
    const chunks = [];
    let rec = null, stopped = null, started = false;
    const t0 = performance.now();
    let lastProg = 0;
    const onVis = () => onStatus(document.hidden ? "⚠️ Garde cet onglet visible pendant l'export, sinon la vidéo peut saccader." : "Export en cours… garde l'onglet visible.");
    document.addEventListener("visibilitychange", onVis);
    const frameMs = 1000 / fps;

    const draw = (span, srcT, outT) => {
      this._t = outT; this._si = span.i; this._srcT = srcT;
      this._draw(ctx, W, H, this._frame(span, (srcT - span.srcStart) / span.speed, srcT, outT, true));
    };
    const progress = (outT, force) => {
      const now = performance.now();
      if (!force && now - lastProg < 250) return;
      lastProg = now;
      const p = clamp(outT / prog.duration, 0, 1);
      onProgress({ p, outT, duration: prog.duration, eta: Math.max(0, prog.duration - outT), elapsed: (now - t0) / 1000 });
    };
    const pauseRec = () => { if (rec && rec.state === "recording") rec.pause(); };
    const resumeRec = () => {
      if (!started) { rec.start(1000); started = true; }
      else if (rec.state === "paused") rec.resume();
    };
    const pauseAll = () => { for (const el of allMediaElements()) if (!el.paused) el.pause(); };
    const prepMusic = async outT => {
      this._syncMusic(false, outT, true);
      const el = this._musicEl;
      if (!el) return;
      const want = this._musicTime(outT, el);
      if (want != null && Math.abs(loopDiff(el.currentTime, want, el.duration, el.loop)) > 0.04) await seekEl(el, want, 4000);
    };
    const startMusic = outT => { this._syncMusic(true, outT, true); };
    // resolves once the element's clock actually advances (audio is flowing), or after ms
    const waitPlaying = (el, ms) => new Promise(r => {
      if (!el || el.paused) return r();
      const t0 = performance.now(), c0 = el.currentTime;
      const poll = () => { if (el.paused || el.currentTime > c0 + 0.03 || performance.now() - t0 > ms) r(); else setTimeout(poll, 15); };
      poll();
    });

    try {
      try {
        rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: H >= 1080 ? (fps > 30 ? 14e6 : 10e6) : (fps > 30 ? 8e6 : 5e6), audioBitsPerSecond: 192000 });
      } catch (e) { throw new Error("Impossible de démarrer l'export : " + e.message); }
      rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onerror = e => fail("Erreur d'encodage : " + ((e.error && e.error.message) || "inconnue") + ". Essaie 720p ou 30 i/s.");
      stopped = new Promise(r => { rec.onstop = r; });
      onStatus("Export en cours… garde l'onglet visible.");

      const spans = prog.spans;
      for (let i = 0; i < spans.length && !job.cancelled; i++) {
        const span = spans[i], prev = spans[i - 1], next = spans[i + 1];
        if (isVideoSpan(span)) {
          const v = getVideo(span.clipId, "main");
          const contiguous = started && rec.state === "recording" && prev && isVideoSpan(prev) && prev.clipId === span.clipId && this._mainEl === v &&
            Math.abs(prev.srcEnd - span.srcStart) < 1e-3 && Math.abs(v.currentTime - span.srcStart) < 0.25 && !v.paused;
          this._mainEl = v;
          A.setVoiceExpected(true);
          this._applyMainAudio(span, v);
          if (!contiguous) {
            pauseRec(); pauseAll();
            setRate(v, span.speed);
            const okSeek = await seekEl(v, span.srcStart, 10000);
            if (job.cancelled) break;
            if (!okSeek) { fail(`Impossible de se positionner dans « ${clipById(span.clipId).fileName} ».`); break; }
            await this._prepareFrame(span, span.srcStart);
            await waitReady(v, 5000);
            await prepMusic(span.outStart);
            if (job.cancelled) break;
            draw(span, span.srcStart, span.outStart);
            await new Promise(r => setTimeout(r, 20));
            // start sound sources first, resume recording once they really play (no silent gap at the seam)
            try { await v.play(); }
            catch (e) { fail("Lecture impossible pendant l'export : " + e.message); break; }
            startMusic(span.outStart);
            this._syncAux(span, span.srcStart, true, true);
            await waitPlaying(this._musicEl, 1200);
            resumeRec();
          } else setRate(v, span.speed);

          await new Promise(resolve => {
            let done = false, lastCT = -1, lastAdv = performance.now(), lastRender = 0;
            const startReal = performance.now(), expected = (span.srcEnd - span.srcStart) / span.speed;
            let iv = 0;
            const finish = () => { if (done) return; done = true; clearInterval(iv); job.wake = null; resolve(); };
            job.wake = finish;
            const tick = fromFrame => {
              if (done) return;
              if (job.cancelled) return finish();
              const now = performance.now();
              const ct = v.currentTime;
              if (v.ended || ct >= span.srcEnd - 0.5 / fps) return finish();
              if (fromFrame || now - lastRender > frameMs * 0.75) {
                lastRender = now;
                const srcT = clamp(ct, span.srcStart, span.srcEnd);
                const outT = span.outStart + (srcT - span.srcStart) / span.speed;
                draw(span, srcT, outT);
                this._syncAux(span, srcT, true, true);
                this._syncMusic(true, outT, true);
                progress(outT);
              }
              if (ct !== lastCT) { lastCT = ct; lastAdv = now; }
              else if (now - lastAdv > 10000) return fail(`La vidéo « ${clipById(span.clipId).fileName} » ne se lit plus (fichier abîmé ?).`), finish();
              if (v.paused && !v.ended && !v.seeking) v.play().catch(() => { });
              if (now - startReal > expected * 2000 + 20000) return fail("L'export est bloqué (la vidéo n'avance plus)."), finish();
            };
            iv = setInterval(() => tick(false), frameMs);
            if (v.requestVideoFrameCallback) {
              const cb = () => { if (done) return; tick(true); v.requestVideoFrameCallback(cb); };
              v.requestVideoFrameCallback(cb);
            }
            tick(true);
          });
          // leaving this clip (or cutting): stop recording before the overshoot is heard
          const nextContig = next && isVideoSpan(next) && next.clipId === span.clipId && Math.abs(span.srcEnd - next.srcStart) < 1e-3;
          if (!nextContig) { pauseRec(); v.pause(); if (this._musicEl) this._musicEl.pause(); }
        } else {
          // wall-clock span (intro / outro / card)
          const dur = span.outEnd - span.outStart;
          this._mainEl = null;
          if (!started || rec.state === "paused") {
            pauseAll();
            this._syncAux(null, 0, false, true);
            A.setVoiceExpected(false);
            A.resetDucking();   // no voice in a card: don't carry the previous speaker's ducking into it
            await prepMusic(span.outStart);
            if (job.cancelled) break;
            draw(span, span.srcStart, span.outStart);
            await new Promise(r => setTimeout(r, 20));
            startMusic(span.outStart);
            await waitPlaying(this._musicEl, 1200);
            resumeRec();
          }
          // pre-seek the next clip while the card is on screen
          if (isVideoSpan(next)) { const nv = getVideo(next.clipId, "main"); if (nv) { nv.pause(); if (Math.abs(nv.currentTime - next.srcStart) > 0.01) nv.currentTime = next.srcStart; } }
          await new Promise(resolve => {
            let done = false, iv = 0;
            const tStart = performance.now();
            const finish = () => { if (done) return; done = true; clearInterval(iv); job.wake = null; resolve(); };
            job.wake = finish;
            const tick = () => {
              if (done) return;
              if (job.cancelled) return finish();
              const local = (performance.now() - tStart) / 1000;
              if (local >= dur) return finish();
              const outT = span.outStart + local;
              draw(span, span.srcStart + local * span.speed, outT);
              this._syncMusic(true, outT, true);
              progress(outT);
            };
            iv = setInterval(tick, frameMs);
            tick();
          });
        }
      }

      if (!job.cancelled) {
        // hold the very last frame for a moment so the encoder flushes it
        const last = prog.spans[prog.spans.length - 1];
        if (rec.state === "recording") {
          draw(last, last.srcEnd, prog.duration - 1e-3);
          await new Promise(r => setTimeout(r, frameMs * 2));
        }
        progress(prog.duration, true);
      }
      pauseAll();
      onStatus(job.cancelled ? "Export annulé." : "Finalisation…");
      if (rec.state !== "inactive") { try { rec.stop(); } catch (e) { } }
      if (started) await Promise.race([stopped, new Promise(r => setTimeout(r, 5000))]);
    } finally {
      document.removeEventListener("visibilitychange", onVis);
      vStream.getVideoTracks().forEach(t => t.stop());
      for (const el of allMediaElements()) if (!el.paused) el.pause();
      this._job = null;
      this._exporting = false; store.exporting = false;
      this.canvas.width = PREVIEW_W; this.canvas.height = PREVIEW_H;
      A.setMonitor(true);
      A.setVoiceExpected(true);
      this._prog = program(); this._seq = this._prog;
      this._t = clamp(this._t, 0, this._seq.duration);
      emit("exportstate", { exporting: false });
      this._showPaused();
    }
    if (job.error) throw new Error(job.error);
    if (job.cancelled) return null;
    const type = mime.split(";")[0];
    const blob = new Blob(chunks, { type });
    if (!blob.size) throw new Error("L'export n'a produit aucune donnée. Réessaie en 720p.");
    const url = URL.createObjectURL(blob);
    this._lastUrl = url;
    const ext = type.includes("mp4") ? "mp4" : "webm";
    return { blob, url, mime, ext, seconds: prog.duration, elapsed: (performance.now() - t0) / 1000 };
  }
}
