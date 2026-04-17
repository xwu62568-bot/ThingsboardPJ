import type { DeviceState, DeviceSummary, IrrigationUser } from "@/lib/domain/types";
import type { TbSession } from "./session";

export const DEFAULT_TB_BASE_URL =
  process.env.NEXT_PUBLIC_TB_BASE_URL?.trim() || "http://58.210.46.6:8888";

const debugListeners = new Set<(entry: TbDebugEntry) => void>();
const debugBuffer: TbDebugEntry[] = [];
let debugSequence = 0;

export type TbDebugEntry = {
  id: string;
  at: number;
  level: "info" | "error";
  scope: "ws" | "rpc" | "rest" | "auth";
  message: string;
  detail?: string;
};

export function subscribeTbDebugLogs(listener: (entry: TbDebugEntry) => void): () => void {
  debugListeners.add(listener);
  for (const entry of debugBuffer) {
    listener(entry);
  }
  return () => {
    debugListeners.delete(listener);
  };
}

function emitDebugLog(entry: Omit<TbDebugEntry, "id" | "at">) {
  const record: TbDebugEntry = {
    id: `tb-debug-${++debugSequence}`,
    at: Date.now(),
    ...entry,
  };
  debugBuffer.push(record);
  if (debugBuffer.length > 80) {
    debugBuffer.shift();
  }
  for (const listener of debugListeners) {
    listener(record);
  }
  // 仅将错误打到浏览器控制台；info 由「TB 调试日志」面板展示，避免 WS 定时推送等刷屏
  if (entry.level === "error") {
    console.error(`[tb:${entry.scope}] ${entry.message}`, entry.detail ?? "");
  }
}

function serializeDetail(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    return text.length > 600 ? `${text.slice(0, 600)}...` : text;
  } catch {
    return String(value);
  }
}

export async function loginToThingsBoard(input: {
  baseUrl: string;
  username: string;
  password: string;
}): Promise<TbSession> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(input),
  });

  const payload = (await response.json()) as {
    user?: IrrigationUser;
    message?: string;
  };

  if (!response.ok || !payload.user) {
    emitDebugLog({
      level: "error",
      scope: "auth",
      message: `登录失败 ${response.status}`,
      detail: payload.message,
    });
    throw new Error(payload.message || "登录失败");
  }

  emitDebugLog({
    level: "info",
    scope: "auth",
    message: "登录成功",
    detail: serializeDetail({
      baseUrl: input.baseUrl,
      user: payload.user.username,
    }),
  });

  return {
    baseUrl: input.baseUrl,
    token: "bff-session",
    user: payload.user,
  };
}

export async function logoutFromThingsBoard(): Promise<void> {
  await fetch("/api/auth/logout", {
    method: "POST",
  });
}

export async function fetchDeviceList(_unusedSession?: TbSession | null): Promise<DeviceSummary[]> {
  void _unusedSession;
  const payload = await appRequest("/api/devices");
  return ((payload as { devices?: DeviceSummary[] }).devices ?? []) as DeviceSummary[];
}

export async function fetchDeviceDetail(
  _unusedSession: TbSession | null | undefined,
  deviceId: string,
): Promise<DeviceState> {
  void _unusedSession;
  const payload = await appRequest(`/api/devices/${deviceId}`);
  return (payload as { device: DeviceState }).device;
}

export async function connectDevice(
  _session: TbSession | null | undefined,
  deviceId: string,
): Promise<DeviceState> {
  void _session;
  emitDebugLog({
    level: "info",
    scope: "rpc",
    message: "发送连接命令",
    detail: serializeDetail({ deviceId }),
  });
  const payload = await appRequest(`/api/devices/${deviceId}/connect`, { method: "POST" });
  return (payload as { device: DeviceState }).device;
}

export async function disconnectDevice(
  _session: TbSession | null | undefined,
  deviceId: string,
): Promise<DeviceState> {
  void _session;
  emitDebugLog({
    level: "info",
    scope: "rpc",
    message: "发送断开命令",
    detail: serializeDetail({ deviceId }),
  });
  const payload = await appRequest(`/api/devices/${deviceId}/disconnect`, { method: "POST" });
  return (payload as { device: DeviceState }).device;
}

export async function refreshDevice(
  _session: TbSession | null | undefined,
  deviceId: string,
): Promise<DeviceState> {
  void _session;
  emitDebugLog({
    level: "info",
    scope: "rpc",
    message: "发送刷新命令",
    detail: serializeDetail({ deviceId }),
  });
  const payload = await appRequest(`/api/devices/${deviceId}/refresh`, { method: "POST" });
  return (payload as { device: DeviceState }).device;
}

export async function runIrrigation(
  _session: TbSession | null | undefined,
  deviceId: string,
  siteNumber: number,
  durationSeconds: number,
): Promise<DeviceState> {
  void _session;
  emitDebugLog({
    level: "info",
    scope: "rpc",
    message: "发送开阀命令",
    detail: serializeDetail({ deviceId, siteNumber, durationSeconds }),
  });
  const payload = await appRequest(`/api/devices/${deviceId}/valves/run`, {
    method: "POST",
    body: JSON.stringify({ siteNumber, durationSeconds }),
  });
  return (payload as { device: DeviceState }).device;
}

export async function stopIrrigation(
  _session: TbSession | null | undefined,
  deviceId: string,
  siteNumber: number,
): Promise<DeviceState> {
  void _session;
  emitDebugLog({
    level: "info",
    scope: "rpc",
    message: "发送关阀命令",
    detail: serializeDetail({ deviceId, siteNumber }),
  });
  const payload = await appRequest(`/api/devices/${deviceId}/valves/stop`, {
    method: "POST",
    body: JSON.stringify({ siteNumber }),
  });
  return (payload as { device: DeviceState }).device;
}

export function openTelemetrySocket(
  _session: TbSession | null | undefined,
  deviceIds: string[],
  onActivity: () => void,
): WebSocket {
  void _session;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${protocol}//${window.location.host}/api/ws`;
  const socket = new WebSocket(url);

  socket.addEventListener("open", () => {
    emitDebugLog({
      level: "info",
      scope: "ws",
      message: `WS 已连接并发送订阅，设备数 ${deviceIds.length}`,
      detail: serializeDetail({ url, deviceIds }),
    });
    socket.send(JSON.stringify({ type: "subscribe", deviceIds }));
  });

  socket.addEventListener("message", (event) => {
    emitDebugLog({
      level: "info",
      scope: "ws",
      message: "收到 WS 消息",
      detail: typeof event.data === "string" ? event.data.slice(0, 600) : "[binary]",
    });
    onActivity();
  });

  socket.addEventListener("error", () => {
    emitDebugLog({
      level: "error",
      scope: "ws",
      message: "WS 异常",
      detail: url,
    });
  });

  socket.addEventListener("close", (event) => {
    emitDebugLog({
      level: event.wasClean ? "info" : "error",
      scope: "ws",
      message: `WS 关闭 code=${event.code}`,
      detail: event.reason || "no reason",
    });
  });

  return socket;
}

async function appRequest(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  const payload = text.trim() ? JSON.parse(text) : null;

  if (!response.ok) {
    emitDebugLog({
      level: "error",
      scope: "rest",
      message: `REST 失败 ${response.status} ${path}`,
      detail: serializeDetail(payload),
    });
    throw new Error(
      typeof payload?.message === "string"
        ? payload.message
        : `请求失败 ${response.status}: ${path}`,
    );
  }

  emitDebugLog({
    level: "info",
    scope: "rest",
    message: `REST 成功 ${path}`,
    detail: serializeDetail(payload),
  });

  return payload;
}
