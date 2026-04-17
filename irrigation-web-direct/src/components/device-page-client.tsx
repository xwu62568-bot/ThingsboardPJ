"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { DeviceConsole } from "@/components/device-console";
import { LogoutButton } from "@/components/logout-button";
import { getStoredSession, type TbSession } from "@/lib/client/session";
import { fetchDeviceDetail, fetchDeviceList } from "@/lib/client/thingsboard";
import type { DeviceState, DeviceSummary } from "@/lib/domain/types";

export function DevicePageClient() {
  const params = useParams<{ deviceId: string }>();
  const router = useRouter();
  const [session] = useState<TbSession | null>(() => getStoredSession());
  const [ready, setReady] = useState(false);
  const [device, setDevice] = useState<DeviceState | null>(null);
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!session) {
      router.replace("/login");
      return;
    }

    void Promise.all([
      fetchDeviceDetail(session, String(params.deviceId)),
      fetchDeviceList(session),
    ])
      .then(([currentDevice, deviceList]) => {
        setDevice(currentDevice);
        setDevices(deviceList);
        setReady(true);
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "设备加载失败");
        setReady(true);
      });
  }, [params.deviceId, router, session]);

  if (!ready) {
    return <main className="appPage">加载中...</main>;
  }

  if (!device) {
    return (
      <main className="appPage">
        <section className="errorBanner">{error || "设备不存在"}</section>
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
          <strong>{session?.user.name ?? ""}</strong>
          <p className="muted">{session?.user.role || "ThingsBoard User"}</p>
        </div>
        <LogoutButton />
      </header>
      {error ? <section className="errorBanner">{error}</section> : null}
      <DeviceConsole
        key={String(params.deviceId)}
        initialDevice={device}
        devices={devices}
        activeDeviceId={String(params.deviceId)}
      />
    </main>
  );
}
