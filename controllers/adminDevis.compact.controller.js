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


// ⚠️ Utilise l'URL publique si dispo, sinon on déduit dynamiquement
const ORIGIN_ENV = process.env.PUBLIC_BACKEND_URL?.replace(/\/$/, "");

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

    // ✅ Origin robuste: env > header origin > protocole + host
    const reqOrigin =
      ORIGIN_ENV ||
      req.headers.origin ||
      `${req.protocol}://${req.get("host")}`;

    const pipeline = [
      { $match: match },
      {
        $project: {
          _id: 1,
          numero: 1,
          createdAt: 1,
          devisPdf: { $concat: [reqOrigin, "/files/devis/", "$numero", ".pdf"] },
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
              {
                $filter: {
                  input: "$allDemNums",
                  as: "n",
                  cond: { $and: [ { $ne: ["$$n", null] }, { $ne: ["$$n", ""] } ] }
                }
              },
              [null, ""]
            ]
          },
          types: {
            $setDifference: [
              {
                $filter: {
                  input: "$allTypes",
                  as: "t",
                  cond: { $and: [ { $ne: ["$$t", null] }, { $ne: ["$$t", ""] } ] }
                }
              },
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
      devisId: d._id?.toString(),
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

export async function listDevisCompact(req, res) {
  try {
    const page  = Math.max(1, parseInt(req.query.page ?? "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? "20", 10)));
    const skip  = (page - 1) * limit;

    const type = String(req.query.type ?? "all").toLowerCase().trim();
    const qRaw = String(req.query.q ?? "").trim();

    // --- Regex sécurisé pour `q` ---
    const rx = qRaw
      ? new RegExp(qRaw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
      : null;

    // ========= PIPELINE =========
    const pipeline = [
      // 1) (Pré-)match léger pour accélérer, sans rater les cas map/array
      //    -> on garde toujours les champs simples ici
      (() => {
        const m = {};
        if (qRaw) {
          m.$or = [
            { numero: rx },
            { "client.nom": rx },
            // ces deux-là marcheront si meta.demandes est déjà un array de sous-docs
            { "meta.demandes.numero": rx },
            { "meta.demandeNumero": rx },
          ];
        }
        // ⚠️ NE PAS filtrer `type` ici, car si `meta.demandes` est une map, on risquerait de rater des docs.
        return Object.keys(m).length ? { $match: m } : { $match: {} };
      })(),

      // 2) Normaliser meta.demandes en tableau: _demandesArray
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

      // 3) Extraire numeros/types depuis le tableau normalisé
      {
        $addFields: {
          _demNumsFromMeta: {
            $map: { input: "$_demandesArray", as: "d", in: "$$d.numero" },
          },
          _typesFromMeta: {
            $map: { input: "$_demandesArray", as: "d", in: "$$d.type" },
          },
        },
      },

      // 4) Construire les champs compactés + URL PDF
      {
        $project: {
          numero: 1,
          createdAt: 1,
          clientNom: "$client.nom",

          // string constante injectée côté Node (OK dans un pipeline)
          devisPdf: { $concat: [ORIGIN, "/files/devis/", "$numero", ".pdf"] },

          // union avec anciens champs (compat héritage)
          allDemNums: {
            $setUnion: [
              { $ifNull: ["$_demNumsFromMeta", []] },
              [
                { $ifNull: ["$demandeNumero", null] },
                { $ifNull: ["$meta.demandeNumero", null] },
              ],
            ],
          },
          allTypes: {
            $setUnion: [
              { $ifNull: ["$_typesFromMeta", []] },
              [
                { $ifNull: ["$typeDemande", null] },
                { $ifNull: ["$meta.typeDemande", null] },
              ],
            ],
          },
        },
      },

      // 5) Nettoyer null / ""
      {
        $project: {
          numero: 1,
          createdAt: 1,
          clientNom: 1,
          devisPdf: 1,
          demandeNumeros: {
            $filter: {
              input: "$allDemNums",
              as: "n",
              cond: { $and: [ { $ne: ["$$n", null] }, { $ne: ["$$n", ""] } ] },
            },
          },
          types: {
            $filter: {
              input: "$allTypes",
              as: "t",
              cond: { $and: [ { $ne: ["$$t", null] }, { $ne: ["$$t", ""] } ] },
            },
          },
        },
      },

      // 6) Filtre `type` APRÈS normalisation (fiable pour array/map)
      ...(type && type !== "all"
        ? [
            {
              $match: {
                $expr: { $in: [type, "$types"] },
              },
            },
          ]
        : []),

      // 7) Filtre `q` APRÈS normalisation pour couvrir aussi demandeNumeros (map/array)
      ...(rx
        ? [
            {
              $match: {
                $expr: {
                  $or: [
                    { $regexMatch: { input: { $ifNull: ["$numero", ""] }, regex: rx } },
                    { $regexMatch: { input: { $ifNull: ["$clientNom", ""] }, regex: rx } },
                    {
                      // true si au moins un numero de demande match le regex
                      $gt: [
                        {
                          $size: {
                            $filter: {
                              input: { $ifNull: ["$demandeNumeros", []] },
                              as: "n",
                              cond: { $regexMatch: { input: "$$n", regex: rx } },
                            },
                          },
                        },
                        0,
                      ],
                    },
                  ],
                },
              },
            },
          ]
        : []),

      // 8) Tri récent d'abord
      { $sort: { createdAt: -1, _id: -1 } },

      // 9) Pagination + total
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

    const [agg = { total: 0, items: [] }] = await Devis.aggregate(pipeline).allowDiskUse(true);

    const items = (agg.items || []).map((d) => ({
      devisNumero: d.numero,
      devisPdf: d.devisPdf,
      demandeNumeros: d.demandeNumeros || [],
      types: d.types || [],
      client: d.clientNom || "",
      date: d.createdAt,
    }));

    return res.json({
      success: true,
      page,
      limit,
      total: agg.total || 0,
      items,
    });
  } catch (e) {
    console.error("listDevisCompact error:", e);
    return res.status(500).json({ success: false, message: "Erreur serveur" });
  }
}