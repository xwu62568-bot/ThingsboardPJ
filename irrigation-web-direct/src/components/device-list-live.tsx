"use client";

import { useEffect, useState } from "react";
import { fetchDeviceList, openTelemetrySocket } from "@/lib/client/thingsboard";
import { getStoredSession } from "@/lib/client/session";
import type { DeviceSummary } from "@/lib/domain/types";
import { TbDebugPanel } from "@/components/tb-debug-panel";

type Props = {
  initialDevices: DeviceSummary[];
};

export function DeviceListLive({ initialDevices }: Props) {
  const [devices, setDevices] = useState(initialDevices);
  const [wsState, setWsState] = useState<"connecting" | "connected" | "disconnected" | "error">(
    getStoredSession() && initialDevices.length > 0 ? "connecting" : "disconnected",
  );
  const [lastPushAt, setLastPushAt] = useState(0);

  useEffect(() => {
    const session = getStoredSession();
    if (!session || initialDevices.length === 0) {
      return;
    }

    let disposed = false;

    const ws = openTelemetrySocket(
      session,
      initialDevices.map((device) => device.id),
      () => {
        if (disposed) {
          return;
        }
        setLastPushAt(Date.now());
        void fetchDeviceList(session)
          .then((items) => setDevices(items))
          .catch(() => undefined);
      },
    );

    ws.addEventListener("open", () => {
      if (disposed) {
        ws.close();
        return;
      }
      setWsState("connected");
    });
    ws.addEventListener("error", () => {
      if (!disposed) {
        setWsState("error");
      }
    });
    ws.addEventListener("close", () => {
      if (!disposed) {
        setWsState("disconnected");
      }
    });

    return () => {
      disposed = true;
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, [initialDevices]);

  return (
    <>
      <section className="wsBanner">
        <span className={`statusPill ${wsState}`}>{formatWsState(wsState)}</span>
        <span className="muted">最近推送 {formatTime(lastPushAt)}</span>
      </section>
      <section className="devicesGrid">
        {devices.map((device) => (
          <a key={device.id} className="deviceListCard" href={`/devices/${device.id}`}>
            <div className="deviceListCardHead">
              <div>
                <div className="eyebrow">{device.model}</div>
                <h2>{device.name}</h2>
              </div>
              <span className={`statusPill ${device.connectivityState}`}>
                {formatConnectionState(device.connectivityState)}
              </span>
            </div>
            <dl className="infoList">
              <div className="infoRow">
                <span>平台状态</span>
                <strong>{formatPlatformState(device.platformState)}</strong>
              </div>
              <div className="infoRow">
                <span>最后活跃</span>
                <strong>{formatTime(device.platformLastActivityAt)}</strong>
              </div>
              <div className="infoRow">
                <span>设备编号</span>
                <strong>{device.serialNumber}</strong>
              </div>
              <div className="infoRow">
                <span>路数</span>
                <strong>{device.siteCount}</strong>
              </div>
              <div className="infoRow">
                <span>电量</span>
                <strong>{device.batteryLevel}%</strong>
              </div>
            </dl>
          </a>
        ))}
      </section>
      <TbDebugPanel />
    </>
  );
}

function formatConnectionState(state: string) {
  switch (state) {
    case "connected":
      return "已连接";
    case "connecting":
      return "连接中";
    case "error":
      return "异常";
    default:
      return "未连接";
  }
}

function formatPlatformState(state: string) {
  return state === "active" ? "活跃" : "未活跃";
}

function formatWsState(state: "connecting" | "connected" | "disconnected" | "error") {
  switch (state) {
    case "connected":
      return "WS 已连接";
    case "connecting":
      return "WS 连接中";
    case "error":
      return "WS 异常";
    default:
      return "WS 已断开";
  }
}

function formatTime(value: number) {
  if (!value) {
    return "--";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}
