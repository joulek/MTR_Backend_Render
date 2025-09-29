// utils/pdf.reclamation.js
import PDFDocument from "pdfkit";
import path from "path";
import dayjs from "dayjs";

export async function buildReclamationPDF(rec) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 40 });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));

      /* --------- Styles & constantes --------- */
      const NAVY   = "#002147";   // bleu marine MTR
      const LIGHT  = "#F3F3F8";
      const BORDER = "#C8C8D8";

      const PAGE_LEFT  = 40;
      const TABLE_W    = 515;
      const PAGE_RIGHT = PAGE_LEFT + TABLE_W;

      const LOGO_W = 120; // taille logo
      const TOP_Y  = 4;   // 🔼 logo un peu plus haut (avant: 10)

      const safe = (s = "") => String(s ?? "").trim() || "—";
      const dateStr = dayjs(rec?.createdAt || Date.now()).format("DD/MM/YYYY HH:mm:ss");

      const u = rec?.user || {};
      const c = rec?.commande || {};

      const drawSectionTitle = (label, x, y, w) => {
        doc.save()
          .fillColor(NAVY)
          .rect(x, y, w, 20).fill()
          .fillColor("#FFF")
          .font("Helvetica-Bold").fontSize(11)
          .text(label, x + 10, y + 4, { width: w - 20, align: "left" })
          .restore();
        return y + 20;
      };

      const drawKeyValue = (pairs, x, y, w, lineH = 18, labelW = 95) => {
        doc.fontSize(10).fillColor("#000");
        pairs.forEach(([label, value]) => {
          doc.font("Helvetica-Bold").text(label, x, y, { width: labelW, align: "left" });
          doc.font("Helvetica").text(value, x + labelW, y, { width: w - labelW, align: "left" });
          y += lineH;
        });
        return y;
      };

      /* ======================= HEADER ======================= */

      // 1) Logo (un peu plus haut)
      try {
        const logoPath = path.resolve(process.cwd(), "assets/logo.png");
        doc.image(logoPath, PAGE_LEFT, TOP_Y, {
          width: LOGO_W, height: LOGO_W, fit: [LOGO_W, LOGO_W],
        });
      } catch {}

      // 2) Titre centré
      const titleY = TOP_Y + 26; // équilibré avec logo
      doc
        .font("Helvetica-Bold")
        .fontSize(26)
        .fillColor(NAVY)
        .text("Réclamation", 0, titleY, { width: doc.page.width, align: "center" });

      // 3) Réf / Date — un peu plus bas que précédemment
      const metaY = titleY + 14; // 🔽 avant: +6
      const refLabel = "Réf : ";
      const refValue = safe(rec?.numero);

      doc.font("Helvetica").fontSize(10);
      const refLabelW = doc.widthOfString(refLabel);
      doc.font("Helvetica-Bold").fontSize(10);
      const refValueW = doc.widthOfString(refValue);

      const xRefValue = PAGE_RIGHT - refValueW;
      const xRefLabel = xRefValue - refLabelW;
      doc.font("Helvetica").fontSize(10).fillColor("#000").text(refLabel, xRefLabel, metaY);
      doc.font("Helvetica-Bold").fontSize(10).text(refValue, xRefValue, metaY);

      const dateLabel = "Date : ";
      const dateValue = dateStr;

      doc.font("Helvetica").fontSize(10);
      const dateLabelW = doc.widthOfString(dateLabel);
      doc.font("Helvetica-Bold").fontSize(10);
      const dateValueW = doc.widthOfString(dateValue);

      const dateY = metaY + 18; // 🔽 avant: +16
      const xDateValue = PAGE_RIGHT - dateValueW;
      const xDateLabel = xDateValue - dateLabelW;

      doc.font("Helvetica").fontSize(10).text(dateLabel, xDateLabel, dateY);
      doc.font("Helvetica-Bold").fontSize(10).text(dateValue, xDateValue, dateY);

      // ligne de séparation
      doc
        .moveTo(PAGE_LEFT, dateY + 22) // 🔽 un peu plus d’air
        .lineTo(PAGE_RIGHT, dateY + 22)
        .strokeColor(BORDER)
        .lineWidth(1)
        .stroke();

      /* ======================= BLOC CLIENT (descendu un peu) ======================= */

      const blockTop = dateY + 36; // 🔽 avant: +28
      let nextY = drawSectionTitle("Client", PAGE_LEFT, blockTop, TABLE_W);

      const CLIENT_H = 120;
      const clientRectY = nextY;
      doc.rect(PAGE_LEFT, clientRectY, TABLE_W, CLIENT_H).strokeColor(BORDER).stroke();

      drawKeyValue(
        [
          ["Nom", `${safe(u.prenom)} ${safe(u.nom)}`.trim()],
          ["Email", safe(u.email)],
          ["Tél", safe(u.numTel)],
          ["Adresse", safe(u.adresse)],
        ],
        PAGE_LEFT + 10,
        clientRectY + 8,
        TABLE_W - 20
      );

      /* ======================= BLOC COMMANDE ======================= */
      const CARD_SPACE_Y = 24; // un peu plus d’espace
      const CMD_H = 140;

      nextY = clientRectY + CLIENT_H + CARD_SPACE_Y;
      const cmdTitleBottom = drawSectionTitle("Commande", PAGE_LEFT, nextY, TABLE_W);
      const cmdRectY = cmdTitleBottom;

      doc.rect(PAGE_LEFT, cmdRectY, TABLE_W, CMD_H).strokeColor(BORDER).stroke();

      drawKeyValue(
        [
          ["Type doc", safe(c.typeDoc)],
          ["Numéro", safe(c.numero)],
          ["Date livr.", c.dateLivraison ? dayjs(c.dateLivraison).format("DD/MM/YYYY") : "—"],
          ["Réf prod.", safe(c.referenceProduit)],
          ["Quantité", String(c.quantite ?? "—")],
        ],
        PAGE_LEFT + 10,
        cmdRectY + 8,
        TABLE_W - 20
      );

      /* ======================= BLOC RÉCLAMATION ======================= */
      const afterBlocksY = cmdRectY + CMD_H + CARD_SPACE_Y;

      let ry = drawSectionTitle("Réclamation", PAGE_LEFT, afterBlocksY, TABLE_W);
      doc.save().rect(PAGE_LEFT, ry, TABLE_W, 56).fill(LIGHT).restore();
      doc.rect(PAGE_LEFT, ry, TABLE_W, 56).strokeColor(BORDER).stroke();

      ry = drawKeyValue(
        [
          ["Nature", safe(rec?.nature)],
          ["Attente", safe(rec?.attente)],
        ],
        PAGE_LEFT + 10,
        ry + 8,
        TABLE_W - 20
      );

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
