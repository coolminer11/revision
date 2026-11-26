// overlays.js — "Éléments à l'écran": add/list/edit overlays, and direct manipulation on the preview
// (drag text/number position, draw the zoom rectangle over the slide box).
import { store, partById, clipById, newOverlay, slideStateAt, fmtTime, checkpoint, changed } from "../state.js";
import { layoutBoxes } from "../render.js";
import { app, targetTalk, seekSrc, srcTimeIn } from "./ctx.js";
import { focusPart } from "./markers.js";
import { h, $, mutate, toast, Panel, bind, row, hint, iconBtn, btn, sub, clamp, onSync, fmtNum } from "./widgets.js";

export const OV_META = {
  text: { icon: "T", label: "Texte", color: "#7aa2ff" },
  number: { icon: "#", label: "Chiffre animé", color: "#f6c453" },
  zoom: { icon: "⌕", label: "Zoom diapo", color: "#4fd1c5" },
  broll: { icon: "▣", label: "B-roll", color: "#f687b3" },
};

export function selectedOverlay() {
  const id = store.selectedOverlayId; if (!id) return null;
  for (const p of store.project.parts) if (p.overlays) { const o = p.overlays.find(o => o.id === id); if (o) return { part: p, ov: o }; }
  return null;
}
export function selectOverlay(part, ov, { seek = true } = {}) {
  store.selectedOverlayId = ov ? ov.id : null;
  if (ov && part) {
    if (part.id !== store.selectedPartId) store.selectedPartId = part.id;
    // zoom: show the slide unzoomed (start of the overlay) so the rectangle can be drawn; others: show them
    if (seek) seekSrc(part, ov.type === "zoom" ? ov.t : ov.t + Math.min(0.8, ov.dur / 2));
  }
  changed("select");
}

/** Add an overlay at the playhead (program: talk part under it; source view: selected part). */
export function addOverlay(type, clipId = null) {
  const tt = targetTalk(); if (!tt) return null;
  if (type === "zoom" && !store.slides.length) toast("Astuce : le zoom agit sur la diapo — ajoute ta présentation.", 3000);
  const ov = newOverlay(type, Math.round(tt.srcT * 100) / 100);
  if (type === "broll") {
    const all = Object.values(store.project.clips).filter(c => c.linked !== false);
    const usedByParts = new Set(store.project.parts.flatMap(p => [p.clipId, p.camB && p.camB.clipId]).filter(Boolean));
    const c = clipById(clipId) || all.find(c => c.kind === "image") || all.find(c => c.kind === "video" && !usedByParts.has(c.id) && c.id !== tt.part.clipId);
    if (!c) { toast("Importe d'abord une photo ou une vidéo d'illustration dans « Médias »."); return null; }
    ov.clipId = c.id;
  }
  mutate(() => { tt.part.overlays.push(ov); store.selectedOverlayId = ov.id; store.selectedPartId = tt.part.id; });
  toast(`${OV_META[type].label} ajouté à ${fmtTime(tt.srcT, true)}${type === "zoom" ? " · dessine le cadre sur l'aperçu" : type === "text" || type === "number" ? " · glisse-le sur l'aperçu" : ""}`, 2400);
  return ov;
}
export function deleteSelectedOverlay() {
  const s = selectedOverlay(); if (!s) return false;
  mutate(() => { s.part.overlays = s.part.overlays.filter(o => o !== s.ov); store.selectedOverlayId = null; });
  toast("Élément supprimé (Ctrl+Z pour annuler)");
  return true;
}

