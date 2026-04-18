"use client";

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DeviceListLive } from "@/components/device-list-live";
import { LogoutButton } from "@/components/logout-button";
import { getStoredSession, type TbSession } from "@/lib/client/session";
import {
  fetchDeviceList,
  fetchDeviceListBasic,
  getCachedDeviceList,
  hasFullCachedDeviceList,
} from "@/lib/client/thingsboard";
import type { DeviceSummary } from "@/lib/domain/types";

export function DevicesPageClient() {
  const navigate = useNavigate();
  const [session] = useState<TbSession | null>(() => getStoredSession());
  const [devices, setDevices] = useState<DeviceSummary[]>(() => getCachedDeviceList(session));
  const [ready, setReady] = useState(() => getCachedDeviceList(session).length > 0);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!session) {
      navigate("/login", { replace: true });
      return;
    }
    if (devices.length > 0) {
      setReady(true);
      if (hasFullCachedDeviceList(session)) {
        return;
      }
      void fetchDeviceList(session)
        .then((items) => {
          setDevices(items);
          setError("");
        })
        .catch((loadError) => {
          setError(loadError instanceof Error ? loadError.message : "设备状态补全失败");
      });
      return;
    }

    void fetchDeviceListBasic(session)
      .then((items) => {
        setDevices(items);
        setError("");
        setReady(true);
        return fetchDeviceList(session);
      })
      .then((items) => {
        if (!items) {
          return;
        }
        setDevices(items);
        setError("");
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "设备加载失败");
        setReady(true);
      });
  }, [devices.length, navigate, session]);

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
            通过浏览器直连 ThingsBoard；列表由 HTTP 加载，TB WebSocket 推送变化时自动刷新。
          </p>
        </div>
      </section>

      {error ? <section className="errorBanner">{error}</section> : null}
      <DeviceListLive initialDevices={devices} />
    </main>
  );
}
