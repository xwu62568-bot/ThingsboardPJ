import type {
  ConnectivityState,
  DeviceState,
  DeviceSummary,
  IrrigationUser,
} from "@/lib/domain/types";
import { clearStoredSession, getStoredSession, type TbSession } from "./session";

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

const configuredDeviceMappings = parseDeviceMappings();
const gatewayCache = new Map<string, { id: string; name: string; expiresAt: number }>();
const unsupportedDeviceInfosBaseUrls = new Set<string>();
const unsupportedCustomerDeviceInfosKeys = new Set<string>();
const deviceListCache = new Map<string, DeviceSummary[]>();
const deviceDetailCache = new Map<string, DeviceState>();
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

function expireLocalSessionAndRedirect(reason?: string) {
  clearStoredSession();
  clearTbClientCaches();
  emitDebugLog({
    level: "error",
    scope: "auth",
    message: "会话已失效，请重新登录",
    detail: reason,
  });
  if (typeof window !== "undefined" && window.location.pathname !== "/login") {
    window.location.replace("/login");
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

function resolveRequiredSession(session?: TbSession | null): TbSession {
  const resolved = session ?? getStoredSession();
  if (!resolved?.token || !resolved.baseUrl) {
    throw new Error("未登录或会话已失效");
  }
  return resolved;
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
  const token = String(payload.token ?? "");
  const currentUser = token ? await fetchCurrentUser(baseUrl, token) : null;
  const session: TbSession = {
    baseUrl,
    token,
    refreshToken: typeof payload.refreshToken === "string" ? payload.refreshToken : undefined,
    user: {
      id: String((currentUser as { id?: { id?: string } } | null)?.id?.id ?? input.username),
      username:
        typeof (currentUser as { email?: string } | null)?.email === "string" &&
        (currentUser as { email?: string }).email
          ? String((currentUser as { email?: string }).email)
          : input.username,
      name: String(
        (currentUser as { firstName?: string } | null)?.firstName ??
          payload.firstName ??
          payload.email ??
          input.username,
      ),
      role: String(
        (currentUser as { authority?: string } | null)?.authority ??
          payload.authority ??
          "TENANT_ADMIN",
      ),
      email:
        typeof (currentUser as { email?: string } | null)?.email === "string"
          ? String((currentUser as { email?: string }).email)
          : typeof payload.email === "string"
            ? payload.email
            : undefined,
      customerId: extractEntityId(
        (currentUser as { customerId?: unknown } | null)?.customerId ?? payload.customerId,
      ),
    } satisfies IrrigationUser & { email?: string; role: string },
  };

  emitDebugLog({
    level: "info",
    scope: "auth",
    message: "登录成功",
    detail: serializeDetail({
      baseUrl,
      user: session.user.username,
      role: session.user.role,
    }),
  });

  return session;
}

export async function logoutFromThingsBoard(): Promise<void> {
  clearTbClientCaches();
  emitDebugLog({
    level: "info",
    scope: "auth",
    message: "本地会话已退出",
  });
}

export async function fetchDeviceList(session?: TbSession | null): Promise<DeviceSummary[]> {
  const resolved = resolveRequiredSession(session);
  const rows = await fetchAccessibleDeviceRows(resolved);
  const devices = rows.map((raw) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const itemId = item.id as { id?: string } | undefined;
    const deviceId = itemId?.id ?? "";
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
        (typeof item.name === "string" ? item.name : itemId?.id ?? ""),
      platformState: item.active ? "active" : "inactive",
      platformLastActivityAt: toInt(item.lastActivityTime) ?? 0,
      connectivityState: "disconnected" as ConnectivityState,
      lastSeenAt: toInt(item.lastActivityTime) ?? 0,
      selectedSiteNumber: 1,
      siteCount: mapping?.siteCount ?? 1,
      batteryLevel: 0,
    } satisfies DeviceSummary;
  });
  deviceListCache.set(getDeviceListCacheKey(resolved), devices);
  return devices;
}

