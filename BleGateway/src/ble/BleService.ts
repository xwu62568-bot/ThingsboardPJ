import { PermissionsAndroid, Platform } from 'react-native';
import type { Permission, PermissionStatus } from 'react-native';
import BleManager, { BleScanCallbackType } from 'react-native-ble-manager';
import { BleStore } from '../state/BleStore';
import type {
  BleDevice,
  BleServiceOptions,
  GattSpec,
  NotifyPayload,
  WriteOptions,
} from './BleTypes';

export class BleService {
  private store: BleStore;
  private gatt: GattSpec;
  private options: {
    scanTimeoutSeconds: number;
    reconnect: {
      enabled: boolean;
      baseDelayMs: number;
      maxDelayMs: number;
      maxAttempts: number;
    };
  };
  private subscriptions: Array<() => void> = [];
  private shouldReconnect = true;
  private reconnectDisabledDevices = new Set<string>();
  private reconnectAttemptsByDevice = new Map<string, number>();
  private reconnectTimersByDevice = new Map<string, ReturnType<typeof setTimeout>>();
  private reconnectTarget?: {
    deviceId?: string;
    deviceName?: string;
  };
  private scanLoopEnabled = false;
  private lastScanServiceUUIDs?: string[];
  private scanRestartTimer?: ReturnType<typeof setTimeout>;

  constructor(store: BleStore, gatt: GattSpec, options?: BleServiceOptions) {
    this.store = store;
    this.gatt = gatt;
    this.options = {
      scanTimeoutSeconds: options?.scanTimeoutSeconds ?? 5,
      reconnect: {
        enabled: options?.reconnect?.enabled ?? true,
        baseDelayMs: options?.reconnect?.baseDelayMs ?? 800,
        maxDelayMs: options?.reconnect?.maxDelayMs ?? 8000,
        maxAttempts: options?.reconnect?.maxAttempts ?? 5,
      },
    };
  }

  async init(): Promise<void> {
    this.resetRuntimeState();
    this.attachListeners();
    try {
      await BleManager.start({ showAlert: false });
      console.log('[BLE] manager started');
    } catch (error) {
      console.log('[BLE] manager start error', String(error));
    }
    BleManager.checkState();
  }

  destroy(): void {
    this.scanLoopEnabled = false;
    if (this.scanRestartTimer) {
      clearTimeout(this.scanRestartTimer);
      this.scanRestartTimer = undefined;
    }
    for (const unsub of this.subscriptions) {
      unsub();
    }
    this.subscriptions = [];
    this.clearReconnect();
  }

