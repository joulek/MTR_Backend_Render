import multer from "multer";
import path from "path";
import fs from "fs";

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");

// تأكد اللي الفولدر موجود
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// تنظيف اسم الملف
function cleanName(name = "file") {
  const ext = path.extname(name).toLowerCase() || ".bin";
  const base = path.basename(name, ext).replace(/[^\w.-]+/g, "_");
  return `${Date.now()}-${base}${ext}`;
}

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => cb(null, cleanName(file.originalname || "file")),
});

export const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 5 }, // 5MB
});
