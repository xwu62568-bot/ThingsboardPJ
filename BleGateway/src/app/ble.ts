import { BleService } from '../ble/BleService';
import { Protocol } from '../ble/Protocol';
import { BleStore } from '../state/BleStore';
import { ThingsBoardBridge } from '../thingsboard/ThingsBoardBridge';
import { ThingsBoardStore } from '../thingsboard/ThingsBoardStore';
import { thingsBoardConfig } from '../thingsboard/config';

export const gattSpec = {
  notifyServiceUUID: '0000180f-0000-1000-8000-00805f9b34fb',
  notifyCharacteristicUUID: '00002a19-0000-1000-8000-00805f9b34fb',
  writeWithResponseServiceUUID: '0000180f-0000-1000-8000-00805f9b34fb',
  writeWithResponseCharacteristicUUID: '00002a1a-0000-1000-8000-00805f9b34fb',
  readServiceUUID: '0000180f-0000-1000-8000-00805f9b34fb',
  readCharacteristicUUID: '00002a1b-0000-1000-8000-00805f9b34fb',
  deviceInfoUuid: '0000180a-0000-1000-8000-00805f9b34fb',
  versionUUID: '00002a50-0000-1000-8000-00805f9b34fb',
};

export const bleStore = new BleStore();
export const bleService = new BleService(bleStore, gattSpec, {
  scanTimeoutSeconds: 15,
  reconnect: { enabled: true, baseDelayMs: 800, maxDelayMs: 8000, maxAttempts: 5 },
});

export const protocol = new Protocol({
  write: (bytes, withResponse) =>
    bleService.write(bytes, { withResponse, maxChunkSize: 20 }),
  onNotify: (handler) => bleService.onNotify(handler),
});

export const thingsBoardStore = new ThingsBoardStore();
type BridgeClient = ConstructorParameters<typeof ThingsBoardBridge>[0];

function createDisabledThingsBoardClient(error: unknown): BridgeClient {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.log('[APP] gateway client unavailable', message);
  thingsBoardStore.setState({
    configured: false,
    connectionState: 'error',
    lastError: { message },
  });

  return {
    isConfigured: () => false,
    getConfigSummary: () => ({
      baseUrl: typeof thingsBoardConfig?.baseUrl === 'string' ? thingsBoardConfig.baseUrl : '',
      configured: false,
    }),
    connect: async () => undefined,
    disconnect: async () => undefined,
    publishTelemetry: async () => undefined,
    publishAttributes: async () => undefined,
    fetchAttributes: async () => ({}),
    pollRpc: async () => null,
    replyRpc: async () => undefined,
    publishChildTelemetry: async () => undefined,
    publishChildAttributes: async () => undefined,
    connectChildDevice: async () => undefined,
    disconnectChildDevice: async () => undefined,
    setError: (nextError: unknown) => {
      const nextMessage =
        nextError instanceof Error ? nextError.stack || nextError.message : String(nextError);
      thingsBoardStore.setState({
        configured: false,
        connectionState: 'error',
        lastError: { message: nextMessage },
      });
    },
    setLastRpcMethod: (method: string) => {
      thingsBoardStore.setState({ lastRpcMethod: method });
    },
    setLatestGatewayValues: (
      packetHex: string,
      values: Record<string, unknown>,
      meta?: { deviceName?: string },
    ) => {
      thingsBoardStore.setState({
        lastPacketHex: packetHex,
        latestGatewayValues: values,
        latestGatewayValuesByDevice: meta?.deviceName
          ? {
              ...(thingsBoardStore.getState().latestGatewayValuesByDevice ?? {}),
              [meta.deviceName]: {
                ...((thingsBoardStore.getState().latestGatewayValuesByDevice ?? {})[meta.deviceName] ??
                  {}),
                ...values,
              },
            }
          : thingsBoardStore.getState().latestGatewayValuesByDevice,
      });
    },
    onConnected: () => () => undefined,
  } as unknown as BridgeClient;
}

function createThingsBoardClient(): BridgeClient {
  try {
    console.log('[APP] loading gateway client', {
      hasBaseUrl: typeof thingsBoardConfig?.baseUrl === 'string',
      hasAccessToken: typeof thingsBoardConfig?.accessToken === 'string',
      mqttUrl: thingsBoardConfig?.mqttUrl,
    });
    const gatewayModule =
      require('../thingsboard/ThingsBoardGatewayClient') as typeof import('../thingsboard/ThingsBoardGatewayClient');
    return new gatewayModule.ThingsBoardGatewayClient(
      thingsBoardConfig,
      thingsBoardStore,
    ) as BridgeClient;
  } catch (error) {
    return createDisabledThingsBoardClient(error);
  }
}

export const thingsBoardClient = createThingsBoardClient();
export const thingsBoardBridge = new ThingsBoardBridge(
  thingsBoardClient,
  bleService,
  bleStore,
  protocol,
);
