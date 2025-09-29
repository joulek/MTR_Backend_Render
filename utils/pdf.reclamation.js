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

      // --- Réglages d'alignement visuel
      const LOGO_W = 120;       // largeur cible du logo
      const LOGO_H = 60;        // hauteur visuelle approx. du logo
      const TOP_Y  = 0;         // colle un peu plus en haut
      const TITLE_SIZE = 30;    // taille du titre
      const TITLE_Y = TOP_Y + 18; // position du titre (bandeau commun logo+titre)

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

      /* ======================= ENTÊTE ======================= */

      // 1) Logo — on positionne pour qu'il tombe sur la même "ligne" visuelle que le titre
      //    (centre vertical du logo ≈ centre de la ligne du titre)
      try {
        const logoPath = path.resolve(process.cwd(), "assets/logo.png");
        const logoY = TITLE_Y - (LOGO_H - TITLE_SIZE) / 2 - 2; // petit offset pour l’œil
        doc.image(logoPath, PAGE_LEFT, logoY, {
          width: LOGO_W, height: LOGO_H, fit: [LOGO_W, LOGO_H]
        });
      } catch {}

      // 2) Titre centré
      doc
        .font("Helvetica-Bold")
        .fontSize(TITLE_SIZE)
        .fillColor(NAVY)
        .text("Réclamation", 0, TITLE_Y, { width: doc.page.width, align: "center" });

      // 3) Réf / Date — on les DESCEND nettement sous le titre
      const metaY = TITLE_Y + 28; // ↓ plus bas
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

      const dateY = metaY + 20; // ↓ encore un cran
      const xDateValue = PAGE_RIGHT - dateValueW;
      const xDateLabel = xDateValue - dateLabelW;

      doc.font("Helvetica").fontSize(10).text(dateLabel, xDateLabel, dateY);
      doc.font("Helvetica-Bold").fontSize(10).text(dateValue, xDateValue, dateY);

      // ligne de séparation sous le bloc header
      const headerRuleY = dateY + 22;
      doc.moveTo(PAGE_LEFT, headerRuleY).lineTo(PAGE_RIGHT, headerRuleY)
         .strokeColor(BORDER).lineWidth(1).stroke();

      /* ======================= CLIENT (descendu) ======================= */

      const blockTop = headerRuleY + 18; // ↓ encore de l’air avant "Client"
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

      /* ======================= COMMANDE ======================= */
      const CARD_SPACE_Y = 26; // espace un peu plus large entre cartes
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

      /* ======================= RÉCLAMATION ======================= */
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
