import Devis from "../models/Devis.js";
import mongoose from "mongoose";
const ORIGIN = process.env.PUBLIC_BACKEND_URL || `http://localhost:${process.env.PORT || 4000}`;

// controllers/devis.client.controller.js


const toObjectId = (v) => {
  try { return new mongoose.Types.ObjectId(String(v)); } catch { return null; }
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
    if (!oid) return res.status(401).json({ success: false, message: "Non autorisé" });

    const page  = Math.max(1, parseInt(req.query.page ?? "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? "20", 10)));
    const skip  = (page - 1) * limit;
    const q     = (req.query.q || "").toString().trim();
    const from  = req.query.from ? new Date(req.query.from) : null;
    const to    = req.query.to   ? new Date(req.query.to)   : null;

    const match = { "client.id": oid };
    if (from || to) {
      match.createdAt = {};
      if (from && !Number.isNaN(from.getTime())) match.createdAt.$gte = from;
      if (to && !Number.isNaN(to.getTime()))     match.createdAt.$lte = to;
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
      {
        $project: {
          _id: 1,                                        // ✅ لازم
          numero: 1,
          createdAt: 1,
          devisPdf: { $concat: [ORIGIN, "/files/devis/", "$numero", ".pdf"] },
          allDemNums: {
            $setUnion: [
              { $ifNull: ["$meta.demandes.numero", []] },
              [
                { $ifNull: ["$demandeNumero", null] },
                { $ifNull: ["$meta.demandeNumero", null] }
              ],
              { $ifNull: ["$items.demandeNumero", []] }
            ]
          },
          allTypes: { $setUnion: [ { $ifNull: ["$meta.demandes.type", []] } ] },
          totalTTC: "$totaux.mttc"
        }
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
              { $filter: { input: "$allDemNums", as: "n", cond: { $and: [ { $ne: ["$$n", null] }, { $ne: ["$$n", ""] } ] } } },
              [null, ""]
            ]
          },
          types: {
            $setDifference: [
              { $filter: { input: "$allTypes", as: "t", cond: { $and: [ { $ne: ["$$t", null] }, { $ne: ["$$t", ""] } ] } } },
              [null, ""]
            ]
          }
        }
      },
      { $sort: { createdAt: -1 } },
      { $facet: { meta:  [{ $count: "total" }], items: [{ $skip: skip }, { $limit: limit }] } },
      { $project: { total: { $ifNull: [ { $arrayElemAt: ["$meta.total", 0] }, 0 ] }, items: 1 } }
    ];

    const [agg = { total: 0, items: [] }] = await Devis.aggregate(pipeline).allowDiskUse(true);

    const items = (agg.items || []).map((d) => ({
      devisId: d._id?.toString(),                        // ✅ هنا
      devisNumero: d.numero,
      devisPdf: d.devisPdf,
      demandeNumeros: d.demandeNumeros || [],
      types: d.types || [],
      totalTTC: d.totalTTC ?? 0,
      date: d.createdAt
    }));

    return res.json({ success: true, page, limit, total: agg.total || 0, items });
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
 */