export function getCachedDeviceList(session?: TbSession | null): DeviceSummary[] {
  try {
    const resolved = resolveRequiredSession(session);
    return deviceListCache.get(getDeviceListCacheKey(resolved)) ?? [];
  } catch {
    return [];
  }
}

export async function fetchDeviceDetail(
  session: TbSession | null | undefined,
  deviceId: string,
): Promise<DeviceState> {
  const resolved = resolveRequiredSession(session);
  const [info, telemetry, clientAttributes, sharedAttributes] = await Promise.all([
    tbRequest(resolved, `/api/device/info/${deviceId}`),
    getLatestTelemetry(resolved, deviceId, TELEMETRY_KEYS),
    getAttributes(resolved, deviceId, "CLIENT_SCOPE", CLIENT_ATTRIBUTE_KEYS),
    getAttributes(resolved, deviceId, "SHARED_SCOPE", SHARED_ATTRIBUTE_KEYS),
  ]);

  const detail = mapToDeviceState(
    (info as Record<string, unknown>) ?? {},
    telemetry,
    clientAttributes,
    sharedAttributes,
  );
  await resolveRpcGateway(resolved, detail, clientAttributes);
  deviceDetailCache.set(getDeviceDetailCacheKey(resolved, deviceId), detail);
  return detail;
}

export function getCachedDeviceDetail(
  session: TbSession | null | undefined,
  deviceId: string,
): DeviceState | null {
  try {
    const resolved = resolveRequiredSession(session);
    return deviceDetailCache.get(getDeviceDetailCacheKey(resolved, deviceId)) ?? null;
  } catch {
    return null;
  }
}

export async function connectDevice(
  session: TbSession | null | undefined,
  deviceId: string,
): Promise<DeviceState> {
  const resolved = resolveRequiredSession(session);
  emitDebugLog({
    level: "info",
    scope: "rpc",
    message: "发送连接命令",
    detail: serializeDetail({ deviceId }),
  });
  return performControlAction(resolved, deviceId, "connect", async (detail) => {
    const rpcId = await resolveRpcGateway(resolved, detail);
    await sendRpc(resolved, rpcId, "ble_connectDevice", {
      deviceName: detail.rpcTargetName || detail.name,
      siteCount: detail.siteCount,
    });
    return { message: "正在请求网关建立 BLE 连接" };
  });
}

export async function disconnectDevice(
  session: TbSession | null | undefined,
  deviceId: string,
): Promise<DeviceState> {
  const resolved = resolveRequiredSession(session);
  emitDebugLog({
    level: "info",
    scope: "rpc",
    message: "发送断开命令",
    detail: serializeDetail({ deviceId }),
  });
  return performControlAction(resolved, deviceId, "disconnect", async (detail) => {
    const rpcId = await resolveRpcGateway(resolved, detail);
    await sendRpc(resolved, rpcId, "ble_disconnectDevice", {
      deviceName: detail.rpcTargetName || detail.name,
    });
    return { message: "正在请求设备断开连接" };
  });
}

export async function refreshDevice(
  session: TbSession | null | undefined,
  deviceId: string,
): Promise<DeviceState> {
  const resolved = resolveRequiredSession(session);
  emitDebugLog({
    level: "info",
    scope: "rpc",
    message: "发送刷新命令",
    detail: serializeDetail({ deviceId }),
  });
  return performControlAction(resolved, deviceId, "refresh", async (detail) => {
    const rpcId = await resolveRpcGateway(resolved, detail);
    await sendRpc(resolved, rpcId, "ble_requestDeviceState", {
      deviceName: detail.rpcTargetName || detail.name,
    });
    return { message: "正在请求设备上送最新状态" };
  });
}

