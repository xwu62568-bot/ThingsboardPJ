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
  const body = (await request.json()) as {
    siteNumber?: number;
    durationSeconds?: number;
  };

  try {
    const device = await irrigationRuntime.runIrrigation(
      session,
      deviceId,
      Number(body.siteNumber),
      Number(body.durationSeconds),
    );
    return NextResponse.json({ device });
  } catch (error) {
    return upstreamErrorResponse(error, "开阀失败");
  }
}