export async function listDevisCompact(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page ?? "1", 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit ?? "20", 10))
    );
    const skip = (page - 1) * limit;

    const typeQ = String(req.query.type || "all").toLowerCase();
    const q = String(req.query.q || "").trim();

    /* ====== MATCH ====== */
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
        { numero: rx },
        { "meta.demandes.numero": rx },
        { demandeNumero: rx },
        { "meta.demandeNumero": rx },
        { "client.nom": rx },
      ];
    }

    const pipeline = [
      { $match: match },

      /* 1) meta.demandes → array */
      {
        $addFields: {
          _demandesArray: {
            $cond: [
              { $isArray: "$meta.demandes" },
              "$meta.demandes",
              {
                $map: {
                  input: { $objectToArray: { $ifNull: ["$meta.demandes", {}] } },
                  as: "kv",
                  in: "$$kv.v",
                },
              },
            ],
          },
        },
      },

      /* 2) Legacy demandes → array */
      {
        $addFields: {
          _legacyDemandes: [
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

      /* 3) Fusion brute */
      {
        $addFields: {
          _allDemandesRaw: {
            $setUnion: [
              { $ifNull: ["$_demandesArray", []] },
              { $ifNull: ["$_legacyDemandes", []] },
            ],
          },
        },
      },

      /* 3.bis) Nettoyage */
      {
        $addFields: {
          _allDemandes: {
            $filter: {
              input: "$_allDemandesRaw",
              as: "d",
              cond: {
                $and: [
                  { $ne: ["$$d", null] },
                  {
                    $ne: [
                      {
                        $cond: [
                          { $eq: [{ $type: "$$d" }, "object"] },
                          { $ifNull: ["$$d.numero", null] },
                          "$$d", // si string
                        ],
                      },
                      null,
                    ],
                  },
                ],
              },
            },
          },
        },
      },

      /* 3.1) Normaliser → {numero, type} حتى لو كانت string */
      {
        $addFields: {
          _allDemandesNorm: {
            $map: {
              input: "$_allDemandes",
              as: "d",
              in: {
                $cond: [
                  { $eq: [{ $type: "$$d" }, "object"] },
                  {
                    numero: "$$d.numero",
                    type: { $toLower: { $ifNull: ["$$d.type", null] } },
                  },
                  { numero: "$$d", type: null },
                ],
              },
            },
          },
        },
      },

      /* 3.5) Dédup par numero */
      {
        $addFields: {
          _uniqDemandesAgg: {
            $reduce: {
              input: { $ifNull: ["$_allDemandesNorm", []] },
              initialValue: { numeros: [], out: [] },
              in: {
                $cond: [
                  { $in: ["$$this.numero", "$$value.numeros"] },
                  "$$value",
                  {
                    numeros: {
                      $concatArrays: ["$$value.numeros", ["$$this.numero"]],
                    },
                    out: { $concatArrays: ["$$value.out", ["$$this"]] },
                  },
                ],
              },
            },
          },
        },
      },
      { $addFields: { _uniqDemandes: "$_uniqDemandesAgg.out" } },

      /* 4) Récupérer tous les types possibles + fallback */
      {
        $addFields: {
          _typesCandidates: {
            $setUnion: [
              { $map: { input: "$_uniqDemandes", as: "d", in: "$$d.type" } },
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
              input: "$_typesCandidates",
              as: "t",
              cond: { $and: [{ $ne: ["$$t", null] }, { $ne: ["$$t", ""] }] },
            },
          },
        },
      },
      {
        $addFields: {
          primaryType: { $ifNull: [{ $arrayElemAt: ["$_typesClean", 0] }, null] },
        },
      },

      /* 4.2) remplir type الناقص داخل demandes بالـ primaryType */
      {
        $addFields: {
          _uniqDemandesFilled: {
            $map: {
              input: "$_uniqDemandes",
              as: "d",
              in: {
                numero: "$$d.numero",
                type: {
                  $toLower: { $ifNull: ["$$d.type", "$primaryType"] },
                },
              },
            },
          },
        },
      },

      /* 5) Dérivés نهائيين */
      {
        $addFields: {
          _demandeNumeros: {
            $setUnion: [
              { $map: { input: "$_uniqDemandesFilled", as: "d", in: "$$d.numero" } },
              [],
            ],
          },
          _typesFinal: {
            $setUnion: [
              { $map: { input: "$_uniqDemandesFilled", as: "d", in: "$$d.type" } },
              [],
            ],
          },
        },
      },

      /* 6) Projection compacte + حقول لازمة للـUI */
      {
        $project: {
          _id: 1,
          numero: 1, // DV…
          createdAt: 1,
          clientNom: "$client.nom",

          // رابط PDF النهائي (fichiers devis)
          devisPdf: { $concat: [ORIGIN, "/files/devis/", "$numero", ".pdf"] },

          // type الأساسي لروابط DDV
          type: "$primaryType",

          // للواجهة
          demandes: "$_uniqDemandesFilled", // [{numero,type}] (بدون دوبل)
          demandeNumeros: "$_demandeNumeros",
          types: "$_typesFinal",

          documents: "$documents",
          attachments: "$attachments",
        },
      },

      { $sort: { createdAt: -1 } },

      /* 7) Pagination */
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

    const items = (agg?.items || []).map((d) => ({
      _id: d._id,
      type: d.type || null, // مستنتج، ماعادش null في أغلب الحالات
      devisNumero: d.numero,
      devisPdf: d.devisPdf,
      client: d.clientNom || "",
      date: d.createdAt,
      documents: d.documents || [],
      attachments: d.attachments ?? 0,
      demandes: d.demandes || [],
      demandeNumeros: d.demandeNumeros || [],
      types: d.types || [],
    }));

    return res.json({ success: true, page, limit, total: agg?.total || 0, items });
  } catch (e) {
    console.error("listDevisCompact error:", e);
    return res.status(500).json({ success: false, message: "Erreur serveur" });
  }
}




