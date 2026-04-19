import type { DeviceState, DeviceSummary, GatewayState } from "@/lib/domain/types";
import type {
  TbAutomationStrategyConfig,
  TbFieldAssetRecord,
  TbRotationPlanConfig,
} from "@/lib/client/thingsboard";

export type FieldSummary = {
  id: string;
  name: string;
  code: string;
  groupName: string;
  cropType: string;
  growthStage: string;
  areaMu: number;
  deviceId: string;
  centerLat: number;
  centerLng: number;
  boundary?: Array<[number, number]>;
  mapZones?: NonNullable<TbFieldAssetRecord["config"]["zones"]>;
  deviceMarkers?: NonNullable<TbFieldAssetRecord["config"]["deviceMarkers"]>;
  zoneCount: number;
  batteryLevel: number;
  soilMoisture: number;
  irrigationState: "idle" | "running" | "attention";
  gatewayState: GatewayState;
  et0: number;
  kc: number;
  etc: number;
};

export type FieldDetail = FieldSummary & {
  rainfallForecastMm: number;
  suggestedDurationMinutes: number;
  zones: Array<{
    id: string;
    name: string;
    siteNumber: number;
    open: boolean;
    remainingSeconds: number;
    plannedDurationSeconds: number;
  }>;
};

export type DashboardSnapshot = {
  totalDevices: number;
  totalFields: number;
  onlineDevices: number;
  runningZones: number;
  attentionFields: number;
  averageBatteryLevel: number;
  averageEt0: number;
  averageEtc: number;
};

export type IrrigationPlanSummary = {
  id: string;
  name: string;
  fieldId: string;
  fieldName: string;
  startAt: string;
  enabled: boolean;
  skipIfRain: boolean;
  zoneCount: number;
  totalDurationMinutes: number;
  mode: "manual" | "semi-auto" | "auto";
  zones: Array<{
    siteNumber: number;
    durationMinutes: number;
  }>;
};

export type StrategySummary = {
  id: string;
  name: string;
  fieldId: string;
  fieldName: string;
  enabled: boolean;
  moistureMin: number;
  moistureRecover: number;
  etcTriggerMm: number;
  rainLockEnabled: boolean;
  mode: "advisory" | "semi-auto" | "auto";
};

const BASE_LAT = 31.29834;
const BASE_LNG = 120.58319;
const CROPS = ["葡萄", "蓝莓", "草莓", "柑橘", "番茄", "苗圃"];
const GROWTH_STAGES = ["营养生长", "花期", "膨果期", "成熟前"];

export function buildFieldSummaries(devices: DeviceSummary[]): FieldSummary[] {
  return devices.map((device, index) => {
    const seed = hashSeed(device.id || device.name || String(index));
    const zoneCount = Math.max(1, device.siteCount || 1);
    const areaMu = 18 + (seed % 35);
    const soilMoisture = clamp(28 + (seed % 30), 18, 62);
    const et0 = Number((3.2 + ((seed % 16) / 10)).toFixed(1));
    const kc = Number((0.62 + ((seed % 28) / 100)).toFixed(2));
    const etc = Number((et0 * kc).toFixed(2));
    const irrigationState =
      device.connectivityState === "connected" && zoneCount > 0 && seed % 5 === 0
        ? "running"
        : soilMoisture < 32 || (device.batteryLevel ?? 0) < 25
          ? "attention"
          : "idle";
    const gatewayState = normalizeGatewayState(device);

    return {
      id: `field-${device.id}`,
      name: formatFieldName(device.name),
      code: `F-${String(index + 1).padStart(2, "0")}`,
      groupName: "默认分组",
      cropType: CROPS[seed % CROPS.length] ?? CROPS[0],
      growthStage: GROWTH_STAGES[seed % GROWTH_STAGES.length] ?? GROWTH_STAGES[0],
      areaMu,
      deviceId: device.id,
      centerLat: Number((BASE_LAT + ((seed % 9) - 4) * 0.018).toFixed(6)),
      centerLng: Number((BASE_LNG + ((seed % 11) - 5) * 0.024).toFixed(6)),
      boundary: undefined,
      mapZones: undefined,
      deviceMarkers: undefined,
      zoneCount,
      batteryLevel: clamp(device.batteryLevel ?? 0, 0, 100),
      soilMoisture,
      irrigationState,
      gatewayState,
      et0,
      kc,
      etc,
    };
  });
}

