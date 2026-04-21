import type {
  ConnectivityState,
  DeviceState,
  DeviceSummary,
  GatewayState,
  IrrigationUser,
} from "@/lib/domain/types";
import { clearStoredSession, getStoredSession, type TbSession } from "./session";

export const DEFAULT_TB_BASE_URL =
  import.meta.env.VITE_TB_BASE_URL?.trim() || "http://58.210.46.6:8888";

const CONTROL_REFRESH_DELAYS_MS = [1200, 2600];
const DEVICE_LIST_ENRICH_CONCURRENCY = 4;

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
  "gatewayHeartbeatTs",
  "gatewayOnline",
  "gatewayOfflineTs",
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

const FIELD_ASSET_TYPE = "Field";
const FIELD_SCHEDULER_EVENT_TYPE =
  import.meta.env.VITE_TB_FIELD_SCHEDULER_EVENT_TYPE?.trim() || "IRRIGATION_PLAN_TICK";
const FIELD_SCHEDULER_EVENT_PREFIX =
  import.meta.env.VITE_TB_FIELD_SCHEDULER_EVENT_PREFIX?.trim() || "专业灌溉巡检：";
const PLAN_SCHEDULER_EVENT_PREFIX =
  import.meta.env.VITE_TB_PLAN_SCHEDULER_EVENT_PREFIX?.trim() || "专业灌溉计划：";
const ZONE_ADVANCE_SCHEDULER_EVENT_PREFIX =
  import.meta.env.VITE_TB_ZONE_ADVANCE_SCHEDULER_EVENT_PREFIX?.trim() || "专业灌溉推进：";
const FIELD_SCHEDULER_TIMEZONE =
  import.meta.env.VITE_TB_FIELD_SCHEDULER_TIMEZONE?.trim() || "Asia/Shanghai";
const FIELD_SCHEDULER_PERIOD_SECONDS = Math.max(
  60,
  Number(import.meta.env.VITE_TB_FIELD_SCHEDULER_PERIOD_SECONDS || 60) || 60,
);
const ZONE_ADVANCE_DELETE_DELAY_MS = Math.max(
  60_000,
  Number(import.meta.env.VITE_TB_ZONE_ADVANCE_DELETE_DELAY_MS || 120_000) || 120_000,
);
const ZONE_ADVANCE_STALE_MS = Math.max(
  5 * 60_000,
  Number(import.meta.env.VITE_TB_ZONE_ADVANCE_STALE_MS || 15 * 60_000) || 15 * 60_000,
);
const FIELD_SCHEDULER_CLEANUP_THROTTLE_MS = Math.max(
  60_000,
  Number(import.meta.env.VITE_TB_FIELD_SCHEDULER_CLEANUP_THROTTLE_MS || 5 * 60_000) || 5 * 60_000,
);
const FIELD_ATTRIBUTE_KEYS = [
  "code",
  "groupName",
  "cropType",
  "growthStage",
  "areaMu",
  "centerLat",
  "centerLng",
  "boundary",
  "zones",
  "deviceId",
  "deviceMarkers",
  "zoneCount",
  "kc",
  "irrigationEfficiency",
  "rotationPlans",
  "automationStrategies",
  "manualExecutionRequest",
  "manualExecutionRequestConsumedId",
  "irrigationExecutionState",
  "lastProcessedAdvanceSchedulerId",
  "lastProcessedAdvanceExecutionId",
  "lastProcessedAdvanceZoneIndex",
  "lastProcessedAdvanceAt",
];
const FIELD_TELEMETRY_KEYS = [
  "soilMoisture",
  "batteryLevel",
  "gatewayState",
  "irrigationState",
  "et0",
  "kc",
  "etc",
  "et0UpdatedAt",
  "et0Source",
  "rainfallForecastMm",
  "suggestedDurationMinutes",
];

const configuredDeviceMappings = parseDeviceMappings();
const gatewayCache = new Map<string, { id: string; name: string; expiresAt: number }>();
const unsupportedDeviceInfosBaseUrls = new Set<string>();
const unsupportedCustomerDeviceInfosKeys = new Set<string>();
const deviceListCache = new Map<string, DeviceSummary[]>();
const deviceListCacheMode = new Map<string, "basic" | "full">();
const deviceDetailCache = new Map<string, DeviceState>();
const fieldAssetCache = new Map<string, TbFieldAssetRecord[]>();
const fieldSchedulerCleanupTimestamps = new Map<string, number>();
const zoneAdvanceCleanupTimers = new Map<string, number>();
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

export type TbEntityType = "ASSET" | "DEVICE";

export type TbEntityRef = {
  entityType: TbEntityType;
  id: string;
};

export type TbFieldAssetConfig = {
  code?: string;
  groupName?: string;
  cropType?: string;
  growthStage?: string;
  areaMu?: number;
  centerLat?: number;
  centerLng?: number;
  boundary?: Array<[number, number]>;
  zones?: Array<{
    id: string;
    name: string;
    siteNumber: number;
    boundary: Array<[number, number]>;
    deviceId?: string;
    deviceIds?: string[];
    deviceBindings?: Array<{
      deviceId: string;
      siteNumber?: number;
    }>;
    valveSiteNumber?: number;
  }>;
  deviceId?: string;
  deviceMarkers?: Array<{
    deviceId: string;
    name: string;
    role: string;
    lng: number;
    lat: number;
    zoneId?: string;
    siteNumber?: number;
  }>;
  zoneCount?: number;
  kc?: number;
  irrigationEfficiency?: number;
  rotationPlans?: unknown[];
  automationStrategies?: unknown[];
};

export type TbFieldAssetRecord = {
  id: string;
  name: string;
  label?: string;
  type: string;
  config: TbFieldAssetConfig;
  telemetry: Record<string, unknown>;
};

export type TbSchedulerEventRecord = {
  id: string;
  name: string;
  type: string;
  fieldId?: string;
  fieldName?: string;
  planId?: string;
  planName?: string;
  irrigation?: string;
  triggerMode?: string;
  executionId?: string;
  zoneIndex?: number;
  startTime?: number;
  createdTime?: number;
  enabled?: boolean;
};

export type TbRotationPlanConfig = {
  id: string;
  name: string;
  fieldId: string;
  scheduleType?: "daily" | "weekly" | "interval";
  weekdays?: number[];
  intervalDays?: number;
  startAt: string;
  enabled: boolean;
  skipIfRain: boolean;
  mode: "manual" | "semi-auto" | "auto";
  executionMode?: "duration" | "quota";
  targetWaterM3PerMu?: number;
  flowRateM3h?: number;
  irrigationEfficiency?: number;
  maxDurationMinutes?: number;
  splitRounds?: boolean;
  zones: Array<{
    zoneId?: string;
    zoneName?: string;
    siteNumber: number;
    deviceId?: string;
    deviceName?: string;
    order?: number;
    durationMinutes: number;
    enabled?: boolean;
  }>;
};

export type TbAutomationStrategyConfig = {
  id: string;
  name: string;
  fieldId: string;
  type?: "threshold" | "etc";
  enabled: boolean;
  scope?: "field" | "zones";
  zoneIds?: string[];
  moistureMin: number;
  moistureRecover: number;
  etcTriggerMm: number;
  targetWaterMm?: number;
  targetWaterM3PerMu?: number;
  flowRateM3h?: number;
  irrigationEfficiency?: number;
  effectiveRainfallRatio?: number;
  replenishRatio?: number;
  executionMode?: "duration" | "quota" | "etc";
  minIntervalHours?: number;
  maxDurationMinutes?: number;
  splitRounds?: boolean;
  rainLockEnabled: boolean;
  mode: "advisory" | "semi-auto" | "auto";
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
  if (typeof window !== "undefined" && window.location.hash !== "#/login") {
    const base = `${window.location.pathname}${window.location.search}`;
    window.location.replace(`${base}#/login`);
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
  const devices = await mapWithConcurrency(rows, DEVICE_LIST_ENRICH_CONCURRENCY, (raw) =>
    mapToDeviceSummary(resolved, raw),
  );
  deviceListCache.set(getDeviceListCacheKey(resolved), devices);
  deviceListCacheMode.set(getDeviceListCacheKey(resolved), "full");
  return devices;
}

export async function fetchDeviceListBasic(session?: TbSession | null): Promise<DeviceSummary[]> {
  const resolved = resolveRequiredSession(session);
  const rows = await fetchAccessibleDeviceRows(resolved);
  const devices = rows.map((raw) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const itemId = item.id as { id?: string } | undefined;
    return buildBaseDeviceSummary(item, itemId?.id ?? "");
  });
  deviceListCache.set(getDeviceListCacheKey(resolved), devices);
  deviceListCacheMode.set(getDeviceListCacheKey(resolved), "basic");
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

export function hasFullCachedDeviceList(session?: TbSession | null): boolean {
  try {
    const resolved = resolveRequiredSession(session);
    return deviceListCacheMode.get(getDeviceListCacheKey(resolved)) === "full";
  } catch {
    return false;
  }
}

export async function fetchFieldAssetRecords(
  session?: TbSession | null,
): Promise<TbFieldAssetRecord[]> {
  const resolved = resolveRequiredSession(session);
  void cleanupStaleZoneAdvanceSchedulers(resolved).catch((error) => {
    emitDebugLog({
      level: "error",
      scope: "rest",
      message: "清理过期分区推进调度失败",
      detail: error instanceof Error ? error.message : String(error),
    });
  });
  void cleanupInvalidPlanZoneAdvanceSchedulers(resolved).catch((error) => {
    emitDebugLog({
      level: "error",
      scope: "rest",
      message: "清理自动轮灌推进调度失败",
      detail: error instanceof Error ? error.message : String(error),
    });
  });
  const rows = await fetchAccessibleAssetRows(resolved, FIELD_ASSET_TYPE);
  const records = await mapWithConcurrency(rows, 4, async (raw) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const assetId = extractEntityId(item.id);
    const [attributes, telemetry] = assetId
      ? await Promise.all([
          getEntityAttributes(resolved, { entityType: "ASSET", id: assetId }, "SERVER_SCOPE", FIELD_ATTRIBUTE_KEYS),
          getEntityLatestTelemetry(resolved, { entityType: "ASSET", id: assetId }, FIELD_TELEMETRY_KEYS),
        ])
      : [{}, {}];

    return {
      id: assetId ?? "",
      name: typeof item.name === "string" ? item.name : "未命名地块",
      label: typeof item.label === "string" ? item.label : undefined,
      type: typeof item.type === "string" ? item.type : FIELD_ASSET_TYPE,
      config: mapFieldAssetConfig(attributes),
      telemetry,
    };
  });
  setCachedFieldAssetRecords(resolved, records);
  return records;
}

