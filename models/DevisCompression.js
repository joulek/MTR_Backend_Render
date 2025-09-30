// models/DevisCompression.js
import mongoose from "mongoose";
import { devisBase } from "./_devisBase.js";

const spec = new mongoose.Schema({
  d: { type: Number, required: true },
  DE: { type: Number, required: true },
  H: Number,
  S: Number,
  DI: { type: Number, required: true },
  Lo: { type: Number, required: true },
  nbSpires: { type: Number, required: true },
  pas: Number,
  quantite: { type: Number, required: true },
  matiere: {
    type: String,
    enum: [
      "Fil ressort noir SH",
      "Fil ressort noir SM",
      "Fil ressort galvanisé",
      "Fil ressort inox",
    ],
    required: true,
  },
  enroulement: { type: String, enum: ["Enroulement gauche", "Enroulement droite"] },
  extremite: { type: String, enum: ["ERM", "EL", "ELM", "ERNM"] },
}, { _id: false });

// ✅ active les timestamps si pas déjà faits dans devisBase
const schema = new mongoose.Schema({}, { timestamps: true });
schema.add(devisBase);
schema.add({
  spec,
  demandePdf: {
    data: Buffer,
    contentType: String,
  },
});

// ✅ index pour accélérer le $sort (et limiter l’usage mémoire)
schema.index({ createdAt: -1 }); // ou { date: -1 } si tu tries sur "date"

export default mongoose.model("DemandeDevisCompression", schema);
