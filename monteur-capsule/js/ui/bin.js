// bin.js — "Médias": drop zones (media + presentation) and the clip bin.
import { store, newTalkPart, newExtractPart, fmtTime } from "../state.js";
import { importFiles, loadSlides, removeClip, getImage } from "../media.js";
import { addOverlay } from "./overlays.js";
import { app, selectPart } from "./ctx.js";
import { h, $, mutate, toast, Panel, hint, iconBtn, btn, pickFiles } from "./widgets.js";

const KIND = { video: { ic: "🎬", lab: "Vidéo" }, image: { ic: "🖼️", lab: "Image" }, audio: { ic: "🎵", lab: "Audio" } };
let slidesStatus = "";

export async function doImport(files) {
  if (store.exporting) return;
  files = [...files];
  const pres = files.filter(f => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
  const pptx = files.filter(f => /\.(pptx?|key)$/i.test(f.name));
  const rest = files.filter(f => !pres.includes(f) && !pptx.includes(f));
  if (pptx.length) toast("Exporte ta présentation en PDF (PowerPoint → Fichier → Exporter → PDF), puis glisse le PDF ici.", 6000, "warn");
  if (pres.length) await doSlides(pres);
  if (!rest.length) return;
  try {
    const before = Object.keys(store.project.clips).length;
    const ids = await importFiles(rest) || [];
    const added = Object.keys(store.project.clips).length - before;
    if (ids.length) toast(added < ids.length ? `${ids.length} fichier(s) prêt(s) · ${ids.length - added} re-lié(s) ✔` : `${ids.length} fichier(s) importé(s) ✔`);
    // first talking video → make it a part right away (friendly start)
    if (!store.project.parts.length) {
      const v = ids.map(id => store.project.clips[id]).find(c => c && c.kind === "video");
      if (v) addPart(v.id, "talk", { quiet: true });
    }
  } catch (e) { console.error(e); toast(e.message || "Import impossible.", 6000, "warn"); }
}
export async function doSlides(files) {
  if (store.exporting) return;
  slidesStatus = "Chargement…"; app.refreshAll();
  try { await loadSlides([...files]); slidesStatus = ""; toast(`Présentation chargée : ${store.slides.length} diapo(s) ✔`); }
  catch (e) {
    console.error(e); slidesStatus = "";
    const old = /withResolvers|Unexpected token|import/i.test(String(e && e.message));
    toast(old ? "Navigateur trop ancien pour lire le PDF : mets-le à jour ou exporte tes diapos en images." : "Erreur en lisant la présentation : " + (e.message || e), 7000, "warn");
  }
  app.refreshAll();
}

/** Every place a clip is used: [{label}] (parts, 2nd person, B-roll, slide videos, music). */
export function clipUses(id) {
  const P = store.project, out = [];
  for (const p of P.parts) {
    if (p.clipId === id) out.push(p.type === "extract" ? "extrait" : "partie");
    if (p.camB && p.camB.clipId === id) out.push("2e personne");
    for (const o of p.overlays || []) if (o.type === "broll" && o.clipId === id) out.push("B-roll");
  }
  for (const v of P.slideVideos) if (v.clipId === id) out.push("vidéo de diapo");
  if (P.music.clipId === id) out.push("musique");
  return out;
}
export function addPart(clipId, type, { quiet = false } = {}) {
  const c = store.project.clips[clipId]; if (!c) return;
  const part = type === "extract" ? newExtractPart(clipId, c) : newTalkPart(clipId, c);
  if (type === "extract") part.label = c.name.replace(/\.[^.]+$/, "").slice(0, 40) || "Extrait";
  mutate(() => {
    const idx = store.project.parts.findIndex(p => p.id === store.selectedPartId);
    if (idx >= 0 && idx < store.project.parts.length - 1) store.project.parts.splice(idx + 1, 0, part); else store.project.parts.push(part);
    store.selectedPartId = part.id;
  });
  if (!quiet) toast(type === "extract" ? "Extrait ajouté à la séquence ✔" : "Partie ajoutée à la séquence ✔ · donne-lui un nom dans l'inspecteur");
  selectPart(part.id);
}

function setupDrop(zone, accept, handler) {
  zone.addEventListener("click", async () => { const f = await pickFiles(accept, true); if (f.length) handler(f); });
  zone.addEventListener("keydown", async e => { if (e.key === "Enter") { const f = await pickFiles(accept, true); if (f.length) handler(f); } });
  zone.addEventListener("dragover", e => { e.preventDefault(); e.stopPropagation(); zone.classList.add("over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("over"));
  zone.addEventListener("drop", e => { e.preventDefault(); e.stopPropagation(); zone.classList.remove("over"); if (e.dataTransfer.files.length) handler([...e.dataTransfer.files]); });
}

function thumbFor(c) {
  const box = h("div.cthumb." + c.kind, { text: KIND[c.kind]?.ic || "📄" });
  if (c.kind === "image" && c.linked) {
    try {
      const bmp = getImage(c.id);
      if (bmp && bmp.width) {
        const cv = h("canvas", { width: 96, height: 54 }); const x = cv.getContext("2d");
        const s = Math.max(96 / bmp.width, 54 / bmp.height); x.drawImage(bmp, (96 - bmp.width * s) / 2, (54 - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
        box.textContent = ""; box.append(cv);
      }
    } catch (e) { }
  }
  return box;
}

export function createBinPanel(el) {
  return new Panel(el, {
    key: () => Object.values(store.project.clips).map(c => c.id + c.linked + (c.duration | 0) + ":" + clipUses(c.id).length).join(",") + "|" + store.slides.length + slidesStatus + "|" + store.project.music.clipId + "|" + store.project.parts.map(p => p.clipId).join(","),
    build: root => {
      const dz = h("div.drop", { tabindex: 0, role: "button", "aria-label": "Importer des médias" },
        h("div.dropic", { text: "＋" }), h("b", { text: "Vidéos, photos, musique" }), h("span.hint", { text: "Glisse tes fichiers ici ou clique · MP4, MOV, JPG, PNG, MP3…" }));
      setupDrop(dz, "video/*,image/*,audio/*,.mov,.mkv,.m4a,.mp3,.wav", doImport);
      const ns = store.slides.length;
      const pz = h("div.drop.pres" + (ns ? ".ok" : ""), { tabindex: 0, role: "button", "aria-label": "Importer la présentation" },
        h("div.dropic", { text: ns ? "✔" : "▤" }), h("b", { text: ns ? `Présentation · ${ns} diapo${ns > 1 ? "s" : ""}` : "Ta présentation" }),
        h("span.hint", { text: slidesStatus || (ns ? "Clique pour la remplacer" : "PDF (PowerPoint → Exporter → PDF) ou images des diapos") }));
      setupDrop(pz, "application/pdf,image/*", doSlides);
      root.append(h("div.drops", dz, pz));

      const clips = Object.values(store.project.clips);
      if (!clips.length) { root.append(hint("Commence par ta vidéo (celle filmée au cell) : elle devient la 1<sup>re</sup> partie.")); return; }
      const list = h("div.bin");
      for (const c of clips) {
        const uses = clipUses(c.id), used = uses.length;
        const meta = [KIND[c.kind]?.lab || c.kind, c.duration ? fmtTime(c.duration) : null, c.width ? `${c.width}×${c.height}` : null].filter(Boolean).join(" · ");
        const acts = h("div.cacts");
        if (c.kind === "video") {
          acts.append(btn("+ Partie", () => addPart(c.id, "talk"), { cls: "sm", title: "Quelqu'un qui présente (avec diapos)" }),
            btn("+ Extrait", () => addPart(c.id, "extract"), { cls: "sm", title: "Extrait d'entrevue (plein écran)" }),
            btn("B-roll ici", () => addOverlay("broll", c.id), { cls: "sm ghost", title: "Par-dessus la vidéo, au moment actuel" }));
        } else if (c.kind === "image") {
          acts.append(btn("B-roll ici", () => addOverlay("broll", c.id), { cls: "sm", title: "Photo par-dessus la vidéo, au moment actuel" }));
        } else if (c.kind === "audio") {
          const isMusic = store.project.music.clipId === c.id;
          acts.append(btn(isMusic ? "✔ Musique" : "Comme musique", () => mutate(() => { store.project.music.clipId = isMusic ? null : c.id; }), { cls: "sm" + (isMusic ? " on" : ""), title: isMusic ? "Retirer la musique" : "Musique de fond" }));
        }
        acts.append(iconBtn("🗑", "Supprimer ce média (et ce qui l'utilise)", () => {
          const u = clipUses(c.id);
          if (u.length && !confirm(`« ${c.name} » est utilisé ${u.length} fois (${[...new Set(u)].join(", ")}). Tout ce qui l'utilise sera retiré. Supprimer quand même ?`)) return;
          if (!store.exporting) removeClip(c.id);
        }, "del"));
        list.append(h("div.clip" + (c.linked ? "" : ".unlinked"), thumbFor(c),
          h("div.cinfo", h("div.cname", { text: c.name, title: c.fileName || c.name }),
            h("div.cmeta", meta, used ? h("span.tag", { text: `utilisé ${used}×`, title: [...new Set(uses)].join(", ") }) : null, c.linked ? null : h("span.tag.warn", { text: "non lié", title: "Ré-importe ce fichier pour continuer" }))),
          acts));
      }
      root.append(list);
    },
  });
}
