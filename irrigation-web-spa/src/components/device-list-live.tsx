"use client";

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { openTelemetrySocket, type TbWsMessage } from "@/lib/client/thingsboard";
import type { ConnectivityState, DeviceSummary } from "@/lib/domain/types";

type Props = {
  initialDevices: DeviceSummary[];
};

export function DeviceListLive({ initialDevices }: Props) {
  const [devices, setDevices] = useState(initialDevices);
  const [wsState, setWsState] = useState<"connecting" | "connected" | "disconnected" | "error">(
    initialDevices.length > 0 ? "connecting" : "disconnected",
  );
  const [lastPushAt, setLastPushAt] = useState(0);
  const devicesRef = useRef(devices);

  useEffect(() => {
    setDevices(initialDevices);
    devicesRef.current = initialDevices;
  }, [initialDevices]);

  useEffect(() => {
    if (initialDevices.length === 0) {
      return;
    }

    let disposed = false;

    const ws = openTelemetrySocket(
      null,
      initialDevices.map((device) => device.id),
      (message) => {
        if (disposed) {
          return;
        }
        const now = Date.now();
        setLastPushAt(now);
        const nextDevices = devicesRef.current.map((device) => ({
          ...device,
          ...deriveDevicePatchFromWs(message, device, now),
        }));
        devicesRef.current = nextDevices;
        setDevices(nextDevices);
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
        {devices.length === 0 ? (
          <section className="errorBanner">当前没有可展示的设备。</section>
        ) : null}
        {devices.map((device) => (
          <Link key={device.id} className="deviceListCard" to={`/devices/${device.id}`}>
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
          </Link>
        ))}
      </section>
    </>
  );
}

function deriveDevicePatchFromWs(
  message: TbWsMessage | undefined,
  device: DeviceSummary,
  fallbackTs: number,
): Partial<DeviceSummary> {
  const data = message?.data ?? {};
  const bleConnectionState = latestWsValue(data.bleConnectionState);
  const bleConnected = latestWsValue(data.bleConnected);
  const batteryLevel = latestWsValue(data.batteryLevel);
  const siteCount = latestWsValue(data.siteCount);
  const selectedSiteNumber = latestWsValue(data.selectedSiteNumber);
  const latestDataTs = Math.max(
    0,
    ...Object.values(data).map((entries) => entries[0]?.[0] ?? 0),
  );
  const nextTs = Math.max(device.lastSeenAt, device.platformLastActivityAt, latestDataTs, fallbackTs);

  return {
    platformState: "active",
    platformLastActivityAt: nextTs,
    lastSeenAt: nextTs,
    connectivityState: normalizeConnectionStateFromWs(
      bleConnectionState,
      bleConnected,
      device.connectivityState,
    ),
    batteryLevel: toNumberOrCurrent(batteryLevel, device.batteryLevel),
    siteCount: clampInt(siteCount, 1, 8, device.siteCount),
    selectedSiteNumber: clampInt(selectedSiteNumber, 1, 8, device.selectedSiteNumber),
  };
}

function latestWsValue(entries?: Array<[number, unknown]>) {
  return entries?.[0]?.[1];
}

function normalizeConnectionStateFromWs(
  state: unknown,
  connected: unknown,
  current: ConnectivityState,
): ConnectivityState {
  if (
    state === "connected" ||
    state === "connecting" ||
    state === "disconnected" ||
    state === "error"
  ) {
    return state;
  }
  if (state === "idle") {
    return "disconnected";
  }
  if (connected === true || connected === "true" || connected === 1 || connected === "1") {
    return "connected";
  }
  if (connected === false || connected === "false" || connected === 0 || connected === "0") {
    return "disconnected";
  }
  return current;
}

function toNumberOrCurrent(value: unknown, current: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return current;
}

function clampInt(value: unknown, min: number, max: number, current: number) {
  const parsed =
    typeof value === "number"
      ? Math.trunc(value)
      : typeof value === "string" && /^-?\d+$/.test(value)
        ? Number.parseInt(value, 10)
        : current;
  return Math.min(max, Math.max(min, parsed));
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
