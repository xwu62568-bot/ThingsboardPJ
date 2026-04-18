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
const gatewayCache = new Map();
const unsupportedDeviceInfosBaseUrls = new Set();
const unsupportedCustomerDeviceInfosKeys = new Set();

/** BFF 透传 ThingsBoard HTTP 状态（如 RPC 409）时使用 */
export class ThingsBoardHttpError extends Error {
  /**
   * @param {string} message
   * @param {{ status: number; path: string; tbBody?: string }} meta
   */
  constructor(message, meta) {
    super(message);
    this.name = "ThingsBoardHttpError";
    this.status = typeof meta.status === "number" ? meta.status : 502;
    this.path = meta.path ?? "";
    this.tbBody = meta.tbBody ?? "";
  }
}

function parseTbErrorDetail(text) {
  if (!text || !String(text).trim()) {
    return "";
  }
  try {
    const j = JSON.parse(text);
    if (j && typeof j.message === "string") {
      return j.message;
    }
  } catch {
    // ignore
  }
  return String(text).trim().slice(0, 400);
}

function buildThingsBoardHttpError(status, path, rawBody) {
  const detail = parseTbErrorDetail(rawBody);
  if (status === 409 && path.includes("/api/plugins/rpc/")) {
    const hint =
      "常见原因：执行 RPC 的网关设备在 ThingsBoard 上没有活跃传输连接（MQTT 等）、设备显示离线，或上一条 RPC 尚未结束。请确认网关在线后重试。";
    const message = detail ? `ThingsBoard 拒绝 RPC（409）：${detail}。${hint}` : `ThingsBoard 拒绝 RPC（409）。${hint}`;
    return new ThingsBoardHttpError(message, { status, path, tbBody: rawBody });
  }
  const tail = detail ? ` — ${detail}` : "";
  return new ThingsBoardHttpError(`ThingsBoard 请求失败 ${status}: ${path}${tail}`, {
    status,
    path,
    tbBody: rawBody,
  });
}

function isRpcConflictError(error) {
  return error instanceof ThingsBoardHttpError && error.status === 409 && error.path.includes("/api/plugins/rpc/");
}

