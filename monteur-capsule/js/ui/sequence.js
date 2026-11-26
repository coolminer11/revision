// sequence.js — "Séquence": ordered parts (drag to reorder), + card, intro / outro / member cards settings.
import { store, partById, clipById, newCardPart, program, partOutDuration, fmtTime, uid } from "../state.js";
import { CARD_TEMPLATES } from "../render.js";
import { app, selectPart } from "./ctx.js";
import { h, mutate, Panel, bind, row, hint, iconBtn, btn, group, toast, onSync } from "./widgets.js";

export const MEMBER_COLORS = ["#4fd1c5", "#7aa2ff", "#f6ad55", "#f687b3", "#9f7aea", "#68d391", "#fc8181", "#f6e05e"];
export function partColor(part, prog = program()) {
  if (part.type === "extract") return "#e08a3c";
  if (part.type === "card") return "#8b6cf0";
  if (part.member && part.member.color) return part.member.color;
  const s = prog.spans.find(s => s.partId === part.id && s.type === "talk");
  return MEMBER_COLORS[Math.max(0, s ? s.memberIndex : 0) % MEMBER_COLORS.length];
}
export function partLabel(part, i) {
  if (part.type === "talk") return part.member.name.trim() || `Partie ${i + 1}`;
  if (part.type === "extract") return part.label || "Extrait";
  return part.title || "Carte titre";
}
const TYPE = { talk: "Présentation", extract: "Extrait", card: "Carte" };

function move(i, j) {
  const ps = store.project.parts; if (j < 0 || j >= ps.length || i === j) return;
  mutate(() => { const [p] = ps.splice(i, 1); ps.splice(j, 0, p); });
}