export async function runIrrigation(
  session: TbSession | null | undefined,
  deviceId: string,
  siteNumber: number,
  durationSeconds: number,
): Promise<DeviceState> {
  const resolved = resolveRequiredSession(session);
  emitDebugLog({
    level: "info",
    scope: "rpc",
    message: "发送开阀命令",
    detail: serializeDetail({ deviceId, siteNumber, durationSeconds }),
  });
  return performControlAction(resolved, deviceId, "run", async (detail) => {
    const rpcId = await resolveRpcGateway(resolved, detail);
    await sendRpc(resolved, rpcId, "openValve", {
      deviceName: detail.rpcTargetName || detail.name,
      stationId: "1",
      siteNumber,
      manualDurationSeconds: durationSeconds,
    });
    return {
      message: `已向 ThingsBoard 下发 ${siteNumber} 号路开阀命令`,
      siteNumber,
      durationSeconds,
    };
  });
}

export async function stopIrrigation(
  session: TbSession | null | undefined,
  deviceId: string,
  siteNumber: number,
): Promise<DeviceState> {
  const resolved = resolveRequiredSession(session);
  emitDebugLog({
    level: "info",
    scope: "rpc",
    message: "发送关阀命令",
    detail: serializeDetail({ deviceId, siteNumber }),
  });
  return performControlAction(resolved, deviceId, "stop", async (detail) => {
    const rpcId = await resolveRpcGateway(resolved, detail);
    await sendRpc(resolved, rpcId, "openValve", {
      deviceName: detail.rpcTargetName || detail.name,
      stationId: "0",
      siteNumber,
    });
    return {
      message: `已向 ThingsBoard 下发 ${siteNumber} 号路关阀命令`,
      siteNumber,
    };
  });
}

export function openTelemetrySocket(
  session: TbSession | null | undefined,
  deviceIds: string[],
  onActivity: () => void,
): WebSocket {
  const resolved = resolveRequiredSession(session);
  const url = buildTbWsUrl(resolved.baseUrl);
  const socket = new WebSocket(url);

  socket.addEventListener("open", () => {
    const body = buildSubscriptionMessage(resolved, deviceIds);
    const parsed = JSON.parse(body) as { cmds?: unknown[] };
    if (!parsed.cmds?.length) {
      socket.close();
      return;
    }
    emitDebugLog({
      level: "info",
      scope: "ws",
      message: `WS 已连接并发送订阅，设备数 ${deviceIds.length}`,
      detail: serializeDetail({ url, deviceIds }),
    });
    socket.send(body);
  });

  socket.addEventListener("message", (event) => {
    try {
      const text = typeof event.data === "string" ? event.data : String(event.data);
      const parsed = JSON.parse(text) as unknown;
      if (!shouldTriggerDownstream(parsed)) {
        return;
      }
      emitDebugLog({
        level: "info",
        scope: "ws",
        message: "收到 TB WS 推送",
        detail: text.slice(0, 600),
      });
      onActivity();
    } catch {
      // ignore non-JSON frames
    }
  });

  socket.addEventListener("error", () => {
    emitDebugLog({
      level: "error",
      scope: "ws",
      message: "TB WS 异常",
      detail: url,
    });
  });

  socket.addEventListener("close", (event) => {
    emitDebugLog({
      level: event.wasClean ? "info" : "error",
      scope: "ws",
      message: `TB WS 关闭 code=${event.code}`,
      detail: event.reason || "no reason",
    });
  });

  return socket;
}

function getTbWsSubscriptionKeyLists() {
  return {
    telemetry: TELEMETRY_KEYS.join(","),
    clientKeys: CLIENT_ATTRIBUTE_KEYS.join(","),
    sharedKeys: SHARED_ATTRIBUTE_KEYS.join(","),
  };
}

function buildTbWsUrl(baseUrl: string) {
  const u = new URL(normalizeBaseUrl(baseUrl));
  const wsProto = u.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProto}//${u.host}/api/ws`;
}