/* ---------------- panel ---------------- */
export function createOverlaysPanel(el) {
  return new Panel(el, {
    key: () => { const p = focusPart(); const s = selectedOverlay(); return `${p ? p.id : "-"}|${p ? p.overlays.map(o => o.id + o.type).join(",") : ""}|${s ? s.ov.id : ""}|${s && s.ov.type === "broll" ? Object.keys(store.project.clips).length : ""}`; },
    build: root => {
      const part = focusPart();
      root.append(h("div.addgrid",
        btn("T  Texte", () => addOverlay("text"), { title: "Ajouter un texte au moment actuel" }),
        btn("#  Chiffre animé", () => addOverlay("number"), { title: "Un chiffre qui compte jusqu'à ta valeur" }),
        btn("⌕  Zoom sur la diapo", () => addOverlay("zoom"), { title: "Zoomer sur une zone de la diapo" }),
        btn("▣  B-roll", () => addOverlay("broll"), { title: "Photo ou vidéo d'illustration par-dessus" })));
      if (!part) { root.append(hint("Les éléments s'ajoutent au moment de la tête de lecture, sur une partie « présentation ».")); return; }
      const sel = selectedOverlay();
      if (!part.overlays.length) root.append(hint("Aucun élément sur cette partie pour l'instant."));
      const list = h("div.ovlist");
      part.overlays.forEach((ov, i) => {
        const m = OV_META[ov.type] || { icon: "?", label: ov.type, color: "#999" };
        const nameOf = o => o.type === "text" ? o.text : o.type === "number" ? `${o.prefix || ""}${o.value}${o.suffix || ""} ${o.label || ""}` : o.type === "broll" ? (clipById(o.clipId)?.name || "B-roll") : `Zoom ${Math.round(o.rect.w * 100)} %`;
        const clean = o => String(nameOf(o)).replace(/\s+/g, " ").trim() || m.label;
        const r = h("div.ovrow" + (sel && sel.ov.id === ov.id ? ".on" : ""), { tabindex: 0, role: "button", title: "Sélectionner", onclick: () => selectOverlay(part, ov) },
          h("span.ovic", { text: m.icon, style: { background: m.color } }),
          h("span.grow.ellip.ovname", { text: clean(ov) }),
          h("span.hint.mono.ovtime", { text: `${fmtTime(ov.t, true)} · ${fmtNum(ov.dur, 1)} s` }),
          iconBtn("⧉", "Dupliquer", () => mutate(() => { const c = JSON.parse(JSON.stringify(ov)); c.id = newOverlay(ov.type, 0).id; c.t = ov.t + ov.dur; part.overlays.splice(i + 1, 0, c); store.selectedOverlayId = c.id; })),
          iconBtn("✕", "Supprimer (Suppr)", () => mutate(() => { part.overlays.splice(i, 1); if (store.selectedOverlayId === ov.id) store.selectedOverlayId = null; }), "del"));
        r.addEventListener("keydown", e => { if (e.key === "Enter" && e.target === r) selectOverlay(part, ov); });
        onSync(() => { const o = part.overlays[i]; if (!o) return; r.querySelector(".ovname").textContent = clean(o); r.querySelector(".ovtime").textContent = `${fmtTime(o.t, true)} · ${fmtNum(o.dur, 1)} s`; });
        list.append(r);
      });
      root.append(list);
      if (sel && sel.part.id === part.id) root.append(overlayInspector(sel.part, sel.ov));
      else if (part.overlays.length) root.append(hint("Clique un élément pour le modifier. Sur l'aperçu, tu peux le glisser."));
    },
  });
}