export function buildFieldSummariesFromRecords(
  records: TbFieldAssetRecord[],
  devices: DeviceSummary[],
): FieldSummary[] {
  return records.map((record, index) => {
    const device = record.config.deviceId
      ? devices.find((item) => item.id === record.config.deviceId)
      : undefined;
    const seed = hashSeed(record.id || record.name || String(index));
    const zoneCount = record.config.zoneCount ?? device?.siteCount ?? 1;
    const areaMu = record.config.areaMu ?? 18 + (seed % 35);
    const et0 = toNumber(record.telemetry.et0) ?? 0;
    const kc = toNumber(record.telemetry.kc) ?? record.config.kc ?? 0;
    const etc = toNumber(record.telemetry.etc) ?? (et0 && kc ? Number((et0 * kc).toFixed(2)) : 0);
    const soilMoisture =
      toNumber(record.telemetry.soilMoisture) ?? (device ? 0 : clamp(28 + (seed % 30), 18, 62));
    const batteryLevel =
      toNumber(record.telemetry.batteryLevel) ?? clamp(device?.batteryLevel ?? 0, 0, 100);

    return {
      id: record.id,
      name: record.name || "未命名地块",
      code: record.config.code || `F-${String(index + 1).padStart(2, "0")}`,
      groupName: record.config.groupName || "默认分组",
      cropType: record.config.cropType || CROPS[seed % CROPS.length] || CROPS[0],
      growthStage:
        record.config.growthStage || GROWTH_STAGES[seed % GROWTH_STAGES.length] || GROWTH_STAGES[0],
      areaMu,
      deviceId: record.config.deviceId || device?.id || "",
      centerLat:
        record.config.centerLat ??
        Number((BASE_LAT + ((seed % 9) - 4) * 0.018).toFixed(6)),
      centerLng:
        record.config.centerLng ??
        Number((BASE_LNG + ((seed % 11) - 5) * 0.024).toFixed(6)),
      boundary: normalizeBoundary(record.config.boundary),
      mapZones: normalizeZones(record.config.zones),
      deviceMarkers: normalizeDeviceMarkers(record.config.deviceMarkers),
      zoneCount,
      batteryLevel,
      soilMoisture,
      irrigationState: normalizeIrrigationState(record.telemetry.irrigationState, soilMoisture),
      gatewayState: normalizeFieldGatewayState(record.telemetry.gatewayState, device),
      et0,
      kc,
      etc,
    };
  });
}

export function buildFieldDetail(
  field: FieldSummary,
  device: DeviceState | null,
): FieldDetail {
  const zones =
    device?.sites.map((site) => ({
      id: `${field.id}-zone-${site.siteNumber}`,
      name: site.label,
      siteNumber: site.siteNumber,
      open: site.open,
      remainingSeconds: site.remainingSeconds,
      plannedDurationSeconds: site.manualDurationSeconds || 600,
    })) ??
    Array.from({ length: field.zoneCount }, (_, index) => ({
      id: `${field.id}-zone-${index + 1}`,
      name: `站点${index + 1}`,
      siteNumber: index + 1,
      open: index === 0 && field.irrigationState === "running",
      remainingSeconds: index === 0 && field.irrigationState === "running" ? 480 : 0,
      plannedDurationSeconds: 600,
    }));

  return {
    ...field,
    rainfallForecastMm: Number((field.kc * 2.6).toFixed(1)),
    suggestedDurationMinutes: Math.max(
      12,
      Math.round((field.etc * field.areaMu * 0.85) / 3),
    ),
    zones,
  };
}

export function buildDashboardSnapshot(fields: FieldSummary[]): DashboardSnapshot {
  const totalDevices = fields.length;
  const runningZones = fields.reduce(
    (count, field) => count + (field.irrigationState === "running" ? 1 : 0),
    0,
  );
  const attentionFields = fields.filter((field) => field.irrigationState === "attention").length;
  const onlineDevices = fields.filter((field) => field.gatewayState === "online").length;

  return {
    totalDevices,
    totalFields: fields.length,
    onlineDevices,
    runningZones,
    attentionFields,
    averageBatteryLevel: average(fields.map((field) => field.batteryLevel)),
    averageEt0: average(fields.map((field) => field.et0)),
    averageEtc: average(fields.map((field) => field.etc)),
  };
}

