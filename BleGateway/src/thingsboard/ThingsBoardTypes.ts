export type ThingsBoardConnectionState =
  | 'disabled'
  | 'idle'
  | 'polling'
  | 'connected'
  | 'error';

export type ThingsBoardError = {
  message: string;
};

export type ThingsBoardConfig = {
  baseUrl: string;
  accessToken: string;
  rpcTimeoutMs?: number;
  mqttUrl?: string;
};

export type ThingsBoardRpcRequest = {
  id: string;
  method: string;
  params?: Record<string, unknown>;
};

export type TelemetryPayload =
  | Record<string, unknown>
  | {
      ts: number;
      values: Record<string, unknown>;
    };

export type ThingsBoardAttributesPayload = {
  client?: Record<string, unknown>;
  shared?: Record<string, unknown>;
};

export type ThingsBoardState = {
  configured: boolean;
  connectionState: ThingsBoardConnectionState;
  lastError?: ThingsBoardError;
  lastRpcMethod?: string;
  lastSyncAt?: number;
  lastPacketHex?: string;
  latestGatewayValues?: Record<string, unknown>;
  latestCloudAttributes?: ThingsBoardAttributesPayload;
  latestGatewayValuesByDevice?: Record<string, Record<string, unknown>>;
  latestCloudAttributesByDevice?: Record<string, ThingsBoardAttributesPayload>;
  lastCloudStateAt?: number;
};
