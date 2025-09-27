// controllers/devis.controller.js
import path from "path";
import fs from "fs";
import { promises as fsp } from "fs";
import mongoose from "mongoose";

import Devis from "../models/Devis.js";

// Demandes (pour créer un devis depuis une demande)
import DemandeDevisAutre from "../models/DevisAutre.js";
import DemandeDevisCompression from "../models/DevisCompression.js";
import DemandeDevisTraction from "../models/DevisTraction.js";

// Devis "métier" (pour la recherche de numéros cross-collections)
import DevisCompression from "../models/DevisCompression.js";
import DevisTraction from "../models/DevisTraction.js";
import DevisTorsion from "../models/DevisTorsion.js";
import DevisFilDresse from "../models/DevisFilDresse.js";
import DevisGrille from "../models/DevisGrille.js";
import DevisAutre from "../models/DevisAutre.js";

// Reclamation (pour streamReclamationPdf)
import Reclamation from "../models/reclamation.js";

import { previewDevisNumber, nextDevisNumber } from "../utils/numbering.js";
import Article from "../models/Article.js";
import { buildDevisPDF } from "../utils/pdf.devis.js";
import { makeTransport } from "../utils/mailer.js";

// 👉 BASE publique du backend
const ORIGIN =
  process.env.PUBLIC_BACKEND_URL ||
  `http://localhost:${process.env.PORT }`;

const toNum = (v) => Number(String(v ?? "").replace(",", "."));

// ======== A) NUMÉROS SUR TOUTES LES COLLECTIONS DEVIS ========

const MODELS = [
  DevisCompression,
  DevisTraction,
  DevisTorsion,
  DevisFilDresse,
  DevisGrille,
  DevisAutre,
];

// ✅ Admin: stream PDF par numéro
export async function adminPdfByNumero(req, res) {
  try {
    const { numero } = req.params;
    if (!numero) {
      return res.status(400).json({ success: false, message: "numero requis" });
    }

    const filename = `${numero}.pdf`;
    const abs = path.resolve(process.cwd(), "storage/devis", filename);

    // 1) S'il existe sur disque -> stream
    try {
      await fsp.access(abs, fs.constants.R_OK);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
      return fs.createReadStream(abs).pipe(res);
    } catch {
      // pas sur disque, on tente la base
    }

    // 2) Fallback DB (si tu stockes aussi le PDF en DB)
    const devis = await Devis.findOne({ numero }, { pdf: 1 }).lean();
    const raw = devis?.pdf?.data ?? devis?.pdf ?? null;
    if (!raw) {
      return res
        .status(404)
        .json({ success: false, message: "PDF introuvable" });
    }

    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    res.setHeader("Content-Type", devis?.pdf?.contentType || "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    return res.end(buf);
  } catch (e) {
    console.error("adminPdfByNumero:", e);
    return res
      .status(500)
      .json({ success: false, message: e.message || "Erreur serveur" });
  }
}

// ✅ Stream PDF de réclamation (utilise le modèle Reclamation)
export async function streamReclamationPdf(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "id invalide" });
    }

    const rec = await Reclamation.findById(id).select(
      "+demandePdf.data demandePdf.contentType demandePdf.generatedAt"
    );

    if (!rec || !rec.demandePdf?.data?.length) {
      return res
        .status(404)
        .json({ success: false, message: "PDF introuvable" });
    }

    const buf = rec.demandePdf.data;
    res.setHeader("Content-Type", rec.demandePdf.contentType || "application/pdf");
    res.setHeader("Content-Length", buf.length);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=300"); // 5 min
    res.setHeader(
      "Content-Disposition",
      `inline; filename="reclamation-${rec._id}.pdf"`
    );

    return res.end(buf);
  } catch (err) {
    console.error("streamReclamationPdf:", err);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
}

