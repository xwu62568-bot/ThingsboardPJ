import { Alert } from 'react-native';
import { BleService } from '../ble/BleService';
import { Protocol } from '../ble/Protocol';
import {
  buildManualDurationCommand,
  buildRequestDeviceStateCommand,
  buildRequestTimeAndBatteryCommand,
  buildSiteOnOffCommand,
  bytesToHex,
  decodeIncomingPackets,
} from '../device/CommandCodec';
import { BleStore } from '../state/BleStore';
import type { ThingsBoardGatewayClient } from './ThingsBoardGatewayClient';

export class ThingsBoardBridge {
  private static readonly cloudStatusAttributeKeys = [
    'bleConnectionState',
    'bleConnected',
    'connectionStateText',
    'connectedDeviceId',
    'connectedDeviceName',
    'bleLastError',
    'lastConnectionUpdateTs',
  ];
  private static readonly cloudClientControlAttributeKeys = [
    'targetDeviceName',
    'targetDeviceId',
    'selectedSiteNumber',
    'siteCount',
    'lastAppliedDesiredConnection',
    'lastRpcValveCommand',
    'lastRpcValveSiteNumber',
    'lastRpcManualDurationSeconds',
    'lastRpcTargetDeviceName',
    'lastRpcControlAt',
    'lastControlSource',
    'lastControlAppliedAt',
  ];
  private static readonly cloudSharedControlAttributeKeys = [
    'desiredConnection',
    'manualDurationSeconds',
    'siteNumber',
    'siteCount',
    'channels',
    'targetDeviceName',
  ];
  private static readonly pendingConnectTimeoutMs = 60000;

  private client: ThingsBoardGatewayClient;
  private bleService: BleService;
  private bleStore: BleStore;
  private protocol: Protocol;
  private disposed = false;
  private rpcAbort?: AbortController;
  private bleUnsubscribe?: () => void;
  private notifyUnsubscribe?: () => void;
  private attributesUnsubscribe?: () => void;
  private gatewayAttributesUnsubscribe?: () => void;
  private lastBleSnapshot = '';
  private lastCloudStatusSnapshot = '';
  private lastSharedControlSnapshot = '';
  private lastChildBleSnapshots = new Map<string, string>();
  private lastConnectionUpdateTs = Date.now();
  private pendingNotifyBuffers = new Map<string, number[]>();
  private pendingSendCommands = new Map<
    number,
    {
      type: 'valve' | 'duration';
      deviceName: string;
      siteNumber?: number;
      open?: boolean;
    }
  >();
  private pendingBleConnect?: {
    deviceName?: string;
    deviceId?: string;
    resolve: (device: ReturnType<BleStore['getState']>['devices'][number]) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    inFlight: boolean;
  };
  private connectedChildDevices = new Map<string, string>();
  private deviceContexts = new Map<
    string,
    {
      blePeripheralId?: string;
      selectedSiteNumber: number;
      siteCount: number;
      lastConnectionUpdateTs: number;
    }
  >();

  constructor(
    client: ThingsBoardGatewayClient,
    bleService: BleService,
    bleStore: BleStore,
    protocol: Protocol,
  ) {
    this.client = client;
    this.bleService = bleService;
    this.bleStore = bleStore;
    this.protocol = protocol;
  }

  start(): void {
    if (!this.client.isConfigured() || this.rpcAbort) {
      console.log('[TB-BRIDGE] start skipped', {
        configured: this.client.isConfigured(),
        alreadyRunning: Boolean(this.rpcAbort),
      });
      return;
    }

    this.disposed = false;
    console.log('[TB-BRIDGE] start');
    this.client.connect().catch((error) => this.client.setError(error));
    this.publishBootAttributes().catch((error) => this.client.setError(error));
    this.publishBleState(this.bleStore.getState()).catch((error) => this.client.setError(error));
    this.refreshCloudState().catch((error) => this.client.setError(error));
    this.bleUnsubscribe = this.bleStore.subscribe((state) => {
      this.maybeHandlePendingBleConnect().catch((error) => this.client.setError(error));
      this.publishBleState(state).catch((error) => this.client.setError(error));
    });
    this.attributesUnsubscribe = this.client.onAttributesUpdate((payload) => {
      this.processCloudControlAttributes(payload).catch((error) => this.client.setError(error));
    });
    this.gatewayAttributesUnsubscribe = this.client.onGatewayAttributesUpdate((payload) => {
      this.processGatewayAttributeControl(payload).catch((error) => this.client.setError(error));
    });
    this.notifyUnsubscribe = this.bleService.onNotify((payload) => {
      this.handleNotify(payload.peripheralId, payload.value).catch((error) =>
        this.client.setError(error),
      );
    });
    this.rpcAbort = new AbortController();
    this.pollRpcLoop(this.rpcAbort.signal).catch((error) => this.client.setError(error));
  }

  stop(): void {
    console.log('[TB-BRIDGE] stop');
    this.disposed = true;
    this.rpcAbort?.abort();
    this.rpcAbort = undefined;
    this.clearPendingBleConnect();
    for (const deviceName of this.connectedChildDevices.values()) {
      this.client.disconnectChildDevice(deviceName).catch(() => undefined);
    }
    this.client.disconnect().catch(() => undefined);
    this.bleUnsubscribe?.();
    this.bleUnsubscribe = undefined;
    this.attributesUnsubscribe?.();
    this.attributesUnsubscribe = undefined;
    this.gatewayAttributesUnsubscribe?.();
    this.gatewayAttributesUnsubscribe = undefined;
    this.notifyUnsubscribe?.();
    this.notifyUnsubscribe = undefined;
  }