export function createSequencePanel(el) {
  return new Panel(el, {
    key: () => store.project.parts.map(p => p.id).join(",") + "|" + store.selectedPartId + "|" + store.project.intro.on + store.project.outro.on + store.project.memberCards.on,
    build: root => {
      const prog = program();
      const list = h("div.seq", { role: "list" });
      const parts = store.project.parts;
      if (!parts.length) list.append(hint("Ta séquence est vide. Dans « Médias », clique <b>+ Partie</b> sur une vidéo."));
      let dragFrom = -1;
      const intro = store.project.intro, outro = store.project.outro;
      if (intro.on) list.append(h("div.seqrow.auto", h("span.grip"), h("span.pcolor", { style: { background: "#6b7489" } }), h("div.pinfo", h("div.pname", { text: intro.title || "Introduction" }), h("div.pmeta", { text: `Intro · ${fmtTime(intro.dur)}` }))));
      const metaOf = (p, prog) => {
        const dur = p.type === "card" ? (+p.dur || 0) : partOutDuration(prog, p.id);
        const c = clipById(p.clipId);
        return [TYPE[p.type], fmtTime(dur, true), p.type === "talk" && p.markers.length ? `${p.markers.length} diapo${p.markers.length > 1 ? "s" : ""}` : null, p.type === "talk" && p.camB ? "duo" : null, p.type === "talk" && p.layout === "cam" ? "cam seule" : null, p.speed && p.speed !== 1 ? `${p.speed}×` : null, c && !c.linked ? "⚠ non lié" : null].filter(Boolean).join(" · ");
      };
      parts.forEach((p, i) => {
        const meta = metaOf(p, prog);
        const r = h("div.seqrow" + (p.id === store.selectedPartId ? ".on" : ""), { role: "listitem", draggable: true, tabindex: 0, title: "Clique pour sélectionner · glisse pour déplacer", dataset: { i } },
          h("span.grip", { text: "⋮⋮", "aria-hidden": "true" }),
          h("span.pcolor", { style: { background: partColor(p, prog) } }),
          h("div.pinfo", h("div.pname", { text: partLabel(p, i) }), h("div.pmeta", { text: meta })),
          h("div.pacts",
            iconBtn("↑", "Monter", () => move(i, i - 1)),
            iconBtn("↓", "Descendre", () => move(i, i + 1)),
            iconBtn("⧉", "Dupliquer", () => mutate(() => {
              const cp = JSON.parse(JSON.stringify(p)); cp.id = uid("part");
              if (cp.overlays) cp.overlays.forEach(o => { o.id = uid("ov"); });
              parts.splice(i + 1, 0, cp); store.selectedPartId = cp.id;
            })),
            iconBtn("✕", "Retirer de la séquence", () => {
              if (p.type === "talk" && (p.markers.length || p.overlays.length) && !confirm(`Retirer « ${partLabel(p, i)} » ? (ses changements de diapo et éléments partent avec — Ctrl+Z pour annuler)`)) return;
              mutate(() => { parts.splice(i, 1); if (store.selectedPartId === p.id) store.selectedPartId = (parts[i] || parts[i - 1] || {}).id || null; });
            }, "del")));
        onSync(() => {
          const pr = program(), nm = partLabel(p, store.project.parts.indexOf(p)), mt = metaOf(p, pr);
          const a = r.querySelector(".pname"), b = r.querySelector(".pmeta"), cc = r.querySelector(".pcolor");
          if (a.textContent !== nm) a.textContent = nm;
          if (b.textContent !== mt) b.textContent = mt;
          cc.style.background = partColor(p, pr);
        });
        r.addEventListener("click", () => selectPart(p.id));
        r.addEventListener("keydown", e => { if (e.key === "Enter") selectPart(p.id); });
        r.addEventListener("dragstart", e => { dragFrom = i; r.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); });
        r.addEventListener("dragend", () => { r.classList.remove("dragging"); list.querySelectorAll(".dropbefore,.dropafter").forEach(x => x.classList.remove("dropbefore", "dropafter")); });
        r.addEventListener("dragover", e => {
          if (dragFrom < 0) return; e.preventDefault();
          const b = r.getBoundingClientRect(), after = e.clientY > b.top + b.height / 2;
          r.classList.toggle("dropafter", after); r.classList.toggle("dropbefore", !after);
        });
        r.addEventListener("dragleave", () => r.classList.remove("dropbefore", "dropafter"));
        r.addEventListener("drop", e => {
          e.preventDefault(); if (dragFrom < 0) return;
          const b = r.getBoundingClientRect(), after = e.clientY > b.top + b.height / 2;
          let j = i + (after ? 1 : 0); if (dragFrom < j) j--;
          const from = dragFrom; dragFrom = -1; move(from, j);
        });
        list.append(r);
      });
      if (outro.on) list.append(h("div.seqrow.auto", h("span.grip"), h("span.pcolor", { style: { background: "#6b7489" } }), h("div.pinfo", h("div.pname", { text: outro.title || "Conclusion" }), h("div.pmeta", { text: `Outro · ${fmtTime(outro.dur)}` }))));
      root.append(list);
      root.append(h("div.btnrow",
        btn("+ Carte titre", () => mutate(() => {
          const c = newCardPart(); const idx = parts.findIndex(p => p.id === store.selectedPartId);
          parts.splice(idx >= 0 ? idx + 1 : parts.length, 0, c); store.selectedPartId = c.id;
        }), { title: "Une carte avec un titre (ex. : « Partie 2 — Le marketing »)" })));

      const tplOpts = () => CARD_TEMPLATES.map(t => [t.id, t.label]);
      const cardGroup = (id, title, getObj, withNames) => group(id, title, b => {
        b.append(row("Afficher", bind(getObj, "on", { type: "check", label: title })));
        b.append(row("Modèle", bind(getObj, "template", { type: "select", options: tplOpts })));
        b.append(row("Titre", bind(getObj, "title", { type: "text", placeholder: id === "intro" ? "ex. Le marketing chez Desjardins" : "Merci !" })));
        b.append(row("Sous-titre", bind(getObj, "subtitle", { type: "text", placeholder: "ex. Gestion · Groupe 1020" })));
        if (withNames) b.append(row("Noms", bind(getObj, "names", { type: "textarea", rows: 2, placeholder: "Un nom par ligne ou séparés par des virgules" })));
        b.append(row("Durée", bind(getObj, "dur", { type: "range", min: 2, max: 12, step: 0.5, unit: " s" })));
      }, { badge: getObj().on ? "activée" : "" });
      root.append(cardGroup("intro", "🎬 Intro", () => store.project.intro, true));
      root.append(cardGroup("outro", "🏁 Outro", () => store.project.outro, true));
      root.append(group("mcards", "👤 Cartes de membre", b => {
        const g = () => store.project.memberCards;
        b.append(hint("Une carte avec le nom apparaît automatiquement quand une nouvelle personne commence à parler."));
        b.append(row("Afficher", bind(g, "on", { type: "check" })));
        b.append(row("Modèle", bind(g, "template", { type: "select", options: tplOpts })));
        b.append(row("Durée", bind(g, "dur", { type: "range", min: 0.8, max: 5, step: 0.1, unit: " s" })));
      }, { badge: store.project.memberCards.on ? "activées" : "" }));
    },
  });
}
