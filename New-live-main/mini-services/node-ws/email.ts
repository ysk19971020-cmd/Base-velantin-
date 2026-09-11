// ---------------------------------------------------------------------------
// Live-stream email alerts via Gmail SMTP (nodemailer).
//
// Requires two env vars (delivered as Base44 secrets):
//   GMAIL_USER         — the Gmail address to send from
//   GMAIL_APP_PASSWORD — 16-char App Password (Google Account → Security →
//                        2-Step Verification → App passwords). A regular
//                        account password will NOT work with Gmail SMTP.
// Optional:
//   APP_URL            — link back to the app in the email body
//
// When the Gmail credentials are not configured, sending is skipped with a
// warning so the realtime layer keeps working without them.
// ---------------------------------------------------------------------------

import nodemailer from 'nodemailer';
import { createDb, type Db } from './db';

// Trim: pasted credentials often carry a stray space/newline, which Gmail
// rejects with 535 BadCredentials.
const GMAIL_USER = (process.env.GMAIL_USER || '').trim();
const GMAIL_APP_PASSWORD = (process.env.GMAIL_APP_PASSWORD || '').trim();
const APP_URL = (process.env.APP_URL || '').trim().replace(/\/$/, '');

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;
function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });
  return transporter;
}

export async function notifySubscribersOfLive(db: Db, hostName: string, title: string): Promise<void> {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    console.warn('[ws][email] GMAIL_USER / GMAIL_APP_PASSWORD not set — skipping live-stream email alerts.');
    return;
  }

  try {
    const subscribers = await db.getSubscribers();
    if (subscribers.length === 0) {
      console.log('[ws][email] live started — no subscribers to notify.');
      return;
    }

    // Single message with everyone on BCC: efficient and keeps the
    // subscriber list private.
    await getTransporter().sendMail({
      from: `"Valentine Express" <${GMAIL_USER}>`,
      bcc: subscribers.map((s) => (s.name ? `"${s.name}" <${s.email}>` : s.email)),
      subject: `🔴 ${hostName} is live on Valentine Express!`,
      text: `${hostName} just started a live stream: "${title}".` + (APP_URL ? `\n\nJoin now: ${APP_URL}` : ''),
      html: `
        <div style="font-family:'Segoe UI',Helvetica,Arial,sans-serif;background:#fff5f6;padding:32px;border-radius:18px;max-width:520px;margin:0 auto;color:#4a1420;">
          <p style="letter-spacing:0.16em;font-size:11px;text-transform:uppercase;color:#fb7185;margin:0 0 8px;">Valentine Express</p>
          <h2 style="margin:0 0 12px;">🔴 ${hostName} is live!</h2>
          <p style="margin:0 0 20px;font-size:15px;">They just started streaming: <strong>${title}</strong></p>
          ${APP_URL ? `<a href="${APP_URL}" style="display:inline-block;background:linear-gradient(180deg,#fb7185,#e11d48);color:#fff;text-decoration:none;padding:12px 20px;border-radius:12px;font-weight:650;">Join the stream</a>` : ''}
        </div>
      `,
    });

    console.log(`[ws][email] live-stream alert sent to ${subscribers.length} subscriber${subscribers.length === 1 ? '' : 's'}.`);
  } catch (err: any) {
    const reason = err?.responseCode || err?.code || err?.message || 'unknown error';
    console.error(
      `[ws][email] failed to send live-stream alerts (Gmail said: ${reason}).` +
        (err?.responseCode === 535
          ? ' Gmail rejected the login — check GMAIL_USER / GMAIL_APP_PASSWORD (needs a 16-char App Password with 2-Step Verification enabled).'
          : ''),
    );
  }
}