export function buildPlanSummaries(
  fields: FieldSummary[],
  records: TbFieldAssetRecord[] = [],
): IrrigationPlanSummary[] {
  const configuredPlans = records.flatMap((record) => {
    const field = fields.find((item) => item.id === record.id);
    return normalizeRotationPlans(record.config.rotationPlans).map((plan) =>
      mapRotationPlanToSummary(plan, field ?? record),
    );
  });
  if (configuredPlans.length > 0) {
    return configuredPlans;
  }

  return fields.map((field, index) => {
    const zoneDuration = 12 + ((index % 3) + 1) * 4;
    const zones = Array.from({ length: field.zoneCount }, (_, zoneIndex) => ({
      siteNumber: zoneIndex + 1,
      durationMinutes: zoneDuration,
    }));
    return {
      id: `plan-${field.id}`,
      name: `${field.name} 晨间轮灌`,
      fieldId: field.id,
      fieldName: field.name,
      startAt: index % 2 === 0 ? "05:30" : "18:10",
      enabled: true,
      skipIfRain: true,
      zoneCount: field.zoneCount,
      totalDurationMinutes: sumPlanDuration(zones),
      mode: index % 3 === 0 ? "auto" : index % 2 === 0 ? "semi-auto" : "manual",
      zones,
    };
  });
}

export function buildStrategySummaries(
  fields: FieldSummary[],
  records: TbFieldAssetRecord[] = [],
): StrategySummary[] {
  const configuredStrategies = records.flatMap((record) => {
    const field = fields.find((item) => item.id === record.id);
    return normalizeAutomationStrategies(record.config.automationStrategies).map((strategy) =>
      mapAutomationStrategyToSummary(strategy, field ?? record),
    );
  });
  if (configuredStrategies.length > 0) {
    return configuredStrategies;
  }

  return fields.map((field, index) => ({
    id: `strategy-${field.id}`,
    name: `${field.name} 墒情联动策略`,
    fieldId: field.id,
    fieldName: field.name,
    enabled: true,
    moistureMin: 28 + (index % 3) * 2,
    moistureRecover: 36 + (index % 4) * 2,
    etcTriggerMm: Number((3.6 + (index % 4) * 0.8).toFixed(1)),
    rainLockEnabled: true,
    mode: index % 3 === 0 ? "auto" : index % 2 === 0 ? "semi-auto" : "advisory",
  }));
}

function formatFieldName(name: string) {
  if (!name.trim()) {
    return "未命名地块";
  }
  return name.includes("地块") ? name : `${name} 地块`;
}

function normalizeGatewayState(device: DeviceSummary): GatewayState {
  if (device.gatewayState) {
    return device.gatewayState;
  }
  return device.connectivityState === "connected" ? "online" : "offline";
}

function normalizeFieldGatewayState(value: unknown, device?: DeviceSummary): GatewayState {
  if (value === "online" || value === "offline" || value === "unknown") {
    return value;
  }
  return device ? normalizeGatewayState(device) : "unknown";
}

function normalizeIrrigationState(
  value: unknown,
  soilMoisture: number,
): FieldSummary["irrigationState"] {
  if (value === "idle" || value === "running" || value === "attention") {
    return value;
  }
  return soilMoisture > 0 && soilMoisture < 32 ? "attention" : "idle";
}

function normalizeRotationPlans(value: unknown): TbRotationPlanConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is Record<string, unknown> => {
      return typeof item === "object" && item !== null && !Array.isArray(item);
    })
    .map((item, index) => {
      const zones = Array.isArray(item.zones)
        ? item.zones
            .filter((zone): zone is Record<string, unknown> => {
              return typeof zone === "object" && zone !== null && !Array.isArray(zone);
            })
            .map((zone, zoneIndex) => ({
              siteNumber: toNumber(zone.siteNumber) ?? zoneIndex + 1,
              durationMinutes: toNumber(zone.durationMinutes) ?? 10,
            }))
        : [];
      return {
        id: typeof item.id === "string" && item.id ? item.id : `plan-${index + 1}`,
        name: typeof item.name === "string" && item.name ? item.name : `轮灌计划${index + 1}`,
        fieldId: typeof item.fieldId === "string" ? item.fieldId : "",
        startAt: typeof item.startAt === "string" ? item.startAt : "05:30",
        enabled: typeof item.enabled === "boolean" ? item.enabled : true,
        skipIfRain: typeof item.skipIfRain === "boolean" ? item.skipIfRain : true,
        mode:
          item.mode === "manual" || item.mode === "semi-auto" || item.mode === "auto"
            ? item.mode
            : "semi-auto",
        zones,
      };
    });
}

