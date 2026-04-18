"use client";

import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { DeviceConsole } from "@/components/device-console";
import { LogoutButton } from "@/components/logout-button";
import { getStoredSession, type TbSession } from "@/lib/client/session";
import {
  fetchDeviceDetail,
  fetchDeviceList,
  getCachedDeviceDetail,
  getCachedDeviceList,
} from "@/lib/client/thingsboard";
import type { DeviceState, DeviceSummary } from "@/lib/domain/types";

export function DevicePageClient() {
  const params = useParams<{ deviceId: string }>();
  const navigate = useNavigate();
  const [session] = useState<TbSession | null>(() => getStoredSession());
  const deviceId = String(params.deviceId);
  const [device, setDevice] = useState<DeviceState | null>(() =>
    getCachedDeviceDetail(session, deviceId),
  );
  const [devices, setDevices] = useState<DeviceSummary[]>(() => getCachedDeviceList(session));
  const [ready, setReady] = useState(() => getCachedDeviceDetail(session, deviceId) !== null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!session) {
      navigate("/login", { replace: true });
      return;
    }

    void fetchDeviceDetail(session, deviceId)
      .then((currentDevice) => {
        setDevice(currentDevice);
        setError("");
        setReady(true);
        void fetchDeviceList(session)
          .then((deviceList) => {
            setDevices(deviceList);
          })
          .catch(() => undefined);
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "设备加载失败");
        setReady(true);
      });
  }, [deviceId, navigate, session]);

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
          <Link className="backLink" to="/devices">
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
        key={deviceId}
        initialDevice={device}
        devices={devices}
        activeDeviceId={deviceId}
      />
    </main>
  );
}
