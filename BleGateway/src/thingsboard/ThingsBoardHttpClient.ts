import { ThingsBoardStore } from './ThingsBoardStore';
import type {
  ThingsBoardAttributesPayload,
  TelemetryPayload,
  ThingsBoardConfig,
  ThingsBoardRpcRequest,
} from './ThingsBoardTypes';

export class ThingsBoardHttpClient {
  private config: Required<ThingsBoardConfig>;
  private store: ThingsBoardStore;

  static normalizeConfig(config?: ThingsBoardConfig): Required<ThingsBoardConfig> {
    const baseUrl = typeof config?.baseUrl === 'string' ? config.baseUrl.trim() : '';
    const accessToken = typeof config?.accessToken === 'string' ? config.accessToken.trim() : '';
    const mqttUrl = typeof config?.mqttUrl === 'string' ? config.mqttUrl.trim() : '';
    return {
      baseUrl: baseUrl.replace(/\/+$/, ''),
      accessToken,
      rpcTimeoutMs: config?.rpcTimeoutMs ?? 20000,
      mqttUrl,
    };
  }

  constructor(config: ThingsBoardConfig, store: ThingsBoardStore) {
    this.config = ThingsBoardHttpClient.normalizeConfig(config);
    this.store = store;
    const configured = this.config.baseUrl.length > 0 && this.config.accessToken.length > 0;
    this.store.setState({
      configured,
      connectionState: configured ? 'idle' : 'disabled',
    });
    console.log('[TB] client init', {
      configured,
      baseUrl: this.config.baseUrl,
      rpcTimeoutMs: this.config.rpcTimeoutMs,
      accessTokenPreview: this.maskToken(this.config.accessToken),
    });
  }

  isConfigured(): boolean {
    return this.config.baseUrl.length > 0 && this.config.accessToken.length > 0;
  }

  getConfigSummary(): { baseUrl: string; configured: boolean } {
    return {
      baseUrl: this.config.baseUrl,
      configured: this.isConfigured(),
    };
  }

  async publishTelemetry(payload: TelemetryPayload): Promise<void> {
    console.log('[TB] publish telemetry', payload);
    await this.post('telemetry', payload);
    this.markConnected();
  }

  async publishAttributes(payload: Record<string, unknown>): Promise<void> {
    console.log('[TB] publish attributes', payload);
    await this.post('attributes', payload);
    this.markConnected();
  }

  async fetchAttributes(options?: {
    clientKeys?: string[];
    sharedKeys?: string[];
  }): Promise<ThingsBoardAttributesPayload> {
    if (!this.isConfigured()) {
      console.log('[TB] skip fetch attributes because client not configured');
      return {};
    }

    const query = new URLSearchParams();
    if (options?.clientKeys?.length) {
      query.set('clientKeys', options.clientKeys.join(','));
    }
    if (options?.sharedKeys?.length) {
      query.set('sharedKeys', options.sharedKeys.join(','));
    }

    const path = query.size > 0 ? `attributes?${query.toString()}` : 'attributes';
    const url = this.buildUrl(path);
    console.log('[TB] fetch attributes', { path, url });

    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      console.log('[TB] fetch attributes failed', { status: response.status, path });
      throw new Error(`ThingsBoard ${path} failed: ${response.status}`);
    }

    const text = await response.text();
    const payload = text.trim()
      ? (JSON.parse(text) as ThingsBoardAttributesPayload)
      : {};

    console.log('[TB] fetch attributes success', payload);
    this.store.setState({
      latestCloudAttributes: payload,
      lastCloudStateAt: Date.now(),
    });
    this.markConnected();
    return payload;
  }

  async pollRpc(signal?: AbortSignal): Promise<ThingsBoardRpcRequest | null> {
    if (!this.isConfigured()) {
      return null;
    }

    this.store.setState({
      configured: true,
      connectionState: 'polling',
      lastError: undefined,
    });
    console.log('[TB] poll rpc start', {
      timeoutMs: this.config.rpcTimeoutMs,
      url: this.buildUrl(`rpc?timeout=${this.config.rpcTimeoutMs}`),
    });

    const response = await fetch(this.buildUrl(`rpc?timeout=${this.config.rpcTimeoutMs}`), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
    });

    if (!response.ok) {
      console.log('[TB] poll rpc failed', { status: response.status });
      throw new Error(`ThingsBoard RPC poll failed: ${response.status}`);
    }

    this.markConnected();
    const text = await response.text();
    if (!text.trim()) {
      console.log('[TB] poll rpc empty response');
      return null;
    }

    console.log('[TB] poll rpc raw', text);
    const payload = JSON.parse(text) as Partial<ThingsBoardRpcRequest>;
    if (!payload.id || !payload.method) {
      console.log('[TB] poll rpc ignored payload', payload);
      return null;
    }

    console.log('[TB] poll rpc parsed', payload);
    return {
      id: String(payload.id),
      method: String(payload.method),
      params: isRecord(payload.params) ? payload.params : undefined,
    };
  }

  async replyRpc(id: string, payload: Record<string, unknown>): Promise<void> {
    console.log('[TB] reply rpc', { id, payload });
    await this.post(`rpc/${id}`, payload);
    this.markConnected();
  }

  setLastRpcMethod(method: string): void {
    this.store.setState({ lastRpcMethod: method, lastSyncAt: Date.now() });
  }

  setLatestGatewayValues(
    packetHex: string,
    values: Record<string, unknown>,
    meta?: { deviceName?: string },
  ): void {
    console.log('[TB] update gateway values', { packetHex, values, meta });
    const current = this.store.getState().latestGatewayValues ?? {};
    const byDevice = this.store.getState().latestGatewayValuesByDevice ?? {};
    const currentDeviceValues =
      meta?.deviceName && byDevice[meta.deviceName] ? byDevice[meta.deviceName] : {};
    this.store.setState({
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
    console.log('[TB] error', message);
    this.store.setState({
      configured: this.isConfigured(),
      connectionState: this.isConfigured() ? 'error' : 'disabled',
      lastError: { message },
    });
  }

  private async post(path: string, payload: unknown): Promise<void> {
    if (!this.isConfigured()) {
      console.log('[TB] skip post because client not configured', { path });
      return;
    }

    console.log('[TB] http post', {
      path,
      url: this.buildUrl(path),
      payload,
    });
    const response = await fetch(this.buildUrl(path), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.log('[TB] http post failed', {
        path,
        status: response.status,
      });
      throw new Error(`ThingsBoard ${path} failed: ${response.status}`);
    }
    console.log('[TB] http post success', { path, status: response.status });
  }

  private buildUrl(path: string): string {
    return `${this.config.baseUrl}/api/v1/${this.config.accessToken}/${path}`;
  }

  private markConnected(): void {
    console.log('[TB] connection marked connected');
    this.store.setState({
      configured: true,
      connectionState: 'connected',
      lastError: undefined,
      lastSyncAt: Date.now(),
    });
  }

  private maskToken(token: string): string {
    if (!token) {
      return '';
    }
    if (token.length <= 8) {
      return `${token.slice(0, 2)}***`;
    }
    return `${token.slice(0, 4)}***${token.slice(-4)}`;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
