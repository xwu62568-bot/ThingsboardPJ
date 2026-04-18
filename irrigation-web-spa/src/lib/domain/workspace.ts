import type { DeviceState, DeviceSummary, GatewayState } from "@/lib/domain/types";

export type FieldSummary = {
  id: string;
  name: string;
  code: string;
  cropType: string;
  growthStage: string;
  areaMu: number;
  deviceId: string;
  centerLat: number;
  centerLng: number;
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
      cropType: CROPS[seed % CROPS.length] ?? CROPS[0],
      growthStage: GROWTH_STAGES[seed % GROWTH_STAGES.length] ?? GROWTH_STAGES[0],
      areaMu,
      deviceId: device.id,
      centerLat: Number((BASE_LAT + ((seed % 9) - 4) * 0.018).toFixed(6)),
      centerLng: Number((BASE_LNG + ((seed % 11) - 5) * 0.024).toFixed(6)),
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

export function buildPlanSummaries(fields: FieldSummary[]): IrrigationPlanSummary[] {
  return fields.map((field, index) => ({
    id: `plan-${field.id}`,
    name: `${field.name} 晨间轮灌`,
    fieldId: field.id,
    fieldName: field.name,
    startAt: index % 2 === 0 ? "05:30" : "18:10",
    enabled: true,
    skipIfRain: true,
    zoneCount: field.zoneCount,
    totalDurationMinutes: field.zoneCount * 12 + ((index % 3) + 1) * 8,
    mode: index % 3 === 0 ? "auto" : index % 2 === 0 ? "semi-auto" : "manual",
  }));
}

export function buildStrategySummaries(fields: FieldSummary[]): StrategySummary[] {
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

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
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
