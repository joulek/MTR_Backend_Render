import Devis from "../models/Devis.js";
import DemandeCompression from "../models/DevisCompression.js";
import DemandeTraction from "../models/DevisTraction.js";
import DemandeTorsion from "../models/DevisTorsion.js";
import DemandeFil from "../models/DevisFilDresse.js";
import DemandeGrille from "../models/DevisGrille.js";
import DemandeAutre from "../models/DevisAutre.js";

const ORIGIN = process.env.PUBLIC_BACKEND_URL || `http://localhost:${process.env.PORT}`;

/**
 * GET /api/admin/devis/compact?type=all|compression|traction|torsion|fil|grille|autre&q=...&page=1&limit=20
 * يرجّع صفوف جاهزة للقائمة (devisNumero, demandeNumeros, types, client, date, pdf)
 */
export async function listDevisCompact(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page ?? "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? "20", 10)));
    const skip = (page - 1) * limit;
    const type = (req.query.type || "all").toString().toLowerCase();
    const q = (req.query.q || "").toString().trim();

    const match = {};
    if (type && type !== "all") {
      match["meta.demandes.type"] = type;
    }
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      match.$or = [
        { numero: rx },
        { "meta.demandes.numero": rx },
        { demandeNumero: rx },
        { "meta.demandeNumero": rx },
        { "client.nom": rx },
        { "client.prenom": rx },
        { "client.firstName": rx },
        { "client.lastName": rx },
      ];
    }

    const pipeline = [
      { $match: match },
      {
        $project: {
          numero: 1,
          createdAt: 1,
          devisPdf: { $concat: [ORIGIN, "/files/devis/", "$numero", ".pdf"] },

          clientPrenom: {
            $ifNull: [
              "$client.prenom",
              { $ifNull: ["$client.firstName", { $ifNull: ["$prenom", "$firstName"] }] }
            ]
          },
          clientNom: {
            $ifNull: [
              "$client.nom",
              { $ifNull: ["$client.lastName", { $ifNull: ["$nom", "$lastName"] }] }
            ]
          },

          allDemNums: {
            $setUnion: [
              { $ifNull: ["$meta.demandes.numero", []] },
              [
                { $ifNull: ["$demandeNumero", null] },
                { $ifNull: ["$meta.demandeNumero", null] }
              ]
            ]
          },
          allTypes: {
            $setUnion: [
              { $ifNull: ["$meta.demandes.type", []] },
              [{ $ifNull: ["$typeDemande", null] }]
            ]
          }
        }
      },
      {
        $project: {
          numero: 1,
          createdAt: 1,
          devisPdf: 1,
          demandeNumeros: {
            $setDifference: [
              {
                $filter: {
                  input: "$allDemNums",
                  as: "n",
                  cond: { $and: [{ $ne: ["$$n", null] }, { $ne: ["$$n", ""] }] }
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
                  cond: { $and: [{ $ne: ["$$t", null] }, { $ne: ["$$t", ""] }] }
                }
              },
              [null, ""]
            ]
          },
          client: {
            $trim: {
              input: {
                $concat: [
                  { $ifNull: ["$clientPrenom", ""] },
                  " ",
                  { $ifNull: ["$clientNom", ""] }
                ]
              }
            }
          }
        }
      },
      { $sort: { createdAt: -1 } },
      {
        $facet: {
          meta: [{ $count: "total" }],
          items: [{ $skip: skip }, { $limit: limit }]
        }
      },
      {
        $project: {
          total: { $ifNull: [{ $arrayElemAt: ["$meta.total", 0] }, 0] },
          items: 1
        }
      }
    ];

    const [agg] = await Devis.aggregate(pipeline).allowDiskUse(true);

    const items = (agg?.items || []).map((d) => ({
      devisNumero: d.numero,
      devisPdf: d.devisPdf,
      demandeNumeros: d.demandeNumeros || [],
      types: d.types || [],
      client: d.client || "",
      date: d.createdAt
    }));

    return res.json({
      success: true,
      page,
      limit,
      total: agg?.total || 0,
      items
    });
  } catch (e) {
    console.error("listDevisCompact error:", e);
    return res.status(500).json({ success: false, message: "Erreur serveur" });
  }
}