function buildSubscriptionMessage(session: TbSession, deviceIds: string[]) {
  const lists = getTbWsSubscriptionKeyLists();
  const cmds: Record<string, unknown>[] = [];
  let cmdId = 1;
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;

  for (const entityId of deviceIds) {
    if (!entityId?.trim()) {
      continue;
    }
    cmds.push({
      type: "TIMESERIES",
      cmdId: cmdId++,
      entityType: "DEVICE",
      entityId: entityId.trim(),
      keys: lists.telemetry,
      scope: "LATEST_TELEMETRY",
      startTs: now - weekMs,
      timeWindow: weekMs,
      interval: 0,
      limit: 200,
      agg: "NONE",
    });
    cmds.push({
      type: "ATTRIBUTES",
      cmdId: cmdId++,
      entityType: "DEVICE",
      entityId: entityId.trim(),
      keys: lists.clientKeys,
      scope: "CLIENT_SCOPE",
    });
    cmds.push({
      type: "ATTRIBUTES",
      cmdId: cmdId++,
      entityType: "DEVICE",
      entityId: entityId.trim(),
      keys: lists.sharedKeys,
      scope: "SHARED_SCOPE",
    });
  }

  return JSON.stringify({
    authCmd: { cmdId: 0, token: session.token },
    cmds,
  });
}

function shouldTriggerDownstream(parsed: unknown): boolean {
  if (parsed == null) {
    return false;
  }
  if (Array.isArray(parsed)) {
    return parsed.some(shouldTriggerDownstream);
  }
  if (typeof parsed === "object" && "subscriptionId" in parsed) {
    return typeof (parsed as { subscriptionId?: unknown }).subscriptionId === "number";
  }
  return false;
}

function clearTbClientCaches() {
  gatewayCache.clear();
  deviceListCache.clear();
  deviceDetailCache.clear();
}

function getSessionCacheScope(session: TbSession) {
  return `${normalizeBaseUrl(session.baseUrl)}::${session.user.id}`;
}

function getDeviceListCacheKey(session: TbSession) {
  return getSessionCacheScope(session);
}

function getDeviceDetailCacheKey(session: TbSession, deviceId: string) {
  return `${getSessionCacheScope(session)}::${deviceId}`;
}

async function fetchAccessibleDeviceRows(session: TbSession) {
  const liveUser = await fetchCurrentUser(session.baseUrl, session.token);
  const effectiveUser = mergeSessionUser(session.user, liveUser);

  if (canUseCustomerScope(effectiveUser)) {
    const customerId =
      extractEntityId(effectiveUser?.customerId) ??
      (await resolveCustomerId(session.baseUrl, session.token, session.user));
    if (!customerId) {
      throw new Error("ThingsBoard 当前账号缺少 customerId，无法查询客户设备列表");
    }
    return fetchCustomerDeviceRows(session, customerId);
  }

  try {
    return await fetchTenantDeviceRows(session);
  } catch (error) {
    const customerId = extractEntityId(effectiveUser?.customerId);
    if (canUseCustomerScope(effectiveUser) && customerId && shouldRetryAsCustomer(error)) {
      return fetchCustomerDeviceRows(session, customerId);
    }
    throw error;
  }
}

async function fetchTenantDeviceRows(session: TbSession) {
  if (
    !supportsDeviceInfos(session.baseUrl) ||
    unsupportedDeviceInfosBaseUrls.has(session.baseUrl)
  ) {
    const data = await tbRequest(session, "/api/tenant/devices?pageSize=100&page=0");
    if (Array.isArray(data)) {
      return data;
    }
    return Array.isArray((data as { data?: unknown[] } | null)?.data)
      ? ((data as { data?: unknown[] }).data ?? [])
      : [];
  }
  try {
    const data = await tbRequest(session, "/api/tenant/deviceInfos?pageSize=100&page=0");
    return Array.isArray((data as { data?: unknown[] } | null)?.data)
      ? ((data as { data?: unknown[] }).data ?? [])
      : [];
  } catch (error) {
    if (!shouldFallbackToTenantDevices(error)) {
      throw error;
    }
    unsupportedDeviceInfosBaseUrls.add(session.baseUrl);
    const data = await tbRequest(session, "/api/tenant/devices?pageSize=100&page=0");
    if (Array.isArray(data)) {
      return data;
    }
    return Array.isArray((data as { data?: unknown[] } | null)?.data)
      ? ((data as { data?: unknown[] }).data ?? [])
      : [];
  }
}

