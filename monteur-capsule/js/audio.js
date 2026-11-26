// audio.js — Web Audio graph: per-element gain + "voix claire" + noise-reduction expander, voice bus,
// music bus with RMS ducking + fade envelope, master, limiter, monitor, MediaStreamDestination for export.

let ctx = null;
let master, limiter, monitorGain, recDest, voiceBus, analyser, musicBus, duckGain, envGain;
let workletState = "none";   // none | loading | ready | failed
let workletPromise = null;
let duckTimer = 0, duckBuf = null, speaking = false, lastSpeech = -10;
let musicParams = { volume: 0.35, duck: 0.3 };
let voiceExpected = true;
const duckLastTarget = { v: -1 };
const chains = new WeakMap();        // el -> chain
const chainList = new Set();         // to insert the worklet once it is loaded

const WORKLET_SRC = `
class Expander extends AudioWorkletProcessor {
  static get parameterDescriptors(){ return [{ name: "strength", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" }]; }
  constructor(){
    super();
    this.env = 0; this.g = 1;
    const sr = sampleRate;
    this.envAtt = Math.exp(-1 / (0.005 * sr));
    this.envRel = Math.exp(-1 / (0.120 * sr));
    this.gOpen = Math.exp(-1 / (0.004 * sr));    // gain rises fast (speech onset)
    this.gClose = Math.exp(-1 / (0.060 * sr));   // gain falls smoothly
  }
  process(inputs, outputs, params){
    const inp = inputs[0], out = outputs[0];
    if (!inp || !inp.length) return true;
    const s = params.strength[0];
    const n = inp[0].length, chs = Math.min(inp.length, out.length);
    if (!(s > 0.001) && this.g > 0.9999) {
      for (let c = 0; c < chs; c++) out[c].set(inp[c]);
      this.env = 0; return true;
    }
    const k = Math.min(1, Math.max(0, (s - 0.1) / 0.9));
    const thr = -55 + 23 * k;                       // -55 dB @ 0.1 ... -32 dB @ 1
    const ratio = 1 + 3 * Math.min(1, s);           // up to 4:1
    const floorDb = -24 * Math.min(1, 0.35 + s);     // max attenuation -24 dB
    for (let i = 0; i < n; i++) {
      let x2 = 0;
      for (let c = 0; c < chs; c++) { const v = inp[c][i]; if (v * v > x2) x2 = v * v; }
      const a = x2 > this.env ? this.envAtt : this.envRel;
      this.env = a * this.env + (1 - a) * x2;
      const lvl = 10 * Math.log10(this.env + 1e-12);
      let gdb = 0;
      if (lvl < thr) { gdb = (lvl - thr) * (ratio - 1); if (gdb < floorDb) gdb = floorDb; }
      const target = s > 0.001 ? Math.pow(10, gdb / 20) : 1;
      const b = target > this.g ? this.gOpen : this.gClose;
      this.g = b * this.g + (1 - b) * target;
      for (let c = 0; c < chs; c++) out[c][i] = inp[c][i] * this.g;
    }
    return true;
  }
}
registerProcessor("mc-expander", Expander);
`;

export function audioContext() { return ctx; }

/** Create (first call, during a user gesture) or resume the AudioContext. */
export function ensureAudio() {
  if (ctx) { if (ctx.state === "suspended") ctx.resume().catch(() => { }); return ctx; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC({ latencyHint: "interactive" });
  master = ctx.createGain();
  limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1.5; limiter.knee.value = 0; limiter.ratio.value = 20;
  limiter.attack.value = 0.002; limiter.release.value = 0.15;
  monitorGain = ctx.createGain();
  recDest = ctx.createMediaStreamDestination();
  voiceBus = ctx.createGain();
  analyser = ctx.createAnalyser(); analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0;
  musicBus = ctx.createGain(); musicBus.gain.value = musicParams.volume;
  duckGain = ctx.createGain();
  envGain = ctx.createGain(); envGain.gain.value = 1;
  voiceBus.connect(master); voiceBus.connect(analyser);
  musicBus.connect(duckGain); duckGain.connect(envGain); envGain.connect(master);
  master.connect(limiter); limiter.connect(monitorGain); monitorGain.connect(ctx.destination);
  limiter.connect(recDest);
  loadWorklet();
  startDucking();
  if (ctx.state === "suspended") ctx.resume().catch(() => { });
  return ctx;
}

function loadWorklet() {
  if (workletPromise) return workletPromise;
  if (!ctx.audioWorklet || typeof AudioWorkletNode === "undefined") { workletState = "failed"; return (workletPromise = Promise.resolve(false)); }
  workletState = "loading";
  const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "application/javascript" }));
  workletPromise = ctx.audioWorklet.addModule(url).then(() => {
    workletState = "ready";
    for (const ch of chainList) insertExpander(ch);
    return true;
  }).catch(e => { console.warn("AudioWorklet indisponible", e); workletState = "failed"; return false; })
    .finally(() => URL.revokeObjectURL(url));
  return workletPromise;
}

