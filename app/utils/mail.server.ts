import nodemailer from "nodemailer";

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
};

let cachedTransporter: nodemailer.Transporter | null = null;
let cachedKey: string | null = null;

function readSmtpConfig(): SmtpConfig | null {
  const host = (process.env.SMTP_HOST ?? "").trim();
  const portRaw = (process.env.SMTP_PORT ?? "").trim();
  const user = (process.env.SMTP_USER ?? "").trim();
  const pass = process.env.SMTP_PASS ?? "";
  const from = (process.env.SMTP_FROM ?? "").trim();
  if (!host || !portRaw || !from) return null;

  const port = Number(portRaw);
  if (!Number.isFinite(port) || port <= 0) return null;

  const secureRaw = (process.env.SMTP_SECURE ?? "").trim().toLowerCase();
  const secure = secureRaw === "1" || secureRaw === "true" || port === 465;

  return {
    host,
    port,
    secure,
    user,
    pass,
    from,
  };
}

function transporterKey(cfg: SmtpConfig) {
  return `${cfg.host}:${cfg.port}:${cfg.secure}:${cfg.user}:${cfg.from}`;
}

function getTransporter(cfg: SmtpConfig) {
  const key = transporterKey(cfg);
  if (cachedTransporter && cachedKey === key) return cachedTransporter;

  cachedTransporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user || cfg.pass ? { user: cfg.user, pass: cfg.pass } : undefined,
  });
  cachedKey = key;
  return cachedTransporter;
}

export function resolveAppBaseUrl(request: Request) {
  const fromEnv = (process.env.APP_BASE_URL ?? "").trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return new URL(request.url).origin;
}

export async function sendPasswordResetEmail(args: {
  to: string;
  resetUrl: string;
}) {
  const cfg = readSmtpConfig();

  if (!cfg) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[auth] SMTP not configured. Reset link for ${args.to}: ${args.resetUrl}`);
      return;
    }
    throw new Error("SMTP is not configured. Set SMTP_HOST/SMTP_PORT/SMTP_FROM (and SMTP_USER/SMTP_PASS if required).");
  }

  const transporter = getTransporter(cfg);

  const subject = "Reset your account password";
  const text = [
    "You requested a password reset.",
    "",
    `Open this link to continue: ${args.resetUrl}`,
    "",
    "If you did not request this, you can ignore this email.",
  ].join("\n");

  const html = `
    <p>You requested a password reset.</p>
    <p><a href="${args.resetUrl}">Reset your password</a></p>
    <p>If you did not request this, you can ignore this email.</p>
  `;

  await transporter.sendMail({
    from: cfg.from,
    to: args.to,
    subject,
    text,
    html,
  });
}
