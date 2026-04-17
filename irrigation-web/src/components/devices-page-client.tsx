"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DeviceListLive } from "@/components/device-list-live";
import { LogoutButton } from "@/components/logout-button";
import { getStoredSession, type TbSession } from "@/lib/client/session";
import { fetchDeviceList } from "@/lib/client/thingsboard";
import type { DeviceSummary } from "@/lib/domain/types";

export function DevicesPageClient() {
  const router = useRouter();
  const [session] = useState<TbSession | null>(() => getStoredSession());
  const [ready, setReady] = useState(false);
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!session) {
      router.replace("/login");
      return;
    }

    void fetchDeviceList(session)
      .then((items) => {
        setDevices(items);
        setReady(true);
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "设备加载失败");
        setReady(true);
      });
  }, [router, session]);

  if (!ready) {
    return <main className="appPage">加载中...</main>;
  }

  return (
    <main className="appPage">
      <header className="appHeader">
        <div>
          <div className="eyebrow">Irrigation Frontend</div>
          <strong>{session?.user.name ?? ""}</strong>
          <p className="muted">{session?.user.role || "ThingsBoard User"}</p>
        </div>
        <LogoutButton />
      </header>

      <section className="devicesPageHeader">
        <div>
          <div className="eyebrow">ThingsBoard Devices</div>
          <h1>设备列表</h1>
          <p className="muted">
            通过 BFF 的 REST 与同源 WebSocket 使用 ThingsBoard；列表变更由 TB 遥测/属性推送触发刷新。
          </p>
        </div>
      </section>

      {error ? <section className="errorBanner">{error}</section> : null}
      <DeviceListLive initialDevices={devices} />
    </main>
  );
}
