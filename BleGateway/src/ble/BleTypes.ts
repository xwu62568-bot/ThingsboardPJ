export type ConnectionState =
  | 'idle'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

export type BleErrorCode =
  | 'bluetooth-off'
  | 'ble-off'
  | 'permission-denied'
  | 'timeout'
  | 'connect-failed'
  | 'scan-failed'
  | 'gatt-error'
  | 'unknown';

export type BleDevice = {
  id: string;
  name?: string | null;
  rssi?: number;
  serviceUUIDs?: string[];
};

export type BleSession = {
  deviceId: string;
  deviceName?: string | null;
  connectionState: ConnectionState;
  lastError?: { code: BleErrorCode; message: string };
  reconnectAttempts: number;
  lastConnectedAt?: number;
};

export type BleState = {
  connectionState: ConnectionState;
  connectedDeviceId?: string;
  lastError?: { code: BleErrorCode; message: string };
  devices: BleDevice[];
  sessions: Record<string, BleSession>;
};

export type GattSpec = {
  notifyServiceUUID: string;
  notifyCharacteristicUUID: string;
  writeWithResponseServiceUUID: string;
  writeWithResponseCharacteristicUUID: string;
  readServiceUUID?: string;
  readCharacteristicUUID?: string;
  deviceInfoUuid?: string;
  versionUUID?: string;
};

export type WriteOptions = {
  withResponse?: boolean;
  maxChunkSize?: number;
  deviceId?: string;
};

export type NotifyPayload = {
  peripheralId: string;
  serviceUUID: string;
  characteristicUUID: string;
  value: number[]; // raw bytes
};

export type BleServiceOptions = {
  scanTimeoutSeconds?: number;
  reconnect?: {
    enabled: boolean;
    baseDelayMs?: number;
    maxDelayMs?: number;
    maxAttempts?: number;
  };
};
