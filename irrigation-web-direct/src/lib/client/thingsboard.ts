import type { DeviceState, DeviceSummary, IrrigationUser } from "@/lib/domain/types";
import type { TbSession } from "./session";

export const DEFAULT_TB_BASE_URL =
  process.env.NEXT_PUBLIC_TB_BASE_URL?.trim() || "http://58.210.46.6:8888";
const CONTROL_REFRESH_DELAYS_MS = [1200, 2600];

const TELEMETRY_KEYS = [
  "selectedSiteNumber",
  "soilMoisture",
  "rainSensorWet",
  "batteryLevel",
  "batteryVoltage",
  "rtcTimestamp",
  "lastValveSiteNumber",
  "lastValveCommand",
  "lastValveStationId",
  "lastControlSource",
  "lastControlAppliedAt",
  ...Array.from({ length: 8 }, (_, index) => `station${index + 1}Open`),
  ...Array.from({ length: 8 }, (_, index) => `station${index + 1}RemainingSeconds`),
  ...Array.from({ length: 8 }, (_, index) => `station${index + 1}OpeningDurationSeconds`),
];

const CLIENT_ATTRIBUTE_KEYS = [
  "appMode",
  "rpcMethods",
  "bleConnectionState",
  "bleConnected",
  "connectedDeviceId",
  "connectedDeviceName",
  "connectionStateText",
  "bleLastError",
  "lastConnectionUpdateTs",
  "selectedSiteNumber",
  "siteCount",
  "channels",
  "lastAppliedDesiredConnection",
  "lastRpcValveCommand",
  "lastRpcValveSiteNumber",
  "lastRpcManualDurationSeconds",
  "lastControlAppliedAt",
];

const SHARED_ATTRIBUTE_KEYS = [
  "desiredConnection",
  "manualDurationSeconds",
  "siteNumber",
  "siteCount",
  "channels",
  "targetDeviceName",
];

const gatewayCache = new Map<string, { id: string; name: string; expiresAt: number }>();
const debugListeners = new Set<(entry: TbDebugEntry) => void>();
const debugBuffer: TbDebugEntry[] = [];
let debugSequence = 0;

type DeviceMapping = {
  id?: string;
  name?: string;
  tbDeviceId?: string;
  rpcDeviceId?: string;
  rpcGatewayName?: string;
  rpcTargetName?: string;
  model?: string;
  serialNumber?: string;
  siteCount?: number;
};

