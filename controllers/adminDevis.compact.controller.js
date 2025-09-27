// controllers/adminDevis.compact.controller.js
import Devis from "../models/Devis.js";

// ⚠️ Adapte ces imports aux chemins réels de tes modèles Demande*
import DemandeCompression from "../models/DevisCompression.js";
import DemandeTraction    from "../models/DevisTraction.js";
import DemandeTorsion     from "../models/DevisTorsion.js";
import DemandeFil         from "../models/DevisFilDresse.js";
import DemandeGrille      from "../models/DevisGrille.js";
import DemandeAutre       from "../models/DevisAutre.js";

// (optionnel mais utile pour fallback) – si tes demandes référencent un user
import User from "../models/User.js";

const ORIGIN = process.env.PUBLIC_BACKEND_URL || `http://localhost:${process.env.PORT}`;

/* -------------------------------------------------------------------------- */
/*                               Utils (Mongo)                                */
/* -------------------------------------------------------------------------- */

// Construit un stage $addFields qui fabrique first/last + fullName à partir
// des candidats possibles (client.*, contact.*, champs à plat, et user.*)
function makeClientNameFields(prefix = "") {
  // prefix vide pour documents directs, ou par ex. "client." si tu veux forcer
  const p = (k) => (prefix ? `${prefix}${k}` : k);

  return [
    // Lookup user (fallback – optionnel si "user" existe dans le doc)
    {
      $lookup: {
        from: User.collection?.name || "users",
        localField: "user",
        foreignField: "_id",
        as: "_user",
      },
    },
    {
      $addFields: {
        _userName:  { $arrayElemAt: ["$_user.name",  0] },
        _userEmail: { $arrayElemAt: ["$_user.email", 0] },
      },
    },

    // Découpe user.name => first/last pour dernier recours
    {
      $addFields: {
        _userNameParts: {
          $filter: {
            input: { $split: ["$_userName", " "] },
            as: "p",
            cond: { $and: [{ $ne: ["$$p", null] }, { $ne: ["$$p", ""] }] },
          },
        },
        _userFirst: { $arrayElemAt: ["$_userNameParts", 0] },
        _userLast:  {
          $cond: [
            { $gt: [{ $size: "$_userNameParts" }, 1] },
            { $arrayElemAt: ["$_userNameParts", -1] },
            null,
          ],
        },
      },
    },

    // Candidats pour first / last
    {
      $addFields: {
        _firstCandidates: [
          `$${p("client.prenom")}`,
          `$${p("client.firstName")}`,
          `$${p("firstName")}`,
          `$${p("prenom")}`,
          `$${p("contact.prenom")}`,
          `$${p("contact.firstName")}`,
          "$_userFirst",
        ],
        _lastCandidates: [
          `$${p("client.nom")}`,
          `$${p("client.lastName")}`,
          `$${p("lastName")}`,
          `$${p("nom")}`,
          `$${p("contact.nom")}`,
          `$${p("contact.lastName")}`,
          "$_userLast",
        ],
      },
    },

    // Prendre le premier non vide
    {
      $addFields: {
        _firstName: {
          $let: {
            vars: {
              cleaned: {
                $filter: {
                  input: "$_firstCandidates",
                  as: "v",
                  cond: { $and: [{ $ne: ["$$v", null] }, { $ne: ["$$v", ""] }] },
                },
              },
            },
            in: {
              $cond: [
                { $gt: [{ $size: "$$cleaned" }, 0] },
                { $arrayElemAt: ["$$cleaned", 0] },
                null,
              ],
            },
          },
        },
        _lastName: {
          $let: {
            vars: {
              cleaned: {
                $filter: {
                  input: "$_lastCandidates",
                  as: "v",
                  cond: { $and: [{ $ne: ["$$v", null] }, { $ne: ["$$v", ""] }] },
                },
              },
            },
            in: {
              $cond: [
                { $gt: [{ $size: "$$cleaned" }, 0] },
                { $arrayElemAt: ["$$cleaned", 0] },
                null,
              ],
            },
          },
        },
      },
    },

    // Fallback nom complet si first/last absents
    {
      $addFields: {
        _nameStringCandidates: [
          `$${p("client.name")}`,
          `$${p("clientNom")}`,
          `$${p("societe")}`,
          `$${p("company")}`,
          "$_userName",
          `$${p("email")}`,
          `$${p("client.email")}`,
        ],
      },
    },
    {
      $addFields: {
        _nameString: {
          $let: {
            vars: {
              cleaned: {
                $filter: {
                  input: "$_nameStringCandidates",
                  as: "v",
                  cond: { $and: [{ $ne: ["$$v", null] }, { $ne: ["$$v", ""] }] },
                },
              },
            },
            in: {
              $cond: [
                { $gt: [{ $size: "$$cleaned" }, 0] },
                { $arrayElemAt: ["$$cleaned", 0] },
                null,
              ],
            },
          },
        },
      },
    },

    // Compose "Prénom Nom" si on a au moins un des deux ; sinon _nameString
    {
      $addFields: {
        _clientFullName: {
          $cond: [
            { $or: [{ $ne: ["$_firstName", null] }, { $ne: ["$_lastName", null] }] },
            {
              $trim: {
                input: {
                  $concat: [
                    { $ifNull: ["$_firstName", ""] },
                    " ",
                    { $ifNull: ["$_lastName", ""] },
                  ],
                },
              },
            },
            "$_nameString",
          ],
        },
      },
    },
  ];
}

