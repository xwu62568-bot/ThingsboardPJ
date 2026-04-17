import Link from "next/link";
import { redirect } from "next/navigation";
import { DeviceConsole } from "@/components/device-console";
import { LogoutButton } from "@/components/logout-button";
import { irrigationRuntime } from "@/lib/server/runtime";
import { getPageSession, getPageUser } from "@/lib/server/session";
import type { DeviceState, DeviceSummary } from "@/lib/domain/types";

type Props = {
  params: Promise<{ deviceId: string }>;
};

export default async function DevicePage({ params }: Props) {
  const [user, session, { deviceId }] = await Promise.all([
    getPageUser(),
    getPageSession(),
    params,
  ]);
  if (!user || !session) {
    redirect("/login");
  }

  const [device, devices] = await Promise.all([
    irrigationRuntime.getDevice(session, deviceId),
    irrigationRuntime.listDevices(session),
  ]);

  if (!device) {
    return (
      <main className="appPage">
        <section className="errorBanner">设备不存在</section>
      </main>
    );
  }

  return (
    <main className="appPage">
      <header className="appHeader">
        <div className="headerLead">
          <Link className="backLink" href="/devices">
            返回设备列表
          </Link>
          <div className="eyebrow">Irrigation Frontend</div>
          <strong>{user.name}</strong>
          <p className="muted">{user.role || "ThingsBoard User"}</p>
        </div>
        <LogoutButton />
      </header>
      <DeviceConsole
        key={deviceId}
        initialDevice={device as DeviceState}
        devices={devices as DeviceSummary[]}
        activeDeviceId={deviceId}
      />
    </main>
  );
}