async function fetchCustomerDeviceRows(session: TbSession, customerId: string) {
  const customerScopeKey = `${session.baseUrl}:${customerId}`;
  if (
    !supportsDeviceInfos(session.baseUrl) ||
    unsupportedCustomerDeviceInfosKeys.has(customerScopeKey)
  ) {
    const data = await tbRequest(session, `/api/customer/${customerId}/devices?pageSize=100&page=0`);
    if (Array.isArray(data)) {
      return data;
    }
    return Array.isArray((data as { data?: unknown[] } | null)?.data)
      ? ((data as { data?: unknown[] }).data ?? [])
      : [];
  }
  try {
    const data = await tbRequest(
      session,
      `/api/customer/${customerId}/deviceInfos?pageSize=100&page=0`,
    );
    return Array.isArray((data as { data?: unknown[] } | null)?.data)
      ? ((data as { data?: unknown[] }).data ?? [])
      : [];
  } catch (error) {
    if (!shouldFallbackToCustomerDevices(error)) {
      throw error;
    }
    unsupportedCustomerDeviceInfosKeys.add(customerScopeKey);
    const data = await tbRequest(session, `/api/customer/${customerId}/devices?pageSize=100&page=0`);
    if (Array.isArray(data)) {
      return data;
    }
    return Array.isArray((data as { data?: unknown[] } | null)?.data)
      ? ((data as { data?: unknown[] }).data ?? [])
      : [];
  }
}

async function resolveCustomerId(baseUrl: string, token: string, user?: IrrigationUser | null) {
  const direct = extractEntityId(user?.customerId);
  if (direct) {
    return direct;
  }
  const profile = await fetchCurrentUser(baseUrl, token);
  return extractEntityId((profile as { customerId?: unknown } | null)?.customerId);
}

async function performControlAction(
  session: TbSession,
  deviceId: string,
  kind: NonNullable<DeviceState["lastCommand"]>["kind"],
  execute: (
    detail: DeviceState,
  ) => Promise<{ message: string; siteNumber?: number; durationSeconds?: number }>,
) {
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

async function refreshAfterControl(session: TbSession, deviceId: string) {
  let latest = await fetchDeviceDetail(session, deviceId);
  for (const delayMs of CONTROL_REFRESH_DELAYS_MS) {
    await wait(delayMs);
    latest = await fetchDeviceDetail(session, deviceId);
  }
  return latest;
}

async function resolveRpcGateway(
  session: TbSession,
  detail: DeviceState,
  knownClientAttributes?: Record<string, unknown>,
) {
  const mapping = findDeviceMapping(detail);
  if (mapping?.rpcDeviceId) {
    detail.rpcGatewayId = mapping.rpcDeviceId;
    detail.rpcGatewayName = mapping.rpcGatewayName || detail.rpcGatewayName || detail.name;
    if (mapping.rpcTargetName) {
      detail.rpcTargetName = mapping.rpcTargetName;
    }
    return mapping.rpcDeviceId;
  }

  const cacheKey = `${session.baseUrl}:${session.user.id}`;
  const cached = gatewayCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    detail.rpcGatewayId = cached.id;
    detail.rpcGatewayName = cached.name;
    return cached.id;
  }

  if (isGatewayAttributes(knownClientAttributes ?? {})) {
    const current = { id: detail.id, name: detail.name, expiresAt: Date.now() + 30_000 };
    gatewayCache.set(cacheKey, current);
    detail.rpcGatewayId = current.id;
    detail.rpcGatewayName = current.name;
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
    return resolved.id;
  }

  return detail.id;
}