/** GET /api/devis/numeros-all */
export const getAllDevisNumeros = async (req, res) => {
  try {
    const { q, withType } = req.query;
    const limit = Math.min(parseInt(req.query.limit || "500", 10), 5000);
    const regex = q ? new RegExp(q, "i") : null;

    const results = await Promise.all(
      MODELS.map((M) =>
        M.find(regex ? { numero: regex } : {}, "_id numero type").lean()
      )
    );
    const all = results.flat();

    const demandeIds = all.map((d) => d._id).filter(Boolean);
    const numeros = all.map((d) => d.numero).filter(Boolean);

    let haveDevisSet = new Set();
    let hasDevisByNumero = () => false;

    if (demandeIds.length || numeros.length) {
      const existing = await Devis.find(
        {
          $or: [
            demandeIds.length ? { demandeId: { $in: demandeIds } } : null,
            numeros.length ? { demandeNumero: { $in: numeros } } : null,
            numeros.length ? { "meta.demandeNumero": { $in: numeros } } : null,
          ].filter(Boolean),
        },
        "demandeId demandeNumero meta.demandeNumero"
      ).lean();

      const doneIds = existing
        .map((x) => x.demandeId)
        .filter(Boolean)
        .map(String);
      const doneNumeros = new Set(
        existing
          .flatMap((x) => [x.demandeNumero, x?.meta?.demandeNumero])
          .filter(Boolean)
      );

      haveDevisSet = new Set(doneIds);
      hasDevisByNumero = (num) => doneNumeros.has(num);
    }

    const notConverted = all.filter(
      (d) => !haveDevisSet.has(String(d._id)) && !hasDevisByNumero(d.numero)
    );

    const byNumero = new Map();
    for (const d of notConverted) {
      if (d?.numero && !byNumero.has(d.numero)) byNumero.set(d.numero, d);
    }

    let data = Array.from(byNumero.values());
    data.sort((a, b) =>
      String(a.numero).localeCompare(String(b.numero), "fr")
    );
    data = data.slice(0, limit);

    const payload =
      withType === "true"
        ? data.map((d) => ({ numero: d.numero, type: d.type }))
        : data.map((d) => ({ numero: d.numero }));

    return res.json({ success: true, data: payload });
  } catch (err) {
    console.error("Erreur getAllDevisNumeros:", err);
    return res.status(500).json({ success: false, message: "Erreur serveur" });
  }
};

// ======== B) CRÉATION / RÉCUP D'UN DEVIS (depuis demande) ========

const DEMANDE_MODELS = [
  { type: "autre",       Model: DemandeDevisAutre },
  { type: "compression", Model: DemandeDevisCompression },
  { type: "traction",    Model: DemandeDevisTraction },
  { type: "torsion",     Model: DevisTorsion },
  { type: "fil",         Model: DevisFilDresse },
  { type: "grille",      Model: DevisGrille },
];

export const getNextDevisNumberPreview = async (_req, res) => {
  try {
    const numero = await previewDevisNumber();
    return res.json({ success: true, numero });
  } catch (e) {
    console.error("Erreur preview devis:", e);
    return res
      .status(500)
      .json({ success: false, message: "Erreur preview n° devis" });
  }
};

async function findDemandeAny(demandeId) {
  for (const { type, Model } of DEMANDE_MODELS) {
    const doc = await Model.findById(demandeId).populate("user");
    if (doc) return { type, doc };
  }
  return null;
}

// --- GET /api/devis/by-demande (admin light)
export async function getByDemandeAdmin(req, res) {
  try {
    const { id } = req.params;
    const numero = (req.query.numero || "").trim();

    const or = [{ demandeId: id }, { "meta.demandes.id": id }];
    if (numero) {
      or.push(
        { demandeNumero: numero },
        { "meta.demandeNumero": numero },
        { "meta.demandes.numero": numero }
      );
    }

    const devis = await Devis.findOne({ $or: or })
      .select("numero createdAt demandeNumero meta.demandes client.nom")
      .lean();

    if (!devis) return res.json({ success: true, exists: false });

    const demandeNumeros = Array.from(
      new Set(
        [
          devis.demandeNumero,
          devis?.meta?.demandeNumero,
          ...(Array.isArray(devis?.meta?.demandes)
            ? devis.meta.demandes.map((x) => x?.numero).filter(Boolean)
            : []),
        ].filter(Boolean)
      )
    );

    const filename = `${devis.numero}.pdf`;
    const pdf = `${ORIGIN}/files/devis/${filename}`;

    return res.json({
      success: true,
      exists: true,
      devis: { _id: devis._id, numero: devis.numero },
      demandeNumeros,
      pdf,
    });
  } catch (e) {
    console.error("getByDemandeAdmin:", e);
    return res.status(500).json({ success: false, message: "Erreur serveur" });
  }
}

// --- GET /api/devis/by-demande (client)
export const getDevisByDemandeClient = async (req, res) => {
  try {
    const { demandeId } = req.params;
    const numero = (req.query.numero || "").toString().trim().toUpperCase();

    const found = await findDemandeAny(demandeId);
    if (!found) return res.json({ success: false, exists: false });

    // contrôle d'accès basique: propriétaire ou admin
    const ownerId = (found.doc?.user?._id || found.doc?.user)?.toString?.();
    const userId = (req.user?._id || req.user?.id)?.toString?.();
    const isAdmin = req.user?.role === "admin";
    if (!isAdmin && (!ownerId || !userId || ownerId !== userId)) {
      return res.json({ success: false, exists: false });
    }

    const or = [];
    if (mongoose.isValidObjectId(demandeId)) {
      or.push({ demandeId: new mongoose.Types.ObjectId(demandeId) });
    }
    if (numero) {
      or.push({ demandeNumero: numero }, { "meta.demandeNumero": numero });
    }

    const devis = await Devis.findOne({ $or: or }).sort({ createdAt: -1 });
    if (!devis) return res.json({ success: false, exists: false });

    const filename = `${devis.numero}.pdf`;
    const pdf = `${ORIGIN}/files/devis/${filename}`;

    return res.json({
      success: true,
      exists: true,
      devis: { _id: devis._id, numero: devis.numero },
      pdf,
    });
  } catch (e) {
    console.error("getDevisByDemandeClient:", e);
    return res.status(500).json({ success: false, message: "Erreur serveur" });
  }
};

