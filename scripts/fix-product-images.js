// scripts/fix-product-images.js
import mongoose from "mongoose";
import path from "path";
import fs from "fs";
import Product from "../models/Product.js";

const MONGO = process.env.MONGODB_URI || "mongodb://localhost:27017/myapp_db";
await mongoose.connect(MONGO);

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");

const hasValidExt = (s) => /\.(png|jpe?g|webp|gif|svg)$/i.test(s || "");

let fixed = 0;
for (const p of await Product.find({})) {
  const before = Array.isArray(p.images) ? p.images : [];
  const after = before
    .map((u) => {
      if (!u) return null;
      // شيل أصل الرابط وخلي pathname
      if (/^https?:\/\//i.test(u)) {
        try { u = new URL(u).pathname || "/"; } catch {}
      }
      if (!u.startsWith("/")) u = "/" + u;
      if (!u.startsWith("/uploads/")) u = "/uploads/" + u.replace(/^\/+/, "");
      return u;
    })
    .filter(Boolean)
    .filter((u) => {
      if (!hasValidExt(u)) return false;
      const rel = u.replace(/^\/+/, "");
      const abs = path.join(process.cwd(), rel);
      return fs.existsSync(abs);
    });

  if (JSON.stringify(before) !== JSON.stringify(after)) {
    p.images = after;
    await p.save();
    fixed++;
  }
}

console.log(`✅ fixed ${fixed} products`);
await mongoose.disconnect();
