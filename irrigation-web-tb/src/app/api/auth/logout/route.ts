import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/server/session";

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: false,
    maxAge: 0,
  });
  return response;
}
