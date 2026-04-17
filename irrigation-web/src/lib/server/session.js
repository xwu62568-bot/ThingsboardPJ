import { cookies } from "next/headers";
import {
  decodeSession,
  encodeSession,
  getSessionFromCookieHeader,
  SESSION_COOKIE,
} from "./session-token.js";

export { getSessionFromCookieHeader, SESSION_COOKIE };

export async function getPageSession() {
  const cookieStore = await cookies();
  return decodeSession(cookieStore.get(SESSION_COOKIE)?.value);
}

export async function getPageUser() {
  return (await getPageSession())?.user ?? null;
}

export function getRequestSession(request) {
  return decodeSession(request.cookies.get(SESSION_COOKIE)?.value);
}

export function getRequestUser(request) {
  return getRequestSession(request)?.user ?? null;
}

export function createSessionToken(session) {
  return encodeSession(session);
}

export function revokeSession(token) {
  void token;
}
