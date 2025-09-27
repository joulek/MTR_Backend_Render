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
    const page  = Math.max(1, parseInt(req.query.page ?? "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? "20", 10)));
    const skip  = (page - 1) * limit;

    const type = (req.query.type || "all").toString().toLowerCase();
    const qRaw = (req.query.q || "").toString().trim();

    const rx = qRaw ? new RegExp(qRaw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null;

    const bases = [
      { model: DemandeCompression, t: "compression" },
      { model: DemandeTraction,    t: "traction" },
      { model: DemandeTorsion,     t: "torsion" },
      { model: DemandeFil,         t: "fil" },
      { model: DemandeGrille,      t: "grille" },
      { model: DemandeAutre,       t: "autre" },
    ];

    const base   = bases[0];
    const unions = bases.slice(1);

    // ---- petits helpers communs d'aggregation ----
    const mkMatch = () => {
      if (!rx) return [];
      return [{
        $match: {
          $or: [
            { numero: rx },
            { devisNumero: rx },
            { "devis.numero": rx },
            { "client.nom": rx },
            { "client.prenom": rx },
            { "client.lastName": rx },
            { "client.firstName": rx },
          ]
        }
      }];
    };

    const commonProjection = (typeLiteral) => ([
      {
        // Normalise les champs pour calculer nom/prenom + documents
        $addFields: {
          __keepId: "$_id",

          // numéro devis possible dans deux emplacements
          __devisNumero: { $ifNull: ["$devisNumero", "$devis.numero"] },

          // client.{prenom,nom,email,numTel} fusion depuis différents schémas
          __client_prenom: {
            $ifNull: [
              "$client.prenom",
              { $ifNull: ["$client.firstName", { $ifNull: ["$prenom", "$firstName"] }] }
            ]
          },
          __client_nom: {
            $ifNull: [
              "$client.nom",
              { $ifNull: ["$client.lastName", { $ifNull: ["$nom", "$lastName"] }] }
            ]
          },
          __client_email: {
            $ifNull: ["$client.email", "$email"]
          },
          __client_numTel: {
            $ifNull: ["$client.numTel", "$numTel"]
          },

          // Présence du PDF DDV
          __hasDemandePdf: { $ne: ["$demandePdf", null] },

          // Map des documents -> (index, filename, mimetype, size, hasData)
          // Utilise $map + $binarySize si dispo (MongoDB 5+). Si non dispo, on fera le size côté JS plus bas.
          __documents: {
            $cond: [
              { $isArray: "$documents" },
              {
                $map: {
                  input: "$documents",
                  as: "d",
                  in: {
                    index: { $indexOfArray: ["$documents", "$$d"] },
                    filename: "$$d.filename",
                    mimetype: "$$d.mimetype",
                    size: {
                      $cond: [
                        { $gt: [ { $type: "$$d.data" }, "missing" ] },
                        // essaie $binarySize, sinon 0:
                        { $cond: [
                          { $eq: [ { $type: "$$d.data" }, "binData" ] },
                          { $binarySize: "$$d.data" },
                          0
                        ]},
                        0
                      ]
                    },
                    hasData: {
                      $and: [
                        { $gt: [ { $type: "$$d.data" }, "missing" ] },
                        { $eq: [ { $type: "$$d.data" }, "binData" ] },
                        { $gt: [ { $binarySize: "$$d.data" }, 0 ] }
                      ]
                    }
                  }
                }
              },
              []
            ]
          }
        }
      },
      {
        $project: {
          _id: "$__keepId",
          demandeNumero: "$numero",
          type: { $literal: typeLiteral },
          devisNumero: "$__devisNumero",
          clientName: {
            $trim: {
              input: {
                $concat: [
                  { $ifNull: ["$__client_prenom", ""] },
                  " ",
                  { $ifNull: ["$__client_nom", ""] }
                ]
              }
            }
          },
          client: {
            prenom: { $ifNull: ["$__client_prenom", ""] },
            nom:    { $ifNull: ["$__client_nom", ""] },
            email:  { $ifNull: ["$__client_email", ""] },
            numTel: { $ifNull: ["$__client_numTel", ""] },
          },
          date: "$createdAt",
          hasDemandePdf: "$__hasDemandePdf",
          documents: "$__documents"
        }
      }
    ]);

    const basePipeline = [
      ...mkMatch(),
      ...commonProjection(base.t),
    ];

    const unionStages = unions.map(({ model, t }) => ({
      $unionWith: {
        coll: model.collection.name,
        pipeline: [
          ...mkMatch(),
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
    const rows = agg?.items || [];

    // Post-traitement JS (au cas où $binarySize n’est pas dispo côté cluster)
    const items = rows.map((d) => {
      const docs = (d.documents || []).map((doc, idx) => {
        // recalcul size/hasData si null/0:
        let size = doc.size;
        let hasData = !!doc.hasData;
        // si tu veux renforcer en lisant depuis le doc original, laisse comme ça (agrégat multi-colls = on n'a pas le binaire ici)
        // donc on garde les métadonnées calculées par l'agg; fallback à 0/false:
        size = Number.isFinite(size) ? size : 0;
        hasData = !!hasData;

        return {
          index: Number.isFinite(doc.index) ? doc.index : idx,
          filename: doc.filename || "",
          mimetype: doc.mimetype || "",
          size,
          hasData
        };
      });

      const ddvPdf  = d.hasDemandePdf ? `${ORIGIN}/api/devis/${d.type}/${d._id}/pdf` : null;
      const devisPdf = d.devisNumero ? `${ORIGIN}/files/devis/${d.devisNumero}.pdf` : null;

      return {
        _id: d._id,
        demandeNumero: d.demandeNumero,
        type: d.type,
        devisNumero: d.devisNumero || null,
        // ✨ ce que tu voulais: nom/prénom visibles + objet client si besoin
        clientName: d.clientName || "",
        client: d.client || { prenom: "", nom: "", email: "", numTel: "" },
        date: d.date,
        hasDemandePdf: !!d.hasDemandePdf,
        ddvPdf,
        devisPdf,
        documents: docs
      };
    });

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
