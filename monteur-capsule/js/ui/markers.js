// markers.js — slide changes (v1 rules), the slide-change panel, the slide strip and slide videos.
import { store, changed, partById, clipById, sortMarkers, slideStateAt, lastSlideBefore, kindOf, fmtTime, uid } from "../state.js";
import { TRANSITIONS } from "../render.js";
import { app, targetTalk, seekSrc, srcTimeIn } from "./ctx.js";
import { h, $, mutate, toast, Panel, bind, row, hint, iconBtn, btn, openModal, onSync, clamp } from "./widgets.js";

const nSlides = () => store.slides.length;

/** Add (or retarget, if one is within 50 ms) a change in `part` at source time t. */
export function addMarker(part, target, t, mode) {
  if (!part || part.type !== "talk") return;
  t = Math.round(t * 100) / 100;
  mutate(() => {
    const ex = part.markers.find(m => Math.abs(m.t - t) < 0.05);
    if (ex) { ex.target = target; if (mode) ex.mode = mode; else delete ex.mode; }
    else { const m = { t, target }; if (mode) m.mode = mode; part.markers.push(m); }
    sortMarkers(part);
  });
}
/** Slide change that keeps "slide only" mode when we are in it; from CAM we return to picture-in-picture. */
export function addSlide(part, n, t) {
  const k = slideStateAt(part, t).kind;
  addMarker(part, n, t, k === "slide" && part.layout !== "cam" ? "slide" : undefined);
}
function nextTarget(part, t, dir) {
  if (!nSlides()) { toast("Ajoute ta présentation pour changer de diapo."); return null; }
  const cur = lastSlideBefore(part, t), st = slideStateAt(part, t).target;
  if (st === "CAM") return dir > 0 ? cur : clamp(cur - 1, 0, nSlides() - 1);   // back to the slide shown before the camera
  return clamp(cur + dir, 0, nSlides() - 1);
}
export function keyNext(dir) {
  const tt = targetTalk(); if (!tt) return;
  const n = nextTarget(tt.part, tt.srcT, dir); if (n == null) return;
  addSlide(tt.part, n, tt.srcT);
}
export function keyMode(target) {
  const tt = targetTalk(); if (!tt) return;
  addMarker(tt.part, target, tt.srcT);
  if (target === "CAM") toast("🎥 Caméra plein écran à partir d'ici · → pour revenir à la diapo", 1800);
  if (target === "SLIDE") toast("🖼️ Diapo seule à partir d'ici", 1600);
}
export function clickThumb(i) {
  const tt = targetTalk(); if (!tt) return;
  addSlide(tt.part, i, tt.srcT);
}

/* ---------------- panel ---------------- */
function targetValue(m) { return m.target === "CAM" || m.target === "SLIDE" ? m.target : (m.mode === "slide" ? "s" : "") + m.target; }
function targetOptions() {
  const out = [];
  const n = Math.max(nSlides(), 1);
  for (let i = 0; i < n; i++) out.push([String(i), `Diapo ${i + 1}${store.slideTitles[i] ? " — " + store.slideTitles[i].slice(0, 28) : ""}`]);
  for (let i = 0; i < n; i++) out.push(["s" + i, `Diapo ${i + 1} · seule`]);
  out.push(["CAM", "🎥 Caméra"], ["SLIDE", "🖼️ Diapo seule"]);
  return out;
}
function setTarget(m, v) {
  if (v === "CAM" || v === "SLIDE") { m.target = v; delete m.mode; }
  else if (v[0] === "s") { m.target = +v.slice(1); m.mode = "slide"; }
  else { m.target = +v; delete m.mode; }
}

const mkIds = new WeakMap(); let mkSeq = 0;
const mkId = m => { if (!mkIds.has(m)) mkIds.set(m, ++mkSeq); return mkIds.get(m); };
export function focusPart() { const p = partById(app.focusPartId); return p && p.type === "talk" ? p : null; }

