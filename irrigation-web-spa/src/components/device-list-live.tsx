"use client";

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { openTelemetrySocket, type TbWsMessage } from "@/lib/client/thingsboard";
import type { ConnectivityState, DeviceSummary, GatewayState } from "@/lib/domain/types";

type Props = {
  initialDevices: DeviceSummary[];
};

export function DeviceListLive({ initialDevices }: Props) {
  const [devices, setDevices] = useState(initialDevices);
  const [wsState, setWsState] = useState<"connecting" | "connected" | "disconnected" | "error">(
    initialDevices.length > 0 ? "connecting" : "disconnected",
  );
  const [lastPushAt, setLastPushAt] = useState(0);
  const [, setClockTick] = useState(0);
  const devicesRef = useRef(devices);

  useEffect(() => {
    setDevices(initialDevices);
    devicesRef.current = initialDevices;
  }, [initialDevices]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClockTick((value) => value + 1);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

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
        if (!message?.deviceId) {
          return;
        }
        const now = Date.now();
        setLastPushAt(now);
        const nextDevices = devicesRef.current.map((device) =>
          device.id === message.deviceId
            ? {
                ...device,
                ...deriveDevicePatchFromWs(message, device, now),
              }
            : device,
        );
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
              <span className={`statusPill ${getStatusPillClass(device)}`}>
                {formatConnectionState(device)}
              </span>
            </div>
            <dl className="infoList">
              <div className="infoRow">
                <span>平台状态</span>
                <strong>{formatPlatformState(device.platformState)}</strong>
              </div>
              <div className="infoRow">
                <span>状态变更</span>
                <strong>{formatTime(device.statusChangedAt ?? 0)}</strong>
              </div>
              <div className="infoRow">
                <span>设备编号</span>
                <strong>{device.serialNumber}</strong>
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
  const appMode = latestWsValue(data.appMode);
  const rpcMethods = latestWsValue(data.rpcMethods);
  const isGateway = device.isGateway || isGatewayWsPayload(appMode, rpcMethods);
  const gatewayHeartbeatTs = latestWsValue(data.gatewayHeartbeatTs);
  const gatewayOnline = latestWsValue(data.gatewayOnline);
  const bleConnectionState = latestWsValue(data.bleConnectionState);
  const bleConnected = latestWsValue(data.bleConnected);
  const connectedDeviceName = latestWsValue(data.connectedDeviceName);
  const lastConnectionUpdateTs = latestWsValue(data.lastConnectionUpdateTs);
  const batteryLevel = latestWsValue(data.batteryLevel);
  const siteCount = latestWsValue(data.siteCount);
  const selectedSiteNumber = latestWsValue(data.selectedSiteNumber);
  const latestDataTs = Math.max(
    0,
    ...Object.values(data).map((entries) => entries[0]?.[0] ?? 0),
  );
  const nextTs = Math.max(device.lastSeenAt, device.platformLastActivityAt, latestDataTs, fallbackTs);

  const gatewayState = isGateway
    ? normalizeGatewayStateFromWs(gatewayHeartbeatTs, gatewayOnline, device.gatewayState)
    : undefined;
  const gatewayHeartbeatAt = toNumberOrCurrent(gatewayHeartbeatTs, device.gatewayHeartbeatAt ?? 0);
  const statusChangedAt = toNumberOrCurrent(lastConnectionUpdateTs, device.statusChangedAt ?? 0);
  const bleConnectivityState = shouldApplyConnectivityPatch(connectedDeviceName, device)
    ? normalizeConnectionStateFromWs(
        bleConnectionState,
        bleConnected,
        device.bleConnectivityState ?? device.connectivityState,
      )
    : device.bleConnectivityState ?? device.connectivityState;

  return {
    platformLastActivityAt: nextTs,
    lastSeenAt: nextTs,
    isGateway,
    gatewayState,
    gatewayHeartbeatAt,
    bleConnectivityState,
    statusChangedAt,
    connectivityState: isGateway ? normalizeGatewayConnectivityState(gatewayState) : bleConnectivityState,
    batteryLevel: isGateway ? device.batteryLevel : toNumberOrCurrent(batteryLevel, device.batteryLevel),
    siteCount: isGateway ? device.siteCount : clampInt(siteCount, 1, 8, device.siteCount),
    selectedSiteNumber: isGateway
      ? device.selectedSiteNumber
      : clampInt(selectedSiteNumber, 1, 8, device.selectedSiteNumber),
  };
}

function normalizeGatewayStateFromWs(
  heartbeatTs: unknown,
  gatewayOnline: unknown,
  current: GatewayState | undefined,
): GatewayState {
  if (
    gatewayOnline === false ||
    gatewayOnline === "false" ||
    gatewayOnline === 0 ||
    gatewayOnline === "0"
  ) {
    return "offline";
  }
  const parsedHeartbeat =
    typeof heartbeatTs === "number"
      ? heartbeatTs
      : typeof heartbeatTs === "string" && /^\d+$/.test(heartbeatTs)
        ? Number.parseInt(heartbeatTs, 10)
        : 0;
  if (parsedHeartbeat && Date.now() - parsedHeartbeat < 2 * 60 * 1000) {
    return "online";
  }
  return current ?? "unknown";
}

function normalizeGatewayConnectivityState(gatewayState?: GatewayState): ConnectivityState {
  return gatewayState === "online" ? "connected" : "disconnected";
}

function isGatewayWsPayload(appMode: unknown, rpcMethods: unknown): boolean {
  if (appMode === "ble-mqtt-gateway") {
    return true;
  }
  return Array.isArray(rpcMethods)
    ? rpcMethods.includes("ble_connectDevice") && rpcMethods.includes("openValve")
    : false;
}

function shouldApplyConnectivityPatch(
  connectedDeviceName: unknown,
  device: DeviceSummary,
): boolean {
  if (typeof connectedDeviceName !== "string") {
    return true;
  }
  const normalizedConnectedName = connectedDeviceName.trim();
  if (!normalizedConnectedName) {
    return true;
  }
  return normalizedConnectedName === device.name || normalizedConnectedName === device.serialNumber;
}

function latestWsValue(entries?: Array<[number, unknown]>) {
  return entries?.[0]?.[1];
}

function normalizeConnectionStateFromWs(
  state: unknown,
  connected: unknown,
  current: ConnectivityState,
): ConnectivityState {
  if (connected === false || connected === "false" || connected === 0 || connected === "0") {
    return "disconnected";
  }
  if (connected === true || connected === "true" || connected === 1 || connected === "1") {
    return "connected";
  }
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

function formatConnectionState(device: DeviceSummary) {
  if (device.isGateway) {
    const gatewayState = resolveDisplayGatewayState(device);
    switch (gatewayState) {
      case "online":
        return "网关在线";
      case "offline":
        return "网关离线";
      default:
        return "网关未知";
    }
  }
  switch (device.bleConnectivityState ?? device.connectivityState) {
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

function getStatusPillClass(device: DeviceSummary): ConnectivityState {
  if (!device.isGateway) {
    return device.bleConnectivityState ?? device.connectivityState;
  }
  return resolveDisplayGatewayState(device) === "online" ? "connected" : "disconnected";
}

function resolveDisplayGatewayState(device: DeviceSummary): GatewayState {
  if (device.gatewayState === "offline") {
    return "offline";
  }
  const heartbeatAt = device.gatewayHeartbeatAt ?? 0;
  if (heartbeatAt) {
    return Date.now() - heartbeatAt < 2 * 60 * 1000 ? "online" : "offline";
  }
  return device.gatewayState ?? "unknown";
}

function formatPlatformState(state: string) {
  return state === "active" ? "活跃" : "未活跃";
}

function formatWsState(state: "connecting" | "connected" | "disconnected" | "error") {
  switch (state) {
    case "connected":
      return "实时已连接";
    case "connecting":
      return "实时连接中";
    case "error":
      return "实时异常";
    default:
      return "实时已断开";
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
