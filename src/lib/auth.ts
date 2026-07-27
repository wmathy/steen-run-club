import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { emailSchema, passwordSchema } from "@/lib/validation";

const SALT_ROUNDS = 12;

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
