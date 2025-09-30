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
    const type  = (req.query.type || "all").toString().toLowerCase();
    const qRaw  = (req.query.q || "").toString().trim();

    // regex et éventuelle interprétation date
    const rx = qRaw ? new RegExp(escRx(qRaw), "i") : null;
    const dateRange = parseDateRange(qRaw);

    // toutes les collections
    const bases = [
      { model: DemandeCompression, t: "compression" },
      { model: DemandeTraction,    t: "traction" },
      { model: DemandeTorsion,     t: "torsion" },
      { model: DemandeFil,         t: "fil" },
      { model: DemandeGrille,      t: "grille" },
      { model: DemandeAutre,       t: "autre" },
    ];
    const unions = bases.slice(1);

    // pipeline par collection
    const pipelineFor = (typeLiteral) => {
      const stages = [
        /* 1) ramener le user */
        {
          $lookup: {
            from: "users",
            localField: "user",
            foreignField: "_id",
            as: "__userArr",
          }
        },
        { $addFields: { __user: { $ifNull: [ { $arrayElemAt: ["$__userArr", 0] }, null ] } } },
      ];

      /* 2) $match global (OR) après $lookup pour que __user.* existe */
      if (rx || dateRange) {
        const or = [];
        if (rx) {
          or.push(
            { numero: rx },
            { devisNumero: rx },
            { "devis.numero": rx },
            { "client.nom": rx },
            { "client.prenom": rx },
            { "__user.prenom": rx },
            { "__user.nom": rx },
            { "__user.firstName": rx },
            { "__user.lastName": rx },
            { "__user.email": rx },
            // ✅ match sur le type (chaîne littérale de ce pipeline)
            { $expr: { $regexMatch: { input: { $literal: typeLiteral }, regex: rx } } },
          );
        }
        if (dateRange) {
          const [start, end] = dateRange;
          or.push({ createdAt: { $gte: start, $lte: end } }, { date: { $gte: start, $lte: end } });
        }
        stages.push({ $match: { $or: or } });
      }

      /* 3) normalisation */
      stages.push(
        {
          $addFields: {
            __keepId: "$_id",
            __devisNumero: { $ifNull: ["$devisNumero", "$devis.numero"] },
            __first: {
              $ifNull: [
                "$client.prenom",
                { $ifNull: ["$client.firstName", { $ifNull: ["$prenom", { $ifNull: ["$firstName", { $ifNull: ["$__user.prenom", "$__user.firstName"] }] }] }] }
              ]
            },
            __last: {
              $ifNull: [
                "$client.nom",
                { $ifNull: ["$client.lastName", { $ifNull: ["$nom", { $ifNull: ["$lastName", { $ifNull: ["$__user.nom", "$__user.lastName"] }] }] }] }
              ]
            },
            __email:  { $ifNull: ["$client.email",  { $ifNull: ["$email",  "$__user.email"  ] }] },
            __numTel: { $ifNull: ["$client.numTel", { $ifNull: ["$numTel", "$__user.numTel"] }] },
            __hasDemandePdf: { $ne: ["$demandePdf", null] },
            __attachmentsCount: { $cond: [ { $isArray: "$documents" }, { $size: "$documents" }, 0 ] }
          }
        },

        /* 4) projection compacte */
        {
          $project: {
            _id: "$__keepId",
            demandeNumero: "$numero",
            type: { $literal: typeLiteral },
            devisNumero: "$__devisNumero",
            clientName: {
              $trim: { input: { $concat: [ { $ifNull: ["$__first", ""] }, " ", { $ifNull: ["$__last", ""] } ] } }
            },
            client: { prenom: { $ifNull: ["$__first", ""] }, nom: { $ifNull: ["$__last", ""] }, email: { $ifNull: ["$__email", ""] }, numTel: { $ifNull: ["$__numTel", ""] } },
            date: "$createdAt",
            hasDemandePdf: "$__hasDemandePdf",
            attachments: "$__attachmentsCount",
          }
        }
      );

      return stages;
    };

    const basePipeline = pipelineFor(bases[0].t);
    const unionStages = unions.map(({ model, t }) => ({
      $unionWith: { coll: model.collection.name, pipeline: pipelineFor(t) }
    }));

    const finalPipeline = [
      ...basePipeline,
      ...unionStages,
      ...(type !== "all" ? [{ $match: { type } }] : []), // filtre du select "Tous les types"
      { $sort: { date: -1 } },
      { $facet: { meta: [{ $count: "total" }], items: [{ $skip: skip }, { $limit: limit }] } },
      { $project: { total: { $ifNull: [{ $arrayElemAt: ["$meta.total", 0] }, 0] }, items: 1 } }
    ];

    const [agg] = await bases[0].model.aggregate(finalPipeline).allowDiskUse(true);
    const rows = agg?.items || [];

    const items = rows.map((d) => {
      const ddvPdf   = d.hasDemandePdf ? `${ORIGIN}/api/devis/${d.type}/${d._id}/pdf` : null;
      const devisPdf = d.devisNumero ? `${ORIGIN}/files/devis/${d.devisNumero}.pdf` : null;
      return {
        _id: d._id,
        demandeNumero: d.demandeNumero,
        type: d.type,
        devisNumero: d.devisNumero || null,
        clientName: d.clientName || "",
        client: d.client || { prenom: "", nom: "", email: "", numTel: "" },
        date: d.date,
        hasDemandePdf: !!d.hasDemandePdf,
        ddvPdf,
        devisPdf,
        attachments: Number.isFinite(d.attachments) ? d.attachments : 0,
      };
    });

    return res.json({ success: true, page, limit, total: agg?.total || 0, items });
  } catch (e) {
    console.error("listDemandesCompact error:", e);
    return res.status(500).json({ success: false, message: "Erreur serveur" });
  }
}