export async function loginToThingsBoard(input) {
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
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ThingsBoard 登录失败: ${response.status} ${text}`);
  }

  const payload = await response.json();
  const token = String(payload.token ?? "");
  const currentUser = token ? await fetchCurrentUser(baseUrl, token) : null;
  console.info(
    `[tb-server] auth user summary ${JSON.stringify({
      baseUrl,
      user: summarizeAuthUser(currentUser),
    })}`,
  );
  return {
    baseUrl,
    token,
    refreshToken: typeof payload.refreshToken === "string" ? payload.refreshToken : undefined,
    user: {
      id: String(currentUser?.id?.id ?? payload.id?.id ?? input.username),
      username:
        typeof currentUser?.email === "string" && currentUser.email
          ? currentUser.email
          : input.username,
      name: String(currentUser?.firstName ?? payload.firstName ?? payload.email ?? input.username),
      role: String(currentUser?.authority ?? payload.authority ?? "TENANT_ADMIN"),
      email:
        typeof currentUser?.email === "string"
          ? currentUser.email
          : typeof payload.email === "string"
            ? payload.email
            : undefined,
      customerId: extractEntityId(currentUser?.customerId ?? payload.customerId),
    },
  };
}

export async function fetchDeviceList(session) {
  const rows = await fetchAccessibleDeviceRows(session);
  const items = await Promise.all(
    rows.map(async (raw) => {
      const item = raw ?? {};
      const deviceId = item.id?.id ?? "";
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
          (typeof item.name === "string" ? item.name : item.id?.id ?? ""),
        platformState: item.active ? "active" : "inactive",
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
    }),
  );

  return items;
}

async function fetchAccessibleDeviceRows(session) {
  const liveUser = await fetchCurrentUser(session.tb.baseUrl, session.tb.token);
  const effectiveUser = mergeSessionUser(session?.user, liveUser);
  if (process.env.TB_SERVER_DEBUG === "1") {
    console.info(
      `[tb-server] device access user ${JSON.stringify({
        baseUrl: session.tb.baseUrl,
        sessionUser: summarizeAuthUser(session?.user),
        liveUser: summarizeAuthUser(liveUser),
        effectiveUser: summarizeAuthUser(effectiveUser),
      })}`,
    );
  }

  if (canUseCustomerScope(effectiveUser)) {
    const customerId = extractEntityId(effectiveUser?.customerId) ?? (await resolveCustomerId(session));
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
      console.warn(
        `[tb-server] retry customer devices after tenant failure ${JSON.stringify({
          baseUrl: session.tb.baseUrl,
          customerId,
        })}`,
      );
      return fetchCustomerDeviceRows(session, customerId);
    }
    throw error;
  }
}

async function fetchTenantDeviceRows(session) {
  if (!supportsDeviceInfos(session.tb.baseUrl) || unsupportedDeviceInfosBaseUrls.has(session.tb.baseUrl)) {
    const data = await tbRequest(session, "/api/tenant/devices?pageSize=100&page=0");
    if (Array.isArray(data)) {
      return data;
    }
    return Array.isArray(data?.data) ? data.data : [];
  }
  try {
    const data = await tbRequest(session, "/api/tenant/deviceInfos?pageSize=100&page=0");
    return Array.isArray(data?.data) ? data.data : [];
  } catch (error) {
    if (!shouldFallbackToTenantDevices(error)) {
      throw error;
    }
    unsupportedDeviceInfosBaseUrls.add(session.tb.baseUrl);
    console.warn(
      `[tb-server] fallback tenant devices ${JSON.stringify({
        baseUrl: session.tb.baseUrl,
      })}`,
    );
    const data = await tbRequest(session, "/api/tenant/devices?pageSize=100&page=0");
    if (Array.isArray(data)) {
      return data;
    }
    return Array.isArray(data?.data) ? data.data : [];
  }
}

async function fetchCustomerDeviceRows(session, customerId) {
  const customerScopeKey = `${session.tb.baseUrl}:${customerId}`;
  if (
    !supportsDeviceInfos(session.tb.baseUrl) ||
    unsupportedCustomerDeviceInfosKeys.has(customerScopeKey)
  ) {
    const data = await tbRequest(session, `/api/customer/${customerId}/devices?pageSize=100&page=0`);
    if (Array.isArray(data)) {
      return data;
    }
    return Array.isArray(data?.data) ? data.data : [];
  }
  try {
    const data = await tbRequest(
      session,
      `/api/customer/${customerId}/deviceInfos?pageSize=100&page=0`,
    );
    return Array.isArray(data?.data) ? data.data : [];
  } catch (error) {
    if (!shouldFallbackToCustomerDevices(error)) {
      throw error;
    }
    unsupportedCustomerDeviceInfosKeys.add(customerScopeKey);
    console.warn(
      `[tb-server] fallback customer devices ${JSON.stringify({
        baseUrl: session.tb.baseUrl,
        customerId,
      })}`,
    );
    const data = await tbRequest(session, `/api/customer/${customerId}/devices?pageSize=100&page=0`);
    if (Array.isArray(data)) {
      return data;
    }
    return Array.isArray(data?.data) ? data.data : [];
  }
}

async function resolveCustomerId(session) {
  const direct = extractEntityId(session?.user?.customerId);
  if (direct) {
    return direct;
  }
  const profile = await fetchCurrentUser(session.tb.baseUrl, session.tb.token);
  return extractEntityId(profile?.customerId);
}

export async function fetchDeviceDetail(session, deviceId) {
  const [info, telemetry, clientAttributes, sharedAttributes] = await Promise.all([
    tbRequest(session, `/api/device/info/${deviceId}`),
    getLatestTelemetry(session, deviceId, TELEMETRY_KEYS),
    getAttributes(session, deviceId, "CLIENT_SCOPE", CLIENT_ATTRIBUTE_KEYS),
    getAttributes(session, deviceId, "SHARED_SCOPE", SHARED_ATTRIBUTE_KEYS),
  ]);

  const detail = mapToDeviceState(info ?? {}, telemetry, clientAttributes, sharedAttributes);
  await resolveRpcGateway(session, detail, clientAttributes);
  return detail;
}

export async function connectDevice(session, deviceId) {
  return performControlAction(session, deviceId, "connect", async (detail) => {
    const rpcId = await resolveRpcGateway(session, detail);
    await sendRpc(session, rpcId, "ble_connectDevice", {
      deviceName: detail.rpcTargetName || detail.name,
      siteCount: detail.siteCount,
    });
    return { message: `正在请求网关建立 BLE 连接` };
  });
}

export async function disconnectDevice(session, deviceId) {
  return performControlAction(session, deviceId, "disconnect", async (detail) => {
    const rpcId = await resolveRpcGateway(session, detail);
    await sendRpc(session, rpcId, "ble_disconnectDevice", {
      deviceName: detail.rpcTargetName || detail.name,
    });
    return { message: "正在请求设备断开连接" };
  });
}

export async function refreshDevice(session, deviceId) {
  return performControlAction(session, deviceId, "refresh", async (detail) => {
    const rpcId = await resolveRpcGateway(session, detail);
    await sendRpc(session, rpcId, "ble_requestDeviceState", {
      deviceName: detail.rpcTargetName || detail.name,
    });
    return { message: "正在请求设备上送最新状态" };
  });
}

export async function runIrrigation(session, deviceId, siteNumber, durationSeconds) {
  return performControlAction(session, deviceId, "run", async (detail) => {
    const rpcId = await resolveRpcGateway(session, detail);
    await sendRpc(session, rpcId, "openValve", {
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

export async function stopIrrigation(session, deviceId, siteNumber) {
  return performControlAction(session, deviceId, "stop", async (detail) => {
    const rpcId = await resolveRpcGateway(session, detail);
    await sendRpc(session, rpcId, "openValve", {
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

async function performControlAction(session, deviceId, kind, execute) {
  const detail = await fetchDeviceDetail(session, deviceId);
  console.info(
    `[tb-server] control action start ${JSON.stringify({
      kind,
      deviceId,
      deviceName: detail.name,
      rpcTargetName: detail.rpcTargetName,
      rpcGatewayId: detail.rpcGatewayId,
      rpcGatewayName: detail.rpcGatewayName,
    })}`,
  );
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

async function refreshAfterControl(session, deviceId) {
  let latest = await fetchDeviceDetail(session, deviceId);
  for (const delayMs of CONTROL_REFRESH_DELAYS_MS) {
    await wait(delayMs);
    latest = await fetchDeviceDetail(session, deviceId);
  }
  return latest;
}

async function resolveRpcGateway(session, detail, knownClientAttributes) {
  const mapping = findDeviceMapping(detail);
  if (mapping?.rpcDeviceId) {
    detail.rpcGatewayId = mapping.rpcDeviceId;
    detail.rpcGatewayName = mapping.rpcGatewayName || detail.rpcGatewayName || detail.name;
    if (mapping.rpcTargetName) {
      detail.rpcTargetName = mapping.rpcTargetName;
    }
    return mapping.rpcDeviceId;
  }

  const cacheKey = `${session.tb.baseUrl}:${session.user.id}`;
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

async function sendRpc(session, deviceId, method, params) {
  console.info(
    `[tb-server] rpc dispatch ${JSON.stringify({
      baseUrl: session.tb.baseUrl,
      rpcDeviceId: deviceId,
      method,
      params,
    })}`,
  );
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
    gatewayCache.delete(`${session.tb.baseUrl}:${session.user.id}`);
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

async function getLatestTelemetry(session, deviceId, keys) {
  const query = new URLSearchParams({
    keys: keys.join(","),
    useStrictDataTypes: "true",
  });
  const payload = await tbRequest(
    session,
    `/api/plugins/telemetry/DEVICE/${deviceId}/values/timeseries?${query.toString()}`,
  );
  const values = {};
  for (const [key, entries] of Object.entries(payload ?? {})) {
    if (Array.isArray(entries) && entries.length > 0) {
      values[key] = normalizeMaybeTypedValue(entries[0]?.value);
      values[`${key}Ts`] = entries[0]?.ts ?? 0;
    }
  }
  return values;
}

async function getAttributes(session, deviceId, scope, keys) {
  const query = new URLSearchParams({
    keys: keys.join(","),
  });
  const payload = await tbRequest(
    session,
    `/api/plugins/telemetry/DEVICE/${deviceId}/values/attributes/${scope}?${query.toString()}`,
  );
  const values = {};
  for (const item of Array.isArray(payload) ? payload : []) {
    values[item.key] = normalizeMaybeTypedValue(item.value);
    values[`${item.key}Ts`] = item.lastUpdateTs ?? 0;
  }
  return values;
}

async function tbRequest(session, path, init = {}) {
  const url = `${session.tb.baseUrl}${path}`;
  const isRpcRequest = path.includes("/api/plugins/rpc/");
  const response = await fetch(`${session.tb.baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Authorization": `Bearer ${session.tb.token}`,
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });

  if (isRpcRequest) {
    console.info(
      `[tb-server] rpc response status ${JSON.stringify({
        path,
        url,
        status: response.status,
        ok: response.ok,
      })}`,
    );
  }

  if (!response.ok) {
    const text = await response.text();
    console.error(
      `[tb-server] request failed ${JSON.stringify({
        path,
        url,
        method: init.method ?? "GET",
        status: response.status,
        body: text,
      })}`,
    );
    throw buildThingsBoardHttpError(response.status, path, text);
  }

  if (response.status === 204) {
    if (isRpcRequest) {
      console.info(`[tb-server] rpc response body ${JSON.stringify({ path, body: null })}`);
    }
    return null;
  }

  const text = await response.text();
  if (isRpcRequest) {
    console.info(`[tb-server] rpc response body ${JSON.stringify({ path, body: text })}`);
  }
  return text.trim() ? JSON.parse(text) : null;
}

