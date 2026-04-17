export type UserRole = string;

export type IrrigationUser = {
  id: string;
  username: string;
  name: string;
  role: UserRole;
};

export type ConnectivityState =
  | "connected"
  | "connecting"
  | "disconnected"
  | "error";

export type PlatformState = "active" | "inactive";

export type SiteState = {
  siteNumber: number;
  label: string;
  open: boolean;
  remainingSeconds: number;
  openingDurationSeconds: number;
  manualDurationSeconds: number;
};

export type DeviceState = {
  id: string;
  name: string;
  model: string;
  serialNumber: string;
  rpcTargetName: string;
  rpcGatewayId?: string;
  rpcGatewayName?: string;
  platformState: PlatformState;
  platformLastActivityAt: number;
  connectivityState: ConnectivityState;
  lastSeenAt: number;
  signalRssi: number;
  siteCount: number;
  selectedSiteNumber: number;
  batteryLevel: number;
  batteryVoltage: number;
  soilMoisture: number;
  rainSensorWet: boolean;
  rtcTimestamp: number;
  lastCommand?: {
    kind: "connect" | "disconnect" | "refresh" | "run" | "stop";
    siteNumber?: number;
    durationSeconds?: number;
    result: "success" | "pending" | "error";
    at: number;
    message: string;
  };
  sites: SiteState[];
};

export type DeviceSummary = Pick<
  DeviceState,
  | "id"
  | "name"
  | "model"
  | "serialNumber"
  | "platformState"
  | "platformLastActivityAt"
  | "connectivityState"
  | "lastSeenAt"
  | "selectedSiteNumber"
  | "siteCount"
  | "batteryLevel"
>;
