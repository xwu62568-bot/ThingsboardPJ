import MQTT, { type IMqttClient, type QoS } from 'sp-react-native-mqtt';
import { ThingsBoardHttpClient } from './ThingsBoardHttpClient';
import { ThingsBoardStore } from './ThingsBoardStore';
import type {
  TelemetryPayload,
  ThingsBoardAttributesPayload,
  ThingsBoardConfig,
  ThingsBoardRpcRequest,
} from './ThingsBoardTypes';

type PendingRpcResolver = (rpc: ThingsBoardRpcRequest | null) => void;
type PendingAttributesResolver = (payload: ThingsBoardAttributesPayload) => void;
type GatewayAttributesUpdate = { device: string; data: Record<string, unknown> };
type MqttConnectionUpdate = { reconnect: boolean };

type RpcReplyMeta = {
  originalId: string;
  deviceName?: string;
  source: 'gateway' | 'child';
};

export class ThingsBoardGatewayClient extends ThingsBoardHttpClient {
  private mqttConfig: Required<ThingsBoardConfig>;
  private mqttStore: ThingsBoardStore;
  private client?: IMqttClient;
  private connectPromise?: Promise<void>;
  private connectTimeout?: ReturnType<typeof setTimeout>;
  private connectResolver?: () => void;
  private connectRejector?: (error: Error) => void;
  private rpcQueue: ThingsBoardRpcRequest[] = [];
  private pendingRpcResolvers: PendingRpcResolver[] = [];
  private pendingAttributesResolvers = new Map<
    string,
    { resolve: PendingAttributesResolver; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }
  >();
  private attributeListeners = new Set<(payload: ThingsBoardAttributesPayload) => void>();
  private gatewayAttributeListeners = new Set<(payload: GatewayAttributesUpdate) => void>();
  private connectionListeners = new Set<(payload: MqttConnectionUpdate) => void>();
  private rpcReplyMeta = new Map<string, RpcReplyMeta>();
  private coreTopicsSubscribed = false;
  private isConnected = false;
  private attributeRequestId = 0;
  private readonly mqttClientId: string;

  constructor(config: ThingsBoardConfig, store: ThingsBoardStore) {
    const normalizedConfig = ThingsBoardHttpClient.normalizeConfig(config);
    super(normalizedConfig, store);
    this.mqttConfig = normalizedConfig;
    this.mqttStore = store;
    this.mqttClientId = this.buildStableClientId();
    this.mqttStore.setState({
      configured: this.isConfigured(),
      connectionState: this.isConfigured() ? 'idle' : 'disabled',
    });
    console.log('[TB-MQTT] client init', {
      configured: this.isConfigured(),
      baseUrl: this.mqttConfig.baseUrl,
      mqttUrl: this.getMqttUri(),
      clientId: this.mqttClientId,
      keepalive: 20,
      accessTokenPreview: this.maskAccessToken(this.mqttConfig.accessToken),
    });
  }

  isConfigured(): boolean {
    return this.mqttConfig.baseUrl.length > 0 && this.mqttConfig.accessToken.length > 0;
  }

  getConfigSummary(): { baseUrl: string; configured: boolean } {
    return {
      baseUrl: this.mqttConfig.baseUrl,
      configured: this.isConfigured(),
    };
  }

