// routes/admin.devis.routes.js
import { Router } from "express";
import auth, { only } from "../middleware/auth.js";
import DevisTraction from "../models/DevisTraction.js";
import DevisTorsion from "../models/DevisTorsion.js"; // ✅ ajouté
import DevisCompression from "../models/DevisCompression.js"; // ✅ ajouté
const router = Router();


/* ------------------------------------------------------------------
 * 📌 TOUTES LES DEMANDES DE DEVIS (agrégation multi-modèles)
 *    GET /api/admin/devis/all
 *    Query:
 *      - q       : texte (numero, user prénom/nom, email)
 *      - page    : 1..N (défaut 1)
 *      - limit   : 1..100 (défaut 20)
 *      - from    : ISO >= createdAt
 *      - to      : ISO <= createdAt
 *      - type    : 'all' | 'traction' | 'torsion' | 'compression' | 'grille' | 'fil' | 'autre'
 * ------------------------------------------------------------------ */

router.get("/devis/all", auth, only("admin"), async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page ?? "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? "20", 10)));
    const q     = String(req.query.q || "").trim();
    const type  = String(req.query.type || "all").toLowerCase();
    const from  = req.query.from ? new Date(req.query.from) : null;
    const to    = req.query.to   ? new Date(req.query.to)   : null;

    // précompile la regex pour la recherche "numero" + filtres en mémoire (user)
    const rx = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null;

    // Filtre commun sur les dates
    const dateMatch = {};
    if (from && !isNaN(from)) dateMatch.$gte = from;
    if (to && !isNaN(to))     dateMatch.$lte = to;

    // Construit un match Mongo minimal (numero + createdAt). Le reste (user, email) sera filtré en mémoire.
    const baseMatch = {};
    if (Object.keys(dateMatch).length) baseMatch.createdAt = dateMatch;
    if (rx) baseMatch.numero = rx;

    // Table de configuration des modèles à agréger
    const SOURCES = [
      { kind: "traction",   Model: DevisTraction,    enabled: type === "all" || type === "traction" },
      { kind: "torsion",    Model: DevisTorsion,     enabled: type === "all" || type === "torsion"  },
      { kind: "compression",Model: DevisCompression, enabled: type === "all" || type === "compression" },
      { kind: "grille",     Model: DevisGrille,      enabled: type === "all" || type === "grille" },
      { kind: "fil",        Model: DevisFilDresse,   enabled: type === "all" || type === "fil" },
      { kind: "autre",      Model: DevisAutre,       enabled: type === "all" || type === "autre" },
    ].filter(s => s.enabled);

    // Récupère toutes les listes en parallèle
    const results = await Promise.all(
      SOURCES.map(async ({ kind, Model }) => {
        const rows = await Model.find(baseMatch)
          .populate("user", "prenom nom email numTel")
          .sort("-createdAt")
          .lean();

        // mapping minimal commun + drapeaux
        const mapped = rows.map(it => ({
          _id: it._id,
          numero: it.numero,
          type: it.type || kind,           // sécurité : s'il n'y a pas "type" en base
          kind,                             // on conserve la provenance
          createdAt: it.createdAt,
          updatedAt: it.updatedAt,
          user: it.user || null,
          // champs utiles côté admin
          spec: it.spec,
          exigences: it.exigences,
          remarques: it.remarques,
          documents: Array.isArray(it.documents)
            ? it.documents.map((d, idx) => ({
                index: idx,
                filename: d?.filename,
                mimetype: d?.mimetype,
                size: toBuffer(d?.data)?.length || 0,
                hasData: !!(toBuffer(d?.data)?.length),
              }))
            : [],
          hasDemandePdf: !!(toBuffer(it?.demandePdf?.data)?.length),
        }));

        return mapped;
      })
    );

    // Fusion
    let all = results.flat();

    // Filtre mémoire supplémentaire sur q (prénom/nom/email) si fourni
    if (rx) {
      all = all.filter(it => {
        const u = it.user || {};
        return (
          rx.test(it.numero || "") ||
          rx.test(u.prenom || "") ||
          rx.test(u.nom || "") ||
          rx.test(u.email || "")
        );
      });
    }

    // Tri global (desc) par createdAt
    all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const total = all.length;
    const start = (page - 1) * limit;
    const end   = start + limit;
    const items = all.slice(start, end);

    res.json({
      success: true,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      items,
    });
  } catch (e) {
    console.error("GET /api/admin/devis/all error:", e);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});


