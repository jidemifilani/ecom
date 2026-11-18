import nodemailer, { type Transporter } from 'nodemailer';

import { isProduction, serverEnv } from './env';
import { logger } from './logger';

/**
 * Outbound email.
 *
 * Two transports are supported. `smtp` delivers for real; `log` writes the
 * message to the server log and is intended for local development, where no
 * mail server exists. `src/lib/env.ts` refuses to boot a production build with
 * `MAIL_TRANSPORT=log`, so mail can never be silently discarded in production.
 */

export type MailMessage = {
  to: string;
  subject: string;
  /** Plain-text body. Always provided, so the mail degrades gracefully. */
  text: string;
  html?: string;
};

let transporter: Transporter | null = null;

const getTransporter = (): Transporter => {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: serverEnv.SMTP_HOST,
    port: serverEnv.SMTP_PORT,
    secure: serverEnv.SMTP_SECURE,
    auth:
      serverEnv.SMTP_USER && serverEnv.SMTP_PASSWORD
        ? { user: serverEnv.SMTP_USER, pass: serverEnv.SMTP_PASSWORD }
        : undefined,
  });

  return transporter;
};

export const sendMail = async (message: MailMessage): Promise<void> => {
  if (serverEnv.MAIL_TRANSPORT === 'log') {
    // The body is logged in full on purpose: in development this is how you
    // retrieve a password-reset link. Guarded so it can never run in production.
    if (isProduction) {
      logger.error('Refusing to log mail bodies in production', { to: message.to });
      return;
    }
    logger.info('Outbound email (log transport)', {
      to: message.to,
      subject: message.subject,
      body: message.text,
    });
    return;
  }

  try {
    await getTransporter().sendMail({
      from: serverEnv.MAIL_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    });
    logger.info('Email sent', { to: message.to, subject: message.subject });
  } catch (error) {
    // Email delivery must not break the originating request - a failed reset
    // email is retried by the user, not by rolling back their account change.
    logger.error('Email delivery failed', { to: message.to, subject: message.subject, error });
  }
};

// ── Templates ────────────────────────────────────────────────────────────────

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const layout = (heading: string, bodyHtml: string): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:24px;background:#f1f5f9;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0">
    <tr><td style="padding:28px 28px 8px">
      <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3">${escapeHtml(heading)}</h1>
      ${bodyHtml}
    </td></tr>
    <tr><td style="padding:8px 28px 28px;color:#64748b;font-size:12px;line-height:1.6">
      If you did not expect this email you can safely ignore it.
    </td></tr>
  </table>
</body></html>`;

const button = (href: string, label: string): string =>
  `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="display:inline-block;background:#1e293b;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${escapeHtml(label)}</a></p>`;

export const passwordResetEmail = (
  name: string,
  resetUrl: string,
  expiryMinutes: number,
): MailMessage => ({
  to: '',
  subject: 'Reset your password',
  text: [
    `Hello ${name},`,
    '',
    'We received a request to reset your password. Open the link below to choose a new one:',
    resetUrl,
    '',
    `This link can be used once and expires in ${expiryMinutes} minutes.`,
    '',
    'If you did not request this, no action is needed and your password is unchanged.',
  ].join('\n'),
  html: layout(
    'Reset your password',
    `<p style="margin:0;line-height:1.6">Hello ${escapeHtml(name)},</p>
     <p style="margin:12px 0 0;line-height:1.6">We received a request to reset your password. Use the button below to choose a new one.</p>
     ${button(resetUrl, 'Choose a new password')}
     <p style="margin:0;color:#64748b;font-size:13px;line-height:1.6">This link can be used once and expires in ${expiryMinutes} minutes.</p>`,
  ),
});

export const staffInviteEmail = (
  name: string,
  loginUrl: string,
  temporaryPassword: string,
): MailMessage => ({
  to: '',
  subject: 'Your Ecom account is ready',
  text: [
    `Hello ${name},`,
    '',
    'An account has been created for you on the Ecom back office.',
    '',
    `Sign in at: ${loginUrl}`,
    `Temporary password: ${temporaryPassword}`,
    '',
    'You will be asked to set your own password the first time you sign in.',
  ].join('\n'),
  html: layout(
    'Your account is ready',
    `<p style="margin:0;line-height:1.6">Hello ${escapeHtml(name)},</p>
     <p style="margin:12px 0 0;line-height:1.6">An account has been created for you on the Ecom back office. You will be asked to set your own password when you first sign in.</p>
     <p style="margin:16px 0 0;line-height:1.6">Temporary password: <code style="background:#f1f5f9;padding:3px 7px;border-radius:5px;font-family:ui-monospace,monospace">${escapeHtml(temporaryPassword)}</code></p>
     ${button(loginUrl, 'Sign in')}`,
  ),
});

export const orderConfirmationEmail = (
  name: string,
  orderNumber: string,
  total: string,
  orderUrl: string,
): MailMessage => ({
  to: '',
  subject: `Order ${orderNumber} confirmed`,
  text: [
    `Hello ${name},`,
    '',
    `Thank you for your order. We have received order ${orderNumber} for ${total}.`,
    '',
    `Track it here: ${orderUrl}`,
  ].join('\n'),
  html: layout(
    `Order ${orderNumber} confirmed`,
    `<p style="margin:0;line-height:1.6">Hello ${escapeHtml(name)},</p>
     <p style="margin:12px 0 0;line-height:1.6">Thank you for your order. We have received order <strong>${escapeHtml(orderNumber)}</strong> for <strong>${escapeHtml(total)}</strong>.</p>
     ${button(orderUrl, 'View your order')}`,
  ),
});

export const orderShippedEmail = (
  name: string,
  orderNumber: string,
  carrier: string,
  trackingNumber: string | null,
  orderUrl: string,
): MailMessage => ({
  to: '',
  subject: `Order ${orderNumber} has shipped`,
  text: [
    `Hello ${name},`,
    '',
    `Order ${orderNumber} is on its way with ${carrier}.`,
    ...(trackingNumber ? [`Tracking number: ${trackingNumber}`] : []),
    '',
    `View your order: ${orderUrl}`,
  ].join('\n'),
  html: layout(
    `Order ${orderNumber} has shipped`,
    `<p style="margin:0;line-height:1.6">Hello ${escapeHtml(name)},</p>
     <p style="margin:12px 0 0;line-height:1.6">Order <strong>${escapeHtml(orderNumber)}</strong> is on its way with ${escapeHtml(carrier)}.</p>
     ${trackingNumber ? `<p style="margin:12px 0 0;line-height:1.6">Tracking number: <code style="background:#f1f5f9;padding:3px 7px;border-radius:5px">${escapeHtml(trackingNumber)}</code></p>` : ''}
     ${button(orderUrl, 'View your order')}`,
  ),
});

/** Sends one of the templates above to a concrete address. */
export const deliver = async (template: MailMessage, to: string): Promise<void> =>
  sendMail({ ...template, to });