  async connect(): Promise<void> {
    if (!this.isConfigured()) {
      return;
    }
    if (this.isConnected) {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.mqttStore.setState({
      configured: true,
      connectionState: 'idle',
      lastError: undefined,
    });

    const mqttUrl = this.getMqttUri();
    console.log('[TB-MQTT] connect start', { mqttUrl, keepalive: 20 });

    this.connectPromise = new Promise<void>(async (resolve, reject) => {
      this.connectResolver = () => {
        this.clearConnectWaiters();
        this.connectPromise = undefined;
        resolve();
      };
      this.connectRejector = (error: Error) => {
        this.clearConnectWaiters();
        this.connectPromise = undefined;
        reject(error);
      };

      this.connectTimeout = setTimeout(() => {
        this.rejectPendingConnect(new Error('MQTT connect timeout'));
      }, 30000);

      try {
        const client = await this.getOrCreateClient();
        client.connect();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.rejectPendingConnect(new Error(message));
      }
    });

    return this.connectPromise;
  }

  async disconnect(): Promise<void> {
    this.flushPendingRpcResolvers();
    this.flushPendingAttributesResolvers();
    this.rpcQueue = [];
    this.rpcReplyMeta.clear();
    this.clearConnectWaiters();
    this.coreTopicsSubscribed = false;
    this.isConnected = false;
    this.connectPromise = undefined;
    const client = this.client;
    this.client = undefined;
    if (!client) {
      return;
    }
    client.disconnect();
    MQTT.removeClient(client);
    this.mqttStore.setState({
      configured: this.isConfigured(),
      connectionState: this.isConfigured() ? 'idle' : 'disabled',
    });
  }

  async publishTelemetry(payload: TelemetryPayload): Promise<void> {
    await this.publishJson('v1/devices/me/telemetry', payload, '[TB-MQTT] publish gateway telemetry');
  }

  async publishAttributes(payload: Record<string, unknown>): Promise<void> {
    await this.publishJson('v1/devices/me/attributes', payload, '[TB-MQTT] publish gateway attributes');
    this.setLatestCloudAttributes(payload);
  }

  async publishChildTelemetry(deviceName: string, payload: TelemetryPayload): Promise<void> {
    const body =
      'ts' in payload
        ? { [deviceName]: [payload] }
        : { [deviceName]: [{ ts: Date.now(), values: payload }] };
    await this.publishJson(
      'v1/gateway/telemetry',
      body,
      '[TB-MQTT] publish child telemetry',
    );
  }

  async publishChildAttributes(
    deviceName: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.publishJson(
      'v1/gateway/attributes',
      { [deviceName]: payload },
      '[TB-MQTT] publish child attributes',
    );
    this.setLatestCloudAttributes({ device: deviceName, ...payload });
  }

  async connectChildDevice(deviceName: string, type = 'BLEDevice'): Promise<void> {
    await this.publishJson(
      'v1/gateway/connect',
      { device: deviceName, type },
      '[TB-MQTT] connect child device',
    );
  }

  async disconnectChildDevice(deviceName: string): Promise<void> {
    await this.publishJson(
      'v1/gateway/disconnect',
      { device: deviceName },
      '[TB-MQTT] disconnect child device',
    );
  }

  async fetchAttributes(options?: {
    clientKeys?: string[];
    sharedKeys?: string[];
  }): Promise<ThingsBoardAttributesPayload> {
    if (!this.isConfigured()) {
      console.log('[TB-MQTT] skip fetch attributes because client not configured');
      return {};
    }
    await this.connect();
    const client = this.client;
    if (!client) {
      throw new Error('MQTT client not initialized');
    }

    const requestId = String(++this.attributeRequestId);
    const payload = {
      ...(options?.clientKeys?.length ? { clientKeys: options.clientKeys.join(',') } : {}),
      ...(options?.sharedKeys?.length ? { sharedKeys: options.sharedKeys.join(',') } : {}),
    };
    console.log('[TB-MQTT] fetch attributes', { requestId, payload });

    return new Promise<ThingsBoardAttributesPayload>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingAttributesResolvers.delete(requestId);
        reject(new Error(`MQTT attributes request timeout: ${requestId}`));
      }, 10000);