export async function listDemandesCompact(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page ?? "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? "20", 10)));
    const skip = (page - 1) * limit;
    const type = (req.query.type || "all").toString().toLowerCase();
    const qRaw = (req.query.q || "").toString().trim();

    const rx = qRaw ? new RegExp(qRaw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null;

    const bases = [
      { model: DemandeCompression, t: "compression" },
      { model: DemandeTraction, t: "traction" },
      { model: DemandeTorsion, t: "torsion" },
      { model: DemandeFil, t: "fil" },
      { model: DemandeGrille, t: "grille" },
      { model: DemandeAutre, t: "autre" },
    ];

    const base = bases[0];
    const unions = bases.slice(1);

    const commonProjection = (typeLiteral) => ([
      {
        $addFields: {
          // garder l'id pour construire l'URL PDF DDV
          _id_keep: "$_id",

          _devisNumero: { $ifNull: ["$devisNumero", "$devis.numero"] },

          _first: {
            $ifNull: [
              "$client.prenom",
              { $ifNull: ["$client.firstName", { $ifNull: ["$prenom", "$firstName"] }] }
            ]
          },
          _last: {
            $ifNull: [
              "$client.nom",
              { $ifNull: ["$client.lastName", { $ifNull: ["$nom", "$lastName"] }] }
            ]
          },

          // simple bool: PDF DDV présent ?
          _hasDemandePdf: { $ne: ["$demandePdf", null] },
        }
      },
      {
        $project: {
          _id: "$_id_keep",                 // <-- garder _id
          demandeNumero: "$numero",
          type: { $literal: typeLiteral },
          devisNumero: "$_devisNumero",
          client: {
            $trim: {
              input: {
                $concat: [
                  { $ifNull: ["$_first", ""] },
                  " ",
                  { $ifNull: ["$_last", ""] }
                ]
              }
            }
          },
          date: "$createdAt",
          hasDemandePdf: "$_hasDemandePdf", // <-- bool pour front
        }
      }
    ]);

    const mkMatch = (tLit) => {
      const m = {};
      if (rx) {
        m.$or = [
          { numero: rx },
          { devisNumero: rx },
          { "devis.numero": rx },
          { "client.nom": rx },
          { "client.prenom": rx },
        ];
      }
      return Object.keys(m).length ? [{ $match: m }] : [];
    };

    const basePipeline = [
      ...mkMatch(base.t),
      ...commonProjection(base.t),
    ];

    const unionStages = unions.map(({ model, t }) => ({
      $unionWith: {
        coll: model.collection.name,
        pipeline: [
          ...mkMatch(t),
          ...commonProjection(t),
        ]
      }
    }));

    const finalPipeline = [
      ...basePipeline,
      ...unionStages,
      ...(type !== "all" ? [{ $match: { type } }] : []),
      { $sort: { date: -1 } },
      {
        $facet: {
          meta: [{ $count: "total" }],
          items: [{ $skip: skip }, { $limit: limit }],
        }
      },
      {
        $project: {
          total: { $ifNull: [{ $arrayElemAt: ["$meta.total", 0] }, 0] },
          items: 1
        }
      }
    ];

    const [agg] = await base.model.aggregate(finalPipeline).allowDiskUse(true);

    const items = (agg?.items || []).map((d) => ({
      _id: d._id,
      demandeNumero: d.demandeNumero,
      type: d.type,
      devisNumero: d.devisNumero || null,
      client: d.client || "",
      date: d.date,

      // 🔗 lien PDF DDV si dispo, sinon null
      ddvPdf: d.hasDemandePdf ? `${ORIGIN}/api/devis/${d.type}/${d._id}/pdf` : null,

      // ancien lien PDF du devis (si un devis existe)
      devisPdf: d.devisNumero ? `${ORIGIN}/files/devis/${d.devisNumero}.pdf` : null,
    }));

    return res.json({
      success: true,
      page,
      limit,
      total: agg?.total || 0,
      items,
    });
  } catch (e) {
    console.error("listDemandesCompact error:", e);
    return res.status(500).json({ success: false, message: "Erreur serveur" });
  }
}
