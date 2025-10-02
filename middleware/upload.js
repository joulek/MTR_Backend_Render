// MTR_Backend/middlewares/upload.js
import multer from "multer";
import path from "path";
import fs from "fs";

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// petit helper pour nettoyer/normaliser le nom
function sanitizeFilename(name = "") {
  return String(name)
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .toLowerCase();
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const original = sanitizeFilename(file.originalname || "");
    const ext = path.extname(original || "") || "";
    cb(null, `${unique}${ext}`);
  },
});

// Filtre MIME recommandé (images + pdf)
const fileFilter = (_req, file, cb) => {
  const ok =
    /^image\/(png|jpe?g|gif|webp)$/i.test(file.mimetype) ||
    file.mimetype === "application/pdf";
  if (!ok) return cb(new Error("Type de fichier non autorisé"), false);
  cb(null, true);
};

export const upload = multer({
  storage,
  fileFilter,                        // ← active le filtre
  limits: {
    fileSize: 10 * 1024 * 1024,      // 10 MB par fichier
    files: 4,                        // ← la limite correcte
  },
});