async function sendRpc(
  session: TbSession,
  deviceId: string,
  method: string,
  params: Record<string, unknown>,
) {
  try {
    await tbRequest(session, `/api/plugins/rpc/oneway/${deviceId}`, {
      method: "POST",
      body: JSON.stringify({
        method,
        params,
        timeout: 20000,
      }),
    });
  } catch (error) {
    if (!isRpcConflictError(error)) {
      throw error;
    }
    gatewayCache.delete(`${session.baseUrl}:${session.user.id}`);
    await wait(1500);
    await tbRequest(session, `/api/plugins/rpc/oneway/${deviceId}`, {
      method: "POST",
      body: JSON.stringify({
        method,
        params,
        timeout: 20000,
      }),
    });
  }
}

async function getLatestTelemetry(session: TbSession, deviceId: string, keys: string[]) {
  const query = new URLSearchParams({
    keys: keys.join(","),
    useStrictDataTypes: "true",
  });
  const payload = (await tbRequest(
    session,
    `/api/plugins/telemetry/DEVICE/${deviceId}/values/timeseries?${query.toString()}`,
  )) as Record<string, Array<{ value?: unknown; ts?: number }>>;
  const values: Record<string, unknown> = {};
  for (const [key, entries] of Object.entries(payload ?? {})) {
    if (Array.isArray(entries) && entries.length > 0) {
      values[key] = normalizeMaybeTypedValue(entries[0]?.value);
      values[`${key}Ts`] = entries[0]?.ts ?? 0;
    }
  }
  return values;
}

async function getAttributes(
  session: TbSession,
  deviceId: string,
  scope: "CLIENT_SCOPE" | "SHARED_SCOPE",
  keys: string[],
) {
  const query = new URLSearchParams({
    keys: keys.join(","),
  });
  const payload = (await tbRequest(
    session,
    `/api/plugins/telemetry/DEVICE/${deviceId}/values/attributes/${scope}?${query.toString()}`,
  )) as Array<{ key?: string; value?: unknown; lastUpdateTs?: number }>;
  const values: Record<string, unknown> = {};
  for (const item of Array.isArray(payload) ? payload : []) {
    if (!item.key) {
      continue;
    }
    values[item.key] = normalizeMaybeTypedValue(item.value);
    values[`${item.key}Ts`] = item.lastUpdateTs ?? 0;
  }
  return values;
}

async function tbRequest(session: TbSession, path: string, init: RequestInit = {}) {
  const url = `${normalizeBaseUrl(session.baseUrl)}${path}`;
  const isRpcRequest = path.includes("/api/plugins/rpc/");
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Authorization": `Bearer ${session.token}`,
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    if (response.status === 401) {
      expireLocalSessionAndRedirect(text);
    }
    emitDebugLog({
      level: "error",
      scope: isRpcRequest ? "rpc" : "rest",
      message: `${isRpcRequest ? "RPC" : "REST"} 失败 ${response.status} ${path}`,
      detail: text,
    });
    throw buildThingsBoardHttpError(response.status, path, text);
  }

  if (response.status === 204) {
    emitDebugLog({
      level: "info",
      scope: isRpcRequest ? "rpc" : "rest",
      message: `${isRpcRequest ? "RPC" : "REST"} 成功 ${path}`,
    });
    return null;
  }

  const text = await response.text();
  const payload = text.trim() ? JSON.parse(text) : null;
  emitDebugLog({
    level: "info",
    scope: isRpcRequest ? "rpc" : "rest",
    message: `${isRpcRequest ? "RPC" : "REST"} 成功 ${path}`,
    detail: serializeDetail(payload),
  });
  return payload;
}