// --- GET /api/devis/by-demande (générique)
export const getDevisByDemande = async (req, res) => {
  try {
    const { demandeId } = req.params;
    const numero = (req.query.numero || "").toString().trim().toUpperCase();

    const or = [];
    if (mongoose.isValidObjectId(demandeId)) {
      or.push({ demandeId: new mongoose.Types.ObjectId(demandeId) });
    }
    if (numero) {
      or.push(
        { demandeNumero: numero },
        { "meta.demandeNumero": numero },
        { "meta.demandes.numero": numero }
      );
    }
    if (!or.length) {
      return res
        .status(400)
        .json({ success: false, message: "Paramètres manquants" });
    }

    const devis = await Devis.findOne({ $or: or })
      .select("numero createdAt")
      .sort({ createdAt: -1 })
      .lean();

    if (!devis) {
      return res.status(200).json({
        success: false,
        exists: false,
        message: "Aucun devis pour cette demande",
      });
    }

    const pdf = `${ORIGIN}/files/devis/${devis.numero}.pdf`;
    return res.json({
      success: true,
      exists: true,
      devis: { _id: devis._id, numero: devis.numero },
      pdf,
    });
  } catch (e) {
    console.error("getDevisByDemande:", e);
    return res.status(500).json({ success: false, message: "Erreur serveur" });
  }
};

