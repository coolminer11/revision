// media.js — file import, clips, hidden <video>/<audio> pool, images, slides (PDF via pdf.js or images).
import { store, uid, clipById, checkpoint, changed, emit, partById } from "./state.js";

const PDFJS_VER = "4.10.38";
const PDFJS_CDNS = ["https://cdn.jsdelivr.net/npm", "https://unpkg.com"];

const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|qt|3gp)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|avif|heic|heif)$/i;
const AUDIO_EXT = /\.(mp3|m4a|wav|ogg|oga|aac|flac|opus)$/i;
const PPT_EXT = /\.(pptx?|key|odp)$/i;
const PPT_MSG = "Exporte ta présentation en PDF (PowerPoint : Fichier → Exporter → PDF ; Google Slides : Fichier → Télécharger → PDF), puis glisse le PDF ici.";

const urls = new Map();     // clipId -> objectURL
const files = new Map();    // clipId -> File
const images = new Map();   // clipId -> ImageBitmap
const audios = new Map();   // clipId -> HTMLAudioElement
const pool = new Map();     // `${clipId}|${role}` -> HTMLVideoElement
let container = null;

const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

export function kindOfFile(f) {
  const t = f.type || "";
  if (PPT_EXT.test(f.name)) return "pptx";
  if (t.startsWith("video/") || VIDEO_EXT.test(f.name)) return "video";
  if (t.startsWith("audio/") || AUDIO_EXT.test(f.name)) return "audio";
  if (t.startsWith("image/") || IMAGE_EXT.test(f.name)) return "image";
  if (t === "application/pdf" || /\.pdf$/i.test(f.name)) return "pdf";
  return null;
}

function getContainer() {
  if (container && container.isConnected) return container;
  container = document.createElement("div");
  container.id = "media-pool";
  container.setAttribute("aria-hidden", "true");
  container.style.cssText = "position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0;pointer-events:none;overflow:hidden;z-index:-1";
  document.body.appendChild(container);
  return container;
}

function probeMedia(url, tag) {
  return new Promise((resolve, reject) => {
    const el = document.createElement(tag);
    el.preload = "metadata"; el.muted = true;
    let timer = setTimeout(() => finish(new Error("délai dépassé")), 20000);
    const finish = (err) => {
      clearTimeout(timer);
      const info = { duration: isFinite(el.duration) ? el.duration : 0, width: el.videoWidth || 0, height: el.videoHeight || 0 };
      el.removeAttribute("src"); try { el.load(); } catch (e) { }
      err ? reject(err) : resolve(info);
    };
    el.onloadedmetadata = () => {
      if (isFinite(el.duration)) return finish();
      // some webm files report Infinity until seeked to the end
      el.ontimeupdate = () => { el.ontimeupdate = null; el.currentTime = 0; finish(); };
      el.currentTime = 1e9;
    };
    el.onerror = () => finish(new Error("format non lisible par le navigateur"));
    el.src = url;
  });
}

async function makeBitmap(fileOrBlob, maxW = 0) {
  let bmp = await createImageBitmap(fileOrBlob);
  if (maxW && bmp.width > maxW * 1.25) {
    const h = Math.round(bmp.height * maxW / bmp.width);
    try { const r = await createImageBitmap(bmp, { resizeWidth: maxW, resizeHeight: h, resizeQuality: "high" }); bmp.close(); bmp = r; } catch (e) { }
  }
  return bmp;
}

function attachUrl(clipId, file) {
  const old = urls.get(clipId); if (old) URL.revokeObjectURL(old);
  const url = URL.createObjectURL(file);
  urls.set(clipId, url); files.set(clipId, file);
  return url;
}

/** Import videos / images / audio. Re-links an unlinked clip with the same fileName. Returns new/relinked clip ids. */
export async function importFiles(fileList) {
  const list = [...(fileList || [])];
  if (list.some(f => kindOfFile(f) === "pptx")) throw new Error(PPT_MSG);
  const ids = [], errors = [];
  for (const f of list) {
    const kind = kindOfFile(f);
    if (kind === "pdf") { errors.push(`${f.name} : glisse le PDF dans la zone « Présentation »`); continue; }
    if (!kind) { errors.push(`${f.name} : type de fichier non pris en charge`); continue; }
    const existing = Object.values(store.project.clips).find(c => !c.linked && c.fileName === f.name && c.kind === kind);
    const id = existing ? existing.id : uid("clip");
    try {
      const url = attachUrl(id, f);
      let info = { duration: 0, width: 0, height: 0 };
      if (kind === "image") {
        const old = images.get(id); if (old) old.close && old.close();
        const bmp = await makeBitmap(f, 2560);
        images.set(id, bmp); info = { duration: 0, width: bmp.width, height: bmp.height };
      } else {
        info = await probeMedia(url, kind === "video" ? "video" : "audio");
        if (kind === "video" && !info.width) {
          // audio-only file with a video extension: treat as audio
        }
      }
      const clip = existing || { id, name: f.name.replace(/\.[^.]+$/, ""), fileName: f.name, kind };
      Object.assign(clip, { duration: info.duration || clip.duration || 0, width: info.width || clip.width || 0, height: info.height || clip.height || 0, linked: true, size: f.size });
      store.project.clips[id] = clip;
      // refresh already-created elements for a relinked clip
      for (const [k, v] of pool) if (k.startsWith(id + "|")) { v.src = url; v.load(); }
      const a = audios.get(id); if (a) { a.src = url; a.load(); }
      ids.push(id);
    } catch (e) {
      const u = urls.get(id); if (u) URL.revokeObjectURL(u);
      urls.delete(id); files.delete(id);
      errors.push(`${f.name} : ${e.message || e}${kind === "video" ? " (essaie MP4/H.264)" : ""}`);
    }
  }
  if (ids.length) changed("media");
  if (errors.length) {
    emit("mediaWarning", { message: "Certains fichiers n'ont pas été ajoutés : " + errors.join(" · "), errors });
    if (!ids.length) throw new Error(errors.join(" · "));
  }
  return ids;
}