/** Resolves once the optional noise-reduction worklet is loaded (or failed). */
export function audioReady() { return ctx ? loadWorklet() : Promise.resolve(false); }

function insertExpander(ch) {
  if (ch.exp || workletState !== "ready" || ch.kind !== "voice") return;
  try {
    ch.exp = new AudioWorkletNode(ctx, "mc-expander", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: "max" });
    ch.exp.parameters.get("strength").value = ch.denoise;
    ch.pre.disconnect();
    ch.pre.connect(ch.exp); ch.exp.connect(ch.hp);
  } catch (e) { ch.exp = null; }
}

function routeOut(ch) {
  try { ch.out.disconnect(); } catch (e) { }
  ch.out.connect(ch.kind === "music" ? musicBus : voiceBus);
}

/** Wire a media element into the graph (idempotent). kind: "voice" (videos) | "music". Returns false before ensureAudio(). */
export function wire(el, kind = "voice") {
  if (!el || !ctx) return false;
  let ch = chains.get(el);
  if (ch) { if (ch.kind !== kind) { ch.kind = kind; if (kind === "music") setVoice(el, { clear: false, denoise: 0 }); routeOut(ch); } return true; }
  let src;
  try { src = ctx.createMediaElementSource(el); } catch (e) { console.warn("wire failed", e); return false; }
  // el.volume still scales the signal after createMediaElementSource: a value set before wiring (fallback path)
  // would silently stack with the graph gains, so reset it — volumes live in the graph from now on.
  try { el.volume = 1; } catch (e) { }
  ch = { el, kind, src, vol: 1, clear: null, denoise: 0, exp: null };
  ch.gain = ctx.createGain();
  ch.pre = ctx.createGain();
  ch.hp = ctx.createBiquadFilter(); ch.hp.type = "highpass"; ch.hp.Q.value = 0.707;
  ch.p1 = ctx.createBiquadFilter(); ch.p1.type = "peaking"; ch.p1.frequency.value = 300; ch.p1.Q.value = 1;
  ch.p2 = ctx.createBiquadFilter(); ch.p2.type = "peaking"; ch.p2.frequency.value = 3500; ch.p2.Q.value = 0.9;
  ch.comp = ctx.createDynamicsCompressor(); ch.comp.knee.value = 6; ch.comp.attack.value = 0.005; ch.comp.release.value = 0.12;
  ch.out = ch.comp;
  src.connect(ch.gain); ch.gain.connect(ch.pre); ch.pre.connect(ch.hp);
  ch.hp.connect(ch.p1); ch.p1.connect(ch.p2); ch.p2.connect(ch.comp);
  chains.set(el, ch); chainList.add(ch);
  applyClear(ch, false, true);
  routeOut(ch);
  insertExpander(ch);
  return true;
}

/** Disconnect an element that is being destroyed. */
export function unwire(el) {
  const ch = chains.get(el); if (!ch) return;
  try { ch.src.disconnect(); ch.out.disconnect(); } catch (e) { }
  chainList.delete(ch); chains.delete(el);
}

export const isWired = el => chains.has(el);

function ramp(param, v, tau = 0.02) {
  const now = ctx.currentTime;
  param.cancelScheduledValues(now);
  param.setTargetAtTime(v, now, tau);
}

function applyClear(ch, on, immediate = false) {
  if (ch.clear === on) return;
  ch.clear = on;
  const set = immediate ? (p, v) => { p.value = v; } : (p, v) => ramp(p, v, 0.03);
  set(ch.hp.frequency, on ? 85 : 10);
  set(ch.p1.gain, on ? -2 : 0);
  set(ch.p2.gain, on ? 3 : 0);
  set(ch.comp.threshold, on ? -20 : 0);
  set(ch.comp.ratio, on ? 3 : 1);
}

export function setClipVolume(el, v) {
  const ch = chains.get(el);
  v = Math.max(0, Math.min(3, +v || 0));
  if (!ch) { if (el) el.volume = Math.min(1, v); return; }
  if (Math.abs(ch.vol - v) < 1e-4) return;
  ch.vol = v; ramp(ch.gain.gain, v, 0.015);
}