function overlayInspector(part, ov) {
  const g = () => { const p = partById(part.id); return p && p.overlays.find(o => o.id === ov.id); };
  const box = h("div.inspector");
  const m = OV_META[ov.type];
  box.append(h("div.insphead", h("span.ovic", { text: m.icon, style: { background: m.color } }), h("b", { text: m.label }),
    h("span.grow"), btn("▶ Voir", () => seekSrc(part, Math.max(0, ov.t - 0.3)), { cls: "sm ghost", title: "Aller juste avant cet élément" })));
  const timeRow = row("Début / durée",
    bind(g, "t", { type: "number", step: 0.1, min: 0, digits: 2, label: "Début (s)" }),
    bind(g, "dur", { type: "number", step: 0.1, min: 0.3, digits: 2, label: "Durée (s)" }),
    btn("⌖", () => { const t = srcTimeIn(part); if (t == null) return toast("La tête de lecture n'est pas dans cette partie."); mutate(() => { g().t = Math.round(t * 100) / 100; }); }, { cls: "sm", title: "Commencer au temps actuel" }));
  if (ov.type === "text") {
    box.append(row("Texte", bind(g, "text", { type: "textarea", rows: 2, placeholder: "Ton texte" })));
    box.append(timeRow);
    box.append(row("Taille", bind(g, "size", { type: "range", min: 20, max: 200, step: 1, unit: " px" })));
    box.append(row("Couleur / gras", bind(g, "color", { type: "color", label: "Couleur" }), bind(g, "weight", { type: "select", options: [[400, "Normal"], [600, "Mi-gras"], [800, "Gras"], [900, "Très gras"]], fromUI: v => +v })));
    box.append(row("Alignement", bind(g, "align", { type: "seg", options: [["left", "Gauche"], ["center", "Centre"], ["right", "Droite"]] })));
    box.append(row("Animation", bind(g, "anim", { type: "select", options: [["fade", "Fondu"], ["up", "Monte"], ["pop", "Pop"], ["type", "Machine à écrire"], ["slide", "Glisse"]] })));
    box.append(row("Fond", bind(g, "bgOn", { type: "check", label: "Fond derrière le texte" }), bind(g, "bg", { type: "color", label: "Couleur du fond" })));
    box.append(posRows(g));
  } else if (ov.type === "number") {
    box.append(row("Valeur", bind(g, "from", { type: "number", step: 1, label: "De" }), h("span.hint", { text: "→" }), bind(g, "value", { type: "number", step: 1, label: "Jusqu'à" })));
    box.append(row("Avant / après", bind(g, "prefix", { type: "text", placeholder: "ex. $", label: "Préfixe" }), bind(g, "suffix", { type: "text", placeholder: "ex. %", label: "Suffixe" })));
    box.append(row("Décimales", bind(g, "decimals", { type: "seg", options: [[0, "0"], [1, "1"], [2, "2"]] , fromUI: v => +v })));
    box.append(row("Libellé", bind(g, "label", { type: "text", placeholder: "ex. employés" })));
    box.append(timeRow);
    box.append(row("Compte en", bind(g, "countDur", { type: "range", min: 0.3, max: 5, step: 0.1, unit: " s" })));
    box.append(row("Taille / couleur", bind(g, "size", { type: "range", min: 40, max: 320, step: 2, unit: " px" }), bind(g, "color", { type: "color" })));
    box.append(posRows(g));
  } else if (ov.type === "zoom") {
    box.append(h("div.callout", { html: "<b>Dessine le cadre</b> directement sur la diapo dans l'aperçu (clique-glisse). La vidéo zoome dedans, puis revient." }));
    box.append(timeRow);
    box.append(row("Entrée / sortie", bind(g, "inDur", { type: "number", step: 0.1, min: 0.1, max: 3, digits: 2, label: "Entrée (s)" }), bind(g, "outDur", { type: "number", step: 0.1, min: 0.1, max: 3, digits: 2, label: "Sortie (s)" })));
    const rg = () => { const o = g(); return o && o.rect; };
    box.append(row("Cadre x / y", bind(rg, "x", { type: "number", step: 0.01, min: 0, max: 0.95, digits: 3 }), bind(rg, "y", { type: "number", step: 0.01, min: 0, max: 0.95, digits: 3 })));
    box.append(row("Cadre l / h", bind(rg, "w", { type: "number", step: 0.01, min: 0.05, max: 1, digits: 3 }), bind(rg, "h", { type: "number", step: 0.01, min: 0.05, max: 1, digits: 3 })));
    box.append(h("div.btnrow", btn("Plein cadre", () => mutate(() => { g().rect = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }; }), { cls: "sm ghost", title: "Recentrer le cadre" })));
  } else if (ov.type === "broll") {
    const media = Object.values(store.project.clips).filter(c => c.kind === "image" || c.kind === "video");
    box.append(row("Média", bind(g, "clipId", { type: "select", options: () => [["", "— choisir —"], ...Object.values(store.project.clips).filter(c => c.kind === "image" || c.kind === "video").map(c => [c.id, (c.kind === "video" ? "🎬 " : "🖼️ ") + c.name])], fromUI: v => v || null })));
    if (!media.length) box.append(hint("Importe une photo ou une vidéo dans « Médias »."));
    box.append(timeRow);
    box.append(row("Zone", bind(g, "area", { type: "seg", options: [["full", "Plein écran"], ["slide", "Cadre de la diapo"]] })));
    box.append(row("Effet Ken Burns", bind(g, "kenBurns", { type: "check", title: "Zoom lent sur les photos" })));
    box.append(row("Volume (vidéo)", bind(g, "volume", { type: "range", min: 0, max: 2, step: 0.05, fmt: v => Math.round(v * 100) + " %" })));
  }
  box.append(h("div.btnrow", btn("🗑️ Supprimer", () => deleteSelectedOverlay(), { cls: "ghost danger sm", title: "Supprimer cet élément (Suppr)" })));
  return box;
}
function posRows(g) {
  return h("div",
    row("Position ↔", bind(g, "x", { type: "range", min: 0, max: 1, step: 0.005, fmt: v => Math.round(v * 100) + " %", reset: 0.5 })),
    row("Position ↕", bind(g, "y", { type: "range", min: 0, max: 1, step: 0.005, fmt: v => Math.round(v * 100) + " %", reset: 0.5 })),
    hint("Astuce : glisse l'élément directement sur l'aperçu."));
}

