import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import multer from "multer";
// ... tes imports de routes

dotenv.config();

const app = express();
const upload = multer({ limits: { fileSize: 5 * 1024 * 1024, files: 10 } });

// ✅ L'origine publique du backend (utile pour construire des URLs absolues)
export const PUBLIC_ORIGIN = (
  process.env.PUBLIC_ORIGIN || "https://mtr-backend-render.onrender.com"
).replace(/\/$/, "");

// ✅ Frontends autorisés (Render + local)
const FRONTEND_ORIGIN = (
  process.env.FRONTEND_ORIGIN || "https://mtr-frontend-render.onrender.com"
).replace(/\/$/, "");

const ALLOWED_ORIGINS = [
  FRONTEND_ORIGIN,
  "http://localhost:3000",
  "http://localhost:5173",
];

// Render/Heroku proxies
app.set("trust proxy", 1);

// ✅ CORS correct (avec cookies)
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);            // ex: curl/postman
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(null, false);                        // refus silencieux
      // ou: return cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// parsers, statiques, Mongo, routes, 404, erreur globale… (inchangé)

// DÉMARRAGE
const PORT = process.env.PORT || 4000;
const server = app.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);

// shutdown handlers…
export default app;