function mapRotationPlanToSummary(
  plan: TbRotationPlanConfig,
  field: FieldSummary | TbFieldAssetRecord,
): IrrigationPlanSummary {
  const fieldId = "config" in field ? field.id : field.id;
  const fieldName = "config" in field ? field.name : field.name;
  const fallbackZoneCount = "zoneCount" in field ? field.zoneCount : field.config.zoneCount ?? 1;
  const zones =
    plan.zones.length > 0
      ? plan.zones
      : Array.from({ length: fallbackZoneCount }, (_, index) => ({
          siteNumber: index + 1,
          durationMinutes: 10,
        }));
  return {
    id: plan.id,
    name: plan.name,
    fieldId: plan.fieldId || fieldId,
    fieldName,
    startAt: plan.startAt,
    enabled: plan.enabled,
    skipIfRain: plan.skipIfRain,
    zoneCount: zones.length,
    totalDurationMinutes: sumPlanDuration(zones),
    mode: plan.mode,
    zones,
  };
}

function sumPlanDuration(zones: Array<{ durationMinutes: number }>) {
  return zones.reduce((sum, zone) => sum + zone.durationMinutes, 0);
}

function normalizeAutomationStrategies(value: unknown): TbAutomationStrategyConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is Record<string, unknown> => {
      return typeof item === "object" && item !== null && !Array.isArray(item);
    })
    .map((item, index) => ({
      id: typeof item.id === "string" && item.id ? item.id : `strategy-${index + 1}`,
      name: typeof item.name === "string" && item.name ? item.name : `自动策略${index + 1}`,
      fieldId: typeof item.fieldId === "string" ? item.fieldId : "",
      enabled: typeof item.enabled === "boolean" ? item.enabled : true,
      moistureMin: toNumber(item.moistureMin) ?? 28,
      moistureRecover: toNumber(item.moistureRecover) ?? 36,
      etcTriggerMm: toNumber(item.etcTriggerMm) ?? 4,
      rainLockEnabled: typeof item.rainLockEnabled === "boolean" ? item.rainLockEnabled : true,
      mode:
        item.mode === "advisory" || item.mode === "semi-auto" || item.mode === "auto"
          ? item.mode
          : "advisory",
    }));
}

function mapAutomationStrategyToSummary(
  strategy: TbAutomationStrategyConfig,
  field: FieldSummary | TbFieldAssetRecord,
): StrategySummary {
  const fieldId = "config" in field ? field.id : field.id;
  const fieldName = "config" in field ? field.name : field.name;
  return {
    id: strategy.id,
    name: strategy.name,
    fieldId: strategy.fieldId || fieldId,
    fieldName,
    enabled: strategy.enabled,
    moistureMin: strategy.moistureMin,
    moistureRecover: strategy.moistureRecover,
    etcTriggerMm: strategy.etcTriggerMm,
    rainLockEnabled: strategy.rainLockEnabled,
    mode: strategy.mode,
  };
}

function normalizeBoundary(value: unknown): Array<[number, number]> | undefined {
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
      return lng === undefined || lat === undefined ? null : ([lng, lat] as [number, number]);
    })
    .filter((point): point is [number, number] => Boolean(point));
  return points.length >= 3 ? points : undefined;
}

function normalizeZones(value: unknown): FieldSummary["mapZones"] {
  return Array.isArray(value) ? (value as FieldSummary["mapZones"]) : undefined;
}

function normalizeDeviceMarkers(value: unknown): FieldSummary["deviceMarkers"] {
  return Array.isArray(value) ? (value as FieldSummary["deviceMarkers"]) : undefined;
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
}

function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function hashSeed(input: string) {
  let hash = 0;
  for (const char of input) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}
