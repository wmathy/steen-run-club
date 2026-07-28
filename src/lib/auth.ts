import { createHash, randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getSession, requireUserId } from "@/lib/session";
import { emailSchema, passwordSchema } from "@/lib/validation";
import { sendPasswordResetEmail } from "@/lib/email";

const SALT_ROUNDS = 12;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Valid bcrypt hash so missing-user login still runs compare (timing). */
const DUMMY_HASH =
  "$2a$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export class AuthValidationError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "AuthValidationError";
  }
}

export class AuthConflictError extends Error {
  status = 409;
  constructor(message: string) {
    super(message);
    this.name = "AuthConflictError";
  }
}

export async function createUser(params: {
  email: string;
  password: string;
  name?: string;
}) {
  const emailResult = emailSchema.safeParse(params.email);
  if (!emailResult.success) {
    throw new AuthValidationError(
      emailResult.error.issues[0]?.message ?? "Invalid email",
    );
  }
  const passwordResult = passwordSchema.safeParse(params.password);
  if (!passwordResult.success) {
    throw new AuthValidationError(
      passwordResult.error.issues[0]?.message ?? "Invalid password",
    );
  }

  const email = emailResult.data;
  const passwordHash = await hashPassword(passwordResult.data);

  try {
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name: params.name?.trim()?.slice(0, 100) || null,
        coachProfile: {
          create: {
            summary: "New athlete — assessment not yet completed.",
          },
        },
      },
    });
    return user;
  } catch (err) {
    // Prisma unique constraint
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code: string }).code)
        : "";
    if (code === "P2002") {
      throw new AuthConflictError("An account with this email already exists");
    }
    throw err;
  }
}

export async function loginUser(email: string, password: string) {
  const emailResult = emailSchema.safeParse(email);
  // Always run bcrypt so early validation failures have similar timing
  const passwordCandidate =
    typeof password === "string" ? password.slice(0, 128) : "";

  const normalized = emailResult.success ? emailResult.data : "";
  const user = normalized
    ? await prisma.user.findUnique({ where: { email: normalized } })
    : null;

  const hash = user?.passwordHash ?? DUMMY_HASH;
  const ok = await verifyPassword(
    passwordCandidate.length > 0 ? passwordCandidate : " ",
    hash,
  );

  const passwordResult = passwordSchema.safeParse(password);
  if (!emailResult.success || !passwordResult.success || !user || !ok) {
    throw new AuthValidationError("Invalid email or password");
  }

  const session = await getSession();
  session.userId = user.id;
  session.email = user.email;
  session.name = user.name ?? undefined;
  session.isLoggedIn = true;
  await session.save();

  return user;
}

export async function logoutUser() {
  const session = await getSession();
  // iron-session v8 destroy() clears the cookie; await if Promise-like
  const result = session.destroy() as void | Promise<void>;
  if (result && typeof (result as Promise<void>).then === "function") {
    await result;
  }
}

export async function getCurrentUser() {
  const session = await getSession();
  if (!session.isLoggedIn || !session.userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
      coachProfile: true,
      googleCalendar: {
        select: {
          id: true,
          calendarId: true,
          connectedAt: true,
        },
      },
      stravaConnection: {
        select: {
          id: true,
          connectedAt: true,
          lastSyncedAt: true,
        },
      },
    },
  });

  return user;
}

function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  ).replace(/\/$/, "");
}

/** Logged-in user changes password (requires current password). */
export async function changePassword(params: {
  currentPassword: string;
  newPassword: string;
}) {
  const userId = await requireUserId();
  const currentResult = passwordSchema.safeParse(params.currentPassword);
  const newResult = passwordSchema.safeParse(params.newPassword);
  if (!currentResult.success || !newResult.success) {
    throw new AuthValidationError(
      newResult.success
        ? "Current password is invalid"
        : (newResult.error.issues[0]?.message ?? "Invalid new password"),
    );
  }
  if (currentResult.data === newResult.data) {
    throw new AuthValidationError(
      "New password must be different from your current password",
    );
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AuthValidationError("Account not found");

  const ok = await verifyPassword(currentResult.data, user.passwordHash);
  if (!ok) {
    throw new AuthValidationError("Current password is incorrect");
  }

  const passwordHash = await hashPassword(newResult.data);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });

  // Invalidate outstanding reset tokens
  await prisma.passwordResetToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  });
}

/**
 * Start password recovery. Always returns the same client message
 * (does not reveal whether the email exists).
 */
export async function requestPasswordReset(emailRaw: string): Promise<{
  message: string;
}> {
  const emailResult = emailSchema.safeParse(emailRaw);
  const generic = {
    message:
      "If an account exists for that email, you’ll receive a reset link shortly.",
  };
  if (!emailResult.success) {
    return generic;
  }

  const user = await prisma.user.findUnique({
    where: { email: emailResult.data },
  });
  if (!user) {
    // Timing-ish delay
    await verifyPassword("dummy-password-check", DUMMY_HASH);
    return generic;
  }

  // Invalidate previous unused tokens
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  const token = randomBytes(32).toString("hex");
  const tokenHash = hashResetToken(token);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt,
    },
  });

  const resetUrl = `${appBaseUrl()}/reset-password?token=${token}`;
  await sendPasswordResetEmail({
    to: user.email,
    resetUrl,
    name: user.name,
  });

  return generic;
}

/** Complete recovery using the one-time token from the email link. */
export async function resetPasswordWithToken(params: {
  token: string;
  newPassword: string;
}) {
  const token = (params.token || "").trim();
  if (!token || token.length < 32) {
    throw new AuthValidationError("Invalid or expired reset link");
  }

  const newResult = passwordSchema.safeParse(params.newPassword);
  if (!newResult.success) {
    throw new AuthValidationError(
      newResult.error.issues[0]?.message ?? "Invalid password",
    );
  }

  const tokenHash = hashResetToken(token);
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
  });

  if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) {
    throw new AuthValidationError(
      "This reset link is invalid or has expired. Request a new one.",
    );
  }

  const passwordHash = await hashPassword(newResult.data);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: row.userId },
      data: { passwordHash },
    }),
    prisma.passwordResetToken.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    }),
    prisma.passwordResetToken.updateMany({
      where: { userId: row.userId, usedAt: null },
      data: { usedAt: new Date() },
    }),
  ]);
}
