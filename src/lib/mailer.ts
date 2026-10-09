/**
 * Email delivery via Nodemailer.
 * Config is read from app_settings (keys: smtp_host, smtp_port, smtp_user,
 * smtp_pass, smtp_from) with env-var fallbacks.
 */
import nodemailer from 'nodemailer';

type TransportOptions = Parameters<typeof nodemailer.createTransport>[0];
import { getDatabase } from './database-sqlite';

export interface MailOptions {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: { filename: string; content: Buffer | string; contentType?: string }[];
}

function getSmtpConfig() {
  let settings: Record<string, string> = {};
  try {
    settings = getDatabase().getAllSettings();
  } catch { /* DB not ready */ }

  return {
    host: settings['smtp_host'] ?? process.env.SMTP_HOST ?? 'localhost',
    port: parseInt(settings['smtp_port'] ?? process.env.SMTP_PORT ?? '587', 10),
    secure: (settings['smtp_secure'] ?? process.env.SMTP_SECURE ?? 'false') === 'true',
    user: settings['smtp_user'] ?? process.env.SMTP_USER ?? '',
    pass: settings['smtp_pass'] ?? process.env.SMTP_PASS ?? '',
    from: settings['smtp_from'] ?? process.env.SMTP_FROM ?? 'indexsphere@localhost',
  };
}

export async function sendEmail(opts: MailOptions): Promise<{ ok: boolean; error?: string }> {
  const cfg = getSmtpConfig();

  const transporterOpts: TransportOptions = {
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    ...(cfg.user ? { auth: { user: cfg.user, pass: cfg.pass } } : {}),
  } as TransportOptions;

  const transporter = nodemailer.createTransport(transporterOpts);

  try {
    await transporter.sendMail({
      from: cfg.from,
      to: Array.isArray(opts.to) ? opts.to.join(', ') : opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
      attachments: opts.attachments,
    });
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[mailer] send failed:', msg);
    return { ok: false, error: msg };
  }
}

/** Verify SMTP connectivity; returns {ok, error?} */
export async function testSmtpConnection(): Promise<{ ok: boolean; error?: string }> {
  const cfg = getSmtpConfig();
  const transporterOpts: TransportOptions = {
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    ...(cfg.user ? { auth: { user: cfg.user, pass: cfg.pass } } : {}),
  } as TransportOptions;
  const transporter = nodemailer.createTransport(transporterOpts);
  try {
    await transporter.verify();
    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