function mapToDeviceState(
  info: Record<string, unknown>,
  telemetry: Record<string, unknown>,
  clientAttributes: Record<string, unknown>,
  sharedAttributes: Record<string, unknown>,
): DeviceState {
  const infoId = info.id as { id?: string } | undefined;
  const mapping = findDeviceMapping({
    id: infoId?.id ?? "",
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

  const sites = Array.from({ length: siteCount }, (_, index) => {
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
  });

  const lastCommand = buildLastCommand(telemetry, clientAttributes);

  return {
    id: infoId?.id ?? "",
    name: typeof info.name === "string" ? info.name : "未命名设备",
    model:
      mapping?.model ||
      (typeof info.type === "string" && info.type) ||
      (typeof info.label === "string" && info.label) ||
      "Device",
    serialNumber:
      mapping?.serialNumber ||
      (typeof info.name === "string" ? info.name : infoId?.id ?? ""),
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
      (normalizeConnectionState(clientAttributes.bleConnectionState) ?? "disconnected") as ConnectivityState,
    lastSeenAt: lastSeenAt || Date.now(),
    signalRssi: -70,
    siteCount,
    selectedSiteNumber: clamp(selectedSiteNumber, 1, siteCount),
    batteryLevel: toNumber(telemetry.batteryLevel) ?? 0,
    batteryVoltage: toNumber(telemetry.batteryVoltage) ?? 0,
    soilMoisture: toNumber(telemetry.soilMoisture) ?? 0,
    rainSensorWet: toBoolean(telemetry.rainSensorWet) ?? false,
    rtcTimestamp: toInt(telemetry.rtcTimestamp) ?? Date.now(),
    lastCommand,
    sites,
  };
}

function buildLastCommand(
  telemetry: Record<string, unknown>,
  clientAttributes: Record<string, unknown>,
): DeviceState["lastCommand"] {
  const siteNumber =
    toInt(telemetry.lastValveSiteNumber) ?? toInt(clientAttributes.lastRpcValveSiteNumber);
  const durationSeconds = toInt(clientAttributes.lastRpcManualDurationSeconds);
  const rawCommand = telemetry.lastValveCommand ?? clientAttributes.lastRpcValveCommand;
  const kindMap: Record<string, NonNullable<DeviceState["lastCommand"]>["kind"]> = {
    open: "run",
    close: "stop",
  };
  const kind = kindMap[String(rawCommand ?? "")] ?? "refresh";
  const at =
    toInt(telemetry.lastControlAppliedAt) ??
    toInt(clientAttributes.lastControlAppliedAt) ??
    toInt(clientAttributes.lastConnectionUpdateTs);

  if (!at && !rawCommand) {
    return undefined;
  }

  return {
    kind,
    siteNumber: siteNumber ?? undefined,
    durationSeconds: durationSeconds ?? undefined,
    result: "success",
    at: at ?? Date.now(),
    message:
      kind === "run"
        ? `最近一次操作：开启 ${siteNumber ?? "-"} 号路`
        : kind === "stop"
          ? `最近一次操作：关闭 ${siteNumber ?? "-"} 号路`
          : "最近一次操作：设备状态刷新",
  };
}

function isGatewayAttributes(attributes: Record<string, unknown>) {
  if (attributes.appMode === "ble-mqtt-gateway") {
    return true;
  }
  const methods = attributes.rpcMethods;
  return Array.isArray(methods)
    ? methods.includes("ble_connectDevice") && methods.includes("openValve")
    : false;
}

function parseDeviceMappings(): DeviceMapping[] {
  const raw =
    process.env.NEXT_PUBLIC_TB_MANAGED_DEVICES?.trim() ||
    process.env.NEXT_PUBLIC_TB_DEVICE_MAPPINGS?.trim();
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DeviceMapping[]) : [];
  } catch (error) {
    console.error("[tb:auth] NEXT_PUBLIC_TB_MANAGED_DEVICES 解析失败", error);
    return [];
  }
}

function findDeviceMapping(input: { id?: string; name?: string }) {
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

function normalizeMaybeTypedValue(value: unknown) {
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

function normalizeConnectionState(value: unknown): ConnectivityState | null {
  if (typeof value !== "string") {
    return null;
  }
  if (
    value === "connected" ||
    value === "connecting" ||
    value === "disconnected" ||
    value === "error"
  ) {
    return value;
  }
  if (value === "idle") {
    return "disconnected";
  }
  return null;
}

function shouldFallbackToTenantDevices(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("/api/tenant/deviceInfos") &&
    (message.includes("Invalid UUID string: deviceInfos") ||
      message.includes('"Invalid UUID string: deviceInfos"'))
  );
}

function shouldFallbackToCustomerDevices(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("/deviceInfos") &&
    (message.includes("Invalid UUID string: deviceInfos") ||
      message.includes('"Invalid UUID string: deviceInfos"'))
  );
}