  async requestPermissions(): Promise<boolean> {
    if (Platform.OS !== 'android') {
      return true;
    }

    const permissions: Permission[] = [];
    if (Platform.Version < 31) {
      permissions.push(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
    } else {
      permissions.push(
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      );
    }

    const results = (await PermissionsAndroid.requestMultiple(permissions)) as Record<
      string,
      PermissionStatus
    >;
    console.log('[BLE] android permissions', results);
    const granted = permissions.every(
      (p) => results[p] === PermissionsAndroid.RESULTS.GRANTED,
    );

    if (!granted) {
      const denied = permissions.filter(
        (p) => results[p] !== PermissionsAndroid.RESULTS.GRANTED,
      );
      this.store.setState({
        connectionState: 'error',
        lastError: {
          code: 'permission-denied',
          message: `Bluetooth denied: ${denied.join(', ')}`,
        },
      });
    }

    return granted;
  }

  async startScan(serviceUUIDs?: string[]): Promise<void> {
    this.scanLoopEnabled = true;
    this.lastScanServiceUUIDs = serviceUUIDs?.length ? serviceUUIDs : undefined;
    if (this.scanRestartTimer) {
      clearTimeout(this.scanRestartTimer);
      this.scanRestartTimer = undefined;
    }
    await this.runScanCycle(true);
  }

  private async runScanCycle(resetDevices: boolean): Promise<void> {
    const scanUUIDs = this.lastScanServiceUUIDs;
    console.log('[BLE] start scan', {
      serviceUUIDs: scanUUIDs,
      seconds: this.options.scanTimeoutSeconds,
      polling: this.scanLoopEnabled,
    });
    if (resetDevices) {
      this.store.clearDevices();
    }
    this.store.setScanning(true);

    try {
      await BleManager.scan({
        ...(scanUUIDs?.length ? { serviceUUIDs: scanUUIDs } : {}),
        seconds: this.options.scanTimeoutSeconds,
        allowDuplicates: false,
        callbackType: BleScanCallbackType.AllMatches,
      });
      console.log('[BLE] scan started');
    } catch (error) {
      console.log('[BLE] scan error', String(error));
      this.store.setState({
        connectionState: 'error',
        lastError: { code: 'scan-failed', message: String(error) },
      });
    }
  }

  async stopScan(): Promise<void> {
    this.scanLoopEnabled = false;
    if (this.scanRestartTimer) {
      clearTimeout(this.scanRestartTimer);
      this.scanRestartTimer = undefined;
    }
    console.log('[BLE] stop scan');
    await BleManager.stopScan();
  }

  async connect(deviceId: string): Promise<void> {
    this.store.updateSession(
      deviceId,
      { connectionState: 'connecting', lastError: undefined },
      { makeActive: true },
    );
    this.clearReconnect(deviceId);
    let stage: 'connect' | 'retrieveServices' | 'startNotification' = 'connect';

    try {
      console.log('[BLE] connect start', {
        deviceId,
        notifyServiceUUID: this.gatt.notifyServiceUUID,
        notifyCharacteristicUUID: this.gatt.notifyCharacteristicUUID,
        writeWithResponseServiceUUID: this.gatt.writeWithResponseServiceUUID,
        writeWithResponseCharacteristicUUID: this.gatt.writeWithResponseCharacteristicUUID,
        readServiceUUID: this.gatt.readServiceUUID,
        readCharacteristicUUID: this.gatt.readCharacteristicUUID,
        deviceInfoUuid: this.gatt.deviceInfoUuid,
        versionUUID: this.gatt.versionUUID,
      });
      await BleManager.connect(deviceId, { autoconnect: false });
      console.log('[BLE] native connect ok', { deviceId });
      stage = 'retrieveServices';
      const services = await BleManager.retrieveServices(deviceId);
      console.log('[BLE] retrieve services', services);
      stage = 'startNotification';
      await BleManager.startNotification(
        deviceId,
        this.gatt.notifyServiceUUID,
        this.gatt.notifyCharacteristicUUID,
      );
      console.log('[BLE] notification started', {
        deviceId,
        notifyServiceUUID: this.gatt.notifyServiceUUID,
        notifyCharacteristicUUID: this.gatt.notifyCharacteristicUUID,
      });

      this.reconnectDisabledDevices.delete(deviceId);
      this.reconnectAttemptsByDevice.set(deviceId, 0);
      this.store.updateSession(deviceId, {
        connectionState: 'connected',
        lastError: undefined,
        reconnectAttempts: 0,
        lastConnectedAt: Date.now(),
      }, {
        makeActive: true,
      });
      console.log('[BLE] connect success', {
        deviceId,
        state: this.store.getState(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('[BLE] connect failed', {
        deviceId,
        stage,
        error: message,
      });
      this.store.updateSession(deviceId, {
        connectionState: 'error',
        lastError: { code: 'connect-failed', message },
      });
      this.scheduleReconnect(deviceId);
    }
  }

  async disconnect(deviceId?: string): Promise<void> {
    const id = deviceId ?? this.store.getState().connectedDeviceId;
    if (!id) {
      return;
    }
    try {
      await BleManager.stopScan();
    } catch {
      // ignore when scanning is not active
    }
    this.store.setScanning(false);
    this.updateReconnectPreference(false, id);
    this.clearReconnect(id);
    if (!deviceId || this.reconnectTarget?.deviceId === id) {
      this.setReconnectTarget(undefined);
    }
    await BleManager.disconnect(id);
    this.store.updateSession(id, {
      connectionState: 'disconnected',
      lastError: undefined,
      reconnectAttempts: 0,
    });
  }

  async write(bytes: number[], options?: WriteOptions): Promise<void> {
    const id = options?.deviceId ?? this.store.getState().connectedDeviceId;
    if (!id) {
      throw new Error('No connected device');
    }

    const withResponse = options?.withResponse ?? true;
    const maxChunkSize = options?.maxChunkSize ?? 20;

    const chunks = chunk(bytes, maxChunkSize);
    for (const c of chunks) {
      if (withResponse) {
        console.log('[BLE] write with response', {
          deviceId: id,
          serviceUUID: this.gatt.writeWithResponseServiceUUID,
          characteristicUUID: this.gatt.writeWithResponseCharacteristicUUID,
          bytes: c,
        });
        await BleManager.write(
          id,
          this.gatt.writeWithResponseServiceUUID,
          this.gatt.writeWithResponseCharacteristicUUID,
          c,
        );
      } else {
        console.log('[BLE] write without response', {
          deviceId: id,
          serviceUUID: this.gatt.writeWithResponseServiceUUID,
          characteristicUUID: this.gatt.writeWithResponseCharacteristicUUID,
          bytes: c,
        });
        await BleManager.writeWithoutResponse(
          id,
          this.gatt.writeWithResponseServiceUUID,
          this.gatt.writeWithResponseCharacteristicUUID,
          c,
        );
      }
    }
  }

  onNotify(handler: (payload: NotifyPayload) => void): () => void {
    const sub = BleManager.onDidUpdateValueForCharacteristic(
      (payload: {
        peripheral?: string;
        peripheralId?: string;
        serviceUUID: string;
        characteristicUUID: string;
        value: number[];
      }) =>
        handler({
          peripheralId: payload.peripheralId ?? payload.peripheral ?? '',
          serviceUUID: payload.serviceUUID,
          characteristicUUID: payload.characteristicUUID,
          value: payload.value,
        }),
    );
    const unsubscribe = () => sub.remove();
    this.subscriptions.push(unsubscribe);
    return unsubscribe;
  }

  setReconnectEnabled(enabled: boolean): void {
    this.options.reconnect.enabled = enabled;
  }

  setShouldReconnect(enabled: boolean): void {
    this.shouldReconnect = enabled;
  }

  setShouldReconnectForDevice(deviceId: string, enabled: boolean): void {
    this.updateReconnectPreference(enabled, deviceId);
  }

  setReconnectTarget(target?: { deviceId?: string; deviceName?: string | null }): void {
    const deviceId = target?.deviceId?.trim();
    const deviceName = target?.deviceName?.trim();
    this.reconnectTarget = deviceId || deviceName ? { deviceId, deviceName } : undefined;
    if (deviceId) {
      this.reconnectDisabledDevices.delete(deviceId);
    }
    console.log('[BLE] reconnect target updated', this.reconnectTarget ?? { cleared: true });
  }

  private attachListeners(): void {
    const state = BleManager.onDidUpdateState((payload: { state?: string }) => {
      console.log('[BLE] state', payload);
      if (payload?.state && payload.state !== 'on' && payload.state !== 'poweredOn') {
        this.store.setState({
          connectionState: 'error',
          lastError: { code: 'ble-off', message: `Bluetooth state: ${payload.state}` },
        });
      }
    });

    const discover = BleManager.onDiscoverPeripheral((device: BleDevice) => {
      const name = typeof device.name === 'string' ? device.name.trim() : '';
      if (!name || !name.toUpperCase().startsWith('WC')) {
        return;
      }

      console.log('[BLE] discovered', {
        id: device.id,
        name,
        rssi: device.rssi,
      });
      this.store.addOrUpdateDevice({ ...device, name });
    });

    const stopScan = BleManager.onStopScan(() => {
      console.log('[BLE] scan stopped');
      this.store.setScanning(false);
      if (!this.scanLoopEnabled) {
        return;
      }
      this.scanRestartTimer = setTimeout(() => {
        this.scanRestartTimer = undefined;
        void this.runScanCycle(false);
      }, 600);
    });

    const disconnect = BleManager.onDisconnectPeripheral((payload: { peripheral: string }) => {
      const id = payload.peripheral;
      console.log('[BLE] disconnect event', {
        payload,
        previousState: this.store.getState(),
      });
      this.store.updateSession(id, {
        connectionState: 'disconnected',
        lastError: undefined,
      });
      this.scheduleReconnect(id);
    });

    this.subscriptions.push(() => state.remove());
    this.subscriptions.push(() => discover.remove());
    this.subscriptions.push(() => stopScan.remove());
    this.subscriptions.push(() => disconnect.remove());
  }

  private scheduleReconnect(deviceId: string): void {
    if (
      !this.shouldReconnect ||
      !this.options.reconnect.enabled ||
      this.reconnectDisabledDevices.has(deviceId) ||
      !this.isReconnectTarget(deviceId)
    ) {
      console.log('[BLE] reconnect skipped', {
        deviceId,
        shouldReconnect: this.shouldReconnect,
        reconnectEnabled: this.options.reconnect.enabled,
        reconnectDisabledForDevice: this.reconnectDisabledDevices.has(deviceId),
        reconnectTarget: this.reconnectTarget,
        reconnectAllowedForDevice: this.isReconnectTarget(deviceId),
      });
      return;
    }

    const reconnectAttempts = this.reconnectAttemptsByDevice.get(deviceId) ?? 0;
    if (reconnectAttempts >= this.options.reconnect.maxAttempts) {
      console.log('[BLE] reconnect limit reached', {
        deviceId,
        reconnectAttempts,
        maxAttempts: this.options.reconnect.maxAttempts,
      });
      return;
    }

    const nextAttempts = reconnectAttempts + 1;
    this.reconnectAttemptsByDevice.set(deviceId, nextAttempts);
    const delay = Math.min(
      this.options.reconnect.baseDelayMs * 2 ** (nextAttempts - 1),
      this.options.reconnect.maxDelayMs,
    );

    this.store.updateSession(deviceId, {
      connectionState: 'reconnecting',
      reconnectAttempts: nextAttempts,
    }, {
      makeActive: this.store.getState().connectedDeviceId === deviceId,
    });
    this.clearReconnect(deviceId);
    console.log('[BLE] reconnect scheduled', {
      deviceId,
      reconnectAttempts: nextAttempts,
      delay,
    });
    const timer = setTimeout(() => {
      this.connect(deviceId).catch(() => undefined);
    }, delay);
    this.reconnectTimersByDevice.set(deviceId, timer);
  }

  private clearReconnect(deviceId?: string): void {
    if (deviceId) {
      const timer = this.reconnectTimersByDevice.get(deviceId);
      if (timer) {
        clearTimeout(timer);
        this.reconnectTimersByDevice.delete(deviceId);
      }
      return;
    }

    for (const [id, timer] of this.reconnectTimersByDevice.entries()) {
      clearTimeout(timer);
      this.reconnectTimersByDevice.delete(id);
    }
  }

  private updateReconnectPreference(enabled: boolean, deviceId?: string): void {
    if (!deviceId) {
      this.shouldReconnect = enabled;
      return;
    }
    if (!enabled) {
      this.reconnectDisabledDevices.add(deviceId);
      this.reconnectAttemptsByDevice.delete(deviceId);
      return;
    }
    this.reconnectDisabledDevices.delete(deviceId);
  }

  private resetRuntimeState(): void {
    this.clearReconnect();
    this.reconnectDisabledDevices.clear();
    this.reconnectAttemptsByDevice.clear();
    this.reconnectTarget = undefined;
    this.store.resetRuntimeState();
  }

  private isReconnectTarget(deviceId: string): boolean {
    if (!this.reconnectTarget) {
      return false;
    }
    if (this.reconnectTarget.deviceId && this.reconnectTarget.deviceId === deviceId) {
      return true;
    }
    if (!this.reconnectTarget.deviceName) {
      return false;
    }
    const state = this.store.getState();
    const deviceName =
      state.sessions[deviceId]?.deviceName?.trim() ??
      state.devices.find((device) => device.id === deviceId)?.name?.trim();
    return Boolean(deviceName && deviceName === this.reconnectTarget.deviceName);
  }
}

function chunk(bytes: number[], size: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < bytes.length; i += size) {
    out.push(bytes.slice(i, i + size));
  }
  return out;
}
