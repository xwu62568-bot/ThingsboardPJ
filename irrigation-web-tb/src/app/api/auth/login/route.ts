import { NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE } from "@/lib/server/session";
import { badRequestResponse } from "@/lib/server/http";
import { DEFAULT_TB_BASE_URL, loginToThingsBoard } from "@/lib/server/thingsboard";

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const payload = isJson
    ? ((await request.json()) as { baseUrl?: string; username?: string; password?: string })
    : Object.fromEntries(await request.formData());

  const baseUrl =
    typeof payload.baseUrl === "string" ? payload.baseUrl.trim() : DEFAULT_TB_BASE_URL;
  const username = typeof payload.username === "string" ? payload.username.trim() : "";
  const password = typeof payload.password === "string" ? payload.password.trim() : "";

  if (!baseUrl || !username || !password) {
    return isJson
      ? badRequestResponse("请输入地址、账号和密码")
      : redirectRelative("/login?error=missing");
  }

  try {
    const tbSession = await loginToThingsBoard({ baseUrl, username, password });
    const session = {
      user: tbSession.user,
      tb: {
        baseUrl: tbSession.baseUrl,
        token: tbSession.token,
        refreshToken: tbSession.refreshToken,
      },
    };

    const response = isJson
      ? NextResponse.json({
          user: session.user,
        })
      : redirectRelative("/devices");

    response.cookies.set(SESSION_COOKIE, createSessionToken(session), {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: false,
      maxAge: 60 * 60 * 12,
    });

    return response;
  } catch (error) {
    return isJson
      ? NextResponse.json(
          { message: error instanceof Error ? error.message : "账号或密码错误" },
          { status: 401 },
        )
      : redirectRelative("/login?error=invalid");
  }
}

function redirectRelative(path: string) {
  return new NextResponse(null, {
    status: 303,
    headers: {
      location: path,
    },
  });
}
