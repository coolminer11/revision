// extras.js — "Musique", "Temps", "Chapitres YouTube", "Miniature YouTube".
import { store, stats, chapters, chaptersText, fmtTime, program, clipById } from "../state.js";
import { app, isSource, frameInfo } from "./ctx.js";
import { MEMBER_COLORS } from "./sequence.js";
import { h, mutate, toast, Panel, bind, row, hint, btn, onSync, copyText, download, esc } from "./widgets.js";

/* ---------------- music ---------------- */
export function createMusicPanel(el) {
  const g = () => store.project.music;
  return new Panel(el, {
    key: () => Object.values(store.project.clips).filter(c => c.kind === "audio").map(c => c.id).join(",") + "|" + !!g().clipId,
    build: root => {
      const audios = Object.values(store.project.clips).filter(c => c.kind === "audio");
      if (!audios.length) { root.append(hint("Importe un fichier audio (MP3, M4A…) dans « Médias » pour ajouter une musique de fond.")); return; }
      root.append(row("Musique", bind(g, "clipId", { type: "select", options: () => [["", "— aucune —"], ...Object.values(store.project.clips).filter(c => c.kind === "audio").map(c => [c.id, c.name])], fromUI: v => v || null })));
      if (!g().clipId) return;
      root.append(row("Volume", bind(g, "volume", { type: "range", min: 0, max: 1, step: 0.01, fmt: v => Math.round(v * 100) + " %", reset: 0.35 })));
      root.append(row("Baisse pendant la voix", bind(g, "duck", { type: "range", min: 0, max: 100, step: 5, toUI: v => Math.round((1 - (v ?? 0.3)) * 100), fromUI: v => Math.round((1 - v / 100) * 100) / 100, unit: " %", title: "La musique baisse automatiquement quand quelqu'un parle" })));
      root.append(row("Fondu début / fin", bind(g, "fadeIn", { type: "number", min: 0, max: 15, step: 0.5, digits: 1, label: "Fondu d'entrée (s)" }), bind(g, "fadeOut", { type: "number", min: 0, max: 15, step: 0.5, digits: 1, label: "Fondu de sortie (s)" }), h("span.hint", { text: "s" })));
      root.append(row("En boucle", bind(g, "loop", { type: "check" })));
      root.append(hint("La musique baisse toute seule quand quelqu'un parle — plus le % est haut, plus elle baisse."));
    },
  });
}

/* ---------------- time ---------------- */
function bar(frac, cls = "") {
  return h("div.meter" + (cls ? "." + cls : ""), h("i", { style: { width: Math.max(0, Math.min(100, frac * 100)) + "%" } }));
}
export function createTimePanel(el) {
  return new Panel(el, {
    key: () => "time",
    build: root => {
      const top = h("div.timebig");
      const totalBar = h("div.meter.big", h("i"), h("b.tick"));
      const members = h("div.members");
      const ext = h("div");
      const targetRow = row("Durée visée", bind(() => store.project, "target", { type: "number", min: 0, max: 120, step: 0.5, digits: 1, toUI: v => (v || 0) / 60, fromUI: v => Math.round(v * 60), label: "Durée visée (minutes)" }), h("span.hint", { text: "min (0 = aucune)" }));
      const limRow = row("Limite d'extraits", bind(() => store.project, "extractLimit", { type: "number", min: 0, max: 600, step: 5, digits: 0, label: "Limite d'extraits (s)" }), h("span.hint", { text: "s (0 = aucune)" }));
      root.append(top, totalBar, targetRow, h("div.sub", h("span", { text: "Temps de parole par membre" })), members, h("div.sub", h("span", { text: "Extraits d'entrevue" })), ext, limRow);
      const upd = () => {
        const st = stats();
        const over = st.target && st.total > st.target;
        const near = st.target && !over && st.total > st.target * 0.92;
        top.innerHTML = `<span class="tnum ${over ? "bad" : near ? "ok" : ""}">${fmtTime(st.total)}</span><span class="hint"> / ${st.target ? fmtTime(st.target) : "—"}</span>` +
          (st.target ? `<span class="tdiff ${over ? "bad" : ""}">${over ? "+" + fmtTime(st.total - st.target) + " de trop" : fmtTime(st.target - st.total) + " restantes"}</span>` : "");
        const frac = st.target ? st.total / Math.max(st.target, st.total) : 1;
        totalBar.querySelector("i").style.width = (frac * 100) + "%";
        totalBar.className = "meter big" + (over ? " bad" : near ? " ok" : "");
        totalBar.querySelector(".tick").style.left = st.target && over ? (st.target / st.total * 100) + "%" : "100%";
        const maxT = Math.max(1, ...st.perMember.map(m => m.talk));
        members.replaceChildren(...(st.perMember.length ? st.perMember.map((m, i) => h("div.mrow",
          h("span.mname", h("i", { style: { background: m.color || MEMBER_COLORS[i % MEMBER_COLORS.length] } }), m.name),
          h("div.meter.thin", h("i", { style: { width: (m.talk / maxT * 100) + "%", background: m.color || MEMBER_COLORS[i % MEMBER_COLORS.length] } })),
          h("span.mono.hint", { text: fmtTime(m.talk) }))) : [hint("Personne n'a encore parlé.")]));
        const lim = st.extractLimit, eo = lim && st.extracts > lim;
        ext.replaceChildren(h("div.mrow", h("span.mname", { text: "Total" }), bar(lim ? st.extracts / Math.max(lim, st.extracts) : (st.extracts ? 1 : 0), eo ? "thin.bad" : "thin.orange"),
          h("span.mono" + (eo ? ".badtxt" : ".hint"), { text: `${fmtTime(st.extracts, true)}${lim ? " / " + lim + " s" : ""}` })));
        if (eo) ext.append(h("div.callout.warn", { text: `Les extraits dépassent la limite de ${Math.round(st.extracts - lim)} s.` }));
      };
      upd(); onSync(upd);
    },
  });
}
/** Compact time pill in the transport bar. */
export function updateTimePill() {
  const el = document.getElementById("timePill"); if (!el) return;
  const st = stats(); const over = st.target && st.total > st.target;
  const txt = `${fmtTime(st.total)}${st.target ? " / " + fmtTime(st.target) : ""}`;
  if (el.textContent !== txt) el.textContent = txt;
  el.classList.toggle("bad", !!over);
  el.title = st.target ? (over ? `Trop long de ${fmtTime(st.total - st.target)}` : `Il reste ${fmtTime(st.target - st.total)} avant la durée visée`) : "Durée totale du montage";
}

