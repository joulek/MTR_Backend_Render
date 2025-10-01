import Devis from "../models/Devis.js";
import mongoose from "mongoose";
const ORIGIN =
  process.env.PUBLIC_BACKEND_URL ||
  `http://localhost:${process.env.PORT || 4000}`;

// controllers/devis.client.controller.js

const toObjectId = (v) => {
  try {
    return new mongoose.Types.ObjectId(String(v));
  } catch {
    return null;
  }
};

const esc = (s = "") => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * GET /api/client/devis
 * Query:
 *  - q     : recherche (numero, demandes, items.designation)
 *  - page  : 1..N
 *  - limit : 1..100
 *  - from  : ISO date (>= createdAt)
 *  - to    : ISO date (<= createdAt)
 *
 * Nécessite req.user._id (via authRequired)
 */
// controllers/devis.client.controller.js

export async function listMyDevis(req, res) {
  try {
    const userId = req.user?._id || req.user?.id || req.query.clientId;
    const oid = toObjectId(userId);
    if (!oid)
      return res.status(401).json({ success: false, message: "Non autorisé" });

    const page = Math.max(1, parseInt(req.query.page ?? "1", 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit ?? "20", 10))
    );
    const skip = (page - 1) * limit;
    const q = (req.query.q || "").toString().trim();
    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;

    const match = { "client.id": oid };
    if (from || to) {
      match.createdAt = {};
      if (from && !Number.isNaN(from.getTime())) match.createdAt.$gte = from;
      if (to && !Number.isNaN(to.getTime())) match.createdAt.$lte = to;
      if (!Object.keys(match.createdAt).length) delete match.createdAt;
    }
    if (q) {
      const rx = new RegExp(esc(q), "i");
      match.$or = [
        { numero: rx },
        { demandeNumero: rx },
        { "meta.demandeNumero": rx },
        { "meta.demandes.numero": rx },
        { "meta.demandes.type": rx },
        { "items.designation": rx },
        { "items.demandeNumero": rx },
      ];
    }

    const pipeline = [
      { $match: match },
      // داخل pipeline: بدّل الـ$project (الخطوة 9) هكة
      {
        $project: {
          _id: 1,
          demandeNumero: "$_filled.numero",
          type: "$_filled.type",
          client: "$client.nom",
          date: "$createdAt",

          // PDF DDV فقط
          ddvPdf: {
            $cond: [
              {
                $and: [
                  { $ne: ["$_filled.type", null] },
                  { $ne: ["$_filled.type", ""] },
                ],
              },
              {
                $concat: [
                  ORIGIN,
                  "/api/devis/",
                  "$_filled.type",
                  "/",
                  { $toString: "$_id" },
                  "/pdf",
                ],
              },
              null,
            ],
          },

          // لا نرجّع devisPdf
          documents: "$documents",
          attachments: "$attachments",
        },
      },
      {
        $project: {
          _id: 1,
          numero: 1,
          createdAt: 1,
          devisPdf: 1,
          totalTTC: 1,
          demandeNumeros: {
            $setDifference: [
              {
                $filter: {
                  input: "$allDemNums",
                  as: "n",
                  cond: {
                    $and: [{ $ne: ["$$n", null] }, { $ne: ["$$n", ""] }],
                  },
                },
              },
              [null, ""],
            ],
          },
          types: {
            $setDifference: [
              {
                $filter: {
                  input: "$allTypes",
                  as: "t",
                  cond: {
                    $and: [{ $ne: ["$$t", null] }, { $ne: ["$$t", ""] }],
                  },
                },
              },
              [null, ""],
            ],
          },
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $facet: {
          meta: [{ $count: "total" }],
          items: [{ $skip: skip }, { $limit: limit }],
        },
      },
      {
        $project: {
          total: { $ifNull: [{ $arrayElemAt: ["$meta.total", 0] }, 0] },
          items: 1,
        },
      },
    ];

    const [agg = { total: 0, items: [] }] = await Devis.aggregate(
      pipeline
    ).allowDiskUse(true);

    // بعد aggregate (post-map): نحّي devisPdf
    const items = (agg?.items || []).map((d) => ({
      _id: d._id,
      demandeNumero: d.demandeNumero,
      type: d.type,
      client: d.client || "",
      date: d.date,
      ddvPdf: d.ddvPdf, // ممكن null
      // devisPdf: نحيناه
      documents: d.documents || [],
      attachments: Array.isArray(d.documents)
        ? d.documents.length
        : Number(d.attachments) || 0,
    }));

    return res.json({
      success: true,
      page,
      limit,
      total: agg.total || 0,
      items,
    });
  } catch (e) {
    console.error("listMyDevis error:", e);
    return res.status(500).json({ success: false, message: "Erreur serveur" });
  }
}