function shouldRetryAsCustomer(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("/api/tenant/") &&
    (message.includes("Invalid UUID string: deviceInfos") ||
      message.includes("Invalid UUID string: devices"))
  );
}

function isCustomerUser(user: Partial<IrrigationUser> | null | undefined) {
  const role = typeof user?.role === "string" ? user.role.toUpperCase() : "";
  return role.includes("CUSTOMER");
}

function canUseCustomerScope(user: Partial<IrrigationUser> | null | undefined) {
  return isCustomerUser(user) && !isNullEntityId(user?.customerId);
}

async function fetchCurrentUser(baseUrl: string, token: string) {
  try {
    return await tbFetchJson(baseUrl, token, "/api/auth/user");
  } catch {
    return null;
  }
}

async function tbFetchJson(baseUrl: string, token: string, path: string) {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}${path}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Authorization": `Bearer ${token}`,
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ThingsBoard 请求失败 ${response.status}: ${path} ${text}`);
  }
  if (response.status === 204) {
    return null;
  }
  const text = await response.text();
  return text.trim() ? JSON.parse(text) : null;
}

function mergeSessionUser(sessionUser: Partial<IrrigationUser> | null, liveUser: unknown) {
  const live = (liveUser ?? {}) as Record<string, unknown>;
  if (!sessionUser && !liveUser) {
    return null;
  }
  return {
    ...(sessionUser ?? {}),
    ...(live as Partial<IrrigationUser>),
    role: String(live.authority ?? sessionUser?.role ?? ""),
    customerId: extractEntityId(live.customerId ?? sessionUser?.customerId),
  };
}

function extractEntityId(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "object" && value !== null && "id" in value) {
    const inner = (value as { id?: unknown }).id;
    if (typeof inner === "string" && inner.trim()) {
      return inner.trim();
    }
  }
  return undefined;
}

function isNullEntityId(value: unknown) {
  return extractEntityId(value) === "13814000-1dd2-11b2-8080-808080808080";
}

function toNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toInt(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  return null;
}

function toBoolean(value: unknown) {
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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeBaseUrl(baseUrl: string) {
  return (baseUrl || DEFAULT_TB_BASE_URL).trim().replace(/\/+$/, "");
}

function supportsDeviceInfos(baseUrl: string) {
  try {
    const hostname = new URL(normalizeBaseUrl(baseUrl)).hostname.toLowerCase();
    return hostname !== "thingsboard.cloud";
  } catch {
    return true;
  }
}

function parseTbErrorDetail(text: string) {
  if (!text || !String(text).trim()) {
    return "";
  }
  try {
    const j = JSON.parse(text) as { message?: string };
    if (j && typeof j.message === "string") {
      return j.message;
    }
  } catch {
    // ignore
  }
  return String(text).trim().slice(0, 400);
}

function buildThingsBoardHttpError(status: number, path: string, rawBody: string) {
  const detail = parseTbErrorDetail(rawBody);
  if (status === 409 && path.includes("/api/plugins/rpc/")) {
    const hint =
      "常见原因：执行 RPC 的网关设备在 ThingsBoard 上没有活跃传输连接（MQTT 等）、设备显示离线，或上一条 RPC 尚未结束。请确认网关在线后重试。";
    const message = detail
      ? `ThingsBoard 拒绝 RPC（409）：${detail}。${hint}`
      : `ThingsBoard 拒绝 RPC（409）。${hint}`;
    return new Error(message);
  }
  const tail = detail ? ` — ${detail}` : "";
  return new Error(`ThingsBoard 请求失败 ${status}: ${path}${tail}`);
}

function isRpcConflictError(error: unknown) {
  return error instanceof Error && error.message.includes("ThingsBoard 拒绝 RPC（409");
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
