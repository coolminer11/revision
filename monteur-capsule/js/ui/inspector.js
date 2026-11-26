// inspector.js — settings of the selected part (talk / extract / card): trim, speed, voice, framing,
// 2nd person, camera-only, cuts, speed sections.
import { store, partById, clipById, partRange, fmtTime, program, partOutDuration } from "../state.js";
import { app, srcTimeIn, seekSrc, setView, isSource, frameInfo } from "./ctx.js";
import { MEMBER_COLORS, partLabel } from "./sequence.js";
import { h, mutate, toast, Panel, bind, row, hint, iconBtn, btn, sub, swatches, group, onSync, fmtNum } from "./widgets.js";

const sel = () => partById(store.selectedPartId);
const pct = { toUI: v => Math.round((v ?? 1) * 100), fromUI: v => v / 100 };

/** Current source time of the selected part, or toast. In program view it must be under the playhead. */
function nowIn(part) {
  const t = srcTimeIn(part);
  if (t == null) toast("Place la tête de lecture dans cette partie (ou ouvre la vue clip).");
  return t == null ? null : Math.round(t * 100) / 100;
}
/** Source time for cut/speed editing: opens the source (clip) view automatically. */
function nowForCut(part) {
  let t = srcTimeIn(part);
  if (!isSource()) {
    const fi = frameInfo();
    setView("source", part.id);
    if (t != null) { app.engine.seek(t); toast("Vue clip ouverte : tu vois toute la vidéo, même les bouts coupés.", 2600); }
    else { toast("Vue clip ouverte : place la tête de lecture puis recommence.", 2600); return null; }
  }
  if (t == null) t = app.engine.time;
  return Math.round(t * 100) / 100;
}

function timeField(g, key, label, part) {
  return row(label,
    bind(g, key, { type: "number", step: 0.1, min: 0, digits: 2, allowEmpty: key === "out", placeholder: key === "out" ? "fin" : "0", label }),
    btn("⌖", () => { const t = nowIn(part); if (t != null) mutate(() => { g()[key] = t; }); }, { cls: "sm", title: "Au temps actuel" }));
}
function voiceRows(g) {
  const vg = () => g() && g().voice;
  return [
    row("Volume", bind(g, "volume", { type: "range", min: 0, max: 300, step: 5, unit: " %", ...pct, reset: 100 })),
    row("Voix claire", bind(vg, "clear", { type: "check", title: "Filtre qui rend la voix plus nette" })),
    row("Réduction de bruit", bind(vg, "denoise", { type: "range", min: 0, max: 100, step: 5, unit: " %", ...pct, reset: 40 })),
  ];
}
function speedRow(g) {
  return row("Vitesse", bind(g, "speed", { type: "range", min: 0.5, max: 2, step: 0.05, fmt: v => fmtNum(v, 2) + "×", reset: 1 }));
}
function framing(getCam) {
  return [
    row("Zoom", bind(getCam, "zoom", { type: "range", min: 1, max: 3, step: 0.01, fmt: v => fmtNum(v, 2) + "×", reset: 1 })),
    row("Décalage ↔", bind(getCam, "x", { type: "range", min: -1, max: 1, step: 0.01, reset: 0 })),
    row("Décalage ↕", bind(getCam, "y", { type: "range", min: -1, max: 1, step: 0.01, reset: 0 })),
    row("Miroir", bind(getCam, "mirror", { type: "check" })),
  ];
}

