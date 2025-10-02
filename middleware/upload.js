import multer from "multer";
import path from "path";
import fs from "fs";

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function cleanName(originalName = "file.png") {
  const ext = path.extname(originalName || ".png").toLowerCase() || ".png";
  const base = path.basename(originalName, ext)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")      // enlève accents
    .replace(/[^\w.-]+/g, "_")           // remplace espaces/char spéciaux
    .replace(/\.+/g, ".")                // condense les points
    .slice(0, 80);                       // limite longueur
  return `${Date.now()}-${base}${ext}`;
}

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => cb(null, cleanName(file.originalname || "image.png")),
});

export const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 20 },
});
