import nodemailer from "nodemailer";

export function makeTransport() {
  const host = process.env.SMTP_HOST || "ssl0.ovh.net";
  const port = Number(process.env.SMTP_PORT || 465);

  // 465 = SSL implicite (secure:true)
  // 587 = STARTTLS (secure:false + requireTLS:true)
  const useSecure = port === 465;

  return nodemailer.createTransport({
    host,
    port,
    secure: useSecure,
    requireTLS: !useSecure,            // pour 587
    auth: {
      user: process.env.SMTP_USER,     // ex: contact@mtr-ressorts.tn
      pass: process.env.SMTP_PASS,     // mdp de la boîte OVH
    },
    // évite les problèmes IPv6
    family: 4,
    // timeouts raisonnables
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    // impose TLS moderne
    tls: { minVersion: "TLSv1.2" },
    // utile pour diagnostiquer
    logger: true,
    debug: true,
  });
}
