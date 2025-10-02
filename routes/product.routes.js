// MTR_Backend/routes/product.routes.js
import { Router } from "express";
import {
  createProduct,
  getProducts,
  getProductById,
  updateProduct,
  deleteProduct,
  getProductsByCategory,
} from "../controllers/product.controller.js";

// ✅ importer ton middleware commun
import { upload } from "../middlewares/upload.js";

const router = Router();

// Routes produits
router.get("/", getProducts);
router.get("/by-category/:categoryId", getProductsByCategory);

// Création produit avec images (max 20 fichiers)
router.post("/", upload.array("images", 20), createProduct);

// Récupération par ID
router.get("/:id", getProductById);

// Mise à jour produit avec images
router.put("/:id", upload.array("images", 20), updateProduct);

// Suppression
router.delete("/:id", deleteProduct);

export default router;