function mapToDeviceState(info, telemetry, clientAttributes, sharedAttributes) {
  const mapping = findDeviceMapping({
    id: info.id?.id ?? "",
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
    id: info.id?.id ?? "",
    name: typeof info.name === "string" ? info.name : "未命名设备",
    model:
      mapping?.model ||
      (typeof info.type === "string" && info.type) ||
      (typeof info.label === "string" && info.label) ||
      "Device",
    serialNumber:
      mapping?.serialNumber ||
      (typeof info.name === "string" ? info.name : info.id?.id ?? ""),
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
    lastCommand,
    sites,
  };
}

function buildLastCommand(telemetry, clientAttributes) {
  const siteNumber =
    toInt(telemetry.lastValveSiteNumber) ?? toInt(clientAttributes.lastRpcValveSiteNumber);
  const durationSeconds = toInt(clientAttributes.lastRpcManualDurationSeconds);
  const rawCommand = telemetry.lastValveCommand ?? clientAttributes.lastRpcValveCommand;
  const commandMap = {
    open: "run",
    close: "stop",
  };
  const kind = commandMap[String(rawCommand ?? "")] ?? "refresh";
  const at =
    toInt(telemetry.lastControlAppliedAt) ??
    toInt(clientAttributes.lastControlAppliedAt) ??
    toInt(clientAttributes.lastConnectionUpdateTs);

  if (!at && !rawCommand) {
    return undefined;
  }

  return {
    kind,
    siteNumber,
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

function isGatewayAttributes(attributes) {
  if (attributes.appMode === "ble-mqtt-gateway") {
    return true;
  }
  const methods = attributes.rpcMethods;
  return Array.isArray(methods)
    ? methods.includes("ble_connectDevice") && methods.includes("openValve")
    : false;
}

function parseDeviceMappings() {
  const raw = process.env.TB_MANAGED_DEVICES?.trim();
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("[tb-runtime] invalid TB_MANAGED_DEVICES", error);
    return [];
  }
}

function findDeviceMapping(input) {
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

function normalizeMaybeTypedValue(value) {
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

function normalizeConnectionState(value) {
  if (typeof value !== "string") {
    return null;
  }
  if (["connected", "connecting", "disconnected", "error"].includes(value)) {
    return value;
  }
  if (value === "idle") {
    return "disconnected";
  }
  return null;
}

function shouldFallbackToTenantDevices(error) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("/api/tenant/deviceInfos") &&
    (message.includes("Invalid UUID string: deviceInfos") ||
      message.includes('"Invalid UUID string: deviceInfos"'))
  );
}

function shouldFallbackToCustomerDevices(error) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("/deviceInfos") &&
    (message.includes("Invalid UUID string: deviceInfos") ||
      message.includes('"Invalid UUID string: deviceInfos"'))
  );
}

