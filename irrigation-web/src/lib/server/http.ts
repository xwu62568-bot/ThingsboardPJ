import { NextResponse } from "next/server";
import { ThingsBoardHttpError } from "./thingsboard.js";

export function unauthorizedResponse() {
  return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
}

export function badRequestResponse(message: string) {
  return NextResponse.json({ message }, { status: 400 });
}

export function notFoundResponse(message: string) {
  return NextResponse.json({ message }, { status: 404 });
}

/** 将 ThingsBoard 错误码透传给浏览器；其它异常仍返回 400。 */
export function upstreamErrorResponse(error: unknown, fallbackMessage = "操作失败") {
  if (error instanceof ThingsBoardHttpError) {
    const s = error.status;
    const status =
      s === 409 || s === 404 || s === 403 || s === 401 || s === 400 || s === 408 || s === 429
        ? s
        : s >= 500
          ? 502
          : 502;
    return NextResponse.json({ message: error.message }, { status });
  }
  return NextResponse.json(
    { message: error instanceof Error ? error.message : fallbackMessage },
    { status: 400 },
  );
}