// Étend le $match de recherche pour couvrir plusieurs clés de client
function extendClientSearch(rx, baseMatch = []) {
  if (!rx) return baseMatch;
  const m = {
    $or: [
      { numero: rx },
      { devisNumero: rx },
      { "devis.numero": rx },

      // variantes client
      { "client.nom": rx },
      { "client.name": rx },
      { "client.prenom": rx },
      { clientNom: rx },
      { prenom: rx },
      { nom: rx },
      { societe: rx },
      { company: rx },
      { "contact.nom": rx },
      { "contact.prenom": rx },
      { "client.email": rx },
      { email: rx },
    ],
  };
  return [{ $match: m }, ...baseMatch];
}

/* -------------------------------------------------------------------------- */
/*                              Devis (compact)                               */
/* -------------------------------------------------------------------------- */

export async function listDevisCompact(req, res) {
  try {
    const page  = Math.max(1, parseInt(req.query.page ?? "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? "20", 10)));
    const skip  = (page - 1) * limit;
    const type  = (req.query.type || "all").toString().toLowerCase();
    const q     = (req.query.q || "").toString().trim();
    const rx    = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null;

    const match = {};
    if (type && type !== "all") {
      match["meta.demandes.type"] = type;
    }

    const pipeline = [
      { $match: match },
      ...extendClientSearch(rx),                 // recherche large
      ...makeClientNameFields(""),               // fabrique _clientFullName

      // Préparer pdf + demandes/types depuis meta + anciens champs
      {
        $project: {
          numero: 1,
          createdAt: 1,
          client: "$_clientFullName",
          devisPdf: { $concat: [ORIGIN, "/files/devis/", "$numero", ".pdf"] },

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
          client: 1,
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
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $facet: {
          meta:  [{ $count: "total" }],
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
      client: d.client || "",             // ← "Prénom Nom" prêt
      date: d.createdAt,
    }));

    return res.json({ success: true, page, limit, total: agg?.total || 0, items });
  } catch (e) {
    console.error("listDevisCompact error:", e);
    return res.status(500).json({ success: false, message: "Erreur serveur" });
  }
}

/* -------------------------------------------------------------------------- */
/*                            Demandes (compact all)                           */
/* -------------------------------------------------------------------------- */

export async function listDemandesCompact(req, res) {
  try {
    const page  = Math.max(1, parseInt(req.query.page ?? "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? "20", 10)));
    const skip  = (page - 1) * limit;
    const type  = (req.query.type || "all").toString().toLowerCase();
    const qRaw  = (req.query.q || "").toString().trim();
    const rx    = qRaw ? new RegExp(qRaw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null;

    const bases = [
      { model: DemandeCompression, t: "compression" },
      { model: DemandeTraction,    t: "traction"    },
      { model: DemandeTorsion,     t: "torsion"     },
      { model: DemandeFil,         t: "fil"         },
      { model: DemandeGrille,      t: "grille"      },
      { model: DemandeAutre,       t: "autre"       },
    ];
    const base = bases[0];
    const unions = bases.slice(1);

    // Pipeline standard par collection
    const commonProjection = (typeLiteral) => ([
      ...extendClientSearch(rx),               // recherche large
      ...makeClientNameFields(""),             // produit _clientFullName

      // Extraire numero devis (2 formats) + projection finale
      {
        $addFields: {
          _devisNumero: { $ifNull: ["$devisNumero", "$devis.numero"] },
        },
      },
      {
        $project: {
          _id: 0,
          demandeNumero: "$numero",
          type: { $literal: typeLiteral },
          devisNumero: "$_devisNumero",
          client: "$_clientFullName",          // ← "Prénom Nom" prêt
          date: "$createdAt",
        },
      },
    ]);

    const basePipeline = [...commonProjection(base.t)];
    const unionStages = unions.map(({ model, t }) => ({
      $unionWith: {
        coll: model.collection.name,
        pipeline: [...commonProjection(t)],
      },
    }));

    const finalPipeline = [
      ...basePipeline,
      ...unionStages,
      ...(type !== "all" ? [{ $match: { type } }] : []),
      { $sort: { date: -1 } },
      {
        $facet: {
          meta:  [{ $count: "total" }],
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

    const items = (agg?.items || []).map((d) => ({
      demandeNumero: d.demandeNumero,
      type: d.type,
      devisNumero: d.devisNumero || null,
      client: d.client || "",                  // ← "Prénom Nom"
      date: d.date,
      devisPdf: d.devisNumero ? `${ORIGIN}/files/devis/${d.devisNumero}.pdf` : null,
    }));

    return res.json({ success: true, page, limit, total: agg?.total || 0, items });
  } catch (e) {
    console.error("listDemandesCompact error:", e);
    return res.status(500).json({ success: false, message: "Erreur serveur" });
  }
}
