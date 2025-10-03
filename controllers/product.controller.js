// controllers/products.controller.js
import fs from "fs";
import path from "path";
import Product from "../models/Product.js";

const UPLOAD_PUBLIC_URL = "/uploads";
const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");

/** URL عامة ثابتة تحت /uploads */
function toPublicPath(filename) {
  return `${UPLOAD_PUBLIC_URL}/${filename}`;
}

/** احذف ملف ماديًا لو موجود (best effort) */
function safeUnlinkByPublicUrl(publicUrl) {
  try {
    const idx = publicUrl.indexOf(UPLOAD_PUBLIC_URL + "/");
    if (idx === -1) return;
    const rel = publicUrl.slice(idx + UPLOAD_PUBLIC_URL.length + 1);
    const abs = path.join(UPLOAD_DIR, rel);
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch {}
}

/** حوّل أي قيمة لصيغة نسبية تحت /uploads */
function extractUploadsRel(u) {
  try {
    if (!u) return null;
    let str = String(u);
    if (/^https?:\/\//i.test(str)) {
      try {
        const parsed = new URL(str);
        str = parsed.pathname || "/";
      } catch {}
    }
    str = str.replace(/^\/+/, "");
    if (str.startsWith("uploads/")) return str.slice("uploads/".length);
    return str;
  } catch {
    return null;
  }
}

/* ---------- CREATE ---------- */
export const createProduct = async (req, res) => {
  try {
    const { name_fr, name_en, description_fr, description_en, category } = req.body;

    const images = (req.files || [])
      .map((f) => f?.filename)
      .filter(Boolean)
      .map(toPublicPath);

    const product = await Product.create({
      name_fr,
      name_en,
      description_fr,
      description_en,
      category,
      images,
    });

    const populated = await product.populate("category");
    res.status(201).json(populated);
  } catch (err) {
    console.error("createProduct ERROR:", err);
    res.status(500).json({ message: "Error creating product", error: err.message });
  }
};

/* ---------- READ ALL ---------- */
export const getProducts = async (req, res) => {
  try {
    const products = await Product.find().populate("category").sort({ createdAt: -1 });
    res.json(products);
  } catch (err) {
    console.error("getProducts ERROR:", err);
    res.status(500).json({ message: "Error fetching products", error: err.message });
  }
};

/* ---------- READ ONE ---------- */
export const getProductById = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).populate("category");
    if (!product) return res.status(404).json({ message: "Product not found" });
    res.json(product);
  } catch (err) {
    console.error("getProductById ERROR:", err);
    res.status(500).json({ message: "Error fetching product", error: err.message });
  }
};

/* ---------- UPDATE ---------- */
export const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name_fr,
      name_en,
      description_fr,
      description_en,
      category,
      replaceImages,
    } = req.body;

    let { removeImages } = req.body;
    if (typeof removeImages === "string") {
      try { removeImages = JSON.parse(removeImages); } catch { removeImages = [removeImages]; }
    }
    if (!Array.isArray(removeImages)) removeImages = [];

    const uploaded = (req.files || [])
      .map((f) => f?.filename)
      .filter(Boolean)
      .map(toPublicPath);

    const product = await Product.findById(id);
    if (!product) return res.status(404).json({ message: "Product not found" });

    if (name_fr !== undefined) product.name_fr = name_fr;
    if (name_en !== undefined) product.name_en = name_en;
    if (description_fr !== undefined) product.description_fr = description_fr;
    if (description_en !== undefined) product.description_en = description_en;
    if (category) product.category = category;

    if (replaceImages === true || replaceImages === "true") {
      for (const url of product.images) safeUnlinkByPublicUrl(url);
      product.images = uploaded;
    } else {
      if (removeImages.length) {
        const removeSet = new Set(
          removeImages.map((u) => extractUploadsRel(u)).filter(Boolean)
        );
        const keep = [];
        for (const url of product.images) {
          const rel = extractUploadsRel(url);
          if (rel && removeSet.has(rel)) safeUnlinkByPublicUrl(url);
          else keep.push(url);
        }
        product.images = keep;
      }
      if (uploaded.length) product.images.push(...uploaded);
    }

    await product.save();
    const populated = await product.populate("category");
    res.json(populated);
  } catch (err) {
    console.error("updateProduct ERROR:", err);
    res.status(500).json({ message: "Error updating product", error: err.message });
  }
};

/* ---------- DELETE ---------- */
export const deleteProduct = async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });
    for (const url of product.images || []) safeUnlinkByPublicUrl(url);
    res.json({ success: true, message: "Product deleted" });
  } catch (err) {
    console.error("deleteProduct ERROR:", err);
    res.status(500).json({ message: "Error deleting product", error: err.message });
  }
};

/* ---------- BY CATEGORY ---------- */
export const getProductsByCategory = async (req, res) => {
  try {
    const prods = await Product.find({ category: req.params.categoryId })
      .populate("category")
      .sort({ createdAt: -1 });
    res.json(prods);
  } catch (err) {
    console.error("getProductsByCategory ERROR:", err);
    res.status(500).json({ message: "Error fetching products by category", error: err.message });
  }
};