      this.pendingAttributesResolvers.set(requestId, {
        resolve: (attributesPayload) => {
          clearTimeout(timeout);
          resolve(attributesPayload);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
        timeout,
      });

      client.publish(
        `v1/devices/me/attributes/request/${requestId}`,
        JSON.stringify(payload),
        1,
        false,
      );
    });
  }

  async pollRpc(signal?: AbortSignal): Promise<ThingsBoardRpcRequest | null> {
    if (!this.isConfigured()) {
      return null;
    }

    await this.connect();
    if (this.rpcQueue.length > 0) {
      return this.rpcQueue.shift() ?? null;
    }

    return new Promise<ThingsBoardRpcRequest | null>((resolve) => {
      const resolver: PendingRpcResolver = (rpc) => {
        signal?.removeEventListener('abort', abortHandler);
        resolve(rpc);
      };
      const abortHandler = () => {
        this.pendingRpcResolvers = this.pendingRpcResolvers.filter((item) => item !== resolver);
        resolve(null);
      };
      signal?.addEventListener('abort', abortHandler, { once: true });
      this.pendingRpcResolvers.push(resolver);
    });
  }

  async replyRpc(id: string, payload: Record<string, unknown>): Promise<void> {
    const meta = this.rpcReplyMeta.get(id);
    if (!meta) {
      console.log('[TB-MQTT] reply rpc skipped, metadata missing', { id, payload });
      return;
    }
    this.rpcReplyMeta.delete(id);

    if (meta.source === 'child' && meta.deviceName) {
      await this.publishJson(
        'v1/gateway/rpc',
        {
          device: meta.deviceName,
          id: Number(meta.originalId),
          data: payload,
        },
        '[TB-MQTT] reply child rpc',
      );
      return;
    }

    await this.publishJson(
      `v1/devices/me/rpc/response/${meta.originalId}`,
      payload,
      '[TB-MQTT] reply gateway rpc',
    );
  }

  setLastRpcMethod(method: string): void {
    this.mqttStore.setState({ lastRpcMethod: method, lastSyncAt: Date.now() });
  }

  setLatestGatewayValues(
    packetHex: string,
    values: Record<string, unknown>,
    meta?: { deviceName?: string },
  ): void {
    console.log('[TB-MQTT] update gateway values', { packetHex, values, meta });
    const current = this.mqttStore.getState().latestGatewayValues ?? {};
    const byDevice = this.mqttStore.getState().latestGatewayValuesByDevice ?? {};
    const currentDeviceValues =
      meta?.deviceName && byDevice[meta.deviceName] ? byDevice[meta.deviceName] : {};
    this.mqttStore.setState({
      lastPacketHex: packetHex,
      latestGatewayValues: {
        ...current,
        ...values,
      },
      latestGatewayValuesByDevice:
        meta?.deviceName
          ? {
              ...byDevice,
              [meta.deviceName]: {
                ...currentDeviceValues,
                ...values,
              },
            }
          : byDevice,
      lastSyncAt: Date.now(),
    });
  }

  setError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    console.log('[TB-MQTT] error', message);
    this.mqttStore.setState({
      configured: this.isConfigured(),
      connectionState: this.isConfigured() ? 'error' : 'disabled',
      lastError: { message },
    });
  }

  onAttributesUpdate(listener: (payload: ThingsBoardAttributesPayload) => void): () => void {
    this.attributeListeners.add(listener);
    return () => this.attributeListeners.delete(listener);
  }

  onGatewayAttributesUpdate(listener: (payload: GatewayAttributesUpdate) => void): () => void {
    this.gatewayAttributeListeners.add(listener);
    return () => this.gatewayAttributeListeners.delete(listener);
  }

  onConnected(listener: (payload: MqttConnectionUpdate) => void): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  private async subscribeCoreTopics(): Promise<void> {
    const client = this.client;
    if (!client) {
      throw new Error('MQTT client not initialized');
    }
    if (this.coreTopicsSubscribed) {
      return;
    }
    client.subscribe('v1/devices/me/rpc/request/+', 1);
    client.subscribe('v1/gateway/rpc', 1);
    client.subscribe('v1/gateway/attributes', 1);
    client.subscribe('v1/devices/me/attributes', 1);
    client.subscribe('v1/devices/me/attributes/response/+', 1);
    this.coreTopicsSubscribed = true;
    console.log('[TB-MQTT] subscribed core topics');
  }

  private handleMessage(topic: string, text: string): void {
    console.log('[TB-MQTT] message', { topic, text });
    try {
      if (topic.startsWith('v1/devices/me/rpc/request/')) {
        const originalId = topic.slice('v1/devices/me/rpc/request/'.length);
        const data = JSON.parse(text) as Partial<ThingsBoardRpcRequest>;
        if (!data.method) {
          return;
        }
        const id = `gateway:${originalId}`;
        this.rpcReplyMeta.set(id, { originalId, source: 'gateway' });
        this.enqueueRpc({
          id,
          method: String(data.method),
          params: isRecord(data.params) ? data.params : undefined,
        });
        return;
      }

      if (topic === 'v1/gateway/rpc') {
        const data = JSON.parse(text) as {
          device?: string;
          data?: { id?: number | string; method?: string; params?: Record<string, unknown> };
        };
        if (!data.device || !data.data?.method || data.data.id === undefined) {
          return;
        }
        const originalId = String(data.data.id);
        const id = `child:${data.device}:${originalId}`;
        this.rpcReplyMeta.set(id, {
          originalId,
          deviceName: data.device,
          source: 'child',
        });
        this.enqueueRpc({
          id,
          method: String(data.data.method),
          params: {
            ...(isRecord(data.data.params) ? data.data.params : {}),
            deviceName: data.device,
          },
        });
        return;
      }

      if (topic === 'v1/devices/me/attributes') {
        const data = JSON.parse(text) as Record<string, unknown>;
        const payload = { shared: data };
        this.updateAttributesState(payload);
        return;
      }

      if (topic === 'v1/gateway/attributes') {
        const data = JSON.parse(text) as { device?: string; data?: Record<string, unknown> };
        if (!data.device || !isRecord(data.data)) {
          return;
        }
        for (const listener of this.gatewayAttributeListeners) {
          listener({ device: data.device, data: data.data });
        }
        return;
      }

      if (topic.startsWith('v1/devices/me/attributes/response/')) {
        const requestId = topic.slice('v1/devices/me/attributes/response/'.length);
        const pending = this.pendingAttributesResolvers.get(requestId);
        if (!pending) {
          return;
        }
        this.pendingAttributesResolvers.delete(requestId);
        const data = JSON.parse(text) as ThingsBoardAttributesPayload;
        const payload =
          'client' in data || 'shared' in data
            ? data
            : ({ shared: data } as ThingsBoardAttributesPayload);
        this.updateAttributesState(payload);
        pending.resolve(payload);
      }
    } catch (error) {
      console.log('[TB-MQTT] message parse failed', {
        topic,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private enqueueRpc(rpc: ThingsBoardRpcRequest): void {
    const resolver = this.pendingRpcResolvers.shift();
    if (resolver) {
      resolver(rpc);
      return;
    }
    this.rpcQueue.push(rpc);
  }

  private flushPendingRpcResolvers(): void {
    const resolvers = this.pendingRpcResolvers.splice(0);
    for (const resolve of resolvers) {
      resolve(null);
    }
  }

  private flushPendingAttributesResolvers(): void {
    const pending = Array.from(this.pendingAttributesResolvers.values());
    this.pendingAttributesResolvers.clear();
    for (const item of pending) {
      clearTimeout(item.timeout);
      item.reject(new Error('MQTT attributes request cancelled'));
    }
  }

  private async publishJson(topic: string, payload: unknown, label: string): Promise<void> {
    await this.connect();
    const client = this.client;
    if (!client) {
      throw new Error('MQTT client not initialized');
    }
    const body = JSON.stringify(payload);
    console.log(label, { topic, payload });
    client.publish(topic, body, 1, false);
    this.mqttStore.setState({
      configured: true,
      connectionState: 'connected',
      lastError: undefined,
      lastSyncAt: Date.now(),
    });
  }

  private setLatestCloudAttributes(payload: Record<string, unknown>): void {
    const deviceName = typeof payload.device === 'string' ? payload.device.trim() : '';
    if (deviceName) {
      const { device: _device, ...rest } = payload;
      this.updateAttributesState({ client: payload }, { deviceName, scope: { client: rest } });
      return;
    }
    this.updateAttributesState({ client: payload });
  }

  private getMqttUri(): string {
    if (this.mqttConfig.mqttUrl) {
      return this.mqttConfig.mqttUrl;
    }
    const base = new URL(this.mqttConfig.baseUrl);
    return `mqtt://${base.hostname}:1883`;
  }

  private async getOrCreateClient(): Promise<IMqttClient> {
    if (this.client) {
      return this.client;
    }

    const mqttUri = this.getMqttUri();
    const client = await MQTT.createClient({
      uri: mqttUri,
      clientId: this.mqttClientId,
      keepalive: 20,
      protocolLevel: 4,
      clean: false,
      auth: true,
      user: this.mqttConfig.accessToken,
      pass: '',
      automaticReconnect: true,
      tls: mqttUri.startsWith('mqtts://'),
    });

    client.on('connect', (message: { reconnect: boolean }) => {
      void this.handleConnectEvent(message);
    });
    client.on('closed', (message: string) => {
      this.handleClosedEvent(message);
    });
    client.on('error', (message: string) => {
      this.handleErrorEvent(message);
    });
    client.on('message', (message: { data: string; qos: QoS; retain: boolean; topic: string }) => {
      this.handleMessage(message.topic, message.data);
    });

    this.client = client;
    return client;
  }

  private async handleConnectEvent(message: { reconnect: boolean }): Promise<void> {
    console.log('[TB-MQTT] connected', message);
    this.isConnected = true;
    this.mqttStore.setState({
      configured: true,
      connectionState: 'connected',
      lastError: undefined,
      lastSyncAt: Date.now(),
    });
    try {
      await this.subscribeCoreTopics();
      for (const listener of this.connectionListeners) {
        listener(message);
      }
      this.resolvePendingConnect();
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      this.handleErrorEvent(messageText);
    }
  }

  private handleClosedEvent(message: string): void {
    console.log('[TB-MQTT] connection closed', {
      message,
      mqttUrl: this.getMqttUri(),
      clientId: this.mqttClientId,
    });
    this.isConnected = false;
    this.coreTopicsSubscribed = false;
    if (this.connectPromise) {
      this.rejectPendingConnect(new Error('MQTT connection closed before ready'));
      return;
    }
    this.mqttStore.setState({
      configured: this.isConfigured(),
      connectionState: this.isConfigured() ? 'idle' : 'disabled',
    });
  }

  private handleErrorEvent(message: string): void {
    console.log('[TB-MQTT] error', {
      message,
      mqttUrl: this.getMqttUri(),
      clientId: this.mqttClientId,
    });
    this.isConnected = false;
    this.mqttStore.setState({
      configured: this.isConfigured(),
      connectionState: this.isConfigured() ? 'error' : 'disabled',
      lastError: { message },
    });
    if (this.connectPromise) {
      this.rejectPendingConnect(new Error(message));
    }
  }

  private resolvePendingConnect(): void {
    const resolve = this.connectResolver;
    if (resolve) {
      resolve();
    } else {
      this.clearConnectWaiters();
    }
  }

  private rejectPendingConnect(error: Error): void {
    const reject = this.connectRejector;
    if (reject) {
      reject(error);
      return;
    }
    this.clearConnectWaiters();
  }

  private clearConnectWaiters(): void {
    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout);
      this.connectTimeout = undefined;
    }
    this.connectResolver = undefined;
    this.connectRejector = undefined;
  }

  private maskAccessToken(token: string): string {
    if (!token) {
      return '';
    }
    if (token.length <= 8) {
      return `${token.slice(0, 2)}***`;
    }
    return `${token.slice(0, 4)}***${token.slice(-4)}`;
  }

  private buildStableClientId(): string {
    const base = new URL(this.mqttConfig.baseUrl);
    const host = base.hostname.replace(/[^a-zA-Z0-9]/g, '-');
    const tokenSuffix = this.mqttConfig.accessToken.slice(-6) || 'token';
    return `ble-gateway-${host}-${tokenSuffix}`;
  }

  private updateAttributesState(
    payload: ThingsBoardAttributesPayload,
    meta?: { deviceName?: string; scope?: ThingsBoardAttributesPayload },
  ): void {
    const merged = mergeAttributesPayload(this.mqttStore.getState().latestCloudAttributes, payload);
    const byDevice = this.mqttStore.getState().latestCloudAttributesByDevice ?? {};
    const nextByDevice =
      meta?.deviceName && meta.scope
        ? {
            ...byDevice,
            [meta.deviceName]: mergeAttributesPayload(byDevice[meta.deviceName], meta.scope),
          }
        : byDevice;
    this.mqttStore.setState({
      latestCloudAttributes: merged,
      latestCloudAttributesByDevice: nextByDevice,
      lastCloudStateAt: Date.now(),
      lastSyncAt: Date.now(),
    });
    for (const listener of this.attributeListeners) {
      listener(merged);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeAttributesPayload(
  current: ThingsBoardAttributesPayload | undefined,
  next: ThingsBoardAttributesPayload,
): ThingsBoardAttributesPayload {
  return {
    client: {
      ...(current?.client ?? {}),
      ...(next.client ?? {}),
    },
    shared: {
      ...(current?.shared ?? {}),
      ...(next.shared ?? {}),
    },
  };
}