const configuredDeviceMappings = parseDeviceMappings();

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
  const logger = entry.level === "error" ? console.error : console.info;
  logger(`[tb:${entry.scope}] ${entry.message}`, entry.detail ?? "");
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
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      username: input.username,
      password: input.password,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    emitDebugLog({
      level: "error",
      scope: "auth",
      message: `登录失败 ${response.status}`,
      detail: text,
    });
    throw new Error(`ThingsBoard 登录失败: ${response.status} ${text}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  emitDebugLog({
    level: "info",
    scope: "auth",
    message: "登录成功",
    detail: serializeDetail({
      baseUrl,
      user: input.username,
      authority: payload.authority,
    }),
  });
  return {
    baseUrl,
    token: String(payload.token ?? ""),
    refreshToken: typeof payload.refreshToken === "string" ? payload.refreshToken : undefined,
    user: {
      id: String((payload.id as { id?: string } | undefined)?.id ?? input.username),
      username: input.username,
      name: String(payload.firstName ?? payload.email ?? input.username),
      email: typeof payload.email === "string" ? payload.email : undefined,
      role: String(payload.authority ?? "TENANT_ADMIN"),
    } satisfies IrrigationUser & { email?: string; role: string },
  };
}

export async function fetchDeviceList(session: TbSession): Promise<DeviceSummary[]> {
  const data = await tbRequest(session, "/api/tenant/deviceInfos?pageSize=100&page=0");
  const rows = Array.isArray((data as { data?: unknown[] } | null)?.data)
    ? ((data as { data?: unknown[] }).data ?? [])
    : [];
  const items = await Promise.all(rows.map(async (raw) => {
    const item = raw as Record<string, unknown>;
    const deviceId = ((item.id as { id?: string } | undefined)?.id ?? "");
    const clientAttributes = deviceId
      ? await getAttributes(session, deviceId, "CLIENT_SCOPE", CLIENT_ATTRIBUTE_KEYS)
      : {};
    const mapping = findDeviceMapping({
      id: deviceId,
      name: typeof item.name === "string" ? item.name : undefined,
    });
    return {
      id: deviceId,
      name: typeof item.name === "string" ? item.name : "未命名设备",
      model:
        mapping?.model ||
        (typeof item.type === "string" && item.type) ||
        (typeof item.label === "string" && item.label) ||
        "Device",
      serialNumber:
        mapping?.serialNumber ||
        (typeof item.name === "string"
          ? item.name
          : ((item.id as { id?: string } | undefined)?.id ?? "")),
      platformState: item.active ? ("active" as const) : ("inactive" as const),
      platformLastActivityAt: toInt(item.lastActivityTime) ?? 0,
      connectivityState:
        normalizeConnectionState(clientAttributes.bleConnectionState) ?? "disconnected",
      lastSeenAt:
        Math.max(
          toInt(item.lastActivityTime) ?? 0,
          toInt(clientAttributes.lastConnectionUpdateTs) ?? 0,
        ) || 0,
      selectedSiteNumber: toInt(clientAttributes.selectedSiteNumber) ?? 1,
      siteCount:
        mapping?.siteCount ??
        toInt(clientAttributes.siteCount) ??
        toInt(clientAttributes.channels) ??
        1,
      batteryLevel: 0,
    };
  }));

  return items;
}

export async function fetchDeviceDetail(
  session: TbSession,
  deviceId: string,
): Promise<DeviceState> {
  const [info, telemetry, clientAttributes, sharedAttributes] = await Promise.all([
    tbRequest(session, `/api/device/info/${deviceId}`),
    getLatestTelemetry(session, deviceId, TELEMETRY_KEYS),
    getAttributes(session, deviceId, "CLIENT_SCOPE", CLIENT_ATTRIBUTE_KEYS),
    getAttributes(session, deviceId, "SHARED_SCOPE", SHARED_ATTRIBUTE_KEYS),
  ]);

  const detail = mapToDeviceState(
    (info as Record<string, unknown>) ?? {},
    telemetry,
    clientAttributes,
    sharedAttributes,
  );
  await resolveRpcGateway(session, detail, clientAttributes);
  return detail;
}

export async function connectDevice(session: TbSession, deviceId: string): Promise<DeviceState> {
  return performControlAction(session, deviceId, "connect", async (detail) => {
    const rpcId = await resolveRpcGateway(session, detail);
    await sendRpc(session, rpcId, "ble_connectDevice", {
      deviceName: detail.rpcTargetName || detail.name,
      siteCount: detail.siteCount,
    });
    return {
      message: `已下发连接命令到 ${detail.rpcGatewayName || rpcId}`,
    };
  });
}

export async function disconnectDevice(
  session: TbSession,
  deviceId: string,
): Promise<DeviceState> {
  return performControlAction(session, deviceId, "disconnect", async (detail) => {
    const rpcId = await resolveRpcGateway(session, detail);
    await sendRpc(session, rpcId, "ble_disconnectDevice", {
      deviceName: detail.rpcTargetName || detail.name,
    });
    return {
      message: `已下发断开命令到 ${detail.rpcGatewayName || rpcId}`,
    };
  });
}

export async function refreshDevice(session: TbSession, deviceId: string): Promise<DeviceState> {
  return performControlAction(session, deviceId, "refresh", async (detail) => {
    const rpcId = await resolveRpcGateway(session, detail);
    await sendRpc(session, rpcId, "ble_requestDeviceState", {
      deviceName: detail.rpcTargetName || detail.name,
    });
    return {
      message: `已请求 ${detail.rpcTargetName || detail.name} 刷新状态`,
    };
  });
}

export async function runIrrigation(
  session: TbSession,
  deviceId: string,
  siteNumber: number,
  durationSeconds: number,
): Promise<DeviceState> {
  return performControlAction(session, deviceId, "run", async (detail) => {
    const rpcId = await resolveRpcGateway(session, detail);
    await sendRpc(session, rpcId, "openValve", {
      deviceName: detail.rpcTargetName || detail.name,
      stationId: "1",
      siteNumber,
      manualDurationSeconds: durationSeconds,
    });
    return {
      message: `已下发 ${siteNumber} 号路开阀 ${durationSeconds} 秒`,
      siteNumber,
      durationSeconds,
    };
  });
}

export async function stopIrrigation(
  session: TbSession,
  deviceId: string,
  siteNumber: number,
): Promise<DeviceState> {
  return performControlAction(session, deviceId, "stop", async (detail) => {
    const rpcId = await resolveRpcGateway(session, detail);
    await sendRpc(session, rpcId, "openValve", {
      deviceName: detail.rpcTargetName || detail.name,
      stationId: "0",
      siteNumber,
    });
    return {
      message: `已下发 ${siteNumber} 号路关阀命令`,
      siteNumber,
    };
  });
}

export function openTelemetrySocket(
  session: TbSession,
  deviceIds: string[],
  onActivity: () => void,
): WebSocket {
  const wsBase = session.baseUrl.replace(/^http/i, "ws");
  const socket = new WebSocket(`${wsBase}/api/ws`);

  socket.addEventListener("open", () => {
    const cmds = deviceIds.flatMap((deviceId, index) => {
      const baseCmdId = 10 + index * 2;
      return [
        {
          entityType: "DEVICE",
          entityId: deviceId,
          keys: TELEMETRY_KEYS.join(","),
          scope: "LATEST_TELEMETRY",
          cmdId: baseCmdId,
          type: "TIMESERIES",
        },
        {
          entityType: "DEVICE",
          entityId: deviceId,
          scope: "CLIENT_SCOPE",
          keys: CLIENT_ATTRIBUTE_KEYS.join(","),
          cmdId: baseCmdId + 1,
          type: "ATTRIBUTES",
        },
      ];
    });

    const payload = {
      authCmd: {
        cmdId: 0,
        token: session.token,
      },
      cmds,
    };
    emitDebugLog({
      level: "info",
      scope: "ws",
      message: `WS 已连接并发送订阅，设备数 ${deviceIds.length}`,
      detail: serializeDetail({
        url: `${wsBase}/api/ws`,
        deviceIds,
        cmds,
      }),
    });
    socket.send(JSON.stringify(payload));
  });

  socket.addEventListener("message", (event) => {
    emitDebugLog({
      level: "info",
      scope: "ws",
      message: "收到 WS 消息",
      detail:
        typeof event.data === "string"
          ? event.data.slice(0, 600)
          : `[${typeof event.data}]`,
    });
    onActivity();
  });

  socket.addEventListener("error", () => {
    emitDebugLog({
      level: "error",
      scope: "ws",
      message: "WS 异常",
      detail: `${wsBase}/api/ws`,
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

async function resolveRpcGateway(
  session: TbSession,
  detail: DeviceState,
  knownClientAttributes?: Record<string, unknown>,
): Promise<string> {
  const mapping = findDeviceMapping(detail);
  if (mapping?.rpcDeviceId) {
    detail.rpcGatewayId = mapping.rpcDeviceId;
    detail.rpcGatewayName = mapping.rpcGatewayName || detail.rpcGatewayName || detail.name;
    if (mapping.rpcTargetName) {
      detail.rpcTargetName = mapping.rpcTargetName;
    }
    emitDebugLog({
      level: "info",
      scope: "rpc",
      message: "RPC 网关命中显式映射",
      detail: serializeDetail({
        deviceId: detail.id,
        deviceName: detail.name,
        rpcGatewayId: detail.rpcGatewayId,
        rpcGatewayName: detail.rpcGatewayName,
        rpcTargetName: detail.rpcTargetName,
      }),
    });
    return mapping.rpcDeviceId;
  }

  const cacheKey = `${session.baseUrl}:${session.user.id}`;
  const cached = gatewayCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    detail.rpcGatewayId = cached.id;
    detail.rpcGatewayName = cached.name;
    emitDebugLog({
      level: "info",
      scope: "rpc",
      message: "RPC 网关命中缓存",
      detail: serializeDetail({
        deviceId: detail.id,
        deviceName: detail.name,
        rpcGatewayId: cached.id,
        rpcGatewayName: cached.name,
      }),
    });
    return cached.id;
  }

  if (isGatewayAttributes(knownClientAttributes ?? {})) {
    const current = { id: detail.id, name: detail.name, expiresAt: Date.now() + 30_000 };
    gatewayCache.set(cacheKey, current);
    detail.rpcGatewayId = current.id;
    detail.rpcGatewayName = current.name;
    emitDebugLog({
      level: "info",
      scope: "rpc",
      message: "当前设备识别为 RPC 网关",
      detail: serializeDetail({
        deviceId: detail.id,
        deviceName: detail.name,
      }),
    });
    return current.id;
  }

  const currentAttrs =
    knownClientAttributes ??
    (await getAttributes(session, detail.id, "CLIENT_SCOPE", CLIENT_ATTRIBUTE_KEYS));
  if (isGatewayAttributes(currentAttrs)) {
    const current = { id: detail.id, name: detail.name, expiresAt: Date.now() + 30_000 };
    gatewayCache.set(cacheKey, current);
    detail.rpcGatewayId = current.id;
    detail.rpcGatewayName = current.name;
    emitDebugLog({
      level: "info",
      scope: "rpc",
      message: "当前设备属性识别为 RPC 网关",
      detail: serializeDetail({
        deviceId: detail.id,
        deviceName: detail.name,
      }),
    });
    return current.id;
  }

  const devices = await fetchDeviceList(session);
  for (const device of devices) {
    const attrs = await getAttributes(session, device.id, "CLIENT_SCOPE", CLIENT_ATTRIBUTE_KEYS);
    if (!isGatewayAttributes(attrs)) {
      continue;
    }
    const resolved = { id: device.id, name: device.name, expiresAt: Date.now() + 30_000 };
    gatewayCache.set(cacheKey, resolved);
    detail.rpcGatewayId = resolved.id;
    detail.rpcGatewayName = resolved.name;
    emitDebugLog({
      level: "info",
      scope: "rpc",
      message: "自动发现 RPC 网关",
      detail: serializeDetail({
        deviceId: detail.id,
        deviceName: detail.name,
        rpcGatewayId: resolved.id,
        rpcGatewayName: resolved.name,
      }),
    });
    return resolved.id;
  }

  emitDebugLog({
    level: "error",
    scope: "rpc",
    message: "未发现 RPC 网关，回退当前设备",
    detail: serializeDetail({
      deviceId: detail.id,
      deviceName: detail.name,
    }),
  });
  return detail.id;
}

async function sendRpc(
  session: TbSession,
  deviceId: string,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const payload = {
    method,
    params,
    timeout: 20000,
  };

  try {
    emitDebugLog({
      level: "info",
      scope: "rpc",
      message: `发送 two-way RPC ${method}`,
      detail: serializeDetail({ deviceId, params }),
    });
    return await tbRequest(session, `/api/rpc/twoway/${deviceId}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    emitDebugLog({
      level: "error",
      scope: "rpc",
      message: `two-way RPC 失败 ${method}`,
      detail: message,
    });
    if (
      !message.includes("请求失败 409") &&
      !message.includes("请求失败 408") &&
      !message.includes("TIMEOUT")
    ) {
      throw error;
    }

    emitDebugLog({
      level: "info",
      scope: "rpc",
      message: `降级 one-way RPC ${method}`,
      detail: serializeDetail({ deviceId, params }),
    });
    return tbRequest(session, `/api/rpc/oneway/${deviceId}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }
}

async function performControlAction(
  session: TbSession,
  deviceId: string,
  kind: NonNullable<DeviceState["lastCommand"]>["kind"],
  execute: (
    detail: DeviceState,
  ) => Promise<{
    message: string;
    siteNumber?: number;
    durationSeconds?: number;
  }>,
): Promise<DeviceState> {
  const detail = await fetchDeviceDetail(session, deviceId);
  const commandMeta = await execute(detail);
  const refreshed = await refreshAfterControl(session, deviceId);
  refreshed.lastCommand = {
    kind,
    siteNumber: commandMeta.siteNumber,
    durationSeconds: commandMeta.durationSeconds,
    result: "success",
    at: Date.now(),
    message: commandMeta.message,
  };
  return refreshed;
}

async function refreshAfterControl(session: TbSession, deviceId: string): Promise<DeviceState> {
  let latest = await fetchDeviceDetail(session, deviceId);
  for (const delayMs of CONTROL_REFRESH_DELAYS_MS) {
    emitDebugLog({
      level: "info",
      scope: "rest",
      message: `控制后延迟回读 ${delayMs}ms`,
      detail: serializeDetail({ deviceId }),
    });
    await wait(delayMs);
    latest = await fetchDeviceDetail(session, deviceId);
  }
  return latest;
}


async function getLatestTelemetry(
  session: TbSession,
  deviceId: string,
  keys: string[],
): Promise<Record<string, unknown>> {
  const query = new URLSearchParams({
    keys: keys.join(","),
    useStrictDataTypes: "true",
  });
  const payload = await tbRequest(
    session,
    `/api/plugins/telemetry/DEVICE/${deviceId}/values/timeseries?${query.toString()}`,
  );
  const values: Record<string, unknown> = {};
  for (const [key, entries] of Object.entries(payload ?? {})) {
    if (Array.isArray(entries) && entries.length > 0) {
      values[key] = normalizeMaybeTypedValue((entries[0] as { value?: unknown }).value);
      values[`${key}Ts`] = (entries[0] as { ts?: number }).ts ?? 0;
    }
  }
  return values;
}

async function getAttributes(
  session: TbSession,
  deviceId: string,
  scope: "CLIENT_SCOPE" | "SHARED_SCOPE",
  keys: string[],
): Promise<Record<string, unknown>> {
  const query = new URLSearchParams({ keys: keys.join(",") });
  const payload = await tbRequest(
    session,
    `/api/plugins/telemetry/DEVICE/${deviceId}/values/attributes/${scope}?${query.toString()}`,
  );
  const values: Record<string, unknown> = {};
  for (const raw of Array.isArray(payload) ? payload : []) {
    const item = raw as { key?: string; value?: unknown; lastUpdateTs?: number };
    if (!item.key) {
      continue;
    }
    values[item.key] = normalizeMaybeTypedValue(item.value);
    values[`${item.key}Ts`] = item.lastUpdateTs ?? 0;
  }
  return values;
}

async function tbRequest(
  session: TbSession,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const response = await fetch(`${session.baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Authorization": `Bearer ${session.token}`,
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    emitDebugLog({
      level: "error",
      scope: "rest",
      message: `REST 失败 ${response.status} ${path}`,
      detail: text,
    });
    throw new Error(`ThingsBoard 请求失败 ${response.status}: ${path} ${text}`);
  }

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  const result = text.trim() ? JSON.parse(text) : null;
  if (
    path.includes("/device/info/") ||
    path.includes("/values/timeseries") ||
    path.includes("/values/attributes/")
  ) {
    emitDebugLog({
      level: "info",
      scope: "rest",
      message: `REST 成功 ${path}`,
      detail: serializeDetail(result),
    });
  }
  return result;
}

function mapToDeviceState(
  info: Record<string, unknown>,
  telemetry: Record<string, unknown>,
  clientAttributes: Record<string, unknown>,
  sharedAttributes: Record<string, unknown>,
): DeviceState {
  const mapping = findDeviceMapping({
    id: ((info.id as { id?: string } | undefined)?.id ?? ""),
    name: typeof info.name === "string" ? info.name : undefined,
  });
  const siteCount =
    mapping?.siteCount ??
    toInt(sharedAttributes.siteCount) ??
    toInt(sharedAttributes.channels) ??
    toInt(clientAttributes.siteCount) ??
    toInt(clientAttributes.channels) ??
    1;

  const selectedSiteNumber =
    toInt(telemetry.selectedSiteNumber) ??
    toInt(clientAttributes.selectedSiteNumber) ??
    toInt(sharedAttributes.siteNumber) ??
    1;

  const lastSeenAt = Math.max(
    0,
    ...Object.entries(telemetry)
      .filter(([key]) => key.endsWith("Ts"))
      .map(([, value]) => toInt(value) ?? 0),
    toInt(clientAttributes.lastConnectionUpdateTs) ?? 0,
  );

  return {
    id: ((info.id as { id?: string } | undefined)?.id ?? ""),
    name: (typeof info.name === "string" ? info.name : "未命名设备"),
    model:
      mapping?.model ||
      (typeof info.type === "string" && info.type) ||
      (typeof info.label === "string" && info.label) ||
      "Device",
    serialNumber:
      mapping?.serialNumber ||
      (typeof info.name === "string" ? info.name : ((info.id as { id?: string } | undefined)?.id ?? "")),
    rpcTargetName:
      (typeof mapping?.rpcTargetName === "string" && mapping.rpcTargetName.trim()) ||
      (typeof sharedAttributes.targetDeviceName === "string" &&
        sharedAttributes.targetDeviceName.trim()) ||
      (typeof clientAttributes.connectedDeviceName === "string" &&
        clientAttributes.connectedDeviceName.trim()) ||
      (typeof info.name === "string" ? info.name : "") ||
      "",
    rpcGatewayId: mapping?.rpcDeviceId,
    rpcGatewayName: mapping?.rpcGatewayName,
    platformState: info.active ? "active" : "inactive",
    platformLastActivityAt: toInt(info.lastActivityTime) ?? 0,
    connectivityState:
      normalizeConnectionState(clientAttributes.bleConnectionState) ?? "disconnected",
    lastSeenAt: lastSeenAt || Date.now(),
    signalRssi: -70,
    siteCount,
    selectedSiteNumber: clamp(selectedSiteNumber, 1, siteCount),
    batteryLevel: toNumber(telemetry.batteryLevel) ?? 0,
    batteryVoltage: toNumber(telemetry.batteryVoltage) ?? 0,
    soilMoisture: toNumber(telemetry.soilMoisture) ?? 0,
    rainSensorWet: toBoolean(telemetry.rainSensorWet) ?? false,
    rtcTimestamp: toInt(telemetry.rtcTimestamp) ?? Date.now(),
    lastCommand: undefined,
    sites: Array.from({ length: siteCount }, (_, index) => {
      const siteNumber = index + 1;
      return {
        siteNumber,
        label: `${siteNumber} 号路`,
        open: toBoolean(telemetry[`station${siteNumber}Open`]) ?? false,
        remainingSeconds: toInt(telemetry[`station${siteNumber}RemainingSeconds`]) ?? 0,
        openingDurationSeconds:
          toInt(telemetry[`station${siteNumber}OpeningDurationSeconds`]) ?? 0,
        manualDurationSeconds: toInt(sharedAttributes.manualDurationSeconds) ?? 600,
      };
    }),
  };
}

function isGatewayAttributes(attributes: Record<string, unknown>): boolean {
  if (attributes.appMode === "ble-mqtt-gateway") {
    return true;
  }
  const methods = attributes.rpcMethods;
  return Array.isArray(methods)
    ? methods.includes("ble_connectDevice") && methods.includes("openValve")
    : false;
}

function normalizeMaybeTypedValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  if (value === "true" || value === "false") {
    return value === "true";
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return value;
}

function normalizeConnectionState(value: unknown): DeviceState["connectivityState"] | null {
  if (typeof value !== "string") {
    return null;
  }
  if (["connected", "connecting", "disconnected", "error"].includes(value)) {
    return value as DeviceState["connectivityState"];
  }
  if (value === "idle") {
    return "disconnected";
  }
  return null;
}

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  return null;
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeBaseUrl(baseUrl: string): string {
  return (baseUrl || DEFAULT_TB_BASE_URL).trim().replace(/\/+$/, "");
}

function parseDeviceMappings(): DeviceMapping[] {
  const raw = process.env.NEXT_PUBLIC_TB_DEVICE_MAPPINGS?.trim();
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is DeviceMapping => !!item && typeof item === "object");
  } catch {
    console.error("[tb:auth] NEXT_PUBLIC_TB_DEVICE_MAPPINGS 解析失败");
    return [];
  }
}

function findDeviceMapping(input: { id?: string; name?: string } | DeviceState): DeviceMapping | null {
  const id = input.id?.trim();
  const name = input.name?.trim();
  for (const item of configuredDeviceMappings) {
    if (id && (item.tbDeviceId === id || item.id === id)) {
      return item;
    }
    if (name && item.name?.trim() === name) {
      return item;
    }
  }
  return null;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