// === CRÉER UN DEVIS À PARTIR DE PLUSIEURS DEMANDES (même client) ===
export const createFromDemande = async (req, res) => {
  try {
    const { demandeIds = [], lines = [], sendEmail = true } = req.body;

    // utils محليّة
    const ORIGIN = `${req.protocol}://${req.get("host")}`;
    const toNum = (v) => +Number(v || 0).toFixed(3);
    const SEG_FOR_TYPE = (t) => {
      // عدّلها لو راوت “fil” عندك اسمه fildresse
      if (t === "fildresse") return "fil";
      return t || "autre";
    };

    // 0) Validation
    if (!Array.isArray(demandeIds) || !demandeIds.length) {
      return res.status(400).json({ success: false, message: "demandeIds[] requis" });
    }
    if (!Array.isArray(lines) || !lines.length) {
      return res.status(400).json({ success: false, message: "lines[] requises" });
    }

    // 1) Charger demandes (multi-type)
    const loaded = [];
    for (const id of demandeIds) {
      const found = await findDemandeAny(id);
      if (!found) {
        return res.status(404).json({ success: false, message: `Demande introuvable: ${id}` });
      }
      loaded.push(found); // { type, doc }
    }

    // 2) Même client
    const firstUserId = (loaded[0].doc?.user?._id || loaded[0].doc?.user)?.toString?.();
    const sameClient = loaded.every((f) => (f.doc?.user?._id || f.doc?.user)?.toString?.() === firstUserId);
    if (!sameClient) {
      return res.status(400).json({
        success: false,
        message: "Toutes les demandes doivent appartenir au même client",
      });
    }
    const demandeUser = loaded[0].doc.user;

    // Maps aide
    const numeroById = new Map(loaded.map((f) => [String(f.doc._id), f.doc.numero]));

    // 3) Lignes d’articles
    const itemDocs = [];
    for (const ln of lines) {
      const {
        demandeId,
        demandeNumero,
        articleId,
        qty = 1,
        remisePct = 0,
        tvaPct = 19,
      } = ln || {};

      if (!articleId) {
        return res.status(400).json({ success: false, message: "Chaque ligne doit contenir articleId" });
      }

      const art = await Article.findById(articleId);
      if (!art) {
        return res.status(404).json({ success: false, message: "Article introuvable pour une ligne" });
      }

      // رقم الطلب الخاص بهذه السطر
      let numFromLine = null;
      if (demandeId && mongoose.isValidObjectId(demandeId)) {
        numFromLine = numeroById.get(String(demandeId));
      }
      if (!numFromLine && typeof demandeId === "string" && demandeId.toUpperCase().startsWith("DDV")) {
        numFromLine = demandeId.toUpperCase();
      }
      if (!numFromLine && demandeNumero) numFromLine = String(demandeNumero).toUpperCase();
      if (!numFromLine) numFromLine = loaded[0].doc.numero || "";

      const qte = toNum(qty || 1);
      const puht = toNum(art.prixHT ?? art.priceHT ?? 0);
      const remise = toNum(remisePct || 0);
      const tva = toNum(tvaPct || 0);
      const totalHT = +(qte * puht * (1 - remise / 100)).toFixed(3);

      itemDocs.push({
        reference: art.reference || "",
        designation: art.designation || art.name || art.name_fr || "",
        unite: art.unite || "U",
        quantite: qte,
        puht,
        remisePct: remise,
        tvaPct: tva,
        totalHT,
        demandeNumero: numFromLine,
      });
    }
    if (!itemDocs.length) {
      return res.status(400).json({ success: false, message: "Aucune ligne valide" });
    }

    // 4) Totaux
    const mtht = +itemDocs.reduce((s, it) => s + (it.totalHT || 0), 0).toFixed(3);
    const mtnetht = mtht;
    const mttva = +itemDocs.reduce((s, it) => s + it.totalHT * (toNum(it.tvaPct) / 100), 0).toFixed(3);
    const mfodec = +((mtnetht) * 0.01).toFixed(3);
    const timbre = 0;
    const mttc = +(mtnetht + mttva + mfodec + timbre).toFixed(3);

    // 5) Numéro du devis
    const numero = await nextDevisNumber();

    // 6) Créer devis “central”
    const devis = await Devis.create({
      numero,
      demandeId: loaded[0].doc._id,
      typeDemande: loaded[0].type,
      demandeNumero: loaded[0].doc.numero,
      client: {
        id: demandeUser?._id,
        nom: `${demandeUser?.prenom || ""} ${demandeUser?.nom || ""}`.trim() || demandeUser?.email,
        email: demandeUser?.email,
        adresse: demandeUser?.adresse,
        tel: demandeUser?.numTel,
        codeTVA: demandeUser?.company?.matriculeFiscal,
      },
      items: itemDocs,
      totaux: { mtht, mtnetht, mttva, fodecPct: 1, mfodec, timbre, mttc },
      meta: {
        demandes: loaded.map((x) => ({ id: x.doc._id, numero: x.doc.numero, type: x.type })),
      },
    });

    // 7) PDF (robuste) + fallback
    let pdfUrl = null;
    try {
      const { filename } = await buildDevisPDF(devis);
      const pdfPath = path.resolve(process.cwd(), "storage/devis", filename);
      // تأكّد من وجود static files /files/devis/* في السيرفر
      pdfUrl = `${ORIGIN}/files/devis/${filename}`;
      // ممكن تحتاج تحفظ pdfPath لو تحب تبعت attachment في الإيميل
    } catch (err) {
      // fallback لفتح PDF الطلب الأول
      const seg = SEG_FOR_TYPE(loaded[0].type);
      pdfUrl = `${ORIGIN}/api/devis/${seg}/${loaded[0].doc._id}/pdf`;
      console.error("buildDevisPDF failed, using fallback:", err?.message || err);
    }

    // 8) Email (non-bloquant)
    let email = { sent: false, error: null };
    if (sendEmail && devis.client?.email) {
      try {
        const transport = makeTransport();

        const DEMANDE_ROUTE = {
          autre: "autre",
          compression: "compression",
          traction: "traction",
          torsion: "torsion",
          fil: "fil",    // غيّرها إلى fildresse إذا هذا هو الراوت عندك
          grille: "grille",
        };
        const demandesLinks = loaded.map((x) => {
          const seg = DEMANDE_ROUTE[x.type] || SEG_FOR_TYPE(x.type);
          return { numero: x.doc.numero, url: `${ORIGIN}/api/devis/${seg}/${x.doc._id}/pdf` };
        });
        const subject = `Votre devis ${devis.numero}`;
        const textBody =
          `Bonjour${devis.client?.nom ? " " + devis.client.nom : ""},\n\n` +
          `Veuillez trouver votre devis: ${pdfUrl}\n` +
          (demandesLinks.length ? `Demandes liées: ${demandesLinks.map(d => d.numero).join(", ")}\n` : "") +
          `\nCordialement,\nMTR`;

        await transport.sendMail({
          from: process.env.MAIL_FROM || "devis@mtr.tn",
          to: devis.client.email,
          subject,
          text: textBody,
          // بإمكانك إضافة html و/أو attachment الـPDF النهائي إذا متوفر
        });
        email.sent = true;
      } catch (err) {
        email = {
          sent: false,
          error: { code: err?.code, command: err?.command, message: err?.message },
        };
        // لا نسقط الراوت
        console.error("sendMail failed:", err);
      }
    }

    return res.json({
      success: true,
      devis: { _id: devis._id, numero: devis.numero },
      pdf: pdfUrl,
      email,
    });
  } catch (e) {
    console.error("createFromDemande:", e);
    return res.status(500).json({
      success: false,
      message: "Erreur création devis (multi)",
    });
  }
};

