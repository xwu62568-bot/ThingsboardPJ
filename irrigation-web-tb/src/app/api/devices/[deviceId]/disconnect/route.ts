import { NextResponse, type NextRequest } from "next/server";
import { irrigationRuntime } from "@/lib/server/runtime";
import { getRequestSession } from "@/lib/server/session";
import { unauthorizedResponse, upstreamErrorResponse } from "@/lib/server/http";

type Props = {
  params: Promise<{ deviceId: string }>;
};

export async function POST(request: NextRequest, { params }: Props) {
  const session = getRequestSession(request);
  if (!session) {
    return unauthorizedResponse();
  }

  const { deviceId } = await params;
  try {
    const device = await irrigationRuntime.disconnectDevice(session, deviceId);
    return NextResponse.json({ device });
  } catch (error) {
    return upstreamErrorResponse(error, "断开失败");
  }
}
