// controllers/adminDevis.compact.controller.js

import Devis from "../models/Devis.js";
import DemandeCompression from "../models/DevisCompression.js";
import DemandeTraction from "../models/DevisTraction.js";
import DemandeTorsion from "../models/DevisTorsion.js";
import DemandeFil from "../models/DevisFilDresse.js";
import DemandeGrille from "../models/DevisGrille.js";
import DemandeAutre from "../models/DevisAutre.js";

import dayjs from "dayjs";
import customParse from "dayjs/plugin/customParseFormat.js";
dayjs.extend(customParse);

const ORIGIN =
  process.env.PUBLIC_BACKEND_URL || `http://localhost:${process.env.PORT}`;

/* --------------------------------- Helpers -------------------------------- */

function escRx(s = "") {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Essaie d’interpréter q comme une date → renvoie [start,end] ou null */
function parseDateRange(qRaw) {
  const raw = String(qRaw || "").trim();
  if (!raw) return null;

  const formats = [
    "DD/MM/YYYY HH:mm",
    "DD-MM-YYYY HH:mm",
    "YYYY-MM-DD HH:mm",
    "DD/MM/YYYY",
    "DD-MM-YYYY",
    "YYYY-MM-DD",
    "DD/MM",
    "DD-MM",
  ];

  for (const fmt of formats) {
    const d = dayjs(raw, fmt, true);
    if (d.isValid()) {
      const year = fmt.includes("YYYY") ? d.year() : dayjs().year();
      const fixed = d.year(year);
      const start = fixed
        .startOf(fmt.includes("HH") ? "minute" : "day")
        .toDate();
      const end = fixed.endOf(fmt.includes("HH") ? "minute" : "day").toDate();
      return [start, end];
    }
  }
  return null;
}

/* --------------------------- GET /devis/compact ---------------------------- */
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
      // filtre strict sur type si renseigné explicitement
      match["meta.demandes.type"] = type;
    }

    const dateRange = parseDateRange(q);
    if (dateRange) {
      const [start, end] = dateRange;
      match.createdAt = { $gte: start, $lte: end };
    }

    if (q) {
      const rx = new RegExp(escRx(q), "i");
      match.$or = [
        { numero: rx },
        { "meta.demandes.numero": rx },
        { demandeNumero: rx },
        { "meta.demandeNumero": rx },
        { "client.nom": rx },
        { "client.prenom": rx },
        { "client.firstName": rx },
        { "client.lastName": rx },
        // recherche textuelle sur types présents dans meta
        { "meta.demandes.type": rx },
        { typeDemande: rx },
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
              { $ifNull: ["$client.firstName", { $ifNull: ["$prenom", "$firstName"] }] },
            ],
          },
          clientNom: {
            $ifNull: [
              "$client.nom",
              { $ifNull: ["$client.lastName", { $ifNull: ["$nom", "$lastName"] }] },
            ],
          },

          allDemNums: {
            $setUnion: [
              { $ifNull: ["$meta.demandes.numero", []] },
              [
                { $ifNull: ["$demandeNumero", null] },
                { $ifNull: ["$meta.demandeNumero", null] },
              ],
            ],
          },
          allTypes: {
            $setUnion: [
              { $ifNull: ["$meta.demandes.type", []] },
              [{ $ifNull: ["$typeDemande", null] }],
            ],
          },
        },
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
                  cond: { $and: [{ $ne: ["$$n", null] }, { $ne: ["$$n", ""] }] },
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
                  cond: { $and: [{ $ne: ["$$t", null] }, { $ne: ["$$t", ""] }] },
                },
              },
              [null, ""],
            ],
          },
          client: {
            $trim: {
              input: {
                $concat: [
                  { $ifNull: ["$clientPrenom", ""] },
                  " ",
                  { $ifNull: ["$clientNom", ""] },
                ],
              },
            },
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

    const [agg] = await Devis.aggregate(pipeline).allowDiskUse(true);

    const items = (agg?.items || []).map((d) => ({
      devisNumero: d.numero,
      devisPdf: d.devisPdf,
      demandeNumeros: d.demandeNumeros || [],
      types: d.types || [],
      client: d.client || "",
      date: d.createdAt,
    }));

    return res.json({
      success: true,
      page,
      limit,
      total: agg?.total || 0,
      items,
    });
  } catch (e) {
    console.error("listDevisCompact error:", e);
    return res
      .status(500)
      .json({ success: false, message: "Erreur serveur" });
  }
}

/* ------------------------- GET /devis/demandes/compact --------------------- */
/**
 * Utilisée par la page "Demandes" (barre de recherche).
 * Recherche multi-colonnes : demande, client, type (texte) et date.
 */
