import { NextResponse, type NextRequest } from "next/server";
import { irrigationRuntime } from "@/lib/server/runtime";
import { getRequestSession } from "@/lib/server/session";
import { notFoundResponse, unauthorizedResponse, upstreamErrorResponse } from "@/lib/server/http";

type Props = {
  params: Promise<{ deviceId: string }>;
};

export async function GET(request: NextRequest, { params }: Props) {
  const session = getRequestSession(request);
  if (!session) {
    return unauthorizedResponse();
  }

  try {
    const { deviceId } = await params;
    const device = await irrigationRuntime.getDevice(session, deviceId);
    if (!device) {
      return notFoundResponse("设备不存在");
    }

    return NextResponse.json({ device });
  } catch (error) {
    return upstreamErrorResponse(error, "设备详情加载失败");
  }
}