/* ---------------- chapters ---------------- */
export function createChaptersPanel(el) {
  return new Panel(el, {
    key: () => "ch",
    build: root => {
      const pre = h("div.chapters");
      const copy = btn("📋 Copier pour YouTube", async () => {
        const list = chapters();
        if (list.length < 3) toast("YouTube demande au moins 3 chapitres (de 10 s ou plus).", 3500);
        const ok = await copyText(chaptersText(list));
        toast(ok ? "Chapitres copiés ✔ Colle-les dans la description YouTube." : "Copie impossible : sélectionne le texte à la main.");
      }, { cls: "sm" });
      root.append(hint("Générés à partir de l'intro, des cartes de membre, des extraits et des titres de diapos (PDF)."), pre, h("div.btnrow", copy));
      const upd = () => {
        const list = chapters();
        const html = list.length ? list.map(c => `<div class="chap" data-t="${c.t}"><span class="mono">${fmtTime(c.t)}</span> ${esc(c.title)}</div>`).join("") : `<div class="hint">Aucun chapitre pour l'instant.</div>`;
        if (pre.innerHTML !== html) { pre.innerHTML = html; pre.querySelectorAll(".chap").forEach(d => d.onclick = () => { if (!isSource() && app.engine) app.engine.seek(+d.dataset.t); }); }
      };
      upd(); onSync(upd);
    },
  });
}

/* ---------------- thumbnail ---------------- */
let thumbTimer = 0, thumbUrl = null, thumbBusy = false;
export function createThumbPanel(el, isOpen) {
  const g = () => store.project.thumbnail;
  const img = h("img.thumbprev", { alt: "Aperçu de la miniature" });
  const refresh = () => {
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(async () => {
      if (!isOpen() || store.exporting || !app.engine || !app.engine.thumbnailBlob) return;
      if (thumbBusy || app.engine.playing) { refresh(); return; }   // thumbnailBlob() seeks/pauses: wait until playback stops
      thumbBusy = true;
      try { const b = await app.engine.thumbnailBlob(); if (b) { if (thumbUrl) URL.revokeObjectURL(thumbUrl); thumbUrl = URL.createObjectURL(b); img.src = thumbUrl; } }
      catch (e) { console.warn("miniature", e); }
      thumbBusy = false;
    }, 450);
  };
  const p = new Panel(el, {
    key: () => "thumb",
    build: root => {
      root.append(h("div.thumbwrap", img));
      root.append(h("div.btnrow",
        btn("📍 Utiliser ce moment", () => {
          if (isSource()) return toast("Passe en vue programme pour choisir le moment.");
          const t = frameInfo().outT ?? app.engine.time;
          mutate(() => { g().outT = Math.round(t * 100) / 100; });
          toast(`Miniature : image à ${fmtTime(t, true)}`);
        }, { cls: "sm", title: "Prend l'image actuelle du montage" }),
        h("span.hint.mono", { text: "" })));
      const tlab = root.querySelector(".btnrow .mono");
      onSync(() => { tlab.textContent = "à " + fmtTime(g().outT || 0, true); refresh(); });
      tlab.textContent = "à " + fmtTime(g().outT || 0, true);
      root.append(row("Titre", bind(g, "title", { type: "text", placeholder: "ex. LE MARKETING EXPLIQUÉ" })));
      root.append(row("Sous-titre", bind(g, "sub", { type: "text", placeholder: "ex. en 10 minutes" })));
      root.append(row("Style", bind(g, "style", { type: "seg", options: [["bold", "Percutant"], ["clean", "Épuré"]] })));
      root.append(h("div.btnrow", btn("⬇️ Télécharger PNG", async () => {
        try { const b = await app.engine.thumbnailBlob(); const u = URL.createObjectURL(b); download(u, "miniature_youtube.png"); setTimeout(() => URL.revokeObjectURL(u), 4000); toast("Miniature téléchargée ✔ (1280×720)"); }
        catch (e) { toast("Impossible de créer la miniature : " + (e.message || e)); }
      }, { cls: "primary sm" })));
      refresh();
    },
  });
  p.kick = refresh;
  return p;
}