export async function listDemandesCompact(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page ?? "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? "20", 10)));
    const skip = (page - 1) * limit;
    const type = (req.query.type || "all").toString().toLowerCase();
    const qRaw = (req.query.q || "").toString().trim();

    const rx = qRaw ? new RegExp(escRx(qRaw), "i") : null;
    const dateRange = parseDateRange(qRaw);

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

    // Construit les $match pour les collections sous-jacentes (avant que 'type' n'existe)
    const mkMatch = () => {
      const or = [];

      if (rx) {
        or.push(
          { numero: rx },
          { devisNumero: rx },
          { "devis.numero": rx },
          { "client.nom": rx },
          { "client.prenom": rx },
          // recherche via user (après lookup)
          { "__user.prenom": rx },
          { "__user.nom": rx },
          { "__user.firstName": rx },
          { "__user.lastName": rx },
          { "__user.email": rx }
          // ⚠️ PAS de { type: rx } ici — 'type' n'existe pas encore à ce stade
        );
      }

      if (dateRange) {
        const [start, end] = dateRange;
        // recherche par date (si le schéma expose date/createdAt)
        or.push(
          { createdAt: { $gte: start, $lte: end } },
          { date: { $gte: start, $lte: end } }
        );
      }

      return or.length ? [{ $match: { $or: or } }] : [];
    };

    // Étapes communes pour chaque collection (inclut $lookup users)
    const commonStages = (typeLiteral) => {
      const stages = [
        // 1) récupération du user
        {
          $lookup: {
            from: "users",
            localField: "user",
            foreignField: "_id",
            as: "__userArr",
          },
        },
        {
          $addFields: {
            __user: { $ifNull: [{ $arrayElemAt: ["$__userArr", 0] }, null] },
          },
        },

        // 2) normalisation des champs
        {
          $addFields: {
            __keepId: "$_id",
            __devisNumero: { $ifNull: ["$devisNumero", "$devis.numero"] },

            // ordre prioritaire: client.prenom -> client.firstName -> this.prenom -> user.prenom/firstName
            __first: {
              $ifNull: [
                "$client.prenom",
                {
                  $ifNull: [
                    "$client.firstName",
                    {
                      $ifNull: [
                        "$prenom",
                        { $ifNull: ["$firstName", { $ifNull: ["$__user.prenom", "$__user.firstName"] }] },
                      ],
                    },
                  ],
                },
              ],
            },
            __last: {
              $ifNull: [
                "$client.nom",
                {
                  $ifNull: [
                    "$client.lastName",
                    {
                      $ifNull: [
                        "$nom",
                        { $ifNull: ["$lastName", { $ifNull: ["$__user.nom", "$__user.lastName"] }] },
                      ],
                    },
                  ],
                },
              ],
            },

            __email: { $ifNull: ["$client.email", { $ifNull: ["$email", "$__user.email"] }] },
            __numTel: { $ifNull: ["$client.numTel", { $ifNull: ["$numTel", "$__user.numTel"] }] },

            __hasDemandePdf: { $ne: ["$demandePdf", null] },

            // compter pièces jointes
            __attachmentsCount: {
              $cond: [{ $isArray: "$documents" }, { $size: "$documents" }, 0],
            },
          },
        },

        // 3) projection compacte pour la liste (+ création du champ 'type')
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
                    { $ifNull: ["$__first", ""] },
                    " ",
                    { $ifNull: ["$__last", ""] },
                  ],
                },
              },
            },
            client: {
              prenom: { $ifNull: ["$__first", ""] },
              nom: { $ifNull: ["$__last", ""] },
              email: { $ifNull: ["$__email", ""] },
              numTel: { $ifNull: ["$__numTel", ""] },
            },
            date: "$createdAt",
            hasDemandePdf: "$__hasDemandePdf",
            attachments: "$__attachmentsCount",
          },
        },
      ];

      // 4) maintenant que 'type' existe, on peut filtrer dessus si q est textuel
      if (rx) {
        stages.push({ $match: { type: rx } });
      }
      return stages;
    };

    const basePipeline = [...mkMatch(), ...commonStages(bases[0].t)];

    const unionStages = unions.map(({ model, t }) => ({
      $unionWith: {
        coll: model.collection.name,
        pipeline: [...mkMatch(), ...commonStages(t)],
      },
    }));

    const finalPipeline = [
      ...basePipeline,
      ...unionStages,
      ...(type !== "all" ? [{ $match: { type } }] : []), // filtre strict par type si sélectionné via dropdown
      { $sort: { date: -1 } },
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

    const [agg] = await base.model.aggregate(finalPipeline).allowDiskUse(true);
    const rows = agg?.items || [];

    const items = rows.map((d) => {
      const ddvPdf = d.hasDemandePdf
        ? `${ORIGIN}/api/devis/${d.type}/${d._id}/pdf`
        : null;
      const devisPdf = d.devisNumero
        ? `${ORIGIN}/files/devis/${d.devisNumero}.pdf`
        : null;

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

    return res.json({
      success: true,
      page,
      limit,
      total: agg?.total || 0,
      items,
    });
  } catch (e) {
    console.error("listDemandesCompact error:", e);
    return res
      .status(500)
      .json({ success: false, message: "Erreur serveur" });
  }
}
