import nodemailer from 'nodemailer'

import { config } from './config.js'

/**
 * SMTP mailer for backend-sent transactional email — the verified email-change
 * confirmation and the recovery-address confirmation. Auth flows never send mail
 * from here (authentik owns those); this exists for the custom features the SPA
 * can't drive directly.
 *
 * The transport is created lazily on first send so the backend boots fine
 * without SMTP configured; sending then fails with a clear error instead.
 */

let transport = null

function getTransport() {
  if (!config.smtp.host) {
    throw new Error('SMTP is not configured (set SMTP_HOST etc.) — cannot send email.')
  }
  if (!transport) {
    transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined
    })
  }
  return transport
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * The IETF-branded shell every confirmation email shares: standalone,
 * email-client-safe (table layout, inline styles), with a prefers-color-scheme
 * dark variant. Callers supply only the wording.
 *
 * `paragraphs` and `closing` are plain strings (escaped here); `name`, `url` and
 * `expiresText` are interpolated into the greeting, the button and the footer.
 */
function renderActionEmailHtml({
  title,
  preheader,
  heading,
  name,
  paragraphs,
  buttonLabel,
  url,
  expiresText,
  closing
}) {
  const safeUrl = escapeHtml(url)
  const body = paragraphs
    .map((text) => `<p style="margin:0 0 16px 0;">${escapeHtml(text)}</p>`)
    .join('\n                ')
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <title>${escapeHtml(title)}</title>
    <style>
      @media (prefers-color-scheme: dark) {
        .email-body { background-color:#0b1220 !important; }
        .email-card { background-color:#111c2e !important; border-top-color:#38bdf8 !important; }
        .email-h1 { color:#f1f5f9 !important; }
        .email-text { color:#cbd5e1 !important; }
        .email-muted { color:#94a3b8 !important; }
        .email-footer-border { border-top-color:#334155 !important; }
        .email-link { color:#7dd3fc !important; }
        .logo-light { display:none !important; }
        .logo-dark { display:inline-block !important; }
      }
    </style>
  </head>
  <body class="email-body" style="margin:0; padding:0; background-color:#f1f5f9; -webkit-text-size-adjust:100%;">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0;">
      ${escapeHtml(preheader)}
    </div>
    <table role="presentation" class="email-body" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" class="email-card" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px; background-color:#ffffff; border-radius:12px; border-top:4px solid #0284c7; overflow:hidden;">
            <tr>
              <td style="padding:32px 40px 8px 40px; font-family:Helvetica,Arial,sans-serif;">
                <img src="https://static.ietf.org/logos/ietf-email-logo.png" alt="IETF" class="logo-light"
                     width="140" height="80"
                     style="display:block; border:0; width:140px; height:80px; max-width:140px;" />
                <img src="https://static.ietf.org/logos/ietf-email-logo-inverted.png" alt="IETF" class="logo-dark"
                     width="140" height="80"
                     style="display:none; border:0; width:140px; height:80px; max-width:140px;" />
              </td>
            </tr>
            <tr>
              <td style="padding:16px 40px 8px 40px; font-family:Helvetica,Arial,sans-serif;">
                <h1 class="email-h1" style="margin:0; font-size:20px; line-height:1.3; color:#0f172a; font-weight:600;">
                  ${escapeHtml(heading)}
                </h1>
              </td>
            </tr>
            <tr>
              <td class="email-text" style="padding:12px 40px 0 40px; font-family:Helvetica,Arial,sans-serif; font-size:15px; line-height:1.6; color:#334155;">
                <p style="margin:0 0 16px 0;">Hi ${escapeHtml(name)},</p>
                ${body}
              </td>
            </tr>
            <tr>
              <td style="padding:12px 40px 8px 40px;" align="left">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td align="center" bgcolor="#0284c7" style="border-radius:8px;">
                      <a href="${safeUrl}" target="_blank" rel="noopener"
                         style="display:inline-block; padding:13px 30px; font-family:Helvetica,Arial,sans-serif; font-size:16px; font-weight:600; color:#ffffff; text-decoration:none; border-radius:8px;">
                        ${escapeHtml(buttonLabel)}
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td class="email-muted" style="padding:8px 40px 0 40px; font-family:Helvetica,Arial,sans-serif; font-size:13px; line-height:1.6; color:#64748b;">
                <p style="margin:0 0 4px 0;">If the button doesn't work, copy and paste this link into your browser:</p>
                <p style="margin:0; word-break:break-all;"><a href="${safeUrl}" target="_blank" rel="noopener" class="email-link" style="color:#0369a1;">${safeUrl}</a></p>
              </td>
            </tr>
            <tr>
              <td class="email-muted" style="padding:16px 40px 0 40px; font-family:Helvetica,Arial,sans-serif; font-size:13px; line-height:1.6; color:#64748b;">
                <p style="margin:0;">This link is valid for ${escapeHtml(expiresText)}.</p>
              </td>
            </tr>
            <tr>
              <td class="email-muted email-footer-border" style="padding:20px 40px 32px 40px; font-family:Helvetica,Arial,sans-serif; font-size:13px; line-height:1.6; color:#94a3b8; border-top:1px solid #e2e8f0;">
                <p style="margin:16px 0 0 0;">
                  ${escapeHtml(closing)}
                </p>
                <p style="margin:12px 0 0 0;">For any questions, contact <a href="mailto:support@ietf.org" class="email-link" style="color:#0369a1;">support@ietf.org</a></p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

// Plain-text alternative, built from the same wording as the HTML part.
function renderActionEmailText({ name, paragraphs, url, expiresText, closing }) {
  return (
    `Hi ${name},\n\n` +
    `${paragraphs.join('\n\n')}\n\n` +
    `${url}\n\n` +
    `This link is valid for ${expiresText}.\n\n` +
    `${closing}\n`
  )
}

async function sendActionEmail({ to, subject, ...content }) {
  await getTransport().sendMail({
    from: config.smtp.from,
    to,
    subject,
    html: renderActionEmailHtml(content),
    text: renderActionEmailText(content)
  })
}

// Send the verified email-change confirmation to the NEW address.
export async function sendEmailChangeVerification({ to, name, url, expiresText }) {
  await sendActionEmail({
    to,
    subject: 'Confirm your new IETF account email address',
    title: 'Confirm your new IETF account email',
    preheader: 'Confirm this new email address for your IETF account.',
    heading: 'Confirm your new email address',
    name,
    paragraphs: [
      'We received a request to change the email address on your IETF account to this one. ' +
        'Please confirm it to complete the change — your account will use this address for ' +
        'signing in and all future messages.'
    ],
    buttonLabel: 'Confirm new email address',
    url,
    expiresText,
    closing:
      "If you didn't request this change, you can safely ignore this email — your account's " +
      'email address won\'t be changed unless this link is opened and confirmed.'
  })
}

// Send the recovery-address confirmation to the address being ADDED. Until this
// link is opened and confirmed, the address is not on the account's recovery list
// — see backend/routes/recovery-emails.js.
export async function sendRecoveryEmailVerification({ to, name, url, expiresText, account }) {
  await sendActionEmail({
    to,
    subject: 'Confirm this recovery email address for your IETF account',
    title: 'Confirm your IETF account recovery email',
    preheader: 'Confirm this address as a recovery email for your IETF account.',
    heading: 'Confirm your recovery email address',
    name,
    paragraphs: [
      `We received a request to add this address as a recovery email for the IETF account ${account}.`,
      'Recovery addresses are only used to get back into the account if access to the primary ' +
        'email address is lost — they cannot be used to sign in.'
    ],
    buttonLabel: 'Confirm recovery email address',
    url,
    expiresText,
    closing:
      "If you didn't request this, you can safely ignore this email — the address won't be " +
      'added to that account unless this link is opened and confirmed.'
  })
}