export function getCachedFieldAssetRecords(session?: TbSession | null): TbFieldAssetRecord[] {
  try {
    const resolved = resolveRequiredSession(session);
    const cacheKey = getFieldAssetCacheKey(resolved);
    const cached = fieldAssetCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const persisted = readPersistedFieldAssetRecords(cacheKey);
    if (persisted.length > 0) {
      fieldAssetCache.set(cacheKey, persisted);
    }
    return persisted;
  } catch {
    return [];
  }
}

export async function saveFieldAssetRecord(input: {
  session?: TbSession | null;
  id?: string;
  name: string;
  label?: string;
  config: TbFieldAssetConfig;
}): Promise<TbFieldAssetRecord> {
  const resolved = resolveRequiredSession(input.session);
  const payload = {
    ...(input.id
      ? {
          id: {
            entityType: "ASSET",
            id: input.id,
          },
        }
      : {}),
    name: input.name,
    label: input.label,
    type: FIELD_ASSET_TYPE,
  };
  const saved = (await tbRequest(resolved, "/api/asset", {
    method: "POST",
    body: JSON.stringify(payload),
  })) as Record<string, unknown>;
  const assetId = extractEntityId(saved.id) ?? input.id;
  if (!assetId) {
    throw new Error("ThingsBoard 未返回地块 Asset ID");
  }
  await saveEntityAttributes(resolved, { entityType: "ASSET", id: assetId }, input.config);
  const record = {
    id: assetId,
    name: typeof saved.name === "string" ? saved.name : input.name,
    label: typeof saved.label === "string" ? saved.label : input.label,
    type: typeof saved.type === "string" ? saved.type : FIELD_ASSET_TYPE,
    config: input.config,
    telemetry: {},
  };
  upsertCachedFieldAssetRecord(resolved, record);
  return record;
}

export async function deleteFieldAssetRecord(input: {
  session?: TbSession | null;
  fieldId: string;
}): Promise<void> {
  const resolved = resolveRequiredSession(input.session);
  await deleteAllFieldSchedulerEvents({ session: resolved, fieldId: input.fieldId }).catch((error) => {
    emitDebugLog({
      level: "error",
      scope: "rest",
      message: "删除地块调度器失败",
      detail: error instanceof Error ? error.message : String(error),
    });
  });
  await tbRequest(resolved, `/api/asset/${input.fieldId}`, {
    method: "DELETE",
  });
  removeCachedFieldAssetRecord(resolved, input.fieldId);
}

export async function saveFieldSchedulerEvent(input: {
  session?: TbSession | null;
  fieldId: string;
  fieldName: string;
}): Promise<TbSchedulerEventRecord> {
  const resolved = resolveRequiredSession(input.session);
  const existing = await findFieldSchedulerEvent(resolved, input.fieldId, input.fieldName);
  const saved = (await tbRequest(resolved, "/api/schedulerEvent", {
    method: "POST",
    body: JSON.stringify(buildFieldSchedulerEventPayload(input.fieldId, input.fieldName, existing)),
  })) as Record<string, unknown>;

  return mapSchedulerEventRecord(saved);
}

export async function deleteFieldSchedulerEvent(input: {
  session?: TbSession | null;
  fieldId: string;
  fieldName?: string;
}): Promise<void> {
  const resolved = resolveRequiredSession(input.session);
  const existing = await findFieldSchedulerEvent(resolved, input.fieldId, input.fieldName);
  if (!existing?.id) {
    return;
  }
  await deleteSchedulerEventById(resolved, existing.id);
}

export async function deleteAllFieldSchedulerEvents(input: {
  session?: TbSession | null;
  fieldId: string;
}): Promise<void> {
  const resolved = resolveRequiredSession(input.session);
  const events = await fetchSchedulerEventRecords(resolved);
  const targets = events.filter((event) => event.fieldId === input.fieldId);
  await Promise.all(targets.map((event) => deleteSchedulerEventById(resolved, event.id)));
}

export async function syncFieldPlanSchedulerEvents(input: {
  session?: TbSession | null;
  fieldId: string;
  fieldName: string;
  plans: TbRotationPlanConfig[];
}): Promise<void> {
  const resolved = resolveRequiredSession(input.session);
  const events = await fetchSchedulerEventRecords(resolved);
  const fieldPlanEvents = events.filter(
    (event) => event.fieldId === input.fieldId && event.irrigation === "planSchedule",
  );
  const fieldPlanZoneAdvanceEvents = events.filter(
    (event) =>
      event.fieldId === input.fieldId &&
      event.irrigation === "zoneAdvance" &&
      event.triggerMode === "planZoneAdvance",
  );
  const desiredPlans = input.plans.filter((plan) => plan.enabled && plan.mode === "auto");
  const desiredPlanIds = new Set(desiredPlans.map((plan) => plan.id));
  const staleEvents = fieldPlanEvents.filter((event) => !event.planId || !desiredPlanIds.has(event.planId));
  const staleZoneAdvanceEvents = fieldPlanZoneAdvanceEvents.filter((event) => {
    if (!event.planId || !desiredPlanIds.has(event.planId)) {
      return true;
    }
    const plan = desiredPlans.find((item) => item.id === event.planId);
    if (!plan) {
      return true;
    }
    const executableZones = plan.zones.filter(
      (zone) => zone.enabled !== false && !!zone.deviceId && Number(zone.siteNumber) > 0,
    );
    return event.zoneIndex === undefined || event.zoneIndex < 1 || event.zoneIndex >= executableZones.length;
  });

  await Promise.all(
    staleEvents.map((event) =>
      deleteSchedulerEventById(resolved, event.id),
    ),
  );
  await Promise.all(staleZoneAdvanceEvents.map((event) => deleteSchedulerEventById(resolved, event.id)));

  for (const plan of desiredPlans) {
    const existing = fieldPlanEvents.find((event) => event.planId === plan.id);
    await tbRequest(resolved, "/api/schedulerEvent", {
      method: "POST",
      body: JSON.stringify(buildPlanSchedulerEventPayload(input.fieldId, input.fieldName, plan, existing)),
    });

    const executableZones = plan.zones
      .filter((zone) => zone.enabled !== false && !!zone.deviceId && Number(zone.siteNumber) > 0)
      .sort((left, right) => (left.order ?? left.siteNumber) - (right.order ?? right.siteNumber));
    if (executableZones.length <= 1) {
      continue;
    }

    let offsetSeconds = 0;
    for (let zoneIndex = 0; zoneIndex < executableZones.length; zoneIndex += 1) {
      const zone = executableZones[zoneIndex];
      const durationSeconds = Math.max(60, Math.round(Number(zone.durationMinutes || 1) * 60));
      if (zoneIndex === 0) {
        offsetSeconds += durationSeconds + 5;
        continue;
      }
      const zoneEvent = fieldPlanZoneAdvanceEvents.find(
        (event) => event.planId === plan.id && event.zoneIndex === zoneIndex,
      );
      await tbRequest(resolved, "/api/schedulerEvent", {
        method: "POST",
        body: JSON.stringify(
          buildPlanZoneAdvanceSchedulerEventPayload(
            input.fieldId,
            input.fieldName,
            plan,
            zone,
            zoneIndex,
            offsetSeconds,
            zoneEvent,
          ),
        ),
      });
      offsetSeconds += durationSeconds + 5;
    }
  }
}

export async function saveFieldRotationPlans(input: {
  session?: TbSession | null;
  fieldId: string;
  fieldName?: string;
  plans: TbRotationPlanConfig[];
}): Promise<void> {
  const resolved = resolveRequiredSession(input.session);
  await cleanupStaleZoneAdvanceSchedulers(resolved, { fieldId: input.fieldId, force: true });
  await saveEntityAttributes(resolved, { entityType: "ASSET", id: input.fieldId }, {
    rotationPlans: input.plans,
  });
  await syncFieldPlanSchedulerEvents({
    session: resolved,
    fieldId: input.fieldId,
    fieldName: input.fieldName || input.fieldId,
    plans: input.plans,
  });
  await cleanupInvalidPlanZoneAdvanceSchedulers(resolved, {
    fieldId: input.fieldId,
    force: true,
  });
  updateCachedFieldAssetConfig(resolved, input.fieldId, { rotationPlans: input.plans });
}

export async function saveFieldAutomationStrategies(input: {
  session?: TbSession | null;
  fieldId: string;
  strategies: TbAutomationStrategyConfig[];
}): Promise<void> {
  const resolved = resolveRequiredSession(input.session);
  await saveEntityAttributes(resolved, { entityType: "ASSET", id: input.fieldId }, {
    automationStrategies: input.strategies,
  });
  updateCachedFieldAssetConfig(resolved, input.fieldId, { automationStrategies: input.strategies });
}

export async function requestManualPlanExecution(input: {
  session?: TbSession | null;
  fieldId: string;
  fieldName: string;
  planId: string;
  planName: string;
}): Promise<void> {
  const resolved = resolveRequiredSession(input.session);
  const fieldExecutionContext = await loadFieldExecutionContext(resolved, input.fieldId);
  const selectedPlan = fieldExecutionContext.rotationPlans.find((plan) => plan.id === input.planId);
  if (!selectedPlan) {
    throw new Error("未找到要执行的轮灌计划，请先刷新地块数据后重试");
  }
  const executableZones = normalizeExecutionPlanZones(selectedPlan, fieldExecutionContext.deviceMarkers);
  if (executableZones.length === 0) {
    throw new Error("当前计划没有可执行分区，请先检查设备绑定和站点配置");
  }

  const requestId = `manual-${Date.now()}`;
  const requestedAt = Date.now();
  const executionId = `exec-${requestedAt}`;

  await cleanupStaleZoneAdvanceSchedulers(resolved, {
    fieldId: input.fieldId,
    force: true,
    activeExecutionId: executionId,
  });

  await saveEntityAttributes(resolved, { entityType: "ASSET", id: input.fieldId }, {
    manualExecutionRequest: {
      id: requestId,
      fieldId: input.fieldId,
      fieldName: input.fieldName,
      planId: input.planId,
      planName: input.planName,
      executionId,
      requestedAt,
      source: "frontend",
    },
  });

  const zoneAdvanceEvents = await scheduleManualZoneAdvanceEvents({
    session: resolved,
    fieldId: input.fieldId,
    fieldName: input.fieldName,
    plan: selectedPlan,
    executionId,
    requestedAt,
    areaMu: fieldExecutionContext.areaMu,
    irrigationEfficiency: fieldExecutionContext.irrigationEfficiency,
    deviceMarkers: fieldExecutionContext.deviceMarkers,
  });
  registerZoneAdvanceCleanupTimers(resolved, zoneAdvanceEvents);

  await submitRuleEngineMessage(resolved, { entityType: "ASSET", id: input.fieldId }, {
    irrigation: "fieldInspect",
    triggerMode: "manualExecution",
    fieldId: input.fieldId,
    fieldName: input.fieldName,
    planId: input.planId,
    planName: input.planName,
    executionId,
    requestId,
    requestedAt,
  });
}

