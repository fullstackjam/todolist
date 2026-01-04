import { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Bindings, User, Session, Variables } from "./types";

type AppContext = Context<{ Bindings: Bindings; Variables: Variables }>;

export function generateSessionId(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createSession(
  db: D1Database,
  userId: number
): Promise<string> {
  const sessionId = generateSessionId();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await db
    .prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(sessionId, userId, expiresAt)
    .run();

  return sessionId;
}

export async function getSession(
  db: D1Database,
  sessionId: string
): Promise<Session | null> {
  const session = await db
    .prepare("SELECT * FROM sessions WHERE id = ? AND expires_at > datetime('now')")
    .bind(sessionId)
    .first<Session>();

  return session || null;
}

export async function deleteSession(
  db: D1Database,
  sessionId: string
): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
}

export async function getUserById(
  db: D1Database,
  userId: number
): Promise<User | null> {
  const user = await db
    .prepare("SELECT * FROM users WHERE id = ?")
    .bind(userId)
    .first<User>();

  return user || null;
}

export async function findOrCreateUser(
  db: D1Database,
  githubId: string,
  username: string,
  avatarUrl: string | null
): Promise<User> {
  let user = await db
    .prepare("SELECT * FROM users WHERE github_id = ?")
    .bind(githubId)
    .first<User>();

  if (!user) {
    await db
      .prepare(
        "INSERT INTO users (github_id, username, avatar_url) VALUES (?, ?, ?)"
      )
      .bind(githubId, username, avatarUrl)
      .run();

    user = await db
      .prepare("SELECT * FROM users WHERE github_id = ?")
      .bind(githubId)
      .first<User>();
  }

  return user!;
}

export function getGitHubAuthUrl(clientId: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "read:user",
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

export async function exchangeCodeForToken(
  clientId: string,
  clientSecret: string,
  code: string
): Promise<string | null> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  const data = (await response.json()) as { access_token?: string };
  return data.access_token || null;
}

export async function getGitHubUser(
  accessToken: string
): Promise<{ id: string; login: string; avatar_url: string } | null> {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "TodoList-App",
    },
  });

  if (!response.ok) return null;

  const data = (await response.json()) as {
    id: number;
    login: string;
    avatar_url: string;
  };

  return {
    id: String(data.id),
    login: data.login,
    avatar_url: data.avatar_url,
  };
}

export async function authMiddleware(c: AppContext, next: () => Promise<void>) {
  const sessionId = getCookie(c, "session");

  if (sessionId) {
    const session = await getSession(c.env.DB, sessionId);
    if (session) {
      const user = await getUserById(c.env.DB, session.user_id);
      c.set("user", user);
      c.set("session", session);
    }
  }

  await next();
}

export function setSessionCookie(c: AppContext, sessionId: string) {
  setCookie(c, "session", sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
}

export function clearSessionCookie(c: AppContext) {
  deleteCookie(c, "session", { path: "/" });
}
