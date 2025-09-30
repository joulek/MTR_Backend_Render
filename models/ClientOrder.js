// models/ClientOrder.js
import mongoose from "mongoose";
const { Schema, Types } = mongoose;

const ClientOrderSchema = new Schema(
  {
    user:        { type: Types.ObjectId, ref: "User", required: true },
    devisId:     { type: Types.ObjectId, ref: "Devis", required: true }, // ✅ الجديد
    devisNumero: { type: String, default: null },
    devisPdf:    { type: String, default: null },
    demandeNumeros: [{ type: String }],
    demandeType: { type: String, enum: ["autre","compression","traction","torsion","fil","grille"] },
    status:      { type: String, enum: ["confirmed", "cancelled"], default: "confirmed" },
    note:        { type: String },
  },
  { timestamps: true }
);

// ❌ احذف القديم user+demandeId
// ✅ أضف الجديد user+devisId
ClientOrderSchema.index({ user: 1, devisId: 1 }, { unique: true, name: "user_1_devisId_1" });

export default mongoose.models.ClientOrder || mongoose.model("ClientOrder", ClientOrderSchema);