async function mapToDeviceSummary(
  session: TbSession,
  raw: unknown,
): Promise<DeviceSummary> {
  const item = (raw ?? {}) as Record<string, unknown>;
  const itemId = item.id as { id?: string } | undefined;
  const deviceId = itemId?.id ?? "";
  const baseSummary = buildBaseDeviceSummary(item, deviceId);
  if (!deviceId) {
    return baseSummary;
  }

  try {
    const [activityInfo, telemetry, clientAttributes, sharedAttributes] = await Promise.all([
      resolveDeviceActivityInfo(session, deviceId, item),
      getLatestTelemetry(session, deviceId, TELEMETRY_KEYS),
      getAttributes(session, deviceId, "CLIENT_SCOPE", CLIENT_ATTRIBUTE_KEYS),
      getAttributes(session, deviceId, "SHARED_SCOPE", SHARED_ATTRIBUTE_KEYS),
    ]);
    return enrichDeviceSummary(baseSummary, activityInfo, telemetry, clientAttributes, sharedAttributes);
  } catch (error) {
    emitDebugLog({
      level: "error",
      scope: "rest",
      message: "设备列表状态补全失败，使用基础设备信息",
      detail: serializeDetail({
        deviceId,
        name: baseSummary.name,
        error: error instanceof Error ? error.message : String(error),
      }),
    });
    return baseSummary;
  }
}

async function resolveDeviceActivityInfo(
  session: TbSession,
  deviceId: string,
  item: Record<string, unknown>,
) {
  if (hasDeviceActivityInfo(item)) {
    return item;
  }
  try {
    const info = await tbRequest(session, `/api/device/info/${deviceId}`);
    if (info && typeof info === "object" && !Array.isArray(info)) {
      return { ...item, ...(info as Record<string, unknown>) };
    }
  } catch (error) {
    emitDebugLog({
      level: "info",
      scope: "rest",
      message: "设备活跃状态补查失败，使用列表接口数据",
      detail: serializeDetail({
        deviceId,
        error: error instanceof Error ? error.message : String(error),
      }),
    });
  }
  return item;
}

function hasDeviceActivityInfo(item: Record<string, unknown>) {
  return toBoolean(item.active) !== null || toInt(item.lastActivityTime) !== null;
}

function buildBaseDeviceSummary(
  item: Record<string, unknown>,
  deviceId: string,
): DeviceSummary {
  const mapping = findDeviceMapping({
    id: deviceId,
    name: typeof item.name === "string" ? item.name : undefined,
  });
  const inferredSiteCount = inferSiteCountFromDeviceIdentity(
    typeof item.name === "string" ? item.name : undefined,
    typeof item.type === "string" ? item.type : undefined,
    typeof item.label === "string" ? item.label : undefined,
  );
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
      (typeof item.name === "string" ? item.name : deviceId),
    platformState: resolvePlatformState(item),
    platformLastActivityAt: resolvePlatformLastActivityAt(item),
    connectivityState: "disconnected" as ConnectivityState,
    lastSeenAt: toInt(item.lastActivityTime) ?? 0,
    selectedSiteNumber: 1,
    siteCount: mapping?.siteCount ?? inferredSiteCount,
    batteryLevel: 0,
    isGateway: false,
    gatewayState: "unknown",
    gatewayHeartbeatAt: 0,
    bleConnectivityState: "disconnected" as ConnectivityState,
    statusChangedAt: 0,
  } satisfies DeviceSummary;
}

