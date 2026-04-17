import { redirect } from "next/navigation";
import { DeviceListLive } from "@/components/device-list-live";
import { LogoutButton } from "@/components/logout-button";
import { irrigationRuntime } from "@/lib/server/runtime";
import { getPageSession, getPageUser } from "@/lib/server/session";
import type { DeviceSummary } from "@/lib/domain/types";

export default async function DevicesPage() {
  const [user, session] = await Promise.all([getPageUser(), getPageSession()]);
  if (!user || !session) {
    redirect("/login");
  }

  let devices: DeviceSummary[] = [];
  let errorMessage = "";
  try {
    devices = (await irrigationRuntime.listDevices(session)) as DeviceSummary[];
  } catch (error) {
    errorMessage = formatDeviceListError(error);
  }

  return (
    <main className="appPage">
      <header className="appHeader">
        <div>
          <div className="eyebrow">Irrigation Frontend</div>
          <strong>{user.name}</strong>
          <p className="muted">{user.role || "ThingsBoard User"}</p>
        </div>
        <LogoutButton />
      </header>

      <section className="devicesPageHeader">
        <div>
          <div className="eyebrow">ThingsBoard Devices</div>
          <h1>设备列表</h1>
          <p className="muted">
            Web + BFF + ThingsBoard。列表由 REST 加载；BFF 订阅 TB `/api/ws`，遥测或属性变更时经同源
            WebSocket 推送刷新。
          </p>
        </div>
      </section>

      {errorMessage ? <section className="errorBanner">{errorMessage}</section> : null}
      <DeviceListLive initialDevices={devices} />
    </main>
  );
}

function formatDeviceListError(error: unknown) {
  const message = error instanceof Error ? error.message : "设备列表加载失败";
  if (
    message.includes("https://thingsboard.cloud") ||
    message.includes("/api/tenant/deviceInfos") ||
    message.includes("/api/tenant/devices")
  ) {
    return "ThingsBoard Cloud 设备列表接口当前返回异常，请到 Swagger UI 验证 tenant 设备列表接口。";
  }
  return message;
}
