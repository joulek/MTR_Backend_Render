// MTR_Backend/routes/product.routes.js
import { Router } from "express";
import {
  createProduct,
  getProducts,
  getProductById,
  updateProduct,
  deleteProduct,
  getProductsByCategory                // ⬅️ import

} from "../controllers/product.controller.js";
const router = Router();
// routes/product.routes.js (مثال)
import multer from "multer";
import path from "path";

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, path.resolve(process.cwd(), "uploads")),
  filename: (_, file, cb) => {
    // اسم نظيف + امتداد
    const ext = path.extname(file.originalname || "").toLowerCase() || ".bin";
    const base = path.basename(file.originalname || "file", ext)
                  .replace(/[^\w.-]+/g, "_");
    cb(null, `${Date.now()}-${base}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 10 },
});


router.get("/", getProducts);
router.get("/by-category/:categoryId", getProductsByCategory); // ⬅️ NEW


router.post("/", upload.array("images", 20), createProduct);
router.get("/:id", getProductById);
router.put("/:id", upload.array("images", 20), updateProduct); // maj avec images
router.delete("/:id", deleteProduct);


export default router;