export function createMarkersPanel(el) {
  return new Panel(el, {
    key: () => { const p = focusPart(); return p ? `${p.id}|${nSlides()}|${p.markers.map(mkId).join(",")}` : "none"; },
    build: root => {
      const part = focusPart();
      if (!part) { root.append(hint("Place la tête de lecture sur une partie « présentation » (ou sélectionne-la) pour voir ses changements de diapo.")); return; }
      const who = part.member.name || "Partie sans nom";
      root.append(h("div.ctxchip", h("span.dot", { style: { background: part.member.color || "var(--accent)" } }), h("span", { text: who }), h("span.hint", { text: ` · ${part.markers.length} changement${part.markers.length > 1 ? "s" : ""}` })));
      root.append(row("Diapo au départ", bind(() => part, "startSlide", { type: "select", options: () => Array.from({ length: Math.max(nSlides(), 1) }, (_, i) => [i, `Diapo ${i + 1}`]), fromUI: v => +v, label: "Diapo au départ" })));
      const list = h("div.mklist");
      if (!part.markers.length) list.append(hint(`Aucun changement encore. Fais jouer et appuie sur <kbd>→</kbd> au bon moment.`));
      const transOpts = [["", "✨ Par défaut"], ...TRANSITIONS.map(t => [t.id, t.label])];
      part.markers.forEach((m, i) => {
        const r = h("div.mk", { dataset: { i } });
        const idx = h("button.mkidx", { type: "button", text: i + 1, title: "Aller à ce moment" , onclick: () => seekSrc(part, m.t) });
        const time = bind(() => m, "t", { type: "number", step: 0.05, min: 0, digits: 2, label: "Temps (s)" });
        // re-sort only when the edit is finished (not on each keystroke)
        time.addEventListener("change", () => { const before = part.markers.map(mkId).join(); sortMarkers(part); if (part.markers.map(mkId).join() !== before) changed("project"); });
        time.title = "Temps dans la vidéo source (secondes)";
        time.addEventListener("focus", () => seekSrc(part, m.t));
        const tg = h("select", { "aria-label": "Passer à", title: "On passe à…" }, targetOptions().map(([v, l]) => h("option", { value: v, text: l })));
        tg.value = targetValue(m);
        tg.onchange = () => { mutate(() => setTarget(m, tg.value)); tg.blur(); };
        const tr = h("select.trsel", { "aria-label": "Transition", title: "Transition de ce changement" }, transOpts.map(([v, l]) => h("option", { value: v, text: l })));
        tr.value = m.trans || "";
        tr.onchange = () => { mutate(() => { if (tr.value) m.trans = tr.value; else delete m.trans; }); tr.blur(); };
        onSync(() => { const mm = m; if (document.activeElement !== tg) tg.value = targetValue(mm); if (document.activeElement !== tr) tr.value = mm.trans || ""; });
        r.append(idx, time, tg, tr, iconBtn("✕", "Supprimer ce changement", () => mutate(() => { const k = part.markers.indexOf(m); if (k >= 0) part.markers.splice(k, 1); }), "del"));
        list.append(r);
      });
      root.append(list);
      root.append(h("div.btnrow",
        btn("🎥 Caméra", () => keyMode("CAM"), { title: "Caméra plein écran à partir d'ici (C)", kbd: "C" }),
        btn("🖼️ Diapo seule", () => keyMode("SLIDE"), { title: "Diapo seule à partir d'ici (V)", kbd: "V" }),
        btn("🗑️ Tout effacer", () => { if (part.markers.length && confirm(`Effacer les ${part.markers.length} changements de cette partie ?`)) mutate(() => { part.markers = []; }); }, { cls: "ghost danger", title: "Effacer tous les changements de cette partie" })));
      // slide videos summary
      const sv = store.project.slideVideos;
      if (sv.length) {
        root.append(h("div.sub", h("span", { text: "Vidéos dans les diapos" })));
        sv.forEach(v => {
          const c = clipById(v.clipId);
          root.append(h("div.lrow", h("span.tag", { text: `Diapo ${v.slide + 1}` }), h("span.grow", { text: c ? c.name : "(vidéo manquante)" }),
            iconBtn("✎", "Modifier", () => openSlideVideo(v.slide)), iconBtn("✕", "Retirer", () => mutate(() => { store.project.slideVideos = store.project.slideVideos.filter(x => x !== v); }), "del")));
        });
      }
    },
  });
}

/** Highlight the current change row (called every frame, cheap). */
let lastHi = "";
export function highlightMarkers() {
  const part = focusPart();
  const t = part ? srcTimeIn(part) : null;
  let idx = -1, st = "";
  if (part && t != null) { part.markers.forEach((m, i) => { if (m.t <= t) idx = i; }); const s = slideStateAt(part, t); st = s.kind === "cam" ? "CAM" : s.kind === "slide" && s.target === "SLIDE" ? "SLIDE" : String(s.slide); }
  const key = (part && part.id) + "|" + idx + "|" + st + "|" + (part && part.markers.length);
  if (key === lastHi) return; lastHi = key;
  document.querySelectorAll(".mk").forEach(r => r.classList.toggle("cur", +r.dataset.i === idx));
  document.querySelectorAll(".thumb").forEach(el => el.classList.toggle("active", el.dataset.t === st));
}
export function resetHighlight() { lastHi = ""; }