/** Convertir les données Mongo en Buffer utilisable */
function toBuffer(maybeBinary) {
  if (!maybeBinary) return null;
  if (Buffer.isBuffer(maybeBinary)) return maybeBinary;
  if (maybeBinary.buffer && Buffer.isBuffer(maybeBinary.buffer)) {
    return Buffer.from(maybeBinary.buffer);
  }
  try {
    return Buffer.from(maybeBinary);
  } catch {
    return null;
  }
}

/**
 * -------------------------
 * 📌 TRACTION
 * -------------------------
 */

router.get("/devis/traction", auth, only("admin"), async (req, res) => {
  try {
    const items = await DevisTraction.find({})
      .populate("user", "prenom nom email numTel")
      .sort("-createdAt")
      .lean();

    const mapped = items.map((it) => ({
      _id: it._id,
      numero: it.numero,
      type: it.type,
      createdAt: it.createdAt,
      updatedAt: it.updatedAt,
      user: it.user,
      spec: it.spec,
      exigences: it.exigences,
      remarques: it.remarques,
      documents: (it.documents || []).map((d, idx) => ({
        index: idx,
        filename: d.filename,
        mimetype: d.mimetype,
        size: toBuffer(d?.data)?.length || 0,
        hasData: !!(toBuffer(d?.data)?.length),
      })),
      hasDemandePdf: !!(toBuffer(it?.demandePdf?.data)?.length),
    }));

    res.json({ success: true, items: mapped });
  } catch (e) {
    console.error("GET /api/admin/devis/traction error:", e);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});

router.get("/devis/traction/:id/pdf", auth, only("admin"), async (req, res) => {
  try {
    const devis = await DevisTraction.findById(req.params.id).lean();
    if (!devis) return res.status(404).json({ success: false, message: "Devis introuvable" });

    const buf = toBuffer(devis?.demandePdf?.data);
    if (!buf?.length) return res.status(404).json({ success: false, message: "PDF non trouvé" });

    res.setHeader("Content-Type", devis.demandePdf.contentType || "application/pdf");
    res.setHeader("Content-Length", buf.length);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="devis-traction-${req.params.id}.pdf"`
    );
    res.end(buf);
  } catch (e) {
    console.error("GET /api/admin/devis/traction/:id/pdf error:", e);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});

router.get("/devis/traction/:id/document/:index", auth, only("admin"), async (req, res) => {
  const devis = await DevisTraction.findById(req.params.id).lean();
  if (!devis || !Array.isArray(devis.documents))
    return res.status(404).json({ success: false, message: "Document non trouvé" });

  const doc = devis.documents[parseInt(req.params.index, 10)];
  if (!doc) return res.status(404).json({ success: false, message: "Document inexistant" });

  const buf = toBuffer(doc.data);
  if (!buf?.length) return res.status(404).json({ success: false, message: "Contenu du document vide" });

  res.setHeader("Content-Type", doc.mimetype || "application/octet-stream");
  res.setHeader("Content-Length", buf.length);
  res.setHeader("Content-Disposition", `inline; filename="${doc.filename || "document"}"`);
  res.end(buf);
});

/**
 * -------------------------
 * 📌 TORSION
 * -------------------------
 */
router.get("/devis/torsion", auth, only("admin"), async (req, res) => {
  try {
    const items = await DevisTorsion.find({})
      .populate("user", "prenom nom email numTel")
      .sort("-createdAt")
      .lean();

    const mapped = items.map((it) => ({
      _id: it._id,
      numero: it.numero,
      type: it.type,
      createdAt: it.createdAt,
      updatedAt: it.updatedAt,
      user: it.user,
      spec: it.spec,
      exigences: it.exigences,
      remarques: it.remarques,
      documents: (it.documents || []).map((d, idx) => ({
        index: idx,
        filename: d.filename,
        mimetype: d.mimetype,
        size: toBuffer(d?.data)?.length || 0,
        hasData: !!(toBuffer(d?.data)?.length),
      })),
      hasDemandePdf: !!(toBuffer(it?.demandePdf?.data)?.length),
    }));

    res.json({ success: true, items: mapped });
  } catch (e) {
    console.error("GET /api/admin/devis/torsion error:", e);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});

// routes/admin.devis.routes.js  -> GET /api/devis/torsion/:id/pdf
router.get("/devis/torsion/:id/pdf", auth, only("admin"), async (req, res) => {
  try {
    const devis = await DevisTorsion.findById(req.params.id).lean();
    if (!devis) return res.status(404).json({ success: false, message: "Devis introuvable" });

    const buf = toBuffer(devis?.demandePdf?.data);
    if (!buf?.length) return res.status(404).json({ success: false, message: "PDF non trouvé" });

    // ⬇️ اسم الملف فقط
    const numero = devis.numero || req.params.id;
    const filename = `devis-torsion-${numero}.pdf`;

    res.setHeader("Content-Type", devis.demandePdf.contentType || "application/pdf");
    res.setHeader("Content-Length", buf.length);
    // 👇 هاذي تفرض اسم الملف وقت التحميل
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
    );

    res.end(buf);
  } catch (e) {
    console.error("GET /api/admin/devis/torsion/:id/pdf error:", e);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});



router.get("/devis/torsion/:id/document/:index", auth, only("admin"), async (req, res) => {
  const devis = await DevisTorsion.findById(req.params.id).lean();
  if (!devis || !Array.isArray(devis.documents))
    return res.status(404).json({ success: false, message: "Document non trouvé" });

  const doc = devis.documents[parseInt(req.params.index, 10)];
  if (!doc) return res.status(404).json({ success: false, message: "Document inexistant" });

  const buf = toBuffer(doc.data);
  if (!buf?.length) return res.status(404).json({ success: false, message: "Contenu du document vide" });

  res.setHeader("Content-Type", doc.mimetype || "application/octet-stream");
  res.setHeader("Content-Length", buf.length);
  res.setHeader("Content-Disposition", `inline; filename="${doc.filename || "document"}"`);
  res.end(buf);
});

/* ------------------------------------------------------------------
 * 📌 COMPRESSION  ✅ NOUVEAU
 * ------------------------------------------------------------------ */
router.get("/devis/compression", auth, only("admin"), async (req, res) => {
  try {
    const items = await DevisCompression.find({})
      .populate("user", "prenom nom email numTel")
      .sort("-createdAt")
      .lean();

    const mapped = items.map((it) => ({
      _id: it._id,
      numero: it.numero,
      type: it.type,
      createdAt: it.createdAt,
      updatedAt: it.updatedAt,
      user: it.user,
      spec: it.spec,
      exigences: it.exigences,
      remarques: it.remarques,
      documents: (it.documents || []).map((d, idx) => ({
        index: idx,
        filename: d.filename,
        mimetype: d.mimetype,
        size: toBuffer(d?.data)?.length || 0,
        hasData: !!(toBuffer(d?.data)?.length),
      })),
      hasDemandePdf: !!(toBuffer(it?.demandePdf?.data)?.length),
    }));

    res.json({ success: true, items: mapped });
  } catch (e) {
    console.error("GET /api/admin/devis/compression error:", e);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});

router.get("/devis/compression/:id/pdf", auth, only("admin"), async (req, res) => {
  try {
    const devis = await DevisCompression.findById(req.params.id).lean();
    if (!devis) return res.status(404).json({ success: false, message: "Devis introuvable" });

    const buf = toBuffer(devis?.demandePdf?.data);
    if (!buf?.length) return res.status(404).json({ success: false, message: "PDF non trouvé" });

    res.setHeader("Content-Type", devis.demandePdf.contentType || "application/pdf");
    res.setHeader("Content-Length", buf.length);
    res.setHeader("Content-Disposition", `inline; filename="devis-compression-${req.params.id}.pdf"`);
    res.end(buf);
  } catch (e) {
    console.error("GET /api/admin/devis/compression/:id/pdf error:", e);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});

router.get("/devis/compression/:id/document/:index", auth, only("admin"), async (req, res) => {
  const devis = await DevisCompression.findById(req.params.id).lean();
  if (!devis || !Array.isArray(devis.documents))
    return res.status(404).json({ success: false, message: "Document non trouvé" });

  const doc = devis.documents[parseInt(req.params.index, 10)];
  if (!doc) return res.status(404).json({ success: false, message: "Document inexistant" });

  const buf = toBuffer(doc.data);
  if (!buf?.length) return res.status(404).json({ success: false, message: "Contenu du document vide" });

  res.setHeader("Content-Type", doc.mimetype || "application/octet-stream");
  res.setHeader("Content-Length", buf.length);
  res.setHeader("Content-Disposition", `inline; filename="${doc.filename || "document"}"`);
  res.end(buf);
});

// routes/admin.devis.routes.js (extrait – ajoute ce bloc GRILLE)
import DevisGrille from "../models/DevisGrille.js";






// util binaire déjà défini: toBuffer(...)

/** -------------------------
 * 📌 GRILLE
 * ------------------------- */
router.get("/devis/grille", auth, only("admin"), async (req, res) => {
  try {
    const items = await DevisGrille.find({})
      .populate("user", "prenom nom email numTel")
      .sort("-createdAt")
      .lean();

    const mapped = items.map((it) => ({
      _id: it._id,
      numero: it.numero,
      type: it.type,
      createdAt: it.createdAt,
      updatedAt: it.updatedAt,
      user: it.user,
      spec: it.spec,
      exigences: it.exigences,
      remarques: it.remarques,
      documents: (it.documents || []).map((d, idx) => ({
        index: idx,
        filename: d.filename,
        mimetype: d.mimetype,
        size: toBuffer(d?.data)?.length || 0,
        hasData: !!(toBuffer(d?.data)?.length),
      })),
      hasDemandePdf: !!(toBuffer(it?.demandePdf?.data)?.length),
    }));

    res.json({ success: true, items: mapped });
  } catch (e) {
    console.error("GET /api/admin/devis/grille error:", e);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});

router.get("/devis/grille/:id/pdf", auth, only("admin"), async (req, res) => {
  try {
    const devis = await DevisGrille.findById(req.params.id).lean();
    if (!devis) return res.status(404).json({ success: false, message: "Devis introuvable" });

    const buf = toBuffer(devis?.demandePdf?.data);
    if (!buf?.length) return res.status(404).json({ success: false, message: "PDF non trouvé" });

    res.setHeader("Content-Type", devis.demandePdf.contentType || "application/pdf");
    res.setHeader("Content-Length", buf.length);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="devis-grille-${req.params.id}.pdf"`
    );
    res.end(buf);
  } catch (e) {
    console.error("GET /api/admin/devis/grille/:id/pdf error:", e);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});

router.get("/devis/grille/:id/document/:index", auth, only("admin"), async (req, res) => {
  const devis = await DevisGrille.findById(req.params.id).lean();
  if (!devis || !Array.isArray(devis.documents))
    return res.status(404).json({ success: false, message: "Document non trouvé" });

  const doc = devis.documents[parseInt(req.params.index, 10)];
  if (!doc) return res.status(404).json({ success: false, message: "Document inexistant" });

  const buf = toBuffer(doc.data);
  if (!buf?.length) return res.status(404).json({ success: false, message: "Contenu du document vide" });

  res.setHeader("Content-Type", doc.mimetype || "application/octet-stream");
  res.setHeader("Content-Length", buf.length);
  res.setHeader("Content-Disposition", `inline; filename="${doc.filename || "document"}"`);
  res.end(buf);
});
/** -------------------------
 * 📌 FIL DRESSÉ
 * ------------------------- */
import DevisFilDresse from "../models/DevisFilDresse.js"; // 🔹 adapte le chemin selon ton projet


// 📌 Liste des devis fil dressé
router.get("/devis/fil", auth, only("admin"), async (req, res) => {
  try {
    const items = await DevisFilDresse.find({})
      .populate("user", "prenom nom email numTel")
      .sort("-createdAt")
      .lean();

    const mapped = items.map((it) => ({
      _id: it._id,
      numero: it.numero,
      type: it.type,
      createdAt: it.createdAt,
      updatedAt: it.updatedAt,
      user: it.user,
      spec: it.spec,
      exigences: it.exigences,
      remarques: it.remarques,
      documents: (it.documents || []).map((d, idx) => ({
        index: idx,
        filename: d.filename,
        mimetype: d.mimetype,
        size: toBuffer(d?.data)?.length || 0,
        hasData: !!(toBuffer(d?.data)?.length),
      })),
      hasDemandePdf: !!(toBuffer(it?.demandePdf?.data)?.length),
    }));

    res.json({ success: true, items: mapped });
  } catch (e) {
    console.error("GET /api/admin/devis/fil error:", e);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});

// 📌 Récupération du PDF
router.get("/devis/fil/:id/pdf", auth, only("admin"), async (req, res) => {
  try {
    const devis = await DevisFilDresse.findById(req.params.id).lean();
    if (!devis) return res.status(404).json({ success: false, message: "Devis introuvable" });

    const buf = toBuffer(devis?.demandePdf?.data);
    if (!buf?.length) return res.status(404).json({ success: false, message: "PDF non trouvé" });

    res.setHeader("Content-Type", devis.demandePdf.contentType || "application/pdf");
    res.setHeader("Content-Length", buf.length);
    res.setHeader("Content-Disposition", `inline; filename="devis-fil-${req.params.id}.pdf"`);
    res.end(buf);
  } catch (e) {
    console.error("GET /api/admin/devis/fil/:id/pdf error:", e);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});

// 📌 Récupération d’un document joint
router.get("/devis/fil/:id/document/:index", auth, only("admin"), async (req, res) => {
  const devis = await DevisFilDresse.findById(req.params.id).lean();
  if (!devis || !Array.isArray(devis.documents))
    return res.status(404).json({ success: false, message: "Document non trouvé" });

  const doc = devis.documents[parseInt(req.params.index, 10)];
  if (!doc) return res.status(404).json({ success: false, message: "Document inexistant" });

  const buf = toBuffer(doc.data);
  if (!buf?.length) return res.status(404).json({ success: false, message: "Contenu du document vide" });

  res.setHeader("Content-Type", doc.mimetype || "application/octet-stream");
  res.setHeader("Content-Length", buf.length);
  res.setHeader("Content-Disposition", `inline; filename="${doc.filename || "document"}"`);
  res.end(buf);
});
/** -------------------------
 * 📌 AUTRE ARTICLE
 * ------------------------- */
import DevisAutre from "../models/DevisAutre.js"; // 🔹 adapte le chemin/nom selon ton projet

// 📌 Liste des devis "autre"
router.get("/devis/autre", auth, only("admin"), async (req, res) => {
  try {
    const items = await DevisAutre.find({})
      .populate("user", "prenom nom email numTel")
      .sort("-createdAt")
      .lean();

    const mapped = items.map((it) => ({
      _id: it._id,
      numero: it.numero,
      type: it.type,
      createdAt: it.createdAt,
      updatedAt: it.updatedAt,
      user: it.user,
      spec: it.spec,               // ⚙️ tes champs spécifiques "autre"
      exigences: it.exigences,
      remarques: it.remarques,
      documents: (it.documents || []).map((d, idx) => ({
        index: idx,
        filename: d.filename,
        mimetype: d.mimetype,
        size: toBuffer(d?.data)?.length || 0,
        hasData: !!(toBuffer(d?.data)?.length),
      })),
      hasDemandePdf: !!(toBuffer(it?.demandePdf?.data)?.length),
    }));

    res.json({ success: true, items: mapped });
  } catch (e) {
    console.error("GET /api/admin/devis/autre error:", e);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});

// 📌 Récupération du PDF "autre"
router.get("/devis/autre/:id/pdf", auth, only("admin"), async (req, res) => {
  try {
    const devis = await DevisAutre.findById(req.params.id).lean();
    if (!devis) return res.status(404).json({ success: false, message: "Devis introuvable" });

    const buf = toBuffer(devis?.demandePdf?.data);
    if (!buf?.length) return res.status(404).json({ success: false, message: "PDF non trouvé" });

    res.setHeader("Content-Type", devis.demandePdf.contentType || "application/pdf");
    res.setHeader("Content-Length", buf.length);
    res.setHeader("Content-Disposition", `inline; filename="devis-autre-${req.params.id}.pdf"`);
    res.end(buf);
  } catch (e) {
    console.error("GET /api/admin/devis/autre/:id/pdf error:", e);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});

// 📌 Récupération d’un document joint "autre"
router.get("/devis/autre/:id/document/:index", auth, only("admin"), async (req, res) => {
  try {
    const devis = await DevisAutre.findById(req.params.id).lean();
    if (!devis || !Array.isArray(devis.documents))
      return res.status(404).json({ success: false, message: "Document non trouvé" });

    const idx = parseInt(req.params.index, 10);
    const doc = devis.documents[idx];
    if (!doc) return res.status(404).json({ success: false, message: "Document inexistant" });

    const buf = toBuffer(doc.data);
    if (!buf?.length) return res.status(404).json({ success: false, message: "Contenu du document vide" });

    res.setHeader("Content-Type", doc.mimetype || "application/octet-stream");
    res.setHeader("Content-Length", buf.length);
    res.setHeader("Content-Disposition", `inline; filename="${doc.filename || "document"}"`);
    res.end(buf);
  } catch (e) {
    console.error("GET /api/admin/devis/autre/:id/document/:index error:", e);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});


export default router;