function enrichDeviceSummary(
  base: DeviceSummary,
  item: Record<string, unknown>,
  telemetry: Record<string, unknown>,
  clientAttributes: Record<string, unknown>,
  sharedAttributes: Record<string, unknown>,
): DeviceSummary {
  const selectedSiteNumber =
    toInt(telemetry.selectedSiteNumber) ??
    toInt(clientAttributes.selectedSiteNumber) ??
    toInt(sharedAttributes.siteNumber) ??
    base.selectedSiteNumber;
  const siteCount = inferSiteCount({
    mappingSiteCount: base.siteCount,
    sharedAttributes,
    clientAttributes,
    telemetry,
    selectedSiteNumber,
    deviceIdentity: [
      typeof item.name === "string" ? item.name : undefined,
      typeof item.type === "string" ? item.type : undefined,
      typeof item.label === "string" ? item.label : undefined,
      base.model,
      base.serialNumber,
    ],
  });
  const lastSeenAt = Math.max(
    base.lastSeenAt,
    ...Object.entries(telemetry)
      .filter(([key]) => key.endsWith("Ts"))
      .map(([, value]) => toInt(value) ?? 0),
    toInt(clientAttributes.lastConnectionUpdateTs) ?? 0,
  );

  const isGateway = isGatewayAttributes(clientAttributes);
  const platformState = resolvePlatformState(item, base.platformState);
  const bleConnectivityState = normalizeBleConnectivityState(clientAttributes, base);
  const gatewayHeartbeatAt = toInt(telemetry.gatewayHeartbeatTs) ?? base.gatewayHeartbeatAt ?? 0;
  const gatewayState = isGateway
    ? normalizeGatewayState(gatewayHeartbeatAt, telemetry.gatewayOnline, platformState)
    : undefined;
  const statusChangedAt = toInt(clientAttributes.lastConnectionUpdateTs) ?? base.statusChangedAt ?? 0;

  return {
    ...base,
    isGateway,
    gatewayState,
    gatewayHeartbeatAt,
    bleConnectivityState,
    statusChangedAt,
    platformState,
    platformLastActivityAt: resolvePlatformLastActivityAt(item, base.platformLastActivityAt),
    connectivityState: isGateway ? normalizeGatewayConnectivityState(gatewayState) : bleConnectivityState,
    lastSeenAt,
    selectedSiteNumber: clamp(selectedSiteNumber, 1, siteCount),
    siteCount,
    batteryLevel: toNumber(telemetry.batteryLevel) ?? base.batteryLevel,
  };
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
  const rpcGatewayId = await resolveRpcGateway(resolved, detail, clientAttributes);
  const normalizedDetail = await enrichDeviceDetailSiteCountFromGateway(
    resolved,
    detail,
    rpcGatewayId,
    clientAttributes,
    sharedAttributes,
  );
  deviceDetailCache.set(getDeviceDetailCacheKey(resolved, deviceId), normalizedDetail);
  return normalizedDetail;
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
    await sendDeviceRpc(resolved, detail, "ble_disconnectDevice", {
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
    await sendDeviceRpc(resolved, detail, "ble_requestDeviceState", {
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
    await sendDeviceRpc(resolved, detail, "openValve", {
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
    await sendDeviceRpc(resolved, detail, "openValve", {
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
  onActivity: (message?: TbWsMessage) => void,
): WebSocket {
  const resolved = resolveRequiredSession(session);
  const url = buildTbWsUrl(resolved.baseUrl);
  const socket = new WebSocket(url);
  let subscriptionDeviceIds = new Map<number, string>();

  socket.addEventListener("open", () => {
    const subscription = buildSubscriptionMessage(resolved, deviceIds);
    subscriptionDeviceIds = subscription.deviceIdsBySubscriptionId;
    const parsed = JSON.parse(subscription.body) as { cmds?: unknown[] };
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
    socket.send(subscription.body);
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
      for (const message of parseTbWsMessages(parsed, subscriptionDeviceIds)) {
        onActivity(message);
      }
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

export type TbWsMessage = {
  subscriptionId?: number;
  deviceId?: string;
  data?: Record<string, Array<[number, unknown]>>;
  latestValues?: Record<string, unknown>;
};

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
  const deviceIdsBySubscriptionId = new Map<number, string>();
  let cmdId = 1;
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;

  for (const entityId of deviceIds) {
    if (!entityId?.trim()) {
      continue;
    }
    const trimmedEntityId = entityId.trim();
    const telemetryCmdId = cmdId++;
    deviceIdsBySubscriptionId.set(telemetryCmdId, trimmedEntityId);
    cmds.push({
      type: "TIMESERIES",
      cmdId: telemetryCmdId,
      entityType: "DEVICE",
      entityId: trimmedEntityId,
      keys: lists.telemetry,
      scope: "LATEST_TELEMETRY",
      startTs: now - weekMs,
      timeWindow: weekMs,
      interval: 0,
      limit: 200,
      agg: "NONE",
    });
    const clientAttributesCmdId = cmdId++;
    deviceIdsBySubscriptionId.set(clientAttributesCmdId, trimmedEntityId);
    cmds.push({
      type: "ATTRIBUTES",
      cmdId: clientAttributesCmdId,
      entityType: "DEVICE",
      entityId: trimmedEntityId,
      keys: lists.clientKeys,
      scope: "CLIENT_SCOPE",
    });
    const sharedAttributesCmdId = cmdId++;
    deviceIdsBySubscriptionId.set(sharedAttributesCmdId, trimmedEntityId);
    cmds.push({
      type: "ATTRIBUTES",
      cmdId: sharedAttributesCmdId,
      entityType: "DEVICE",
      entityId: trimmedEntityId,
      keys: lists.sharedKeys,
      scope: "SHARED_SCOPE",
    });
  }

  return {
    body: JSON.stringify({
      authCmd: { cmdId: 0, token: session.token },
      cmds,
    }),
    deviceIdsBySubscriptionId,
  };
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

function parseTbWsMessages(
  parsed: unknown,
  deviceIdsBySubscriptionId: Map<number, string>,
): TbWsMessage[] {
  if (Array.isArray(parsed)) {
    return parsed.flatMap((item) => parseTbWsMessages(item, deviceIdsBySubscriptionId));
  }
  const message = parseTbWsMessage(parsed, deviceIdsBySubscriptionId);
  return message ? [message] : [];
}

function parseTbWsMessage(
  parsed: unknown,
  deviceIdsBySubscriptionId: Map<number, string>,
): TbWsMessage | undefined {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }
  const item = parsed as {
    subscriptionId?: unknown;
    entityId?: unknown;
    data?: unknown;
    latestValues?: unknown;
  };
  if (typeof item.subscriptionId !== "number") {
    return undefined;
  }
  const mappedDeviceId = deviceIdsBySubscriptionId.get(item.subscriptionId);
  const entityDeviceId = extractEntityId(item.entityId);
  return {
    subscriptionId: item.subscriptionId,
    deviceId: mappedDeviceId || entityDeviceId,
    data: isRecord(item.data) ? normalizeWsData(item.data) : undefined,
    latestValues: isRecord(item.latestValues) ? item.latestValues : undefined,
  };
}

function normalizeWsData(input: Record<string, unknown>) {
  const data: Record<string, Array<[number, unknown]>> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!Array.isArray(value)) {
      continue;
    }
    data[key] = value
      .filter((entry): entry is [number, unknown] => {
        return (
          Array.isArray(entry) &&
          entry.length >= 2 &&
          typeof entry[0] === "number"
        );
      })
      .map((entry) => [entry[0], normalizeMaybeTypedValue(entry[1])]);
  }
  return data;
}

function clearTbClientCaches() {
  gatewayCache.clear();
  deviceListCache.clear();
  deviceListCacheMode.clear();
  deviceDetailCache.clear();
  fieldAssetCache.clear();
  clearPersistedFieldAssetRecords();
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

function getFieldAssetCacheKey(session: TbSession) {
  return getSessionCacheScope(session);
}

function getPersistedFieldAssetCacheKey(cacheKey: string) {
  return `tb_field_assets::${cacheKey}`;
}

function setCachedFieldAssetRecords(session: TbSession, records: TbFieldAssetRecord[]) {
  const cacheKey = getFieldAssetCacheKey(session);
  fieldAssetCache.set(cacheKey, records);
  persistFieldAssetRecords(cacheKey, records);
}

function upsertCachedFieldAssetRecord(session: TbSession, record: TbFieldAssetRecord) {
  const cacheKey = getFieldAssetCacheKey(session);
  const current = fieldAssetCache.get(cacheKey) ?? readPersistedFieldAssetRecords(cacheKey);
  const next = [record, ...current.filter((item) => item.id !== record.id)];
  fieldAssetCache.set(cacheKey, next);
  persistFieldAssetRecords(cacheKey, next);
}

function removeCachedFieldAssetRecord(session: TbSession, fieldId: string) {
  const cacheKey = getFieldAssetCacheKey(session);
  const current = fieldAssetCache.get(cacheKey) ?? readPersistedFieldAssetRecords(cacheKey);
  const next = current.filter((record) => record.id !== fieldId);
  fieldAssetCache.set(cacheKey, next);
  persistFieldAssetRecords(cacheKey, next);
}

function updateCachedFieldAssetConfig(
  session: TbSession,
  fieldId: string,
  patch: Partial<TbFieldAssetConfig>,
) {
  const cacheKey = getFieldAssetCacheKey(session);
  const current = fieldAssetCache.get(cacheKey) ?? readPersistedFieldAssetRecords(cacheKey);
  if (current.length === 0) {
    return;
  }
  const next = current.map((record) =>
    record.id === fieldId ? { ...record, config: { ...record.config, ...patch } } : record,
  );
  fieldAssetCache.set(cacheKey, next);
  persistFieldAssetRecords(cacheKey, next);
}

function persistFieldAssetRecords(cacheKey: string, records: TbFieldAssetRecord[]) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(getPersistedFieldAssetCacheKey(cacheKey), JSON.stringify(records));
  } catch {
    // Ignore storage quota/private mode failures; in-memory cache still works.
  }
}

function readPersistedFieldAssetRecords(cacheKey: string): TbFieldAssetRecord[] {
  if (typeof window === "undefined") {
    return [];
  }
  const raw = window.localStorage.getItem(getPersistedFieldAssetCacheKey(cacheKey));
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TbFieldAssetRecord[]) : [];
  } catch {
    window.localStorage.removeItem(getPersistedFieldAssetCacheKey(cacheKey));
    return [];
  }
}

function clearPersistedFieldAssetRecords() {
  if (typeof window === "undefined") {
    return;
  }
  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith("tb_field_assets::")) {
      window.localStorage.removeItem(key);
    }
  }
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

async function fetchAccessibleAssetRows(session: TbSession, assetType: string) {
  const liveUser = await fetchCurrentUser(session.baseUrl, session.token);
  const effectiveUser = mergeSessionUser(session.user, liveUser);

  if (canUseCustomerScope(effectiveUser)) {
    const customerId =
      extractEntityId(effectiveUser?.customerId) ??
      (await resolveCustomerId(session.baseUrl, session.token, session.user));
    if (!customerId) {
      throw new Error("ThingsBoard 当前账号缺少 customerId，无法查询客户资产列表");
    }
    return fetchCustomerAssetRows(session, customerId, assetType);
  }

  try {
    return await fetchTenantAssetRows(session, assetType);
  } catch (error) {
    const customerId = extractEntityId(effectiveUser?.customerId);
    if (canUseCustomerScope(effectiveUser) && customerId) {
      return fetchCustomerAssetRows(session, customerId, assetType);
    }
    throw error;
  }
}

async function fetchTenantAssetRows(session: TbSession, assetType: string) {
  return fetchAssetRowsWithFallback(session, [
    `/api/tenant/assets?pageSize=100&page=0&type=${encodeURIComponent(assetType)}`,
    `/api/tenant/assets?pageSize=100&page=0&assetType=${encodeURIComponent(assetType)}`,
  ]);
}

async function fetchCustomerAssetRows(session: TbSession, customerId: string, assetType: string) {
  return fetchAssetRowsWithFallback(session, [
    `/api/customer/${customerId}/assets?pageSize=100&page=0&type=${encodeURIComponent(assetType)}`,
    `/api/customer/${customerId}/assets?pageSize=100&page=0&assetType=${encodeURIComponent(assetType)}`,
  ]);
}

async function fetchAssetRowsWithFallback(session: TbSession, paths: string[]) {
  let lastError: unknown;
  let emptyRows: unknown[] = [];
  let sawEmptyResponse = false;
  for (const path of paths) {
    try {
      const data = await tbRequest(session, path);
      const rows = Array.isArray(data)
        ? data
        : Array.isArray((data as { data?: unknown[] } | null)?.data)
          ? ((data as { data?: unknown[] }).data ?? [])
          : [];
      if (rows.length > 0) {
        return rows;
      }
      emptyRows = rows;
      sawEmptyResponse = true;
    } catch (error) {
      lastError = error;
    }
  }
  if (sawEmptyResponse) {
    return emptyRows;
  }
  throw lastError instanceof Error ? lastError : new Error("ThingsBoard 资产列表查询失败");
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

  const gateway = await discoverRpcGateway(session);
  if (gateway) {
    gatewayCache.set(cacheKey, gateway);
    detail.rpcGatewayId = gateway.id;
    detail.rpcGatewayName = gateway.name;
    return gateway.id;
  }

  return detail.id;
}

async function discoverRpcGateway(session: TbSession) {
  const cachedDevices = deviceListCache.get(getDeviceListCacheKey(session)) ?? [];
  const candidates = cachedDevices.length
    ? cachedDevices
    : (await fetchAccessibleDeviceRows(session)).map((raw) => {
        const item = (raw ?? {}) as Record<string, unknown>;
        const itemId = item.id as { id?: string } | undefined;
        return buildBaseDeviceSummary(item, itemId?.id ?? "");
      });

  const matches = await mapWithConcurrency(candidates, DEVICE_LIST_ENRICH_CONCURRENCY, async (device) => {
    if (!device.id) {
      return null;
    }
    try {
      const attrs = await getAttributes(session, device.id, "CLIENT_SCOPE", CLIENT_ATTRIBUTE_KEYS);
      if (!isGatewayAttributes(attrs)) {
        return null;
      }
      return {
        id: device.id,
        name: device.name,
        expiresAt: Date.now() + 30_000,
      };
    } catch {
      return null;
    }
  });

  return matches.find((item): item is { id: string; name: string; expiresAt: number } => item !== null);
}

async function sendDeviceRpc(
  session: TbSession,
  detail: DeviceState,
  method: string,
  params: Record<string, unknown>,
) {
  const gatewayId = await resolveRpcGateway(session, detail);
  const targets =
    gatewayId && gatewayId !== detail.id
      ? [
          { kind: "child", id: detail.id, name: detail.name },
          { kind: "gateway", id: gatewayId, name: detail.rpcGatewayName || gatewayId },
        ]
      : [{ kind: "gateway", id: gatewayId || detail.id, name: detail.rpcGatewayName || detail.name }];

  let lastError: unknown;
  for (const target of targets) {
    emitDebugLog({
      level: "info",
      scope: "rpc",
      message: "RPC 下发目标",
      detail: serializeDetail({
        method,
        targetKind: target.kind,
        targetDeviceId: target.id,
        targetDeviceName: target.name,
        childDeviceId: detail.id,
        childDeviceName: detail.name,
        gatewayId,
        rpcTargetName: detail.rpcTargetName,
        params,
      }),
    });

    try {
      await sendRpc(session, target.id, method, params);
      return;
    } catch (error) {
      lastError = error;
      if (target.kind === "child" && isRpcConflictError(error) && targets.length > 1) {
        emitDebugLog({
          level: "error",
          scope: "rpc",
          message: "子设备 RPC 409，回退到网关 RPC",
          detail: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
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
  return getEntityLatestTelemetry(session, { entityType: "DEVICE", id: deviceId }, keys);
}

async function getEntityLatestTelemetry(
  session: TbSession,
  entity: TbEntityRef,
  keys: string[],
) {
  const query = new URLSearchParams({
    keys: keys.join(","),
    useStrictDataTypes: "true",
  });
  const payload = (await tbRequest(
    session,
    `/api/plugins/telemetry/${entity.entityType}/${entity.id}/values/timeseries?${query.toString()}`,
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
  return getEntityAttributes(session, { entityType: "DEVICE", id: deviceId }, scope, keys);
}

async function getEntityAttributes(
  session: TbSession,
  entity: TbEntityRef,
  scope: "CLIENT_SCOPE" | "SHARED_SCOPE" | "SERVER_SCOPE",
  keys: string[],
) {
  const query = new URLSearchParams({
    keys: keys.join(","),
  });
  const payload = (await tbRequest(
    session,
    `/api/plugins/telemetry/${entity.entityType}/${entity.id}/values/attributes/${scope}?${query.toString()}`,
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

async function saveEntityAttributes(
  session: TbSession,
  entity: TbEntityRef,
  attributes: Record<string, unknown>,
) {
  await tbRequest(session, `/api/plugins/telemetry/${entity.entityType}/${entity.id}/SERVER_SCOPE`, {
    method: "POST",
    body: JSON.stringify(compactRecord(attributes)),
  });
}

async function submitRuleEngineMessage(
  session: TbSession,
  entity: TbEntityRef,
  message: Record<string, unknown>,
) {
  await tbRequest(session, `/api/rule-engine/${entity.entityType}/${entity.id}/1000`, {
    method: "POST",
    body: JSON.stringify(compactRecord(message)),
  });
}

type FieldExecutionContext = {
  rotationPlans: TbRotationPlanConfig[];
  deviceMarkers: NonNullable<TbFieldAssetConfig["deviceMarkers"]>;
  areaMu: number;
  irrigationEfficiency: number;
};

async function loadFieldExecutionContext(
  session: TbSession,
  fieldId: string,
): Promise<FieldExecutionContext> {
  const attributes = await getEntityAttributes(
    session,
    { entityType: "ASSET", id: fieldId },
    "SERVER_SCOPE",
    ["rotationPlans", "deviceMarkers", "areaMu", "irrigationEfficiency"],
  );

  return {
    rotationPlans: normalizeRotationPlanConfigs(attributes.rotationPlans),
    deviceMarkers: normalizeDeviceMarkersAttribute(attributes.deviceMarkers) ?? [],
    areaMu: toNumber(attributes.areaMu) ?? 0,
    irrigationEfficiency: toNumber(attributes.irrigationEfficiency) ?? 0.85,
  };
}

async function scheduleManualZoneAdvanceEvents(input: {
  session: TbSession;
  fieldId: string;
  fieldName: string;
  plan: TbRotationPlanConfig;
  executionId: string;
  requestedAt: number;
  areaMu: number;
  irrigationEfficiency: number;
  deviceMarkers: NonNullable<TbFieldAssetConfig["deviceMarkers"]>;
}) {
  const events = await fetchSchedulerEventRecords(input.session);
  const zones = normalizeExecutionPlanZones(input.plan, input.deviceMarkers);
  if (zones.length <= 1) {
    return [];
  }

  const createdEvents: TbSchedulerEventRecord[] = [];
  let scheduledAt = input.requestedAt;

  for (let zoneIndex = 0; zoneIndex < zones.length; zoneIndex += 1) {
    const zone = zones[zoneIndex];
    const durationSeconds = calculatePlanZoneDurationSeconds({
      plan: input.plan,
      zone,
      zoneCount: zones.length,
      areaMu: input.areaMu,
      irrigationEfficiency: input.irrigationEfficiency,
    });

    if (zoneIndex === 0) {
      scheduledAt += durationSeconds * 1000 + 5_000;
      continue;
    }

    const existing = events.find(
      (event) =>
        event.irrigation === "zoneAdvance" &&
        event.fieldId === input.fieldId &&
        event.executionId === input.executionId &&
        event.zoneIndex === zoneIndex,
    );

    const saved = (await tbRequest(input.session, "/api/schedulerEvent", {
      method: "POST",
      body: JSON.stringify(
        buildZoneAdvanceSchedulerEventPayload(
          {
            triggerMode: "manualZoneAdvance",
            fieldId: input.fieldId,
            fieldName: input.fieldName,
            planId: input.plan.id,
            planName: input.plan.name,
            executionId: input.executionId,
            zoneIndex,
            zoneName: zone.zoneName ?? `${zone.siteNumber}区`,
            startTime: scheduledAt,
          },
          existing ?? null,
        ),
      ),
    })) as Record<string, unknown>;

    createdEvents.push(mapSchedulerEventRecord(saved));
    scheduledAt += durationSeconds * 1000 + 5_000;
  }

  return createdEvents;
}

async function cleanupStaleZoneAdvanceSchedulers(
  session: TbSession,
  options: {
    fieldId?: string;
    force?: boolean;
    activeExecutionId?: string;
  } = {},
): Promise<void> {
  const cleanupKey = `${session.baseUrl}:${options.fieldId ?? "*"}`;
  const now = Date.now();
  const lastCleanupAt = fieldSchedulerCleanupTimestamps.get(cleanupKey) ?? 0;
  if (!options.force && now - lastCleanupAt < FIELD_SCHEDULER_CLEANUP_THROTTLE_MS) {
    return;
  }
  fieldSchedulerCleanupTimestamps.set(cleanupKey, now);

  const events = await fetchSchedulerEventRecords(session);
  const zoneAdvanceEvents = events.filter(
    (event) =>
      event.irrigation === "zoneAdvance" &&
      event.triggerMode === "manualZoneAdvance" &&
      (!options.fieldId || event.fieldId === options.fieldId),
  );
  if (zoneAdvanceEvents.length === 0) {
    return;
  }

  const keepIds = new Set<string>();
  const dedupeBuckets = new Map<string, TbSchedulerEventRecord[]>();
  for (const event of zoneAdvanceEvents) {
    const bucketKey = [
      event.fieldId ?? "",
      event.executionId ?? "",
      event.planId ?? "",
      String(event.zoneIndex ?? -1),
    ].join(":");
    const bucket = dedupeBuckets.get(bucketKey) ?? [];
    bucket.push(event);
    dedupeBuckets.set(bucketKey, bucket);
  }
  for (const bucket of dedupeBuckets.values()) {
    bucket.sort(
      (left, right) =>
        Number(right.startTime ?? 0) - Number(left.startTime ?? 0) ||
        Number(right.createdTime ?? 0) - Number(left.createdTime ?? 0),
    );
    if (bucket[0]?.id) {
      keepIds.add(bucket[0].id);
    }
  }

  const deleteTargets = zoneAdvanceEvents.filter((event) => {
    if (!event.id) {
      return false;
    }
    if (!keepIds.has(event.id)) {
      return true;
    }
    if (options.activeExecutionId && event.executionId && event.executionId !== options.activeExecutionId) {
      return true;
    }
    return Number(event.startTime ?? 0) > 0 && Number(event.startTime) < now - ZONE_ADVANCE_STALE_MS;
  });

  await Promise.all(deleteTargets.map((event) => deleteSchedulerEventById(session, event.id)));
}

async function cleanupInvalidPlanZoneAdvanceSchedulers(
  session: TbSession,
  options: {
    fieldId?: string;
    force?: boolean;
  } = {},
): Promise<void> {
  const cleanupKey = `${session.baseUrl}:plan:${options.fieldId ?? "*"}`;
  const now = Date.now();
  const lastCleanupAt = fieldSchedulerCleanupTimestamps.get(cleanupKey) ?? 0;
  if (!options.force && now - lastCleanupAt < FIELD_SCHEDULER_CLEANUP_THROTTLE_MS) {
    return;
  }
  fieldSchedulerCleanupTimestamps.set(cleanupKey, now);

  const events = await fetchSchedulerEventRecords(session);
  const planZoneAdvanceEvents = events.filter(
    (event) =>
      event.irrigation === "zoneAdvance" &&
      event.triggerMode === "planZoneAdvance" &&
      (!options.fieldId || event.fieldId === options.fieldId),
  );
  if (planZoneAdvanceEvents.length === 0) {
    return;
  }

  const eventsByField = new Map<string, TbSchedulerEventRecord[]>();
  for (const event of planZoneAdvanceEvents) {
    if (!event.fieldId) {
      continue;
    }
    const bucket = eventsByField.get(event.fieldId) ?? [];
    bucket.push(event);
    eventsByField.set(event.fieldId, bucket);
  }

  const deleteIds = new Set<string>();
  for (const [fieldId, fieldEvents] of eventsByField.entries()) {
    const context = await loadFieldExecutionContext(session, fieldId).catch(() => null);
    const autoPlans = new Map(
      (context?.rotationPlans ?? [])
        .filter((plan) => plan.enabled && plan.mode === "auto")
        .map((plan) => [
          plan.id,
          normalizeExecutionPlanZones(plan, context?.deviceMarkers ?? []),
        ]),
    );

    const keepIds = new Set<string>();
    const dedupeBuckets = new Map<string, TbSchedulerEventRecord[]>();
    for (const event of fieldEvents) {
      const bucketKey = `${event.planId ?? ""}:${String(event.zoneIndex ?? -1)}`;
      const bucket = dedupeBuckets.get(bucketKey) ?? [];
      bucket.push(event);
      dedupeBuckets.set(bucketKey, bucket);
    }
    for (const bucket of dedupeBuckets.values()) {
      bucket.sort(
        (left, right) =>
          Number(right.startTime ?? 0) - Number(left.startTime ?? 0) ||
          Number(right.createdTime ?? 0) - Number(left.createdTime ?? 0),
      );
      if (bucket[0]?.id) {
        keepIds.add(bucket[0].id);
      }
    }

    for (const event of fieldEvents) {
      if (!event.id) {
        continue;
      }
      if (!keepIds.has(event.id)) {
        deleteIds.add(event.id);
        continue;
      }
      if (!event.planId) {
        deleteIds.add(event.id);
        continue;
      }
      const zones = autoPlans.get(event.planId);
      if (!zones || zones.length <= 1) {
        deleteIds.add(event.id);
        continue;
      }
      if (event.zoneIndex === undefined || event.zoneIndex < 1 || event.zoneIndex >= zones.length) {
        deleteIds.add(event.id);
      }
    }
  }

  await Promise.all([...deleteIds].map((schedulerEventId) => deleteSchedulerEventById(session, schedulerEventId)));
}

function registerZoneAdvanceCleanupTimers(
  session: TbSession,
  events: TbSchedulerEventRecord[],
) {
  if (typeof window === "undefined") {
    return;
  }
  for (const event of events) {
    if (
      !event.id ||
      !event.startTime ||
      event.triggerMode !== "manualZoneAdvance" ||
      zoneAdvanceCleanupTimers.has(event.id)
    ) {
      continue;
    }
    const delay = Math.max(5_000, event.startTime + ZONE_ADVANCE_DELETE_DELAY_MS - Date.now());
    const timerId = window.setTimeout(() => {
      void deleteSchedulerEventById(session, event.id)
        .catch((error) => {
          emitDebugLog({
            level: "error",
            scope: "rest",
            message: "删除分区推进调度失败",
            detail: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          zoneAdvanceCleanupTimers.delete(event.id);
        });
    }, delay);
    zoneAdvanceCleanupTimers.set(event.id, timerId);
  }
}

async function deleteSchedulerEventById(session: TbSession, schedulerEventId: string) {
  if (!schedulerEventId) {
    return;
  }
  if (typeof window !== "undefined") {
    const timerId = zoneAdvanceCleanupTimers.get(schedulerEventId);
    if (timerId !== undefined) {
      window.clearTimeout(timerId);
      zoneAdvanceCleanupTimers.delete(schedulerEventId);
    }
  }
  await tbRequest(session, `/api/schedulerEvent/${schedulerEventId}`, {
    method: "DELETE",
  });
}

function normalizeRotationPlanConfigs(value: unknown): TbRotationPlanConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : "",
      name: typeof item.name === "string" ? item.name : "未命名计划",
      fieldId: typeof item.fieldId === "string" ? item.fieldId : "",
      scheduleType:
        (item.scheduleType === "weekly" || item.scheduleType === "interval" ? item.scheduleType : "daily") as
          | "daily"
          | "weekly"
          | "interval",
      weekdays: Array.isArray(item.weekdays) ? item.weekdays.flatMap((entry) => (typeof entry === "number" ? [entry] : [])) : [],
      intervalDays: toInt(item.intervalDays) ?? undefined,
      startAt: typeof item.startAt === "string" ? item.startAt : "00:00",
      enabled: item.enabled !== false,
      skipIfRain: item.skipIfRain === true,
      mode: (
        item.mode === "semi-auto" || item.mode === "auto"
          ? item.mode
          : "manual"
      ) as "manual" | "semi-auto" | "auto",
      executionMode: (item.executionMode === "quota" ? "quota" : "duration") as "duration" | "quota",
      targetWaterM3PerMu: toNumber(item.targetWaterM3PerMu) ?? undefined,
      flowRateM3h: toNumber(item.flowRateM3h) ?? undefined,
      irrigationEfficiency: toNumber(item.irrigationEfficiency) ?? undefined,
      maxDurationMinutes: toNumber(item.maxDurationMinutes) ?? undefined,
      splitRounds: item.splitRounds === true,
      zones: Array.isArray(item.zones)
        ? item.zones
            .filter((zone): zone is Record<string, unknown> => isRecord(zone))
            .map((zone) => ({
              zoneId: toStringValue(zone.zoneId ?? zone.id),
              zoneName: toStringValue(zone.zoneName ?? zone.name),
              siteNumber: toInt(zone.siteNumber) ?? 0,
              deviceId: toStringValue(zone.deviceId),
              deviceName: toStringValue(zone.deviceName),
              order: toInt(zone.order) ?? undefined,
              durationMinutes: toNumber(zone.durationMinutes) ?? 0,
              enabled: zone.enabled !== false,
            }))
        : [],
    }))
    .filter((plan) => plan.id);
}

function normalizeExecutionPlanZones(
  plan: TbRotationPlanConfig,
  deviceMarkers: NonNullable<TbFieldAssetConfig["deviceMarkers"]>,
) {
  return plan.zones
    .filter((zone) => zone.enabled !== false && !!zone.deviceId && Number(zone.siteNumber) > 0)
    .map((zone) => {
      const marker = deviceMarkers.find((item) => item.deviceId === zone.deviceId);
      return {
        ...zone,
        deviceName: zone.deviceName || marker?.name || "",
      };
    })
    .filter((zone) => !!zone.deviceName)
    .sort((left, right) => (left.order ?? left.siteNumber) - (right.order ?? right.siteNumber));
}

function calculatePlanZoneDurationSeconds(input: {
  plan: TbRotationPlanConfig;
  zone: TbRotationPlanConfig["zones"][number];
  zoneCount: number;
  areaMu: number;
  irrigationEfficiency: number;
}) {
  if (input.plan.executionMode === "quota") {
    const safeAreaMu = input.areaMu > 0 ? input.areaMu : 1;
    const safeZoneCount = Math.max(1, input.zoneCount);
    const targetWaterM3PerMu = Math.max(0.1, Number(input.plan.targetWaterM3PerMu || 5));
    const flowRateM3h = Math.max(0.1, Number(input.plan.flowRateM3h || 2));
    const efficiency = Math.min(
      1,
      Math.max(0.1, Number(input.plan.irrigationEfficiency || input.irrigationEfficiency || 0.85)),
    );
    const maxMinutes = Math.max(1, Number(input.plan.maxDurationMinutes || input.zone.durationMinutes || 60));
    const zoneWaterM3 = (safeAreaMu / safeZoneCount) * targetWaterM3PerMu;
    const minutes = (zoneWaterM3 / flowRateM3h / efficiency) * 60;
    return Math.max(60, Math.round(Math.min(minutes, maxMinutes) * 60));
  }

  return Math.max(60, Math.round(Number(input.zone.durationMinutes || 1) * 60));
}

async function findFieldSchedulerEvent(
  session: TbSession,
  fieldId: string,
  fieldName?: string,
): Promise<TbSchedulerEventRecord | null> {
  const expectedName = getFieldSchedulerEventName(fieldName || "");
  const events = await fetchSchedulerEventRecords(session);
  const fieldEvents = events.filter(
    (event) => event.irrigation === "fieldInspect" || event.irrigation === "planTick" || event.name === expectedName,
  );
  return (
    fieldEvents.find((event) => event.fieldId === fieldId) ??
    fieldEvents.find((event) => fieldName && event.name === expectedName) ??
    null
  );
}

async function fetchSchedulerEventRecords(session: TbSession): Promise<TbSchedulerEventRecord[]> {
  const rows = (await tbRequest(
    session,
    `/api/schedulerEvents?type=${encodeURIComponent(FIELD_SCHEDULER_EVENT_TYPE)}`,
  )) as unknown[];
  const records = Array.isArray(rows) ? rows.map(mapSchedulerEventRecord) : [];
  registerZoneAdvanceCleanupTimers(
    session,
    records.filter((event) => event.irrigation === "zoneAdvance"),
  );
  return records;
}

function buildFieldSchedulerEventPayload(
  fieldId: string,
  fieldName: string,
  existing?: TbSchedulerEventRecord | null,
) {
  const payload: Record<string, unknown> = {
    name: getFieldSchedulerEventName(fieldName),
    type: FIELD_SCHEDULER_EVENT_TYPE,
    originatorId: {
      entityType: "ASSET",
      id: fieldId,
    },
    msgType: "CUSTOM",
    msgBody: {
      fieldId,
      fieldName,
    },
    metadata: {
      irrigation: "fieldInspect",
      fieldId,
      fieldName,
    },
    schedule: {
      timezone: FIELD_SCHEDULER_TIMEZONE,
      startTime: getNextSchedulerStartTime(),
      repeat: {
        type: "TIMER",
        endsOn: 0,
        repeatInterval: FIELD_SCHEDULER_PERIOD_SECONDS,
        timeUnit: "SECONDS",
      },
    },
    configuration: {
      originatorId: {
        entityType: "ASSET",
        id: fieldId,
      },
      msgType: "CUSTOM",
      msgBody: {
        fieldId,
        fieldName,
      },
      metadata: {
        irrigation: "fieldInspect",
        fieldId,
        fieldName,
      },
    },
    additionalInfo: {
      source: "irrigation-web-spa",
      triggerMode: "fieldInspect",
      fieldId,
      fieldName,
      note: "Root Rule Chain must route metadata.irrigation=fieldInspect to the irrigation rule chain.",
    },
  };

  if (existing?.id) {
    payload.id = {
      entityType: "SCHEDULER_EVENT",
      id: existing.id,
    };
  }

  return payload;
}

function buildPlanSchedulerEventPayload(
  fieldId: string,
  fieldName: string,
  plan: TbRotationPlanConfig,
  existing?: TbSchedulerEventRecord | null,
) {
  const payload: Record<string, unknown> = {
    name: getPlanSchedulerEventName(fieldName, plan.name),
    type: FIELD_SCHEDULER_EVENT_TYPE,
    originatorId: {
      entityType: "ASSET",
      id: fieldId,
    },
    msgType: "CUSTOM",
    msgBody: {
      fieldId,
      fieldName,
      planId: plan.id,
      planName: plan.name,
    },
    metadata: {
      irrigation: "planSchedule",
      fieldId,
      fieldName,
      planId: plan.id,
      planName: plan.name,
    },
    schedule: {
      timezone: FIELD_SCHEDULER_TIMEZONE,
      startTime: getNextPlanSchedulerStartTime(plan),
      repeat: buildPlanSchedulerRepeat(plan),
    },
    configuration: {
      originatorId: {
        entityType: "ASSET",
        id: fieldId,
      },
      msgType: "CUSTOM",
      msgBody: {
        fieldId,
        fieldName,
        planId: plan.id,
        planName: plan.name,
      },
      metadata: {
        irrigation: "planSchedule",
        fieldId,
        fieldName,
        planId: plan.id,
        planName: plan.name,
      },
    },
    additionalInfo: {
      source: "irrigation-web-spa",
      triggerMode: "planSchedule",
      fieldId,
      fieldName,
      planId: plan.id,
      planName: plan.name,
      scheduleType: plan.scheduleType || "daily",
      note: "Root Rule Chain must route metadata.irrigation=planSchedule to the irrigation rule chain.",
    },
  };

  if (existing?.id) {
    payload.id = {
      entityType: "SCHEDULER_EVENT",
      id: existing.id,
    };
  }

  return payload;
}

function buildPlanZoneAdvanceSchedulerEventPayload(
  fieldId: string,
  fieldName: string,
  plan: TbRotationPlanConfig,
  zone: TbRotationPlanConfig["zones"][number],
  zoneIndex: number,
  offsetSeconds: number,
  existing?: TbSchedulerEventRecord | null,
) {
  const payload = buildZoneAdvanceSchedulerEventPayload(
    {
      triggerMode: "planZoneAdvance",
      fieldId,
      fieldName,
      planId: plan.id,
      planName: plan.name,
      executionId: "",
      zoneIndex,
      zoneName: zone.zoneName ?? `${zone.siteNumber}区`,
      startTime: getNextPlanSchedulerStartTime(plan) + offsetSeconds * 1000,
    },
    existing,
  );

  payload.schedule = {
    timezone: FIELD_SCHEDULER_TIMEZONE,
    startTime: getNextPlanSchedulerStartTime(plan) + offsetSeconds * 1000,
    repeat: buildPlanSchedulerRepeat(plan),
  };

  return payload;
}

function buildZoneAdvanceSchedulerEventPayload(
  input: {
    triggerMode: "manualZoneAdvance" | "planZoneAdvance";
    fieldId: string;
    fieldName: string;
    planId: string;
    planName: string;
    executionId: string;
    zoneIndex: number;
    zoneName: string;
    startTime: number;
  },
  existing?: TbSchedulerEventRecord | null,
) {
  const payload: Record<string, unknown> = {
    name: getZoneAdvanceSchedulerEventName(input.fieldName, input.planName, input.zoneName, input.zoneIndex),
    type: FIELD_SCHEDULER_EVENT_TYPE,
    originatorId: {
      entityType: "ASSET",
      id: input.fieldId,
    },
    msgType: "CUSTOM",
    msgBody: {
      fieldId: input.fieldId,
      fieldName: input.fieldName,
      planId: input.planId,
      planName: input.planName,
      executionId: input.executionId,
      zoneIndex: input.zoneIndex,
      schedulerEventId: existing?.id,
    },
    metadata: {
      irrigation: "zoneAdvance",
      triggerMode: input.triggerMode,
      fieldId: input.fieldId,
      fieldName: input.fieldName,
      planId: input.planId,
      planName: input.planName,
      executionId: input.executionId,
      zoneIndex: input.zoneIndex,
      schedulerEventId: existing?.id,
    },
    schedule: {
      timezone: FIELD_SCHEDULER_TIMEZONE,
      startTime: input.startTime,
    },
    configuration: {
      originatorId: {
        entityType: "ASSET",
        id: input.fieldId,
      },
      msgType: "CUSTOM",
      msgBody: {
        fieldId: input.fieldId,
        fieldName: input.fieldName,
        planId: input.planId,
        planName: input.planName,
        executionId: input.executionId,
        zoneIndex: input.zoneIndex,
        schedulerEventId: existing?.id,
      },
      metadata: {
        irrigation: "zoneAdvance",
        triggerMode: input.triggerMode,
        fieldId: input.fieldId,
        fieldName: input.fieldName,
        planId: input.planId,
        planName: input.planName,
        executionId: input.executionId,
        zoneIndex: input.zoneIndex,
        schedulerEventId: existing?.id,
      },
    },
    additionalInfo: {
      source: "irrigation-web-spa",
      triggerMode: input.triggerMode,
      fieldId: input.fieldId,
      fieldName: input.fieldName,
      planId: input.planId,
      planName: input.planName,
      executionId: input.executionId,
      zoneIndex: input.zoneIndex,
      zoneName: input.zoneName,
      note: "一次性分区推进调度，执行后由前端和补偿清理逻辑删除。",
    },
  };

  if (existing?.id) {
    payload.id = {
      entityType: "SCHEDULER_EVENT",
      id: existing.id,
    };
  }

  return payload;
}

function getFieldSchedulerEventName(fieldName: string) {
  return `${FIELD_SCHEDULER_EVENT_PREFIX}${fieldName || "未命名地块"}`;
}

function getPlanSchedulerEventName(fieldName: string, planName: string) {
  return `${PLAN_SCHEDULER_EVENT_PREFIX}${fieldName || "未命名地块"} / ${planName || "未命名计划"}`;
}

function getZoneAdvanceSchedulerEventName(
  fieldName: string,
  planName: string,
  zoneName: string,
  zoneIndex: number,
) {
  return `${ZONE_ADVANCE_SCHEDULER_EVENT_PREFIX}${fieldName || "未命名地块"} / ${planName || "未命名计划"} / ${zoneName || `${zoneIndex + 1}区`}`;
}

function getNextSchedulerStartTime() {
  return Math.ceil(Date.now() / 60000) * 60000;
}

function getNextPlanSchedulerStartTime(plan: TbRotationPlanConfig) {
  const [hour = 0, minute = 0] = String(plan.startAt || "00:00").split(":").map(Number);
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime();
}

function buildPlanSchedulerRepeat(plan: TbRotationPlanConfig) {
  if (plan.scheduleType === "interval") {
    return {
      type: "TIMER",
      endsOn: 0,
      repeatInterval: Math.max(1, plan.intervalDays || 1) * 86400,
      timeUnit: "SECONDS",
    };
  }
  return {
    type: "TIMER",
    endsOn: 0,
    repeatInterval: 86400,
    timeUnit: "SECONDS",
  };
}

function mapSchedulerEventRecord(raw: unknown): TbSchedulerEventRecord {
  const item = (raw ?? {}) as Record<string, unknown>;
  const configuration = normalizeRecord(item.configuration);
  const metadata = normalizeRecord(configuration.metadata);
  const payloadMetadata = normalizeRecord(item.metadata);
  const additionalInfo = normalizeRecord(item.additionalInfo);
  const schedule = normalizeRecord(item.schedule);
  const id = extractEntityId(item.id) ?? "";
  const fieldId =
    typeof metadata.fieldId === "string"
      ? metadata.fieldId
      : typeof payloadMetadata.fieldId === "string"
        ? payloadMetadata.fieldId
      : typeof additionalInfo.fieldId === "string"
        ? additionalInfo.fieldId
        : undefined;
  const planId =
    typeof metadata.planId === "string"
      ? metadata.planId
      : typeof payloadMetadata.planId === "string"
        ? payloadMetadata.planId
      : typeof additionalInfo.planId === "string"
        ? additionalInfo.planId
        : undefined;
  return {
    id,
    name: typeof item.name === "string" ? item.name : "",
    type: typeof item.type === "string" ? item.type : FIELD_SCHEDULER_EVENT_TYPE,
    fieldId,
    fieldName:
      typeof metadata.fieldName === "string"
        ? metadata.fieldName
        : typeof payloadMetadata.fieldName === "string"
          ? payloadMetadata.fieldName
        : typeof additionalInfo.fieldName === "string"
          ? additionalInfo.fieldName
          : undefined,
    planId,
    planName:
      typeof metadata.planName === "string"
        ? metadata.planName
        : typeof payloadMetadata.planName === "string"
          ? payloadMetadata.planName
          : typeof additionalInfo.planName === "string"
            ? additionalInfo.planName
            : undefined,
    irrigation:
      typeof metadata.irrigation === "string"
        ? metadata.irrigation
        : typeof payloadMetadata.irrigation === "string"
          ? payloadMetadata.irrigation
        : typeof additionalInfo.triggerMode === "string"
          ? additionalInfo.triggerMode
          : undefined,
    triggerMode:
      typeof payloadMetadata.triggerMode === "string"
        ? payloadMetadata.triggerMode
        : typeof metadata.triggerMode === "string"
          ? metadata.triggerMode
          : typeof additionalInfo.triggerMode === "string"
            ? additionalInfo.triggerMode
            : undefined,
    executionId:
      typeof metadata.executionId === "string"
        ? metadata.executionId
        : typeof payloadMetadata.executionId === "string"
          ? payloadMetadata.executionId
          : typeof additionalInfo.executionId === "string"
            ? additionalInfo.executionId
            : undefined,
    zoneIndex:
      toInt(metadata.zoneIndex) ??
      toInt(payloadMetadata.zoneIndex) ??
      toInt(additionalInfo.zoneIndex) ??
      undefined,
    startTime: toInt(schedule.startTime) ?? undefined,
    createdTime: toInt(item.createdTime) ?? undefined,
    enabled: typeof item.enabled === "boolean" ? item.enabled : undefined,
  };
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function tbRequest(session: TbSession, path: string, init: RequestInit = {}) {
  const url = `${normalizeBaseUrl(session.baseUrl)}${path}`;
  const isRpcRequest = path.includes("/api/plugins/rpc/");
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Authorization": `Bearer ${session.token}`,
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitDebugLog({
      level: "error",
      scope: isRpcRequest ? "rpc" : "rest",
      message: `${isRpcRequest ? "RPC" : "REST"} 网络失败 ${path}`,
      detail: serializeDetail({ url, error: message }),
    });
    throw new Error(
      `无法连接 ThingsBoard：${message}。请检查网络、ThingsBoard 地址、HTTPS/CORS 或请求是否过于频繁。`,
    );
  }

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
  const selectedSiteNumber =
    toInt(telemetry.selectedSiteNumber) ??
    toInt(clientAttributes.selectedSiteNumber) ??
    toInt(sharedAttributes.siteNumber) ??
    1;

  const siteCount = inferSiteCount({
    mappingSiteCount: mapping?.siteCount,
    sharedAttributes,
    clientAttributes,
    telemetry,
    selectedSiteNumber,
    deviceIdentity: [
      typeof info.name === "string" ? info.name : undefined,
      mapping?.model,
      typeof info.type === "string" ? info.type : undefined,
      typeof info.label === "string" ? info.label : undefined,
      mapping?.serialNumber,
    ],
  });

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
      label: `站点${siteNumber}`,
      open: toBoolean(telemetry[`station${siteNumber}Open`]) ?? false,
      remainingSeconds: toInt(telemetry[`station${siteNumber}RemainingSeconds`]) ?? 0,
      openingDurationSeconds:
        toInt(telemetry[`station${siteNumber}OpeningDurationSeconds`]) ?? 0,
      manualDurationSeconds: toInt(sharedAttributes.manualDurationSeconds) ?? 600,
    };
  });

  const lastCommand = buildLastCommand(telemetry, clientAttributes);
  const platformState = resolvePlatformState(info);
  const deviceIdentity = {
    name: typeof info.name === "string" ? info.name : "未命名设备",
    serialNumber: mapping?.serialNumber || (typeof info.name === "string" ? info.name : infoId?.id ?? ""),
    platformState,
    connectivityState: "disconnected" as ConnectivityState,
  };

  return {
    id: infoId?.id ?? "",
    name: deviceIdentity.name,
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
    platformState,
    platformLastActivityAt: resolvePlatformLastActivityAt(info),
    connectivityState: normalizeBleConnectivityState(clientAttributes, deviceIdentity),
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

async function enrichDeviceDetailSiteCountFromGateway(
  session: TbSession,
  detail: DeviceState,
  rpcGatewayId: string,
  clientAttributes: Record<string, unknown>,
  sharedAttributes: Record<string, unknown>,
) {
  const childExplicitSiteCount =
    toInt(sharedAttributes.siteCount) ??
    toInt(sharedAttributes.channels) ??
    toInt(clientAttributes.siteCount) ??
    toInt(clientAttributes.channels);
  if (childExplicitSiteCount || !rpcGatewayId || rpcGatewayId === detail.id) {
    return detail;
  }

  try {
    const gatewayAttrs = await getAttributes(session, rpcGatewayId, "CLIENT_SCOPE", CLIENT_ATTRIBUTE_KEYS);
    const gatewaySiteCount = toInt(gatewayAttrs.siteCount) ?? toInt(gatewayAttrs.channels);
    if (!gatewaySiteCount || gatewaySiteCount === detail.siteCount) {
      return detail;
    }
    return applySiteCount(detail, gatewaySiteCount);
  } catch {
    return detail;
  }
}

function applySiteCount(detail: DeviceState, nextSiteCount: number): DeviceState {
  const siteCount = clamp(nextSiteCount, 1, 8);
  const nextSites = Array.from({ length: siteCount }, (_, index) => {
    const siteNumber = index + 1;
    const current = detail.sites.find((site) => site.siteNumber === siteNumber);
    return (
      current ?? {
        siteNumber,
        label: `站点${siteNumber}`,
        open: false,
        remainingSeconds: 0,
        openingDurationSeconds: 0,
        manualDurationSeconds: detail.sites[0]?.manualDurationSeconds ?? 600,
      }
    );
  });
  return {
    ...detail,
    siteCount,
    selectedSiteNumber: clamp(detail.selectedSiteNumber, 1, siteCount),
    sites: nextSites,
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

function inferSiteCount(input: {
  mappingSiteCount?: number;
  sharedAttributes: Record<string, unknown>;
  clientAttributes: Record<string, unknown>;
  telemetry: Record<string, unknown>;
  selectedSiteNumber: number;
  deviceIdentity: Array<string | undefined>;
}) {
  const explicit =
    toInt(input.sharedAttributes.siteCount) ??
    toInt(input.sharedAttributes.channels) ??
    toInt(input.clientAttributes.siteCount) ??
    toInt(input.clientAttributes.channels) ??
    input.mappingSiteCount;
  if (explicit && explicit >= 1) {
    return clamp(explicit, 1, 8);
  }

  const inferredFromKeys = inferSiteCountFromKeys(
    input.telemetry,
    input.clientAttributes,
    input.sharedAttributes,
  );
  if (inferredFromKeys > 1) {
    return inferredFromKeys;
  }

  const inferredFromIdentity = inferSiteCountFromDeviceIdentity(...input.deviceIdentity);
  if (inferredFromIdentity > 1 || inferredFromIdentity === 1) {
    return inferredFromIdentity;
  }

  return clamp(input.selectedSiteNumber, 1, 8);
}

function inferSiteCountFromKeys(...sources: Array<Record<string, unknown>>) {
  let maxSite = 1;
  for (const source of sources) {
    for (const key of Object.keys(source)) {
      const match = key.match(/^station([1-8])(Open|RemainingSeconds|OpeningDurationSeconds)$/);
      if (match) {
        maxSite = Math.max(maxSite, Number.parseInt(match[1] ?? "1", 10));
      }
    }
  }
  return maxSite;
}

function inferSiteCountFromDeviceIdentity(...values: Array<string | undefined>) {
  for (const value of values) {
    const normalized = value?.trim().toUpperCase();
    if (!normalized) {
      continue;
    }
    const modelMatch = normalized.match(/WC(\d+)/);
    const secondDigit = modelMatch?.[1]?.[1];
    if (!secondDigit) {
      continue;
    }
    const parsed = Number.parseInt(secondDigit, 10);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 8) {
      return parsed;
    }
  }
  return 1;
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
    import.meta.env.VITE_TB_MANAGED_DEVICES?.trim() ||
    import.meta.env.VITE_TB_DEVICE_MAPPINGS?.trim();
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DeviceMapping[]) : [];
  } catch (error) {
    console.error("[tb:auth] VITE_TB_MANAGED_DEVICES 解析失败", error);
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

function mapFieldAssetConfig(attributes: Record<string, unknown>): TbFieldAssetConfig {
  return {
    code: toStringValue(attributes.code),
    groupName: toStringValue(attributes.groupName),
    cropType: toStringValue(attributes.cropType),
    growthStage: toStringValue(attributes.growthStage),
    areaMu: toNumber(attributes.areaMu) ?? undefined,
    centerLat: toNumber(attributes.centerLat) ?? undefined,
    centerLng: toNumber(attributes.centerLng) ?? undefined,
    boundary: normalizeBoundaryAttribute(attributes.boundary),
    zones: normalizeZonesAttribute(attributes.zones),
    deviceId: toStringValue(attributes.deviceId),
    deviceMarkers: normalizeDeviceMarkersAttribute(attributes.deviceMarkers),
    zoneCount: toInt(attributes.zoneCount) ?? undefined,
    kc: toNumber(attributes.kc) ?? undefined,
    irrigationEfficiency: toNumber(attributes.irrigationEfficiency) ?? undefined,
    rotationPlans: Array.isArray(attributes.rotationPlans) ? attributes.rotationPlans : undefined,
    automationStrategies: Array.isArray(attributes.automationStrategies)
      ? attributes.automationStrategies
      : undefined,
  };
}

function compactRecord<T extends Record<string, unknown>>(input: T) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

function normalizeBoundaryAttribute(value: unknown): Array<[number, number]> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const points = value
    .map((point) => {
      if (!Array.isArray(point) || point.length < 2) {
        return null;
      }
      const lng = toNumber(point[0]);
      const lat = toNumber(point[1]);
      return lng === null || lat === null ? null : ([lng, lat] as [number, number]);
    })
    .filter((point): point is [number, number] => Boolean(point));
  return points.length >= 3 ? points : undefined;
}

function normalizeZonesAttribute(value: unknown): TbFieldAssetConfig["zones"] {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const zones = value
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item, index) => {
      const boundary = normalizeBoundaryAttribute(item.boundary);
      if (!boundary) {
        return null;
      }
      return {
        id: toStringValue(item.id) ?? `zone-${index + 1}`,
        name: toStringValue(item.name) ?? `${index + 1}区`,
        siteNumber: toInt(item.siteNumber) ?? index + 1,
        boundary,
        deviceId: toStringValue(item.deviceId),
        deviceIds: Array.isArray(item.deviceIds)
          ? item.deviceIds.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
          : undefined,
        deviceBindings: Array.isArray(item.deviceBindings)
          ? item.deviceBindings
              .filter((entry): entry is Record<string, unknown> => isRecord(entry))
              .flatMap((entry) => {
                const deviceId = toStringValue(entry.deviceId);
                if (!deviceId) {
                  return [];
                }
                const siteNumber = toInt(entry.siteNumber) ?? undefined;
                return siteNumber ? [{ deviceId, siteNumber }] : [{ deviceId }];
              })
          : undefined,
        valveSiteNumber: toInt(item.valveSiteNumber) ?? index + 1,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  return zones.length > 0 ? zones : undefined;
}

function normalizeDeviceMarkersAttribute(value: unknown): TbFieldAssetConfig["deviceMarkers"] {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const markers = value
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => {
      const deviceId = toStringValue(item.deviceId);
      const lng = toNumber(item.lng);
      const lat = toNumber(item.lat);
      if (!deviceId || lng === null || lat === null) {
        return null;
      }
      return {
        deviceId,
        name: toStringValue(item.name) ?? "现场设备",
        role: toStringValue(item.role) ?? "controller",
        lng,
        lat,
        zoneId: toStringValue(item.zoneId),
        siteNumber: toInt(item.siteNumber) ?? undefined,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  return markers.length > 0 ? markers : undefined;
}

function toStringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function normalizeBleConnectivityState(
  clientAttributes: Record<string, unknown>,
  device: Pick<DeviceSummary, "name" | "serialNumber" | "platformState" | "connectivityState">,
): ConnectivityState {
  const connectedName =
    typeof clientAttributes.connectedDeviceName === "string"
      ? clientAttributes.connectedDeviceName.trim()
      : "";
  const nameMatches =
    !connectedName || connectedName === device.name || connectedName === device.serialNumber;
  if (!nameMatches) {
    return "disconnected";
  }

  const bleConnected = toBoolean(clientAttributes.bleConnected);
  if (bleConnected === true) {
    return "connected";
  }
  if (bleConnected === false) {
    return "disconnected";
  }

  return normalizeConnectionState(clientAttributes.bleConnectionState) ?? device.connectivityState;
}

function normalizeGatewayState(
  heartbeatTs: number,
  gatewayOnline: unknown,
  platformState: "active" | "inactive",
): GatewayState {
  const online = toBoolean(gatewayOnline);
  if (online === false) {
    return "offline";
  }
  if (heartbeatTs && Date.now() - heartbeatTs < 2 * 60 * 1000) {
    return "online";
  }
  if (heartbeatTs || platformState === "inactive") {
    return "offline";
  }
  return "unknown";
}

function normalizeGatewayConnectivityState(gatewayState?: GatewayState): ConnectivityState {
  return gatewayState === "online" ? "connected" : "disconnected";
}

function resolvePlatformState(
  item: Record<string, unknown>,
  fallback: "active" | "inactive" = "inactive",
): "active" | "inactive" {
  const active = toBoolean(item.active);
  if (active !== null) {
    return active ? "active" : "inactive";
  }
  return fallback;
}

function resolvePlatformLastActivityAt(
  item: Record<string, unknown>,
  fallback = 0,
): number {
  return toInt(item.lastActivityTime) ?? fallback;
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

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(items[currentIndex] as T, currentIndex);
      }
    }),
  );

  return results;
}