/* ---------------- slide strip ---------------- */
export function renderThumbs() {
  const box = $("#thumbs"); if (!box) return;
  box.replaceChildren(); resetHighlight();
  if (!store.slideThumbs.length) { box.append(h("div.thumbs-empty", { html: "Tes diapos apparaîtront ici. Clique une diapo pour y changer <b>maintenant</b>." })); return; }
  store.slideThumbs.forEach((src, i) => {
    const hasVid = store.project.slideVideos.some(v => v.slide === i && v.clipId);
    const d = h("div.thumb", { dataset: { t: String(i) }, title: `Passer à la diapo ${i + 1} maintenant${store.slideTitles[i] ? " — " + store.slideTitles[i] : ""}`, tabindex: 0, role: "button" },
      h("img", { src, alt: `Diapo ${i + 1}`, draggable: false }), h("span.n", { text: i + 1 }),
      h("button.film" + (hasVid ? ".on" : ""), { type: "button", title: hasVid ? "Vidéo dans cette diapo (modifier)" : "Mettre une vidéo dans cette diapo", "aria-label": "Vidéo dans la diapo", text: "🎞", onclick: e => { e.stopPropagation(); openSlideVideo(i); } }));
    d.onclick = () => { if (!store.exporting) clickThumb(i); };
    d.onkeydown = e => { if (e.key === "Enter" && e.target === d && !store.exporting) clickThumb(i); };
    box.append(d);
  });
  [["CAM", "🎥", "Caméra<br>plein écran", "Caméra plein écran à partir d'ici (C)"], ["SLIDE", "🖼️", "Diapo<br>seule", "Diapo seule à partir d'ici (V)"]].forEach(([t, ic, l, tip]) => {
    const d = h("div.thumb.special", { dataset: { t }, title: tip, html: `<span class="ic">${ic}</span><span>${l}</span>`, tabindex: 0, role: "button" });
    d.onclick = () => { if (!store.exporting) keyMode(t); };
    d.onkeydown = e => { if (e.key === "Enter" && e.target === d && !store.exporting) keyMode(t); };
    box.append(d);
  });
}

/* ---------------- slide videos ---------------- */
export function openSlideVideo(slide) {
  const vids = Object.values(store.project.clips).filter(c => c.kind === "video");
  if (!vids.length) { toast("Importe d'abord une vidéo dans « Médias »."); return; }
  let sv = store.project.slideVideos.find(v => v.slide === slide);
  const draft = sv ? { ...sv } : { id: uid("sv"), slide, clipId: vids[0].id, volume: 0, fit: "contain", loop: true };
  const g = () => draft;
  const body = h("div",
    store.slideThumbs[slide] ? h("img.svprev", { src: store.slideThumbs[slide], alt: "" }) : null,
    row("Vidéo", bind(g, "clipId", { type: "select", options: vids.map(c => [c.id, c.name]), label: "Vidéo", kind: "local" })),
    row("Volume", bind(g, "volume", { type: "range", min: 0, max: 2, step: 0.05, toUI: v => v, fmt: v => Math.round(v * 100) + " %", kind: "local" })),
    row("Ajustement", bind(g, "fit", { type: "seg", options: [["contain", "Entière"], ["cover", "Remplir"]], kind: "local" })),
    row("En boucle", bind(g, "loop", { type: "check", kind: "local" })),
    hint("La vidéo démarre quand la diapo apparaît et s'affiche dans le cadre de la diapo."));
  // these binds mutate the draft only (checkpoint harmless); commit on save
  const actions = [{ label: "Enregistrer", primary: true, onclick: () => mutate(() => {
    const list = store.project.slideVideos;
    const ex = list.find(v => v.slide === slide);
    if (ex) Object.assign(ex, draft); else list.push(draft);
  }) }];
  if (sv) actions.unshift({ label: "Retirer la vidéo", danger: true, onclick: () => mutate(() => { store.project.slideVideos = store.project.slideVideos.filter(v => v.slide !== slide); }) });
  openModal(`🎞 Vidéo dans la diapo ${slide + 1}`, body, { actions });
}
