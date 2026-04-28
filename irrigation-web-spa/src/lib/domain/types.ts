export type UserRole = string;

export type IrrigationUser = {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  customerId?: string;
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
  valveState: "open" | "closed" | "unknown";
  open: boolean;
  remainingSeconds: number;
  openingDurationSeconds: number;
  manualDurationSeconds: number;
};

export type DeviceControlMode = "ble_gateway" | "direct_4g" | "direct";

export type ValveRpcConfig = {
  rpcMethod?: string;
  openRpcMethod?: string;
  closeRpcMethod?: string;
  valveField: string;
  durationField: string;
  commandIdField: string;
  openCommandId?: number;
  closeCommandId?: number;
};

export type DeviceState = {
  id: string;
  name: string;
  blePeripheralId?: string;
  model: string;
  serialNumber: string;
  rpcTargetName: string;
  rpcGatewayId?: string;
  rpcGatewayName?: string;
  controlMode: DeviceControlMode;
  supportsConnectionControl: boolean;
  hideConnectivityState: boolean;
  valveRpc: ValveRpcConfig;
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

export type GatewayState = "online" | "offline" | "unknown";

export type DeviceSummary = Pick<
  DeviceState,
  | "id"
  | "name"
  | "model"
  | "serialNumber"
  | "controlMode"
  | "supportsConnectionControl"
  | "hideConnectivityState"
  | "platformState"
  | "platformLastActivityAt"
  | "connectivityState"
  | "lastSeenAt"
  | "selectedSiteNumber"
  | "siteCount"
  | "batteryLevel"
> & {
  blePeripheralId?: string;
  rpcTargetName?: string;
  isGateway?: boolean;
  gatewayState?: GatewayState;
  gatewayHeartbeatAt?: number;
  bleConnectivityState?: ConnectivityState;
  statusChangedAt?: number;
};
