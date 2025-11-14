// routes/admin.devis.routes.js
import { Router } from "express";
import auth, { only } from "../middleware/auth.js";
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
import DevisTraction    from "../models/DevisTraction.js";
import DevisTorsion     from "../models/DevisTorsion.js";
import DevisCompression from "../models/DevisCompression.js";
import DevisGrille      from "../models/DevisGrille.js";
import DevisFilDresse   from "../models/DevisFilDresse.js";
import DevisAutre       from "../models/DevisAutre.js";

// helpers
const safeInt = (v, def, min = 1, max = 100) => {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
};
const esc = (s = "") => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isValidDate = (d) => d instanceof Date && !Number.isNaN(+d);

router.get("/devis/all", auth, only("admin"), async (req, res) => {
  try {
    const page  = safeInt(req.query.page ?? "1", 1, 1, 1e6);
    const limit = safeInt(req.query.limit ?? "20", 20, 1, 100);
    const q     = String(req.query.q || "").trim();
    const type  = String(req.query.type || "all").toLowerCase();

    const from  = req.query.from ? new Date(req.query.from) : null;
    const to    = req.query.to   ? new Date(req.query.to)   : null;

    const rx = q ? new RegExp(esc(q), "i") : null;

    const dateMatch = {};
    if (isValidDate(from)) dateMatch.$gte = from;
    if (isValidDate(to))   dateMatch.$lte = to;

    const baseMatch = {};
    if (Object.keys(dateMatch).length) baseMatch.createdAt = dateMatch;
    if (rx) baseMatch.numero = rx;

    const SOURCES = [
      { kind: "traction",    Model: DevisTraction,    enabled: type === "all" || type === "traction" },
      { kind: "torsion",     Model: DevisTorsion,     enabled: type === "all" || type === "torsion"  },
      { kind: "compression", Model: DevisCompression, enabled: type === "all" || type === "compression" },
      { kind: "grille",      Model: DevisGrille,      enabled: type === "all" || type === "grille" },
      { kind: "fil",         Model: DevisFilDresse,   enabled: type === "all" || type === "fil" },
      { kind: "autre",       Model: DevisAutre,       enabled: type === "all" || type === "autre" },
    ].filter(s => s.enabled);

    const results = await Promise.all(
      SOURCES.map(async ({ kind, Model }) => {
        // projection légère pour éviter de charger de gros buffers si inutile
        const rows = await Model.find(baseMatch, {
          numero: 1, type: 1, createdAt: 1, updatedAt: 1,
          user: 1, spec: 1, exigences: 1, remarques: 1,
          documents: 1, demandePdf: 1,
        })
        .populate("user", "prenom nom email numTel")
        .sort("-createdAt")
        .lean();

        return rows.map(it => {
          const docs = Array.isArray(it.documents) ? it.documents : [];
          const mappedDocs = docs.map((d, idx) => {
            const buf = d?.data; // mongoose Buffer ou undefined
            const size = Buffer.isBuffer(buf) ? buf.length : 0;
            return {
              index: idx,
              filename: d?.filename,
              mimetype: d?.mimetype,
              size,
              hasData: size > 0,
            };
          });

          const demandeBuf = it?.demandePdf?.data;
          const hasDemandePdf = Buffer.isBuffer(demandeBuf) && demandeBuf.length > 0;

          return {
            _id: it._id,
            numero: it.numero,
            type: it.type || kind,
            kind,
            createdAt: it.createdAt,
            updatedAt: it.updatedAt,
            user: it.user || null,
            spec: it.spec,
            exigences: it.exigences,
            remarques: it.remarques,
            documents: mappedDocs,
            hasDemandePdf,
          };
        });
      })
    );

    let all = results.flat();

    // filtre mémoire sur utilisateur si q fourni
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

    all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const total = all.length;
    const start = (page - 1) * limit;
    const items = all.slice(start, start + limit);

    res.json({
      success: true,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      items,
    });
  } catch (e) {
    console.error("GET /api/admin/devis/all error:", e?.message);
    if (e?.stack) console.error(e.stack);
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