/** One hidden-but-rendered <video> per (clipId, role). */
export function getVideo(clipId, role = "main") {
  const c = clipById(clipId);
  if (!c || !c.linked || c.kind !== "video") return null;
  const url = urls.get(clipId); if (!url) return null;
  const key = clipId + "|" + role;
  let v = pool.get(key);
  if (v) return v;
  v = document.createElement("video");
  v.playsInline = true; v.setAttribute("playsinline", ""); v.setAttribute("webkit-playsinline", "");
  v.preload = "auto"; v.disablePictureInPicture = true;
  v.preservesPitch = true; v.mozPreservesPitch = true; v.webkitPreservesPitch = true;
  v.dataset.clipId = clipId; v.dataset.role = role;
  v.style.cssText = "position:absolute;left:0;top:0;width:2px;height:2px";
  const notify = () => emit("mediaFrame", { clipId, role });
  v.addEventListener("seeked", notify); v.addEventListener("loadeddata", notify);
  v.addEventListener("error", () => emit("mediaWarning", { message: `Impossible de lire « ${c.fileName} » (essaie MP4/H.264).`, clipId }));
  v.src = url;
  getContainer().appendChild(v);
  pool.set(key, v);
  return v;
}

export function getImage(clipId) { return images.get(clipId) || null; }

/** <audio> element for audio clips (also works for a video clip used as music). */
export function getAudio(clipId) {
  const c = clipById(clipId);
  if (!c || !c.linked || (c.kind !== "audio" && c.kind !== "video")) return null;
  const url = urls.get(clipId); if (!url) return null;
  let a = audios.get(clipId);
  if (!a) {
    a = document.createElement("audio");
    a.preload = "auto"; a.preservesPitch = true; a.dataset.clipId = clipId; a.dataset.role = "music";
    a.src = url;
    getContainer().appendChild(a);
    audios.set(clipId, a);
  }
  return a;
}

export function mediaReady(clipId) {
  const c = clipById(clipId);
  if (!c || !c.linked) return false;
  if (c.kind === "image") return images.has(clipId);
  if (c.kind === "audio") { const a = getAudio(clipId); return !!a && a.readyState >= 2; }
  const v = getVideo(clipId, "main"); return !!v && v.readyState >= 2;
}

export function allMediaElements() { return [...pool.values(), ...audios.values()]; }

function dropElements(clipId) {
  for (const [k, v] of [...pool]) {
    if (!k.startsWith(clipId + "|")) continue;
    try { v.pause(); v.removeAttribute("src"); v.load(); } catch (e) { }
    v.remove(); pool.delete(k);
    emit("mediaElementRemoved", { el: v });
  }
  const a = audios.get(clipId);
  if (a) { try { a.pause(); a.removeAttribute("src"); a.load(); } catch (e) { } a.remove(); audios.delete(clipId); emit("mediaElementRemoved", { el: a }); }
}

export function removeClip(clipId) {
  const p = store.project;
  if (!p.clips[clipId]) return;
  checkpoint();
  p.parts = p.parts.filter(part => part.clipId !== clipId);
  for (const part of p.parts) {
    if (part.camB && part.camB.clipId === clipId) part.camB = null;
    if (part.overlays) part.overlays = part.overlays.filter(o => !(o.type === "broll" && o.clipId === clipId));
  }
  p.slideVideos = p.slideVideos.filter(v => v.clipId !== clipId);
  if (p.music.clipId === clipId) p.music.clipId = null;
  delete p.clips[clipId];
  dropElements(clipId);
  const u = urls.get(clipId); if (u) URL.revokeObjectURL(u);
  urls.delete(clipId); files.delete(clipId);
  const b = images.get(clipId); if (b && b.close) b.close(); images.delete(clipId);
  if (!partById(store.selectedPartId)) store.selectedPartId = p.parts[0] ? p.parts[0].id : null;
  changed("project");
}