/* ---------------- direct manipulation on the preview ---------------- */
const DW = 1920, DH = 1080;
let drag = null;

function stageGeom() {
  const cv = $("#preview"); const r = cv.getBoundingClientRect();
  return { r, sx: r.width / DW, sy: r.height / DH };
}
/** Slide box (design px) shown for the selected part at the playhead, or null. */
function slideBoxNow(part) {
  const t = srcTimeIn(part); if (t == null) return null;
  const st = slideStateAt(part, t);
  if (st.kind === "cam") return null;
  if (st.kind === "pip" && part.camB && part.camB.clipId && store.project.style.duoLayout === "side") return null;   // duo side by side: no slide shown
  let L; try { L = layoutBoxes(DW, DH, part, st.kind); } catch (e) { return null; }
  if (!L) return null;
  if (st.kind === "slide") return L.bigSlide || L.slide;
  return L.slide || L.bigSlide;
}

/** Update the guide layer above the preview (called every frame). */
export function updateGuides() {
  const layer = $("#guides"); if (!layer) return;
  const s = selectedOverlay();
  const show = s && !store.exporting && srcTimeIn(s.part) != null && (s.ov.type === "zoom" || s.ov.type === "text" || s.ov.type === "number");
  layer.classList.toggle("on", !!show);
  if (!show) { layer.dataset.mode = ""; return; }
  const { sx, sy } = stageGeom();
  const box = layer.querySelector(".gbox"), pin = layer.querySelector(".gpin"), sl = layer.querySelector(".gslide");
  if (s.ov.type === "zoom") {
    const b = slideBoxNow(s.part);
    layer.dataset.mode = b ? "zoom" : "nozoom";
    if (!b) { box.style.display = sl.style.display = "none"; pin.style.display = "none"; return; }
    const R = s.ov.rect;
    Object.assign(sl.style, { display: "block", left: b.x * sx + "px", top: b.y * sy + "px", width: b.w * sx + "px", height: b.h * sy + "px" });
    Object.assign(box.style, { display: "block", left: (b.x + R.x * b.w) * sx + "px", top: (b.y + R.y * b.h) * sy + "px", width: R.w * b.w * sx + "px", height: R.h * b.h * sy + "px" });
    pin.style.display = "none";
  } else {
    layer.dataset.mode = "pos";
    box.style.display = sl.style.display = "none";
    Object.assign(pin.style, { display: "block", left: s.ov.x * DW * sx + "px", top: s.ov.y * DH * sy + "px" });
  }
}

