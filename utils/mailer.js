import nodemailer from "nodemailer";

export function makeTransport() {
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = port === 465; // donc false ici

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,                 // false pour 587
    requireTLS: !secure,    // true pour 587
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    family: 4,              // force IPv4 (évite soucis IPv6)
    connectionTimeout: 20000,
    greetingTimeout: 15000, // ↑ augmente un peu
    socketTimeout: 25000,
    tls: { minVersion: "TLSv1.2" },
    logger: true,
    debug: true,
  });
}
