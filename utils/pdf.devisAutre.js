// utils/pdf.devisAutre.js
import PDFDocument from "pdfkit";
import dayjs from "dayjs";
import fs from "fs";
import path from "path";

/**
 * Construit un PDF (Buffer) pour la demande "Autre article".
 * @param {Object} devis - Doc hydraté (avec user populé si possible)
 * @returns {Promise<Buffer>}
 */
export function buildDevisAutrePDF(devis = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });

    /* ===== Buffer ===== */
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    /* ===== Style tokens ===== */
    const PRIMARY = "#002147";           // bleu marine MTR
    const LIGHT   = "#F5F7FB";
    const BORDER  = "#D5D9E4";
    const TXT     = "#111";

    const LEFT    = doc.page.margins.left;
    const RIGHT   = doc.page.width - doc.page.margins.right;
    const TOP     = doc.page.margins.top;
    const BOTTOM  = doc.page.height - doc.page.margins.bottom;
    const INNER_W = RIGHT - LEFT;

    const PRODUCT_LABEL = "Autre Type";

    /* ===== Helpers ===== */
    const safe = (v, dash = "—") =>
      v === null || v === undefined || String(v).trim() === "" ? dash : String(v).trim();
    const sanitize = (v) => safe(v).replace(/\s*\n+\s*/g, " ");
    const hasText  = (v) => v !== null && v !== undefined && String(v).trim() !== "";

    const get = (obj, paths = []) => {
      for (const p of paths) {
        const v = p.split(".").reduce((a, k) => (a && a[k] !== undefined ? a[k] : undefined), obj);
        if (v === undefined || v === null) continue;
        if (typeof v === "object") continue; // évite [object Object]
        const s = String(v).trim();
        if (s) return s;
      }
      return "";
    };

    const tryImage = (pathsArr = []) => {
      for (const p of pathsArr) {
        try {
          const abs = path.resolve(process.cwd(), p);
          if (fs.existsSync(abs)) return abs;
        } catch {}
      }
      return null;
    };

    // Texte sur 1 ligne (réduction auto)
    const fitOneLine = ({ text, x, y, width, bold = false, maxSize = 10.5, minSize = 8 }) => {
      const fontName = bold ? "Helvetica-Bold" : "Helvetica";
      let size = maxSize;
      doc.font(fontName);
      while (size > minSize) {
        doc.fontSize(size);
        const w = doc.widthOfString(text);
        if (w <= width) break;
        size -= 0.5;
      }
      doc.fontSize(size).text(text, x, y, { width, lineBreak: false, align: "left" });
      return size;
    };

    let y = TOP;
    const rule = (yy, color = BORDER) =>
      doc.moveTo(LEFT, yy).lineTo(RIGHT, yy).strokeColor(color).lineWidth(1).stroke();

    const section = (label, yy, x = LEFT, w = INNER_W) => {
      const h = 22;
      doc
        .save()
        .fillColor(PRIMARY)
        .rect(x, yy, w, h)
        .fill()
        .fillColor("#fff")
        .font("Helvetica-Bold")
        .fontSize(11)
        .text(label, x + 10, yy + 4, { width: w - 20, align: "left" })
        .restore();
      return yy + h;
    };

    const ensureSpace = (needed) => {
      if (y + needed > BOTTOM) {
        doc.addPage();
        y = TOP;
      }
    };

    /* ===== Données ===== */
    const {
      _id,
      numero,
      createdAt,
      user = {},
      spec = {},
      exigences,
      remarques,
      type,
      quantite: quantiteDevis, // éventuel fallback porté par "devis"
    } = devis || {};

    const client = {
      nom: get(user, ["nom", "lastName", "name.last", "fullname"]),
      prenom: get(user, ["prenom", "firstName", "name.first"]),
      email: get(user, ["email"]),
      tel: get(user, ["numTel", "telephone", "phone", "tel"]),
      adresse: get(user, ["adresse", "address", "location.address"]),
    };

    /* ===== En-tête (logo + titres) ===== */
    // Réglages indépendants (comme demandé)
    const SAFE_TOP = 10;
    const HEADER_SHIFT_UP = 28;           // bouge tout le bandeau si besoin
    const HEADER_Y = Math.max(SAFE_TOP, TOP - HEADER_SHIFT_UP);

    const TITLE_OFFSET_DOWN = 36;         // ↓ titre plus bas
    const LOGO_EXTRA_UP = 18;             // ↑ logo plus haut

    const logoPath = tryImage(["assets/logo.png"]);
    const logoW = 210, logoHMax = 100;
    const logoY = Math.max(SAFE_TOP - 2, HEADER_Y - 12 - LOGO_EXTRA_UP);
    if (logoPath) doc.image(logoPath, LEFT, logoY, { fit: [logoW, logoHMax] });

    // Titres en bleu marine
    const titleTop = HEADER_Y + TITLE_OFFSET_DOWN;
    doc
      .fillColor(PRIMARY)
      .font("Helvetica-Bold")
      .fontSize(20)
      .text("Demande de devis", LEFT, titleTop, { width: INNER_W, align: "center" });

    const h1 = doc.heightOfString("Demande de devis", { width: INNER_W });
    const subTop = titleTop + h1 + 4;
    doc
      .font("Helvetica-Bold")
      .fontSize(22)
      .fillColor(PRIMARY)
      .text(PRODUCT_LABEL, LEFT, subTop, { width: INNER_W, align: "center" });

    // Méta à droite — valeur en GRAS, libellé normal
    const subH = doc.heightOfString(PRODUCT_LABEL, { width: INNER_W });
    const metaTop = subTop + subH + 6;

    const metaFontSize = 10;
    const numLabel = "N° : ";
    const numValue = numero ? String(numero) : (_id ? String(_id) : "");
    doc.font("Helvetica-Bold").fontSize(metaFontSize);
    const numValW = doc.widthOfString(numValue);
    const numValX = RIGHT - numValW;
    doc.text(numValue, numValX, metaTop, { lineBreak: false });

    doc.font("Helvetica").fontSize(metaFontSize);
    const numLblW = doc.widthOfString(numLabel);
    doc.text(numLabel, numValX - numLblW, metaTop, { lineBreak: false });

    const dateLabel = "Date : ";
    const dateValue = dayjs(createdAt || Date.now()).format("DD/MM/YYYY HH:mm");
    doc.font("Helvetica-Bold").fontSize(metaFontSize);
    const dateValW = doc.widthOfString(dateValue);
    const dateValX = RIGHT - dateValW;
    doc.text(dateValue, dateValX, metaTop + 14, { lineBreak: false });

    doc.font("Helvetica").fontSize(metaFontSize);
    const dateLblW = doc.widthOfString(dateLabel);
    doc.text(dateLabel, dateValX - dateLblW, metaTop + 14, { lineBreak: false });

    rule(metaTop + 24);
    y = metaTop + 34;

    /* ===== Client ===== */
    y = section("Client", y);

    // Champs user supplémentaires
    const accountType = (get(user, ["accountType"]) || "").toLowerCase();
    const role        = get(user, ["role"]);

    const cin        = get(user, ["personal.cin"]);
    const postePers  = get(user, ["personal.posteActuel"]);

    const mf         = get(user, ["company.matriculeFiscal"]);
    const nomSociete = get(user, ["company.nomSociete"]);
    const posteSoc   = get(user, ["company.posteActuel"]);

    const accountLabel =
      accountType === "societe"   ? "Société"   :
      accountType === "personnel" ? "Personnel" : (accountType || "");

    // Liste dynamique des paires (label, valeur)
    const clientPairs = [];
    const pushPair = (k, v) => { if (hasText(v)) clientPairs.push([k, sanitize(v)]); };

    // Identité + méta
    pushPair("Nom", [client.prenom, client.nom].filter(Boolean).join(" "));
    pushPair("Type de compte", accountLabel);
    pushPair("Rôle", role);

    // Bloc entreprise (si présent)
    if (accountType === "societe" || hasText(nomSociete) || hasText(mf) || hasText(posteSoc)) {
      pushPair("Raison sociale", nomSociete);
      pushPair("Matricule fiscal", mf);
      pushPair("Poste (société)", posteSoc);
    }

    // Bloc personnel (si présent)
    if (accountType === "personnel" || hasText(cin) || hasText(postePers)) {
      pushPair("CIN", cin);
      pushPair("Poste (personnel)", postePers);
    }

    // Contacts
    pushPair("Email", client.email);
    pushPair("Tél.", client.tel);
    pushPair("Adresse", client.adresse);

    const rowHClient = 18, labelW = 120;
    const clientBoxH = rowHClient * clientPairs.length + 8;
    ensureSpace(clientBoxH + 12);

    doc.rect(LEFT, y, INNER_W, clientBoxH).strokeColor(BORDER).stroke();

    let cy = y + 6;
    clientPairs.forEach(([k, v]) => {
      fitOneLine({ text: k, x: LEFT + 8, y: cy, width: labelW, bold: true, maxSize: 10, minSize: 8 });
      fitOneLine({ text: v, x: LEFT + 8 + labelW + 6, y: cy, width: INNER_W - (labelW + 26), maxSize: 10, minSize: 8 });
      cy += rowHClient;
    });
    y += clientBoxH + 14;

    /* ===== Spécifications (table bi-colonne) ===== */
    const pairs = [];
    const pushIf = (label, value) => { if (hasText(value)) pairs.push([label, sanitize(value)]); };

    // Champs issus du formulaire "Autre article"
    pushIf("Désignation / Référence", spec.titre || spec.designation);
    pushIf("Dimensions principales", spec.dimensions || spec.dim || spec.dimension);
    pushIf("Quantité", spec.quantite ?? quantiteDevis);
    pushIf("Matière", spec.matiere);
    if (hasText(spec.matiereAutre)) pushIf("Matière (autre)", spec.matiereAutre);

    // Passage en lignes de 2 colonnes
    const rows = [];
    for (let i = 0; i < pairs.length; i += 2) rows.push([pairs[i], pairs[i + 1] || ["", ""]]);

    const rowH  = 28;
    const halfW = Math.floor(INNER_W / 2);
    const padX  = 6;
    const labLW = 170;
    const labRW = 185;
    const valLW = halfW - (labLW + padX * 3);
    const valRW = halfW - (labRW + padX * 3);

    const tableH = rows.length * rowH;
    if (y + 22 + tableH + 10 > BOTTOM) { doc.addPage(); y = TOP; }
    y = section("Spécifications principales", y);

    const tableTop = y;
    if (rows.length) {
      doc.rect(LEFT, tableTop, INNER_W, tableH).strokeColor(BORDER).lineWidth(1).stroke();

      rows.forEach((r, i) => {
        const yy = tableTop + i * rowH;
        if (i % 2 === 0) doc.save().fillColor(LIGHT).rect(LEFT, yy, INNER_W, rowH).fill().restore();

        doc.moveTo(LEFT, yy).lineTo(RIGHT, yy).strokeColor(BORDER).stroke();
        doc.moveTo(LEFT + halfW, yy).lineTo(LEFT + halfW, yy + rowH).strokeColor(BORDER).stroke();

        // Colonne gauche
        fitOneLine({ text: r[0][0], x: LEFT + padX, y: yy + 6, width: labLW, bold: true, maxSize: 10.5, minSize: 8 });
        fitOneLine({ text: r[0][1], x: LEFT + padX + labLW + padX, y: yy + 6, width: valLW, maxSize: 10.5, minSize: 7.5 });

        // Colonne droite
        fitOneLine({ text: r[1][0], x: LEFT + halfW + padX, y: yy + 6, width: labRW, bold: true, maxSize: 10.5, minSize: 8 });
        fitOneLine({ text: r[1][1], x: LEFT + halfW + padX + labRW + padX, y: yy + 6, width: valRW, maxSize: 10.5, minSize: 7.5 });
      });

      doc.moveTo(LEFT, tableTop + tableH).lineTo(RIGHT, tableTop + tableH).strokeColor(BORDER).stroke();
      y = tableTop + tableH + 12;
    }

    /* ===== Description (bloc) ===== */
    if (hasText(spec.description)) {
      const text = sanitize(spec.description);
      const h = Math.max(56, doc.font("Helvetica").fontSize(10).heightOfString(text, { width: INNER_W - 20 }) + 14);
      if (y + 22 + h + 10 > BOTTOM) { doc.addPage(); y = TOP; }
      y = section("Description de l'article", y);
      doc.save().fillColor("#fff").rect(LEFT, y, INNER_W, h).fill().restore();
      doc.rect(LEFT, y, INNER_W, h).strokeColor(BORDER).stroke();
      doc.font("Helvetica").fontSize(10).fillColor(TXT).text(text, LEFT + 10, y + 8, { width: INNER_W - 20 });
      y += h + 10;
    }

    /* ===== Exigences & Remarques ===== */
    const blocks = [];
    if (hasText(exigences)) {
      const t = sanitize(exigences);
      const h = Math.max(56, doc.font("Helvetica").fontSize(10).heightOfString(t, { width: INNER_W - 20 }) + 14);
      blocks.push({ title: "Exigences particulières", text: t, h });
    }
    if (hasText(remarques)) {
      const t = sanitize(remarques);
      const h = Math.max(56, doc.font("Helvetica").fontSize(10).heightOfString(t, { width: INNER_W - 20 }) + 14);
      blocks.push({ title: "Autres remarques", text: t, h });
    }

    if (blocks.length) {
      // Forcer une page propre pour ces sections
      doc.addPage(); y = TOP;
      for (const b of blocks) {
        y = section(b.title, y);
        doc.save().fillColor("#fff").rect(LEFT, y, INNER_W, b.h).fill().restore();
        doc.rect(LEFT, y, INNER_W, b.h).strokeColor(BORDER).stroke();
        doc.font("Helvetica").fontSize(10).fillColor(TXT).text(b.text, LEFT + 10, y + 8, { width: INNER_W - 20 });
        y += b.h + 10;
      }
    }

    /* ===== Pied de page ===== */
    ensureSpace(40);
    rule(BOTTOM - 18);
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#555")
      .text("Document généré automatiquement — MTR", LEFT, BOTTOM - 14, { width: INNER_W, align: "center" });

    doc.end();
  });
}
