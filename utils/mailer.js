import nodemailer from "nodemailer";

export function makeTransport() {
  const port = Number(process.env.SMTP_PORT || 587);
  const useSecure = port === 465;

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: useSecure, // false pour 587
    requireTLS: !useSecure, // true pour 587
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    family: 4, // force IPv4
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    tls: { minVersion: "TLSv1.2" },
    logger: true,
    debug: true,
  });
}