export function createInspectorPanel(el) {
  return new Panel(el, {
    key: () => { const p = sel(); return p ? `${p.id}|${p.type}|${!!(p.camB)}|${p.cuts ? p.cuts.length : 0}|${p.speedSections ? p.speedSections.length : 0}|${JSON.stringify(app.pendingCut)}|${JSON.stringify(app.pendingSpeed)}|${Object.keys(store.project.clips).length}` : "none"; },
    build: root => {
      const part = sel();
      if (!part) { root.append(hint("Sélectionne une partie dans la séquence pour la régler.")); return; }
      const g = () => partById(part.id);
      const idx = store.project.parts.indexOf(part);
      const clip = clipById(part.clipId);
      const title = h("b", { text: partLabel(part, idx) });
      onSync(() => { const p = g(); if (p) title.textContent = partLabel(p, store.project.parts.indexOf(p)); });
      root.append(h("div.insphead", title, h("span.tag", { text: { talk: "Présentation", extract: "Extrait", card: "Carte titre" }[part.type] }), h("span.grow"),
        part.type !== "card" ? btn(isSource() ? "◧ Vue programme" : "◨ Vue clip", () => setView(isSource() ? "program" : "source", part.id), { cls: "sm ghost", title: "Vue clip : la vidéo brute de cette partie (pour les coupes) · Vue programme : le montage final" }) : null));
      if (clip && !clip.linked) root.append(h("div.callout.warn", { text: `« ${clip.name} » n'est pas chargé : ré-importe-le dans Médias.` }));

      if (part.type === "card") {
        root.append(row("Titre", bind(g, "title", { type: "text" })), row("Sous-titre", bind(g, "sub", { type: "text" })), row("Durée", bind(g, "dur", { type: "range", min: 0.5, max: 10, step: 0.1, unit: " s" })));
        return;
      }
      if (part.type === "extract") {
        root.append(row("Titre", bind(g, "label", { type: "text", placeholder: "ex. Entrevue avec la directrice" })), row("Sous-titre", bind(g, "sub", { type: "text", placeholder: "ex. Marie Tremblay, Desjardins" })));
        root.append(row("Affichage", bind(g, "display", { type: "seg", options: [["full", "Plein écran"], ["frame", "Dans un cadre"]] })));
        root.append(timeField(g, "in", "Début", part), timeField(g, "out", "Fin", part));
        root.append(speedRow(g), ...voiceRows(g));
        root.append(durNote(part));
        return;
      }
      // ---- talk ----
      const mg = () => g() && g().member;
      root.append(row("Nom", bind(mg, "name", { type: "text", placeholder: "ex. Léa Gagnon" })));
      root.append(row("Sous-titre", bind(mg, "sub", { type: "text", placeholder: "ex. Ressources humaines" })));
      root.append(row("Couleur", swatches(MEMBER_COLORS, mg, "color", "project", { allowNone: true })));
      root.append(timeField(g, "in", "Début", part), timeField(g, "out", "Fin", part), durNote(part));
      root.append(row("Caméra seulement", bind(g, "layout", { type: "check", toUI: v => v === "cam", fromUI: v => v ? "cam" : null, title: "Toute la partie en caméra plein écran, sans diapo" })));

      root.append(group("insp-sound", "🔊 Vitesse et son", b => { b.append(speedRow(g), ...voiceRows(g)); }, { open: true }));
      root.append(group("insp-cam", "🎥 Cadrage de la caméra", b => { b.append(...framing(() => g() && g().cam)); }));

      // 2nd person
      root.append(group("insp-duo", "👥 2e personne", b => {
        const vids = Object.values(store.project.clips).filter(c => c.kind === "video" && c.id !== part.clipId);
        if (!part.camB) {
          b.append(hint("Deux personnes filmées en même temps (2 cells) ? Ajoute la 2e vidéo : elles s'affichent ensemble."));
          if (!vids.length) b.append(hint("Importe d'abord la 2e vidéo dans « Médias »."));
          else b.append(h("div.btnrow", btn("+ Ajouter la 2e personne", () => mutate(() => { g().camB = { clipId: vids[0].id, offset: 0, zoom: 1, x: 0, y: 0, mirror: false, volume: 1 }; }), { cls: "primary sm" })));
          return;
        }
        const cb = () => g() && g().camB;
        b.append(row("Vidéo", bind(cb, "clipId", { type: "select", options: () => Object.values(store.project.clips).filter(c => c.kind === "video" && c.id !== part.clipId).map(c => [c.id, c.name]) })));
        b.append(row("Synchro", bind(cb, "offset", { type: "number", step: 0.05, digits: 2, label: "Décalage (s)" }),
          btn("−0,1", () => mutate(() => { cb().offset = Math.round(((+cb().offset || 0) - 0.1) * 100) / 100; }), { cls: "sm", title: "La 2e vidéo 0,1 s plus tôt" }),
          btn("+0,1", () => mutate(() => { cb().offset = Math.round(((+cb().offset || 0) + 0.1) * 100) / 100; }), { cls: "sm", title: "La 2e vidéo 0,1 s plus tard" })));
        b.append(hint("Décalage = où en est la 2e vidéo quand la 1<sup>re</sup> est à 0 s. Astuce : un clap au début aide à synchroniser."));
        b.append(row("Disposition", bind(() => store.project.style, "duoLayout", { type: "seg", kind: "style", options: [["stack", "Empilées + diapo"], ["side", "Côte à côte"]] })));
        b.append(row("Volume", bind(cb, "volume", { type: "range", min: 0, max: 300, step: 5, unit: " %", ...pct, reset: 100 })));
        b.append(...framing(cb));
        b.append(h("div.btnrow", btn("Retirer la 2e personne", () => mutate(() => { g().camB = null; }), { cls: "ghost danger sm" })));
      }, { badge: part.camB ? "activée" : "", open: !!part.camB }));

      // cuts
      root.append(group("insp-cuts", "✂️ Coupes", b => {
        b.append(hint("Enlève les bouts ratés (hésitations, silences). Dans la vue clip, les coupes sont hachurées en rouge et leurs bords se glissent."));
        const pend = app.pendingCut && app.pendingCut.partId === part.id ? app.pendingCut : null;
        b.append(h("div.btnrow",
          btn(pend ? `Début : ${fmtTime(pend.a, true)}` : "[ Début coupe", () => { const t = nowForCut(part); if (t == null) return; app.pendingCut = { partId: part.id, a: t }; app.refreshAll(); }, { cls: "sm" + (pend ? " on" : ""), title: "Marque le début du bout à enlever (au temps actuel)" }),
          btn("Fin coupe ]", () => {
            const p = app.pendingCut && app.pendingCut.partId === part.id ? app.pendingCut : null;
            if (!p) return toast("Clique d'abord « Début coupe ».");
            const t = nowForCut(part); if (t == null) return;
            if (Math.abs(t - p.a) < 0.05) return toast("Avance un peu la vidéo pour marquer la fin.");
            app.pendingCut = null;
            mutate(() => { g().cuts.push({ a: Math.min(p.a, t), b: Math.max(p.a, t) }); g().cuts.sort((x, y) => x.a - y.a); });
            toast(`Coupe ajoutée : ${fmtNum(Math.abs(t - p.a), 1)} s enlevées ✂️`);
          }, { cls: "sm", title: "Marque la fin du bout à enlever" }),
          pend ? iconBtn("✕", "Annuler le début", () => { app.pendingCut = null; app.refreshAll(); }) : null));
        part.cuts.forEach((c, i) => {
          const cg = () => g() && g().cuts[i];
          b.append(h("div.lrow", h("button.mkidx", { type: "button", text: i + 1, title: "Voir cette coupe", onclick: () => { if (!isSource()) setView("source", part.id); app.engine.seek(Math.max(0, c.a - 1)); } }),
            bind(cg, "a", { type: "number", step: 0.05, min: 0, digits: 2, label: "Début de la coupe" }), h("span.hint", { text: "→" }),
            bind(cg, "b", { type: "number", step: 0.05, min: 0, digits: 2, label: "Fin de la coupe" }),
            h("span.hint.mono", { text: `−${fmtNum(Math.abs(c.b - c.a), 1)} s` }),
            iconBtn("✕", "Supprimer la coupe", () => mutate(() => g().cuts.splice(i, 1)), "del")));
        });
      }, { badge: part.cuts.length ? String(part.cuts.length) : "", open: part.cuts.length > 0 || !!(app.pendingCut && app.pendingCut.partId === part.id) }));

      // speed sections
      root.append(group("insp-speed", "⏩ Vitesse par section", b => {
        b.append(hint("Accélère un passage précis (ex. une démo trop longue) sans toucher au reste."));
        const pend = app.pendingSpeed && app.pendingSpeed.partId === part.id ? app.pendingSpeed : null;
        b.append(h("div.btnrow",
          btn(pend ? `Début : ${fmtTime(pend.a, true)}` : "[ Début", () => { const t = nowForCut(part); if (t == null) return; app.pendingSpeed = { partId: part.id, a: t }; app.refreshAll(); }, { cls: "sm" + (pend ? " on" : ""), title: "Début de la section (au temps actuel)" }),
          btn("Fin ]", () => {
            const p = app.pendingSpeed && app.pendingSpeed.partId === part.id ? app.pendingSpeed : null;
            if (!p) return toast("Clique d'abord « Début ».");
            const t = nowForCut(part); if (t == null) return;
            if (Math.abs(t - p.a) < 0.05) return toast("Avance un peu la vidéo pour marquer la fin.");
            app.pendingSpeed = null;
            mutate(() => { g().speedSections.push({ a: Math.min(p.a, t), b: Math.max(p.a, t), speed: 1.5 }); g().speedSections.sort((x, y) => x.a - y.a); });
          }, { cls: "sm", title: "Fin de la section" }),
          pend ? iconBtn("✕", "Annuler le début", () => { app.pendingSpeed = null; app.refreshAll(); }) : null));
        part.speedSections.forEach((s, i) => {
          const sg = () => g() && g().speedSections[i];
          b.append(h("div.lrow",
            bind(sg, "a", { type: "number", step: 0.05, min: 0, digits: 2, label: "Début" }), h("span.hint", { text: "→" }),
            bind(sg, "b", { type: "number", step: 0.05, min: 0, digits: 2, label: "Fin" }),
            bind(sg, "speed", { type: "select", options: [[0.5, "0,5×"], [0.75, "0,75×"], [1.25, "1,25×"], [1.5, "1,5×"], [2, "2×"], [3, "3×"], [4, "4×"]], fromUI: v => +v, label: "Vitesse" }),
            iconBtn("✕", "Supprimer", () => mutate(() => g().speedSections.splice(i, 1)), "del")));
        });
      }, { badge: part.speedSections.length ? String(part.speedSections.length) : "", open: part.speedSections.length > 0 || !!(app.pendingSpeed && app.pendingSpeed.partId === part.id) }));
    },
  });
}

function durNote(part) {
  const el = h("div.hint.mono");
  const upd = () => {
    const p = partById(part.id); if (!p) return;
    const [a, b] = partRange(p);
    el.textContent = `Dans le montage : ${fmtTime(partOutDuration(program(), p.id), true)} (clip ${fmtTime(a, true)} → ${fmtTime(b, true)})`;
  };
  upd(); onSync(upd); return el;
}