/**
 * GET /api/admin/devis/compact?type=all|compression|traction|torsion|fil|grille|autre&q=...&page=1&limit=20
 * يرجّع صفوف جاهزة للقائمة (devisNumero, demandeNumeros, types, client, date, pdf)
 */
/**
 * GET /api/admin/devis/compact
 * Query:
 *  - q     : recherche (devis.numero, meta.demandes.numero, demandeNumero, client.nom)
 *  - type  : "all" | "traction" | "torsion" | ...  (filtre côté serveur si présent)
 *  - page  : 1..N
 *  - limit : 1..100
 */
// controllers/devis.admin.controller.js (exemple de chemin)

// controllers/devis.admin.controller.js

/**
 * GET /api/devis/devis/list
 * Query:
 *  - page, limit
 *  - type = all|compression|traction|torsion|fil|grille|autre
 *  - q    = recherche (numero, meta.demandes.numero, client.nom)
 // controllers/devis.admin.controller.js
import Devis from "../models/Devis.js";

const ORIGIN =
  process.env.PUBLIC_BACKEND_URL ||
  `http://localhost:${process.env.PORT || 4000}`;

/**
 * GET /api/devis/demandes/flat
 * Query:
 *  - page, limit
 *  - type = all|compression|traction|torsion|fil|grille|autre
 *  - q    = recherche (DDV..., client, DV..., etc.)
 */
