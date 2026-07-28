/**
 * Outbound email helpers.
 * Prefer Resend (https://resend.com) via RESEND_API_KEY + EMAIL_FROM.
 * Without email config, reset links are logged server-side only (dev/fallback).
 */

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendPasswordResetEmail(params: {
  to: string;
  resetUrl: string;
  name?: string | null;
}): Promise<{ sent: boolean }> {
  const { to, resetUrl, name } = params;
  const subject = "Reset your Steen Run Club password";
  const greeting = name?.trim() ? `Hi ${name.trim()},` : "Hi,";
  const text = `${greeting}

We received a request to reset your Steen Run Club password.

Open this link within 1 hour:
${resetUrl}

If you didn't ask for this, you can ignore this email — your password won't change.

— Steen Run Club
`;

  const html = `
    <p>${greeting}</p>
    <p>We received a request to reset your <strong>Steen Run Club</strong> password.</p>
    <p><a href="${resetUrl}" style="color:#1f8f5f;font-weight:600">Reset your password</a></p>
    <p style="color:#666;font-size:14px">This link expires in 1 hour. If you didn't request it, ignore this email.</p>
    <p>— Steen Run Club</p>
  `;

  if (!isEmailConfigured()) {
    // Fallback so local/test still works without an email provider
    console.warn(
      "[email] RESEND_API_KEY / EMAIL_FROM not set. Password reset link (dev):\n",
      resetUrl,
    );
    return { sent: false };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [to],
        subject,
        text,
        html,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error("[email] Resend failed:", res.status, body.slice(0, 400));
      // Still log link so ops can help a friend in a pinch
      console.warn("[email] Fallback reset link:\n", resetUrl);
      return { sent: false };
    }
    return { sent: true };
  } catch (err) {
    console.error("[email] send error:", err);
    console.warn("[email] Fallback reset link:\n", resetUrl);
    return { sent: false };
  }
}