function isCustomerUser(user) {
  const role = typeof user?.role === "string" ? user.role.toUpperCase() : "";
  return role.includes("CUSTOMER");
}

function canUseCustomerScope(user) {
  return isCustomerUser(user) && !isNullEntityId(user?.customerId);
}

function shouldRetryAsCustomer(error) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("/api/tenant/") &&
    (message.includes("Invalid UUID string: deviceInfos") ||
      message.includes("Invalid UUID string: devices"))
  );
}

async function fetchCurrentUser(baseUrl, token) {
  try {
    return await tbFetchJson(baseUrl, token, "/api/auth/user");
  } catch (error) {
    console.warn(
      `[tb-server] auth user fetch failed ${JSON.stringify({
        baseUrl,
        message: error instanceof Error ? error.message : String(error),
      })}`,
    );
    return null;
  }
}

async function tbFetchJson(baseUrl, token, path) {
  const response = await fetch(`${baseUrl}${path}`, {
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

function mergeSessionUser(sessionUser, liveUser) {
  if (!sessionUser && !liveUser) {
    return null;
  }
  return {
    ...(sessionUser ?? {}),
    ...(liveUser ?? {}),
    role: String(liveUser?.authority ?? sessionUser?.role ?? ""),
    customerId: extractEntityId(liveUser?.customerId ?? sessionUser?.customerId),
  };
}

function summarizeAuthUser(user) {
  if (!user) {
    return null;
  }
  return {
    id: extractEntityId(user.id),
    email: typeof user.email === "string" ? user.email : undefined,
    authority: typeof user.authority === "string" ? user.authority : undefined,
    role: typeof user.role === "string" ? user.role : undefined,
    customerId: extractEntityId(user.customerId),
    tenantId: extractEntityId(user.tenantId),
  };
}

function extractEntityId(value) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value?.id === "string" && value.id.trim()) {
    return value.id.trim();
  }
  return undefined;
}

function isNullEntityId(value) {
  return extractEntityId(value) === "13814000-1dd2-11b2-8080-808080808080";
}

function toNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toInt(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  return null;
}

function toBoolean(value) {
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeBaseUrl(baseUrl) {
  return (baseUrl || DEFAULT_TB_BASE_URL).trim().replace(/\/+$/, "");
}

function supportsDeviceInfos(baseUrl) {
  try {
    const hostname = new URL(normalizeBaseUrl(baseUrl)).hostname.toLowerCase();
    return hostname !== "thingsboard.cloud";
  } catch {
    return true;
  }
}

/** 与 ThingsBoard `/api/ws` 订阅字段一致，供 BFF 上游 WS 使用。 */
export function getTbWsSubscriptionKeyLists() {
  return {
    telemetry: TELEMETRY_KEYS.join(","),
    clientKeys: CLIENT_ATTRIBUTE_KEYS.join(","),
    sharedKeys: SHARED_ATTRIBUTE_KEYS.join(","),
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
