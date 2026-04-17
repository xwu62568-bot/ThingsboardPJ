import { NextResponse, type NextRequest } from "next/server";
import { irrigationRuntime } from "@/lib/server/runtime";
import { getRequestSession } from "@/lib/server/session";
import { unauthorizedResponse, upstreamErrorResponse } from "@/lib/server/http";

export async function GET(request: NextRequest) {
  const session = getRequestSession(request);
  if (!session) {
    return unauthorizedResponse();
  }

  try {
    const devices = await irrigationRuntime.listDevices(session);
    return NextResponse.json({ devices });
  } catch (error) {
    return upstreamErrorResponse(error, "设备列表加载失败");
  }
}
