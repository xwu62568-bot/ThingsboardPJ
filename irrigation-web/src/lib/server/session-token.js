import { createHash } from "node:crypto";

export const SESSION_COOKIE = "irrigation_session";
const SESSION_SECRET = "irrigation-web-dev-secret";

export function encodeSession(session) {
  const payload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  const signature = sign(payload);
  return `${payload}.${signature}`;
}

export function decodeSession(token) {
  if (!token) {
    return null;
  }

  const [payload, signature] = token.split(".");
  if (!payload || !signature) {
    return null;
  }

  if (sign(payload) !== signature) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function getSessionFromCookieHeader(cookieHeader, cookieName = SESSION_COOKIE) {
  if (!cookieHeader) {
    return undefined;
  }

  const segments = cookieHeader.split(";");
  for (const segment of segments) {
    const [rawKey, ...rest] = segment.trim().split("=");
    if (rawKey === cookieName) {
      return rest.join("=");
    }
  }
  return undefined;
}

function sign(payload) {
  return createHash("sha256").update(`${payload}.${SESSION_SECRET}`).digest("base64url");
}