export async function listDemandesFlat(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page ?? "1", 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit ?? "20", 10))
    );
    const skip = (page - 1) * limit;

    const typeQ = String(req.query.type || "all").toLowerCase();
    const q = String(req.query.q || "").trim();

    /* ===== MATCH ===== */
    const match = {};
    if (typeQ && typeQ !== "all") {
      match.$or = [
        { "meta.demandes.type": typeQ },
        { "meta.typeDemande": typeQ },
        { typeDemande: typeQ },
        { type: typeQ },
      ];
    }
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      match.$or = [
        ...(match.$or || []),
        { numero: rx }, // DV...
        { "meta.demandes.numero": rx }, // DDV...
        { demandeNumero: rx },
        { "meta.demandeNumero": rx },
        { "client.nom": rx },
      ];
    }

    const pipeline = [
      { $match: match },

      /* 1) meta.demandes -> array */
      {
        $addFields: {
          _dArr: {
            $cond: [
              { $isArray: "$meta.demandes" },
              "$meta.demandes",
              {
                $map: {
                  input: {
                    $objectToArray: { $ifNull: ["$meta.demandes", {}] },
                  },
                  as: "kv",
                  in: "$$kv.v",
                },
              },
            ],
          },
        },
      },

      /* 2) Legacy -> array */
      {
        $addFields: {
          _legacy: [
            {
              numero: { $ifNull: ["$demandeNumero", null] },
              type: { $ifNull: ["$typeDemande", "$meta.typeDemande"] },
            },
            {
              numero: { $ifNull: ["$meta.demandeNumero", null] },
              type: { $ifNull: ["$meta.typeDemande", null] },
            },
          ],
        },
      },

      /* 3) Fusion + nettoyage */
      {
        $addFields: {
          _all: {
            $filter: {
              input: {
                $setUnion: [
                  { $ifNull: ["$_dArr", []] },
                  { $ifNull: ["$_legacy", []] },
                ],
              },
              as: "d",
              cond: {
                $and: [
                  { $ne: ["$$d", null] },
                  { $ne: [{ $ifNull: ["$$d.numero", null] }, null] },
                  { $ne: [{ $ifNull: ["$$d.numero", ""] }, ""] },
                ],
              },
            },
          },
        },
      },

      /* 4) Normaliser -> {numero,type} + lowercase type */
      {
        $addFields: {
          _allNorm: {
            $map: {
              input: "$_all",
              as: "d",
              in: {
                numero: "$$d.numero",
                type: { $toLower: { $ifNull: ["$$d.type", null] } },
              },
            },
          },
        },
      },

      /* 5) Dédup dans الوثيقة نفسها */
      {
        $addFields: {
          _uniqAgg: {
            $reduce: {
              input: "$_allNorm",
              initialValue: { nums: [], out: [] },
              in: {
                $cond: [
                  { $in: ["$$this.numero", "$$value.nums"] },
                  "$$value",
                  {
                    nums: {
                      $concatArrays: ["$$value.nums", ["$$this.numero"]],
                    },
                    out: { $concatArrays: ["$$value.out", ["$$this"]] },
                  },
                ],
              },
            },
          },
        },
      },
      { $addFields: { _uniq: "$_uniqAgg.out" } },

      /* 6) استنتاج primaryType باش ما يكونش null */
      {
        $addFields: {
          _typesCand: {
            $setUnion: [
              { $map: { input: "$_uniq", as: "d", in: "$$d.type" } },
              [{ $toLower: { $ifNull: ["$type", null] } }],
              [{ $toLower: { $ifNull: ["$typeDemande", null] } }],
              [{ $toLower: { $ifNull: ["$meta.typeDemande", null] } }],
            ],
          },
        },
      },
      {
        $addFields: {
          _typesClean: {
            $filter: {
              input: "$_typesCand",
              as: "t",
              cond: { $and: [{ $ne: ["$$t", null] }, { $ne: ["$$t", ""] }] },
            },
          },
        },
      },
      {
        $addFields: {
          primaryType: {
            $ifNull: [{ $arrayElemAt: ["$_typesClean", 0] }, null],
          },
        },
      },

      /* 7) عَبّي type الناقص */
      {
        $addFields: {
          _filled: {
            $map: {
              input: "$_uniq",
              as: "d",
              in: {
                numero: "$$d.numero",
                type: { $toLower: { $ifNull: ["$$d.type", "$primaryType"] } },
              },
            },
          },
        },
      },

      /* 8) Unwind => chaque document = Demande واحدة */
      { $unwind: "$_filled" },

      /* 9) Projection سطر واحد (Demande) */
      {
        $project: {
          _id: 1, // id وثيقة Devis المجمّعة (يخدم مع /api/devis/:type/:id/pdf)
          demandeNumero: "$_filled.numero",
          type: "$_filled.type",
          client: "$client.nom",
          date: "$createdAt",

          // PDF DDV (كيما routes متاعك): نعمرها كان النوع موجود
          ddvPdf: {
            $cond: [
              {
                $and: [
                  { $ne: ["$_filled.type", null] },
                  { $ne: ["$_filled.type", ""] },
                ],
              },
              {
                $concat: [
                  ORIGIN,
                  "/api/devis/",
                  "$_filled.type",
                  "/",
                  { $toString: "$_id" },
                  "/pdf",
                ],
              },
              null,
            ],
          },

          // PDF fichiers devis (DVxxxx.pdf)
          devisPdf: { $concat: [ORIGIN, "/files/devis/", "$numero", ".pdf"] },

          // Attachments/Docs
          documents: "$documents",
          attachments: "$attachments",
        },
      },

      /* 10) ترتيب + Pagination */
      { $sort: { date: -1, demandeNumero: 1 } },

      {
        $facet: {
          meta: [{ $count: "total" }],
          items: [{ $skip: skip }, { $limit: limit }],
        },
      },
      {
        $project: {
          total: { $ifNull: [{ $arrayElemAt: ["$meta.total", 0] }, 0] },
          items: 1,
        },
      },
    ];

    const [agg] = await Devis.aggregate(pipeline).allowDiskUse(true);

    // POST-map صغير: عدّ الملفات
    const items = (agg?.items || []).map((d) => ({
      _id: d._id,
      demandeNumero: d.demandeNumero,
      type: d.type,
      client: d.client || "",
      date: d.date,
      ddvPdf: d.ddvPdf, // قد يكون null (نخبيه في الفرونت)
      devisPdf: d.devisPdf,
      attachments: Array.isArray(d.documents)
        ? d.documents.length
        : Number(d.attachments) || 0,
    }));

    return res.json({
      success: true,
      page,
      limit,
      total: agg?.total || 0,
      items,
    });
  } catch (e) {
    console.error("listDemandesFlat error:", e);
    return res.status(500).json({ success: false, message: "Erreur serveur" });
  }
}