export function setVoice(el, { clear = false, denoise = 0 } = {}) {
  const ch = chains.get(el); if (!ch) return;
  if (ch.kind === "music") { clear = false; denoise = 0; }
  applyClear(ch, !!clear);
  denoise = Math.max(0, Math.min(1, +denoise || 0));
  if (Math.abs(ch.denoise - denoise) > 1e-4) {
    ch.denoise = denoise;
    if (ch.exp) ch.exp.parameters.get("strength").setValueAtTime(denoise, ctx.currentTime);
  }
}

export function setMonitor(on) { if (ctx) ramp(monitorGain.gain, on ? 1 : 0, 0.01); }
export function setMaster(v) { if (ctx) ramp(master.gain, Math.max(0, Math.min(2.5, +v || 0)), 0.02); }

export function setMusicParams({ volume, duck } = {}) {
  if (volume != null) musicParams.volume = Math.max(0, Math.min(2, +volume || 0));
  if (duck != null) musicParams.duck = Math.max(0, Math.min(1, +duck));
  if (ctx && Math.abs(musicBus.gain.value - musicParams.volume) > 1e-4) ramp(musicBus.gain, musicParams.volume, 0.05);
}

let lastEnv = -1;
export function setMusicEnvelope(mult) {
  if (!ctx) return;
  mult = Math.max(0, Math.min(1, +mult || 0));
  if (Math.abs(mult - lastEnv) < 0.002) return;
  lastEnv = mult; ramp(envGain.gain, mult, 0.03);
}

/** Speech level on the voice bus (dBFS, for UI meters / debugging). */
export let voiceLevelDb = -100;
export const isSpeaking = () => speaking;

function startDucking() {
  duckBuf = new Float32Array(analyser.fftSize);
  const lt = duckLastTarget;
  clearInterval(duckTimer);
  duckTimer = setInterval(() => {
    if (!ctx || ctx.state !== "running") return;
    analyser.getFloatTimeDomainData(duckBuf);
    let s = 0; for (let i = 0; i < duckBuf.length; i++) s += duckBuf[i] * duckBuf[i];
    const db = 10 * Math.log10(s / duckBuf.length + 1e-12);
    voiceLevelDb = db;
    const now = ctx.currentTime;
    // hysteresis: start above -42 dBFS, keep while above -50 dBFS, release after 0.3 s below
    if (!voiceExpected) lastSpeech = -10;            // card / intro / outro: whatever is still in the buffers is not speech
    else if (db > -42 || (speaking && db > -50)) lastSpeech = now;
    speaking = now - lastSpeech < 0.3;
    const target = speaking ? musicParams.duck : 1;
    if (Math.abs(target - lt.v) > 1e-3) {
      lt.v = target;
      duckGain.gain.cancelScheduledValues(now);
      duckGain.gain.setTargetAtTime(target, now, speaking ? 0.05 : 0.2);   // ~0.15 s attack, ~0.6 s release
    }
  }, 33);
}

/** Forget the current speech state and put the music back to full level at once (call while nothing is audible,
 * e.g. when the export recorder is paused before a card / intro / outro, so the music is not left ducked). */
/** Tell the ducker whether a voice can be heard now (false during cards / intro / outro → music comes back up). */
export function setVoiceExpected(on) { voiceExpected = !!on; }

export function resetDucking() {
  if (!ctx) return;
  speaking = false; lastSpeech = -10; voiceLevelDb = -100;
  const now = ctx.currentTime;
  duckGain.gain.cancelScheduledValues(now);
  duckGain.gain.setValueAtTime(1, now);
  duckLastTarget.v = 1;
}

/** MediaStream with one audio track = master mix (post-limiter, independent of monitor). */
export function recordStream() {
  if (!ensureAudio()) return new MediaStream();
  return recDest.stream;
}

/** Diagnostics (console / tests): current gains of the shared buses and of one element's chain. */
export function debugState(el) {
  if (!ctx) return null;
  const ch = el ? chains.get(el) : null;
  return {
    state: ctx.state, master: master.gain.value, monitor: monitorGain.gain.value,
    musicBus: musicBus.gain.value, duck: duckGain.gain.value, env: envGain.gain.value, speaking, voiceLevelDb,
    el: ch ? { kind: ch.kind, gain: ch.gain.gain.value, volume: el.volume, muted: el.muted, clear: ch.clear, denoise: ch.denoise } : null,
  };
}