export async function loadImageAsset(file) {
  if (!file || kindOfFile(file) !== "image") throw new Error("Choisis une image (PNG, JPG…).");
  return makeBitmap(file, 2560);
}

/* ------------------------------------------------------------------ */
/* Slides                                                              */
/* ------------------------------------------------------------------ */
let pdfjsPromise = null;
async function loadPdfjs() {
  if (pdfjsPromise) return pdfjsPromise;
  pdfjsPromise = (async () => {
    let lastErr;
    for (const cdn of PDFJS_CDNS) {
      const base = `${cdn}/pdfjs-dist@${PDFJS_VER}/build/`;
      try {
        const lib = await import(base + "pdf.min.mjs");
        lib.GlobalWorkerOptions.workerSrc = base + "pdf.worker.min.mjs";
        return lib;
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error("pdf.js indisponible");
  })();
  try { return await pdfjsPromise; } catch (e) { pdfjsPromise = null; throw e; }
}

function titleFromText(tc) {
  const items = (tc && tc.items || []).filter(it => it.str && it.str.trim() && it.transform);
  if (!items.length) return "";
  const size = it => Math.hypot(it.transform[2], it.transform[3]) || Math.abs(it.transform[3]) || it.height || 0;
  const max = Math.max(...items.map(size));
  if (!(max > 0)) return "";
  const big = items.filter(it => size(it) >= max * 0.9);
  // reading order: top to bottom (pdf y grows upward), then left to right
  big.sort((a, b) => (b.transform[5] - a.transform[5]) || (a.transform[4] - b.transform[4]));
  let s = big.map(it => it.str).join(" ").replace(/\s+/g, " ").trim();
  if (s.length > 60) s = s.slice(0, 59).replace(/\s+\S*$/, "") + "…";
  return s;
}

function thumbOf(bmp) {
  const c = document.createElement("canvas");
  c.width = 264; c.height = Math.max(1, Math.round(264 * bmp.height / bmp.width));
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  const url = c.toDataURL("image/jpeg", 0.8);
  c.width = c.height = 0;
  return url;
}

/** PDF (pdf.js) or slide images (natural sort). onProgress(i, n) optional. */
export async function loadSlides(fileList, onProgress) {
  const list = [...(fileList || [])];
  const pdf = list.find(f => kindOfFile(f) === "pdf");
  const imgs = list.filter(f => kindOfFile(f) === "image").sort((a, b) => natural(a.name, b.name));
  if (!pdf && !imgs.length) {
    if (list.some(f => kindOfFile(f) === "pptx")) throw new Error(PPT_MSG);
    throw new Error("Ajoute un PDF ou des images de tes diapos.");
  }
  const slides = [], titles = [];
  try {
    if (pdf) {
      const lib = await loadPdfjs();
      const task = lib.getDocument({ data: new Uint8Array(await pdf.arrayBuffer()) });
      try {
        const doc = await task.promise;
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const v1 = page.getViewport({ scale: 1 });
          const vp = page.getViewport({ scale: 1920 / v1.width });
          const c = document.createElement("canvas");
          c.width = Math.round(vp.width); c.height = Math.round(vp.height);
          const cx = c.getContext("2d");
          cx.fillStyle = "#fff"; cx.fillRect(0, 0, c.width, c.height);
          await page.render({ canvasContext: cx, viewport: vp }).promise;
          let bmp = c;
          try { bmp = await createImageBitmap(c); c.width = c.height = 0; } catch (e) { }
          slides.push(bmp);
          let title = "";
          try { title = titleFromText(await page.getTextContent()); } catch (e) { }
          titles.push(title);
          try { page.cleanup(); } catch (e) { }
          onProgress && onProgress(i, doc.numPages);
          emit("slidesProgress", { i, n: doc.numPages });
        }
      } finally {
        try { await task.destroy(); } catch (e) { }
      }
    } else {
      let i = 0;
      for (const f of imgs) {
        slides.push(await makeBitmap(f, 1920));
        titles.push("");
        i++; onProgress && onProgress(i, imgs.length); emit("slidesProgress", { i, n: imgs.length });
      }
    }
  } catch (e) {
    for (const s of slides) if (s && s.close) s.close();
    const msg = String(e && e.message || e);
    if (/withResolvers|Unexpected token|import|Failed to fetch|dynamically imported/i.test(msg))
      throw new Error("Impossible de lire le PDF (navigateur trop ancien ou pas d'internet). Mets ton navigateur à jour, ou exporte tes diapos en images PNG et glisse-les ici.");
    if (/password/i.test(msg)) throw new Error("Ce PDF est protégé par un mot de passe : exporte-le sans protection.");
    throw new Error("Erreur en lisant la présentation : " + msg);
  }
  for (const s of store.slides) if (s && s.close && !slides.includes(s)) s.close();
  store.slides = slides;
  store.slideTitles = titles;
  store.slideThumbs = slides.map(thumbOf);
  changed("media");
  return slides.length;
}