  requestDeviceSnapshotNow(deviceId?: string): Promise<void> {
    return this.requestDeviceSnapshot(deviceId);
  }

  refreshCloudStateNow(): Promise<void> {
    return this.refreshCloudState();
  }

  private async pollRpcLoop(signal: AbortSignal): Promise<void> {
    console.log('[TB-BRIDGE] rpc loop started');
    while (!this.disposed && !signal.aborted) {
      try {
        const rpc = await this.client.pollRpc(signal);
        if (!rpc) {
          continue;
        }

        const method = rpc.method.trim();
        console.log('[TB-BRIDGE] rpc received', {
          id: rpc.id,
          method,
          params: rpc.params,
        });
        this.client.setLastRpcMethod(method);
        try {
          const result = await this.handleRpc(method, rpc.params ?? {});
          console.log('[TB-BRIDGE] rpc success', {
            id: rpc.id,
            method,
            result,
          });
          await this.client.replyRpc(rpc.id, {
            success: true,
            method,
            ...result,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log('[TB-BRIDGE] rpc failed', {
            id: rpc.id,
            method,
            error: message,
          });
          await this.client.replyRpc(rpc.id, {
            success: false,
            method,
            error: message,
          });
          throw error;
        }
      } catch (error) {
        if (signal.aborted) {
          console.log('[TB-BRIDGE] rpc loop aborted');
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        console.log('[TB-BRIDGE] rpc loop error', message);
        this.client.setError(error);
        await this.replyBestEffortError(message);
        await sleep(1500);
      }
    }
    console.log('[TB-BRIDGE] rpc loop stopped');
  }

  private async handleRpc(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    switch (method) {
      case 'ble_connectDevice':
        return this.handleBleConnect(params);
      case 'ble_disconnectDevice':
        return this.handleBleDisconnect(params);
      case 'openValve':
        return this.handleValvePlaceholder(params);
      case 'ble_requestDeviceState':
        return this.handleRequestDeviceState(params);
      default:
        throw new Error(`Unsupported RPC method: ${method}`);
    }
  }

  private async handleBleConnect(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const deviceName = typeof params.deviceName === 'string' ? params.deviceName.trim() : '';
    console.log('[TB-BRIDGE] handle ble_connectDevice', { deviceName, params });
    if (!deviceName) {
      throw new Error('ble_connectDevice requires params.deviceName');
    }
    const deviceContext = this.getOrCreateDeviceContext(deviceName);
    deviceContext.siteCount = this.resolveDeviceSiteCount(
      deviceName,
      params,
      deviceContext.siteCount,
    );
    deviceContext.selectedSiteNumber =
      this.parseOptionalInt(params.siteNumber, 1, deviceContext.siteCount) ?? 1;

    const ok = await this.bleService.requestPermissions();
    if (!ok) {
      throw new Error('Bluetooth permissions denied');
    }

    const device = await this.resolveDevice(deviceName, deviceContext.blePeripheralId);
    await this.connectToDeviceAndSync(device, deviceName);

    return {
      message: 'connected',
      deviceId: device.id,
      deviceName: device.name ?? deviceName,
      selectedSiteNumber: deviceContext.selectedSiteNumber,
      siteCount: deviceContext.siteCount,
    };
  }

  private async handleBleDisconnect(
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const requestedDeviceName =
      typeof params.deviceName === 'string' ? params.deviceName.trim() : '';
    const activeSession = this.getConnectedDevice(requestedDeviceName || undefined);
    if (!activeSession) {
      throw new Error('No connected BLE device found for disconnect');
    }
    await this.bleService.disconnect(activeSession.deviceId);
    return {
      message: 'disconnected',
      deviceId: activeSession.deviceId,
      deviceName: activeSession.deviceName ?? requestedDeviceName,
    };
  }

  private async handleValvePlaceholder(
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const deviceName = typeof params.deviceName === 'string' ? params.deviceName.trim() : '';
    const stationId =
      typeof params.stationId === 'string'
        ? params.stationId.trim()
        : typeof params.stationId === 'number'
          ? String(params.stationId)
          : '';
    const manualDurationSeconds =
      typeof params.manualDurationSeconds === 'number'
        ? params.manualDurationSeconds
        : typeof params.manualDurationSeconds === 'string'
          ? Number.parseInt(params.manualDurationSeconds, 10)
          : undefined;
    console.log('[TB-BRIDGE] handle openValve', params);
    if (stationId !== '0' && stationId !== '1') {
      throw new Error('openValve requires params.stationId to be "1" or "0"');
    }

    const siteNumber =
      typeof params.siteNumber === 'number'
        ? params.siteNumber
        : typeof params.siteNumber === 'string'
          ? Number.parseInt(params.siteNumber, 10)
          : 1;

    if (!Number.isInteger(siteNumber) || siteNumber < 1 || siteNumber > 8) {
      throw new Error('openValve optional params.siteNumber must be 1-8');
    }

    const targetDeviceName = deviceName || this.resolveSingleConnectedDeviceName();
    const activeDevice = await this.ensureBleDeviceConnected(targetDeviceName || undefined);
    const deviceContext = this.getOrCreateDeviceContext(activeDevice.deviceName);

    const open = stationId === '1';
    deviceContext.selectedSiteNumber = siteNumber;
    deviceContext.siteCount = Math.max(
      this.resolveDeviceSiteCount(activeDevice.deviceName, params, deviceContext.siteCount),
      siteNumber,
    );
    let commandHexes: string[] = [];
    if (open && manualDurationSeconds !== undefined) {
      const durationBytes = buildManualDurationCommand(
        deviceContext.siteCount,
        siteNumber,
        manualDurationSeconds,
      );
      this.pendingSendCommands.set(durationBytes[4] ?? 0, {
        type: 'duration',
        deviceName: activeDevice.deviceName,
        siteNumber,
      });
      console.log('[TB-BRIDGE] valve duration command encoded', {
        siteNumber,
        manualDurationSeconds,
        siteCount: deviceContext.siteCount,
        bytesHex: bytesToHex(durationBytes),
      });
      await this.bleService.write(durationBytes, {
        withResponse: true,
        maxChunkSize: 20,
        deviceId: activeDevice.deviceId,
      });
      console.log('[TB-BRIDGE] valve duration written to ble', {
        deviceName: activeDevice.deviceName,
        siteNumber,
        connectedDeviceId: activeDevice.deviceId,
      });
      commandHexes.push(bytesToHex(durationBytes));
      await sleep(200);
    }

    const onOffBytes = buildSiteOnOffCommand(siteNumber, open);
    this.pendingSendCommands.set(onOffBytes[4] ?? 0, {
      type: 'valve',
      deviceName: activeDevice.deviceName,
      siteNumber,
      open,
    });
    console.log('[TB-BRIDGE] valve command encoded', {
      siteNumber,
      stationId,
      open,
      manualDurationSeconds,
      bytesHex: bytesToHex(onOffBytes),
    });
    await this.bleService.write(onOffBytes, {
      withResponse: true,
      maxChunkSize: 20,
      deviceId: activeDevice.deviceId,
    });
    console.log('[TB-BRIDGE] valve command written to ble', {
      deviceName: activeDevice.deviceName,
      siteNumber,
      stationId,
      connectedDeviceId: activeDevice.deviceId,
    });
    commandHexes.push(bytesToHex(onOffBytes));
    await this.client.publishChildTelemetry(activeDevice.deviceName, {
      ts: Date.now(),
      values: {
        lastValveSiteNumber: siteNumber,
        lastValveCommand: open ? 'open' : 'close',
        lastValveStationId: stationId,
      },
    });
    await this.publishRpcValveControlState({
      deviceName: activeDevice.deviceName,
      siteNumber,
      open,
      manualDurationSeconds,
    });
    setTimeout(() => {
      this.requestDeviceSnapshot(activeDevice.deviceId).catch((error) => this.client.setError(error));
    }, 1200);

    // Keep protocol referenced until the device-side custom frame parser is fully unified.
    void this.protocol;

    return {
      message: open ? 'valve-open-command-sent' : 'valve-close-command-sent',
      siteNumber,
      stationId,
      bytesHex: commandHexes.join(' | '),
    };
  }

  private async handleRequestDeviceState(
    params?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const deviceName =
      params && typeof params.deviceName === 'string' ? params.deviceName.trim() : '';
    const activeDevice = await this.ensureBleDeviceConnected(deviceName || undefined);
    await this.requestDeviceSnapshot(activeDevice.deviceId);
    return {
      message: 'device-state-request-sent',
      deviceName: activeDevice.deviceName,
      selectedSiteNumber: this.getOrCreateDeviceContext(activeDevice.deviceName).selectedSiteNumber,
      siteCount: this.getOrCreateDeviceContext(activeDevice.deviceName).siteCount,
    };
  }

  private async publishBootAttributes(): Promise<void> {
    console.log('[TB-BRIDGE] publish boot attributes');
    await this.client.publishAttributes({
      appMode: 'ble-mqtt-gateway',
      rpcMethods: ['ble_connectDevice', 'ble_disconnectDevice', 'openValve', 'ble_requestDeviceState'],
      sharedControlKeys: [
        'desiredConnection',
        'siteNumber',
        'manualDurationSeconds',
        'targetDeviceName',
        'blePeripheralId',
      ],
      valveControlMode: 'rpc',
      valveControlNotes:
        'Use RPC openValve for immediate manual valve control. Shared attributes are configuration only.',
    });
  }

  private async publishBleState(state: ReturnType<BleStore['getState']>): Promise<void> {
    const snapshot = JSON.stringify({
      connectionState: state.connectionState,
      connectedDeviceId: state.connectedDeviceId,
      deviceCount: state.devices.length,
      error: state.lastError?.message,
      sessions: Object.values(state.sessions).map((session) => ({
        deviceId: session.deviceId,
        connectionState: session.connectionState,
        reconnectAttempts: session.reconnectAttempts,
        error: session.lastError?.message,
      })),
    });

    if (snapshot === this.lastBleSnapshot) {
      return;
    }
    this.lastBleSnapshot = snapshot;
    this.lastConnectionUpdateTs = Date.now();
    console.log('[TB-BRIDGE] publish ble state', snapshot);

    const connectedDevice = state.devices.find((item) => item.id === state.connectedDeviceId);
    const connectedDeviceName = connectedDevice?.name?.trim() || '';
    const statusValues = {
      bleConnectionState: state.connectionState,
      bleConnected: state.connectionState === 'connected',
      connectionStateText: this.getConnectionStateText(state.connectionState, state.lastError?.message),
      connectedDeviceId: state.connectedDeviceId ?? '',
      connectedDeviceName,
      bleLastError: state.lastError?.message ?? '',
      lastConnectionUpdateTs: this.lastConnectionUpdateTs,
    };

    await this.client.publishTelemetry({
      ts: Date.now(),
      values: {
        ...statusValues,
        discoveredDeviceCount: state.devices.length,
      },
    });

    await this.syncCloudBleState(statusValues);
    await this.syncAllChildBleStates(state);

    if (state.connectionState === 'connected') {
      this.requestDeviceSnapshot(state.connectedDeviceId).catch((error) => this.client.setError(error));
    }
  }

  private async connectToDeviceAndSync(
    device: ReturnType<BleStore['getState']>['devices'][number],
    fallbackName: string,
  ): Promise<void> {
    this.bleService.setReconnectTarget({
      deviceId: device.id,
      deviceName: device.name ?? fallbackName,
    });
    await this.bleService.connect(device.id);
    const bleState = this.bleStore.getState();
    console.log('[TB-BRIDGE] post connect ble state', bleState);
    if (bleState.connectionState !== 'connected' || bleState.connectedDeviceId !== device.id) {
      throw new Error(`BLE connect did not reach connected state for ${device.name ?? fallbackName}`);
    }

    const deviceName = device.name ?? fallbackName;
    const deviceContext = this.getOrCreateDeviceContext(deviceName);
    deviceContext.blePeripheralId = device.id;
    deviceContext.lastConnectionUpdateTs = Date.now();
    deviceContext.siteCount = this.resolveDeviceSiteCount(deviceName, undefined, deviceContext.siteCount);
    this.connectedChildDevices.set(device.id, deviceName);
    await this.client.connectChildDevice(deviceName);

    console.log('[TB-BRIDGE] ble device connected', {
      deviceId: device.id,
      deviceName,
    });
    await this.client.publishAttributes({
      targetDeviceName: deviceName,
      targetDeviceId: device.id,
      selectedSiteNumber: deviceContext.selectedSiteNumber,
      siteCount: deviceContext.siteCount,
    });
    await this.syncChildBleState(
      device.id,
      deviceName,
      {
        bleConnectionState: 'connected',
        bleConnected: true,
        connectionStateText: '已连接',
        connectedDeviceId: device.id,
        connectedDeviceName: deviceName,
        bleLastError: '',
        blePeripheralId: device.id,
      },
      'connected',
    );
    await this.requestDeviceSnapshot(device.id);
  }

  private async ensureBleDeviceConnected(
    deviceName?: string,
  ): Promise<{ deviceId: string; deviceName: string }> {
    const connectedSession = this.getConnectedDevice(deviceName);
    if (connectedSession && connectedSession.connectionState === 'connected') {
      const resolvedDeviceName =
        connectedSession.deviceName?.trim() || deviceName || connectedSession.deviceId;
      this.connectedChildDevices.set(connectedSession.deviceId, resolvedDeviceName);
      return {
        deviceId: connectedSession.deviceId,
        deviceName: resolvedDeviceName,
      };
    }

    if (!deviceName) {
      throw new Error('BLE device not connected');
    }

    const device = await this.resolveDevice(
      deviceName,
      this.getOrCreateDeviceContext(deviceName).blePeripheralId,
    );
    await this.connectToDeviceAndSync(device, deviceName);
    return {
      deviceId: device.id,
      deviceName: device.name ?? deviceName,
    };
  }

  private async resolveDevice(deviceName: string, deviceIdHint?: string) {
    let device =
      (deviceIdHint
        ? this.bleStore.getState().devices.find((item) => item.id === deviceIdHint)
        : undefined) ??
      this.bleStore.getState().devices.find((item) => item.name === deviceName);
    if (!device) {
      console.log('[TB-BRIDGE] target device not in cache, scanning', { deviceName, deviceIdHint });
      await this.bleService.startScan([]);
      device = await this.waitForPendingBleConnect(deviceName, deviceIdHint);
    }
    if (!device) {
      throw new Error(`Device not found: ${deviceName}${deviceIdHint ? ` (${deviceIdHint})` : ''}`);
    }
    return device;
  }

  private getConnectedDevice(deviceName?: string) {
    const state = this.bleStore.getState();
    if (deviceName) {
      const context = this.deviceContexts.get(deviceName);
      if (context?.blePeripheralId && state.sessions[context.blePeripheralId]) {
        return state.sessions[context.blePeripheralId];
      }
      const namedSession = Object.values(state.sessions).find(
        (session) =>
          session.connectionState === 'connected' &&
          session.deviceName?.trim() === deviceName,
      );
      if (namedSession) {
        return namedSession;
      }
      const device =
        (context?.blePeripheralId
          ? state.devices.find((item) => item.id === context.blePeripheralId)
          : undefined) ?? state.devices.find((item) => item.name === deviceName);
      if (!device) {
        return undefined;
      }
      return state.sessions[device.id];
    }
    if (state.connectedDeviceId && state.sessions[state.connectedDeviceId]) {
      return state.sessions[state.connectedDeviceId];
    }
    return Object.values(state.sessions).find((session) => session.connectionState === 'connected');
  }

  private waitForPendingBleConnect(deviceName?: string, deviceId?: string) {
    return new Promise<ReturnType<BleStore['getState']>['devices'][number]>((resolve, reject) => {
      this.clearPendingBleConnect();
      const timer = setTimeout(() => {
        if (
          this.pendingBleConnect?.deviceName !== deviceName ||
          this.pendingBleConnect?.deviceId !== deviceId
        ) {
          return;
        }
        console.log('[TB-BRIDGE] wait device timeout', {
          deviceName,
          deviceId,
          timeoutMs: ThingsBoardBridge.pendingConnectTimeoutMs,
        });
        const error = new Error(
          `Device not found: ${deviceName ?? 'unknown'}${deviceId ? ` (${deviceId})` : ''}`,
        );
        this.clearPendingBleConnect();
        reject(error);
      }, ThingsBoardBridge.pendingConnectTimeoutMs);

      this.pendingBleConnect = {
        deviceName,
        deviceId,
        resolve,
        reject,
        timer,
        inFlight: false,
      };

      void this.maybeHandlePendingBleConnect();
    });
  }

  private async maybeHandlePendingBleConnect(): Promise<void> {
    const pending = this.pendingBleConnect;
    if (!pending || pending.inFlight) {
      return;
    }

    const device = this.bleStore.getState().devices.find((item) => {
      if (pending.deviceId && item.id === pending.deviceId) {
        return true;
      }
      if (pending.deviceName && item.name === pending.deviceName) {
        return true;
      }
      return false;
    });
    if (!device) {
      return;
    }

    pending.inFlight = true;
    console.log('[TB-BRIDGE] wait device matched', {
      deviceName: pending.deviceName,
      deviceId: device.id,
    });

    try {
      await this.connectToDeviceAndSync(device, pending.deviceName ?? device.name ?? device.id);
      if (this.pendingBleConnect === pending) {
        this.clearPendingBleConnect();
      }
      pending.resolve(device);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('[TB-BRIDGE] pending connect failed', {
        deviceName: pending.deviceName,
        deviceId: device.id,
        error: message,
      });
      if (this.pendingBleConnect === pending) {
        this.clearPendingBleConnect();
      }
      pending.reject(error instanceof Error ? error : new Error(message));
    }
  }

  private clearPendingBleConnect(): void {
    if (!this.pendingBleConnect) {
      return;
    }
    clearTimeout(this.pendingBleConnect.timer);
    this.pendingBleConnect = undefined;
  }

  private async syncCloudBleState(values: Record<string, unknown>): Promise<void> {
    const snapshot = JSON.stringify(values);
    if (snapshot === this.lastCloudStatusSnapshot) {
      return;
    }

    this.lastCloudStatusSnapshot = snapshot;
    console.log('[TB-BRIDGE] sync cloud ble state', snapshot);
    await this.client.publishAttributes(values);
  }

  private async syncChildBleState(
    deviceId: string,
    deviceName: string,
    values: Record<string, unknown>,
    connectionState: ReturnType<BleStore['getState']>['connectionState'],
  ): Promise<void> {
    if (!deviceName) {
      return;
    }
    const snapshot = JSON.stringify({ deviceName, values });
    if (snapshot === this.lastChildBleSnapshots.get(deviceId)) {
      return;
    }
    this.lastChildBleSnapshots.set(deviceId, snapshot);
    const deviceContext = this.getOrCreateDeviceContext(deviceName);
    deviceContext.lastConnectionUpdateTs = Date.now();
    console.log('[TB-BRIDGE] sync child ble state', { deviceName, values });
    await this.client.publishChildAttributes(deviceName, {
      ...values,
      lastConnectionUpdateTs: deviceContext.lastConnectionUpdateTs,
      blePeripheralId: deviceContext.blePeripheralId ?? deviceId,
    });
    if (connectionState === 'disconnected' || connectionState === 'error' || connectionState === 'idle') {
      await this.client.disconnectChildDevice(deviceName);
      this.connectedChildDevices.delete(deviceId);
    }
  }

  private async syncAllChildBleStates(state: ReturnType<BleStore['getState']>): Promise<void> {
    for (const session of Object.values(state.sessions)) {
      const deviceName = session.deviceName?.trim();
      if (!deviceName) {
        continue;
      }
      await this.syncChildBleState(
        session.deviceId,
        deviceName,
        {
          bleConnectionState: session.connectionState,
          bleConnected: session.connectionState === 'connected',
          connectionStateText: this.getConnectionStateText(
            session.connectionState,
            session.lastError?.message,
          ),
          connectedDeviceId: session.connectionState === 'connected' ? session.deviceId : '',
          connectedDeviceName: session.connectionState === 'connected' ? deviceName : '',
          bleLastError: session.lastError?.message ?? '',
          reconnectAttempts: session.reconnectAttempts,
        },
        session.connectionState,
      );
    }
  }

  private async replyBestEffortError(message: string): Promise<void> {
    console.log('[TB-BRIDGE] publish best-effort error telemetry', { message });
    await this.client.publishTelemetry({
      ts: Date.now(),
      values: {
        tbBridgeError: message,
      },
    }).catch(() => undefined);
  }

  private async refreshCloudState(): Promise<void> {
    console.log('[TB-BRIDGE] refresh cloud state');
    const payload = await this.client.fetchAttributes({
      clientKeys: [
        ...ThingsBoardBridge.cloudStatusAttributeKeys,
        ...ThingsBoardBridge.cloudClientControlAttributeKeys,
      ],
      sharedKeys: ThingsBoardBridge.cloudSharedControlAttributeKeys,
    });
    await this.processCloudControlAttributes(payload);
  }

  private async handleNotify(peripheralId: string, bytes: number[]): Promise<void> {
    console.log('[TB-BRIDGE] notify bytes', { peripheralId, bytesHex: bytesToHex(bytes) });
    const deviceName =
      this.connectedChildDevices.get(peripheralId) ??
      this.bleStore.getState().sessions[peripheralId]?.deviceName?.trim();
    const deviceContext = deviceName ? this.getOrCreateDeviceContext(deviceName) : undefined;
    const packetBytes = this.consumeNotifyPackets(peripheralId, bytes);
    if (packetBytes.length === 0) {
      console.log('[TB-BRIDGE] notify buffered partial packet', { peripheralId });
      return;
    }

    const commandResponses = this.parseCommandResponses(packetBytes);
    for (const response of commandResponses) {
      const meta = this.pendingSendCommands.get(response.messageId);
      if (meta) {
        this.pendingSendCommands.delete(response.messageId);
      }
      console.log('[TB-BRIDGE] command response', {
        peripheralId,
        deviceName: meta?.deviceName ?? deviceName,
        type: meta?.type,
        siteNumber: meta?.siteNumber,
        open: meta?.open,
        messageId: response.messageId,
        status: response.status,
        statusText: this.describeCommandStatus(meta?.type, response.status),
        packetHex: response.packetHex,
      });
      this.maybeAlertCommandFailure(meta?.deviceName ?? deviceName, meta?.type, response.status);
    }

    const packets = decodeIncomingPackets(packetBytes, deviceContext?.selectedSiteNumber ?? 1);
    if (packets.length === 0) {
      if (commandResponses.length === 0) {
        console.log('[TB-BRIDGE] notify no known telemetry parsed');
      }
      return;
    }

    for (const packet of packets) {
      const values = {
        ...packet.telemetry,
        selectedSiteNumber: deviceContext?.selectedSiteNumber ?? 1,
      };
      this.client.setLatestGatewayValues(packet.packetHex, values, { deviceName });
      console.log('[TB-BRIDGE] publish parsed device telemetry', values);
      await this.client.publishTelemetry({
        ts: Date.now(),
        values,
      });
      if (!deviceName) {
        continue;
      }
      await this.client.publishChildTelemetry(deviceName, {
        ts: Date.now(),
        values,
      });
    }
  }

  private consumeNotifyPackets(peripheralId: string, bytes: number[]): number[] {
    const buffered = this.pendingNotifyBuffers.get(peripheralId) ?? [];
    const merged = [...buffered, ...bytes];
    const complete: number[] = [];
    let offset = 0;

    while (offset < merged.length) {
      while (offset < merged.length && merged[offset] !== 0x7b) {
        offset += 1;
      }
      if (offset + 4 > merged.length) {
        break;
      }

      const packetLength = ((merged[offset + 2] ?? 0) << 8) | (merged[offset + 3] ?? 0);
      if (packetLength < 7) {
        offset += 1;
        continue;
      }
      if (offset + packetLength > merged.length) {
        break;
      }

      complete.push(...merged.slice(offset, offset + packetLength));
      offset += packetLength;
    }

    const remainder = merged.slice(offset);
    if (remainder.length > 0) {
      this.pendingNotifyBuffers.set(peripheralId, remainder);
    } else {
      this.pendingNotifyBuffers.delete(peripheralId);
    }

    return complete;
  }

  private parseCommandResponses(bytes: number[]): Array<{
    messageId: number;
    status: number;
    packetHex: string;
  }> {
    const responses: Array<{ messageId: number; status: number; packetHex: string }> = [];
    let offset = 0;
    while (offset + 8 <= bytes.length) {
      if (bytes[offset] !== 0x7b || bytes[offset + 1] !== 0xca) {
        offset += 1;
        continue;
      }
      const packetLength = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
      if (packetLength < 8 || offset + packetLength > bytes.length) {
        break;
      }
      if (packetLength === 8) {
        responses.push({
          messageId: bytes[offset + 4] ?? 0,
          status: bytes[offset + 5] ?? 0,
          packetHex: bytesToHex(bytes.slice(offset, offset + packetLength)),
        });
      }
      offset += packetLength;
    }
    return responses;
  }

  private describeCommandStatus(type: 'valve' | 'duration' | undefined, status: number): string {
    if (type === 'valve') {
      switch (status) {
        case 0:
          return 'success';
        case 1:
          return 'failed';
        case 2:
          return 'duplicate-operation';
        case 3:
          return 'battery-empty';
        case 4:
          return 'no-valve-attached';
        case 5:
          return 'battery-low';
        default:
          return `unknown-${status}`;
      }
    }
    if (type === 'duration') {
      switch (status) {
        case 0:
          return 'success';
        case 1:
          return 'battery-low';
        default:
          return `unknown-${status}`;
      }
    }
    return `status-${status}`;
  }

  private maybeAlertCommandFailure(
    deviceName: string | undefined,
    type: 'valve' | 'duration' | undefined,
    status: number,
  ): void {
    const title = deviceName ? `${deviceName} 操作失败` : '设备操作失败';
    let message: string | undefined;

    if (type === 'valve') {
      switch (status) {
        case 1:
          message = '开关阀失败。';
          break;
        case 2:
          message = '重复操作，设备当前状态未变化。';
          break;
        case 3:
          message = '电量耗尽，设备拒绝执行开阀。';
          break;
        case 4:
          message = '未接阀，设备拒绝执行开阀。';
          break;
        case 5:
          message = '电量低，设备拒绝执行开阀。';
          break;
        default:
          break;
      }
    } else if (type === 'duration') {
      if (status === 1) {
        message = '电量低，手动时长设置失败。';
      }
    }

    if (!message) {
      return;
    }
    Alert.alert(title, message);
  }

  private async requestDeviceSnapshot(deviceId?: string): Promise<void> {
    const connectedDeviceId = deviceId ?? this.bleStore.getState().connectedDeviceId;
    if (!connectedDeviceId) {
      console.log('[TB-BRIDGE] skip request snapshot because no connected device');
      return;
    }

    const deviceName =
      this.connectedChildDevices.get(connectedDeviceId) ??
      this.bleStore.getState().sessions[connectedDeviceId]?.deviceName?.trim();
    const deviceContext = deviceName ? this.getOrCreateDeviceContext(deviceName) : undefined;

    const stateBytes = buildRequestDeviceStateCommand(deviceContext?.siteCount ?? 1);
    const timeBatteryBytes = buildRequestTimeAndBatteryCommand();
    console.log('[TB-BRIDGE] request device snapshot', {
      siteCount: deviceContext?.siteCount ?? 1,
      selectedSiteNumber: deviceContext?.selectedSiteNumber ?? 1,
      stateBytesHex: bytesToHex(stateBytes),
      timeBatteryBytesHex: bytesToHex(timeBatteryBytes),
      deviceId: connectedDeviceId,
      deviceName,
    });
    await this.bleService.write(stateBytes, {
      withResponse: true,
      maxChunkSize: 20,
      deviceId: connectedDeviceId,
    });
    await sleep(200);
    await this.bleService.write(timeBatteryBytes, {
      withResponse: true,
      maxChunkSize: 20,
      deviceId: connectedDeviceId,
    });
  }

  private parseOptionalInt(
    value: unknown,
    min: number,
    max: number,
  ): number | undefined {
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number.parseInt(value, 10)
          : undefined;
    if (!parsed || !Number.isInteger(parsed)) {
      return undefined;
    }
    if (parsed < min || parsed > max) {
      return undefined;
    }
    return parsed;
  }

  private getConnectionStateText(
    connectionState: ReturnType<BleStore['getState']>['connectionState'],
    errorMessage?: string,
  ): string {
    if (connectionState === 'connected') {
      return '已连接';
    }
    if (connectionState === 'connecting' || connectionState === 'reconnecting') {
      return '连接中';
    }
    if (connectionState === 'error') {
      return errorMessage ? `连接失败: ${errorMessage}` : '连接失败';
    }
    return '未连接';
  }

  private async processCloudControlAttributes(payload: {
    client?: Record<string, unknown>;
    shared?: Record<string, unknown>;
  }): Promise<void> {
    const client = payload.client ?? {};
    const shared = payload.shared ?? {};
    const sharedSnapshot = JSON.stringify(shared);
    if (sharedSnapshot !== this.lastSharedControlSnapshot) {
      this.lastSharedControlSnapshot = sharedSnapshot;
      console.log('[TB-BRIDGE] shared control changed', shared);
    }

    const desiredConnection = this.parseDesiredBoolean(shared.desiredConnection);
    const lastAppliedDesiredConnection = this.parseDesiredBoolean(client.lastAppliedDesiredConnection);
    if (desiredConnection !== undefined && desiredConnection !== lastAppliedDesiredConnection) {
      await this.applyDesiredConnection(desiredConnection, payload);
    }
  }

  private async applyDesiredConnection(
    desiredConnection: boolean,
    payload: {
      client?: Record<string, unknown>;
      shared?: Record<string, unknown>;
    },
  ): Promise<void> {
    const targetDeviceName = this.resolveCloudTargetDeviceName(payload);
    console.log('[TB-BRIDGE] apply desiredConnection', {
      desiredConnection,
      targetDeviceName,
    });

    if (desiredConnection) {
      if (!targetDeviceName) {
        console.log('[TB-BRIDGE] skip desiredConnection because target device is unknown');
        return;
      }
      await this.ensureBleDeviceConnected(targetDeviceName);
    } else {
      const activeSession = this.getConnectedDevice(targetDeviceName);
      await this.bleService.disconnect(activeSession?.deviceId);
    }

    await this.client.publishAttributes({
      lastAppliedDesiredConnection: desiredConnection,
      lastControlAppliedAt: Date.now(),
    });
  }

  private resolveCloudTargetDeviceName(payload: {
    client?: Record<string, unknown>;
    shared?: Record<string, unknown>;
  }): string | undefined {
    const sharedTarget =
      typeof payload.shared?.targetDeviceName === 'string'
        ? payload.shared.targetDeviceName.trim()
        : '';
    if (sharedTarget) {
      return sharedTarget;
    }

    const clientTarget =
      typeof payload.client?.targetDeviceName === 'string'
        ? payload.client.targetDeviceName.trim()
        : '';
    if (clientTarget) {
      return clientTarget;
    }

    const connectedSession = this.getConnectedDevice();
    const sessionTarget = connectedSession?.deviceName?.trim();
    return sessionTarget || undefined;
  }

  private resolveCloudSiteNumber(payload: {
    client?: Record<string, unknown>;
    shared?: Record<string, unknown>;
  }): number {
    return (
      this.parseOptionalInt(payload.shared?.siteNumber, 1, 8) ??
      this.parseOptionalInt(payload.client?.selectedSiteNumber, 1, 8) ??
      1
    );
  }

  private parseDesiredBoolean(value: unknown): boolean | undefined {
    if (value === true || value === 'true' || value === 1 || value === '1' || value === 'open') {
      return true;
    }
    if (
      value === false ||
      value === 'false' ||
      value === 0 ||
      value === '0' ||
      value === 'close'
    ) {
      return false;
    }
    return undefined;
  }

  private async processGatewayAttributeControl(payload: {
    device: string;
    data: Record<string, unknown>;
  }): Promise<void> {
    const deviceName = payload.device.trim();
    if (!deviceName) {
      return;
    }
    console.log('[TB-BRIDGE] gateway attribute control', payload);
    const deviceContext = this.getOrCreateDeviceContext(deviceName);
    const blePeripheralId = this.parsePeripheralIdentifier(payload.data);
    if (blePeripheralId) {
      deviceContext.blePeripheralId = blePeripheralId;
    }

    const explicitSiteNumber =
      this.parseOptionalInt(payload.data.siteNumber, 1, 8) ??
      this.parseOptionalInt(payload.data.selectedSiteNumber, 1, 8);
    deviceContext.siteCount = this.resolveDeviceSiteCount(deviceName, payload.data, deviceContext.siteCount);
    if (explicitSiteNumber) {
      deviceContext.selectedSiteNumber = explicitSiteNumber;
      deviceContext.siteCount = Math.max(deviceContext.siteCount, explicitSiteNumber);
    }

    const desiredConnection = this.parseDesiredBoolean(payload.data.desiredConnection);
    if (desiredConnection !== undefined) {
      await this.applyGatewayDesiredConnection(deviceName, desiredConnection);
    }

    const manualDurationSeconds =
      this.parseOptionalInt(payload.data.manualDurationSeconds, 1, 0xffff) ?? undefined;
    if (manualDurationSeconds !== undefined) {
      await this.client.publishAttributes({
        manualDurationSeconds,
        lastControlAppliedAt: Date.now(),
      });
      await this.client.publishChildAttributes(deviceName, {
        manualDurationSeconds,
        blePeripheralId: deviceContext.blePeripheralId ?? '',
      });
    }
  }

  private async publishRpcValveControlState(params: {
    deviceName: string;
    siteNumber: number;
    open: boolean;
    manualDurationSeconds?: number;
  }): Promise<void> {
    const now = Date.now();
    const values = {
      lastRpcValveCommand: params.open ? 'open' : 'close',
      lastRpcValveSiteNumber: params.siteNumber,
      ...(params.manualDurationSeconds !== undefined
        ? { lastRpcManualDurationSeconds: params.manualDurationSeconds }
        : {}),
      lastRpcTargetDeviceName: params.deviceName,
      lastRpcControlAt: now,
      lastControlSource: 'rpc',
      lastControlAppliedAt: now,
    };
    await this.client.publishAttributes(values);
    await this.client.publishChildAttributes(params.deviceName, values);
  }

  private async applyGatewayDesiredConnection(
    deviceName: string,
    desiredConnection: boolean,
  ): Promise<void> {
    console.log('[TB-BRIDGE] apply gateway desiredConnection', {
      deviceName,
      desiredConnection,
      blePeripheralId: this.getOrCreateDeviceContext(deviceName).blePeripheralId,
    });
    if (desiredConnection) {
      await this.ensureBleDeviceConnected(deviceName);
    } else {
      const activeSession = this.getConnectedDevice(deviceName);
      await this.bleService.disconnect(activeSession?.deviceId);
    }
    await this.client.publishChildAttributes(deviceName, {
      lastAppliedDesiredConnection: desiredConnection,
      lastControlAppliedAt: Date.now(),
      blePeripheralId: this.getOrCreateDeviceContext(deviceName).blePeripheralId ?? '',
    });
  }

  private getOrCreateDeviceContext(deviceName: string) {
    const existing = this.deviceContexts.get(deviceName);
    if (existing) {
      return existing;
    }
    const created = {
      blePeripheralId: undefined as string | undefined,
      selectedSiteNumber: 1,
      siteCount: this.inferSiteCountFromDeviceName(deviceName),
      lastConnectionUpdateTs: Date.now(),
    };
    this.deviceContexts.set(deviceName, created);
    return created;
  }

  private resolveDeviceSiteCount(
    deviceName: string,
    values?: Record<string, unknown>,
    fallback?: number,
  ): number {
    const explicitSiteCount =
      this.parseOptionalInt(values?.siteCount, 1, 8) ??
      this.parseOptionalInt(values?.channels, 1, 8);
    if (explicitSiteCount) {
      return explicitSiteCount;
    }

    const current = fallback ?? this.deviceContexts.get(deviceName)?.siteCount;
    if (current && current > 1) {
      return current;
    }

    return this.inferSiteCountFromDeviceName(deviceName);
  }

  private inferSiteCountFromDeviceName(deviceName: string): number {
    const normalized = deviceName.trim().toUpperCase();
    if (!normalized) {
      return 1;
    }
    const modelMatch = normalized.match(/WC(\d+)/);
    const secondDigit = modelMatch?.[1]?.[1];
    if (secondDigit) {
      const parsed = Number.parseInt(secondDigit, 10);
      if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 8) {
        return parsed;
      }
    }
    return 1;
  }

  private resolveSingleConnectedDeviceName(): string | undefined {
    const connected = Object.values(this.bleStore.getState().sessions).find(
      (session) => session.connectionState === 'connected' && session.deviceName?.trim(),
    );
    return connected?.deviceName?.trim() || undefined;
  }

  private parsePeripheralIdentifier(data: Record<string, unknown>): string | undefined {
    const candidates = [
      data.blePeripheralId,
      data.peripheralId,
      data.bleMacAddress,
      data.macAddress,
      data.targetDeviceId,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }
    return undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
