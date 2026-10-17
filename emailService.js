const { Resend } = require('resend');

/**
 * ShareBite Transactional Email Service
 * 
 * Powered by the official Resend Node.js SDK.
 * Compatible with Vercel Serverless Functions.
 */

// Memory store for test inspections ONLY (never logged or exposed outside test assertions)
const _testSentEmails = [];

/**
 * Validate required email configuration environment variables
 */
function validateConfig() {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;

    const missing = [];
    if (!apiKey || !apiKey.trim() || apiKey.trim() === 'YOUR_RESEND_API_KEY') {
        missing.push('RESEND_API_KEY');
    }
    if (!from || !from.trim()) {
        missing.push('EMAIL_FROM');
    }

    return {
        isValid: missing.length === 0,
        missing,
        apiKey: apiKey ? apiKey.trim() : null,
        from: from ? from.trim() : null
    };
}

/**
 * Retrieve last sent email record for an address (ONLY for automated testing)
 */
function getLastSentEmailForTesting(email) {
    const clean = (email || '').trim().toLowerCase();
    for (let i = _testSentEmails.length - 1; i >= 0; i--) {
        if (_testSentEmails[i].to.toLowerCase() === clean) {
            return _testSentEmails[i];
        }
    }
    return null;
}

/**
 * Clear test email records (used by test suite)
 */
function clearTestEmails() {
    _testSentEmails.length = 0;
}

/**
 * Build professional branded HTML email template for ShareBite password reset
 */
function buildResetEmailHtml({ userName, otpCode }) {
    const name = userName ? userName.trim() : 'Valued Member';
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ShareBite - Password Reset OTP</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f6f8; margin: 0; padding: 20px; color: #1e293b; }
    .container { max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; }
    .header { background: linear-gradient(135deg, #059669 0%, #10b981 100%); padding: 32px 24px; text-align: center; color: #ffffff; }
    .logo { font-size: 26px; font-weight: 800; letter-spacing: -0.5px; margin: 0; }
    .logo span { color: #d1fae5; }
    .subtitle { font-size: 14px; opacity: 0.9; margin-top: 6px; }
    .content { padding: 32px 28px; }
    .greeting { font-size: 18px; font-weight: 600; margin-bottom: 12px; color: #0f172a; }
    .message { font-size: 15px; line-height: 1.6; color: #475569; margin-bottom: 24px; }
    .otp-card { background: #f0fdf4; border: 2px dashed #86efac; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px; }
    .otp-label { font-size: 13px; text-transform: uppercase; font-weight: 700; color: #15803d; letter-spacing: 1px; margin-bottom: 8px; }
    .otp-code { font-size: 38px; font-weight: 800; letter-spacing: 8px; color: #047857; font-family: 'Courier New', monospace; margin: 4px 0; }
    .otp-expiry { font-size: 13px; color: #16a34a; font-weight: 600; margin-top: 8px; }
    .warning-box { background: #fffbeb; border-left: 4px solid #f59e0b; padding: 14px 16px; border-radius: 6px; margin-bottom: 24px; }
    .warning-text { font-size: 13px; color: #92400e; margin: 0; line-height: 1.5; }
    .footer { background: #f8fafc; padding: 20px 28px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 class="logo">🍃 Share<span>Bite</span></h1>
      <p class="subtitle">Food Redistribution & Surplus Sharing Platform</p>
    </div>
    <div class="content">
      <div class="greeting">Hello, ${name}</div>
      <p class="message">
        We received a request to reset the password for your ShareBite account. Please use the verification code below to authorize your password change.
      </p>
      
      <div class="otp-card">
        <div class="otp-label">Your One-Time Passcode</div>
        <div class="otp-code">${otpCode}</div>
        <div class="otp-expiry">⏱️ Expires in 5 minutes (single-use)</div>
      </div>

      <div class="warning-box">
        <p class="warning-text">
          <strong>Security Notice:</strong> Never share this code with anyone. ShareBite employees and administrators will NEVER ask for your verification code.
        </p>
      </div>

      <p class="message" style="font-size: 13px; color: #64748b; margin-bottom: 0;">
        If you did not request a password reset, please disregard this email. Your password and account remain completely safe and unchanged.
      </p>
    </div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} ShareBite Platform. Together reducing food waste and hunger.<br>
      Automated security notification — Please do not reply directly to this email.
    </div>
  </div>
</body>
</html>
    `.trim();
}

/**
 * Format sender address
 */
function formatFromAddress(from) {
    if (!from) return 'ShareBite <onboarding@resend.dev>';
    if (from.includes('<') && from.includes('>')) return from;
    return `ShareBite <${from}>`;
}

/**
 * Send password reset OTP email using the official Resend SDK
 * @param {Object} options
 * @param {string} options.to - Recipient email
 * @param {string} options.userName - Recipient name
 * @param {string} options.otp - 6-digit plain OTP
 * @param {Object} [options.overrideConfig] - Optional config override for testing
 * @returns {Promise<{ success: boolean, provider: string, messageId?: string, error?: string }>}
 */
async function sendPasswordResetEmail({ to, userName, otp, overrideConfig = null }) {
    if (!to || !otp) {
        throw new Error('Recipient email and OTP are required.');
    }

    const config = overrideConfig || validateConfig();

    const subject = 'ShareBite - Password Reset OTP';
    const textContent = `Your ShareBite password reset code is: ${otp}\n\nThis single-use code expires in 5 minutes.\nIf you did not request this, please safely ignore this email.\nNever share this code with anyone.`;
    const htmlContent = buildResetEmailHtml({ userName, otpCode: otp });

    // Store in internal test store for test assertions
    _testSentEmails.push({
        to,
        userName,
        otp,
        sentAt: new Date().toISOString()
    });

    // 1. If configuration is missing required environment variables
    if (!config.isValid) {
        const errorMsg = `Email configuration incomplete: Missing ${config.missing.join(', ')}`;
        return {
            success: false,
            provider: 'resend',
            error: errorMsg,
            missing: config.missing
        };
    }

    // 2. Dispatch using the official Resend SDK
    try {
        const resend = new Resend(config.apiKey);
        const fromAddress = formatFromAddress(config.from);

        const { data, error } = await resend.emails.send({
            from: fromAddress,
            to: [to],
            subject,
            text: textContent,
            html: htmlContent
        });

        if (error) {
            console.error('[EmailService] Resend API error:', error.message);
            return {
                success: false,
                provider: 'resend',
                error: error.message
            };
        }

        return {
            success: true,
            provider: 'resend',
            messageId: data ? data.id : null
        };
    } catch (err) {
        console.error('[EmailService] Resend dispatch exception:', err.message);
        return {
            success: false,
            provider: 'resend',
            error: err.message
        };
    }
}

module.exports = {
    validateConfig,
    sendPasswordResetEmail,
    buildResetEmailHtml,
    formatFromAddress,
    getLastSentEmailForTesting,
    clearTestEmails
};
