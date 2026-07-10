import nodemailer from "nodemailer";
import { captureException } from "@/lib/monitoring";

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;
let transporterInitAttempted = false;

function getTransporter() {
  if (transporterInitAttempted) return transporter;
  transporterInitAttempted = true;

  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  if (!host || !port) return null;

  transporter = nodemailer.createTransport({
    host,
    port: Number(port),
    // Porta 465 é sempre TLS implícito; qualquer outra (587, 25) usa
    // STARTTLS, negociado automaticamente pelo nodemailer.
    secure: Number(port) === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return transporter;
}

/**
 * Envia um e-mail transacional (hoje só usado para recuperação de senha —
 * ver `sendResetPassword` em lib/auth.ts). Nunca lança: sem SMTP_HOST
 * configurado (ex.: dev local sem servidor SMTP), só loga um aviso e
 * segue em frente — o Better Auth já responde com a mesma mensagem
 * genérica de sucesso independente de o e-mail ter sido enviado de fato,
 * então uma falha aqui nunca deve derrubar a requisição do usuário.
 */
export async function sendMail(params: { to: string; subject: string; html: string; text: string }): Promise<void> {
  const client = getTransporter();
  if (!client) {
    // eslint-disable-next-line no-console -- aviso operacional único (SMTP não configurado), não um erro de aplicação
    console.warn(`SMTP não configurado — e-mail para ${params.to} ("${params.subject}") não foi enviado.`);
    return;
  }

  try {
    await client.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    });
  } catch (error) {
    captureException(error, { to: params.to, subject: params.subject });
  }
}
