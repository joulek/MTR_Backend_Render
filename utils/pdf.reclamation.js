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

      /* --------- Constantes --------- */
      const NAVY   = "#003366",
            LIGHT  = "#F3F3F8",
            BORDER = "#C8C8D8";

      const PAGE_LEFT  = 40;
      const TABLE_W    = 515;
      const PAGE_RIGHT = PAGE_LEFT + TABLE_W;
      const CARD_SPACE_Y = 28;
      const LOGO_W = 120; // taille logo

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
      const topY = 10; // logo plus haut

      // Logo
      try {
        const logoPath = path.resolve(process.cwd(), "assets/logo.png");
        doc.image(logoPath, PAGE_LEFT, topY, {
          width: LOGO_W,
          height: LOGO_W,
          fit: [LOGO_W, LOGO_W],
        });
      } catch {
        /* si le logo manque, on ignore pour ne pas casser le rendu */
      }

      // Titre centré (légèrement descendu)
      doc.font("Helvetica-Bold")
        .fontSize(22)
        .fillColor(NAVY)
        .text("Réclamation ", 0, topY + 35, { align: "center" });

      // Bloc Réf / Date (placé juste au-dessus de "Client")
      const metaY = topY + LOGO_W + 10;

      const refLabel = "Réf : ";
      const refValue = safe(rec?.numero);
      const refValueWidth = (() => { doc.font("Helvetica-Bold").fontSize(10); return doc.widthOfString(refValue); })();
      const refLabelWidth = (() => { doc.font("Helvetica").fontSize(10); return doc.widthOfString(refLabel); })();
      const refValueX = PAGE_RIGHT - refValueWidth;
      const refLabelX = refValueX - refLabelWidth;

      doc.font("Helvetica").fontSize(10).fillColor("#000").text(refLabel, refLabelX, metaY);
      doc.font("Helvetica-Bold").fontSize(10).text(refValue, refValueX, metaY);

      const dateLabel = "Date : ";
      const dateValue = dateStr;
      const dateValueWidth = (() => { doc.font("Helvetica-Bold").fontSize(10); return doc.widthOfString(dateValue); })();
      const dateLabelWidth = (() => { doc.font("Helvetica").fontSize(10); return doc.widthOfString(dateLabel); })();
      const dateY = metaY + 16;
      const dateValueX = PAGE_RIGHT - dateValueWidth;
      const dateLabelX = dateValueX - dateLabelWidth;

      doc.font("Helvetica").fontSize(10).text(dateLabel, dateLabelX, dateY);
      doc.font("Helvetica-Bold").fontSize(10).text(dateValue, dateValueX, dateY);

      /* ======================= BLOC CLIENT ======================= */
      const blockTop = metaY + 40; // bloc Client un peu plus bas

      const CLIENT_H = 120;
      let nextY = drawSectionTitle("Client", PAGE_LEFT, blockTop, TABLE_W);
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