export function initPreviewEditing() {
  const layer = $("#guides");
  layer.innerHTML = `<div class="gslide"></div><div class="gbox"><span>Zone du zoom</span></div><div class="gpin" title="Glisse pour déplacer"></div><div class="ghint"></div>`;
  const toDesign = e => { const { r, sx, sy } = stageGeom(); return { x: (e.clientX - r.left) / sx, y: (e.clientY - r.top) / sy }; };
  layer.addEventListener("pointerdown", e => {
    const s = selectedOverlay(); if (!s || store.exporting) return;
    const p = toDesign(e);
    if (s.ov.type === "zoom") {
      const b = slideBoxNow(s.part); if (!b) return;
      const nx = clamp((p.x - b.x) / b.w, 0, 1), ny = clamp((p.y - b.y) / b.h, 0, 1);
      const R = s.ov.rect;
      const inside = nx >= R.x && nx <= R.x + R.w && ny >= R.y && ny <= R.y + R.h;
      drag = { type: inside && !e.shiftKey ? "moveRect" : "drawRect", s, b, x0: nx, y0: ny, r0: { ...R }, moved: false };
    } else {
      drag = { type: "pos", s, dx: s.ov.x - p.x / DW, dy: s.ov.y - p.y / DH, moved: false };
    }
    layer.setPointerCapture(e.pointerId); e.preventDefault();
  });
  layer.addEventListener("pointermove", e => {
    if (!drag) return;
    const p = toDesign(e), ov = drag.s.ov;
    if (!drag.moved) { checkpoint(); drag.moved = true; }
    if (drag.type === "pos") {
      ov.x = Math.round(clamp(p.x / DW + drag.dx, 0, 1) * 1000) / 1000;
      ov.y = Math.round(clamp(p.y / DH + drag.dy, 0, 1) * 1000) / 1000;
    } else {
      const b = drag.b;
      const nx = clamp((p.x - b.x) / b.w, 0, 1), ny = clamp((p.y - b.y) / b.h, 0, 1);
      if (drag.type === "drawRect") {
        // same proportions as the slide box, so the zoomed view is never distorted
        const dx = nx < drag.x0 ? -1 : 1, dy = ny < drag.y0 ? -1 : 1;
        let k = Math.max(Math.abs(nx - drag.x0), Math.abs(ny - drag.y0));
        k = Math.max(0.05, Math.min(k, dx > 0 ? 1 - drag.x0 : drag.x0, dy > 0 ? 1 - drag.y0 : drag.y0));
        const x = clamp(dx > 0 ? drag.x0 : drag.x0 - k, 0, 1 - k), y = clamp(dy > 0 ? drag.y0 : drag.y0 - k, 0, 1 - k);
        ov.rect = { x: r3(x), y: r3(y), w: r3(k), h: r3(k) };
      } else {
        const R = drag.r0;
        ov.rect = { ...R, x: r3(clamp(R.x + nx - drag.x0, 0, 1 - R.w)), y: r3(clamp(R.y + ny - drag.y0, 0, 1 - R.h)) };
      }
    }
    try { app.engine.renderNow(); } catch (_) { }
    updateGuides();
  });
  const end = () => { if (!drag) return; const moved = drag.moved; drag = null; if (moved) changed("project"); };
  layer.addEventListener("pointerup", end); layer.addEventListener("pointercancel", end);
}
const r3 = v => Math.round(v * 1000) / 1000;
