import type {
  BleState,
  BleDevice,
  ConnectionState,
  BleErrorCode,
  BleSession,
} from '../ble/BleTypes';

type Listener = (state: BleState) => void;

const defaultState: BleState = {
  connectionState: 'idle',
  devices: [],
  sessions: {},
};

export class BleStore {
  private state: BleState = defaultState;
  private listeners = new Set<Listener>();

  getState(): BleState {
    return this.state;
  }

  setState(partial: Partial<BleState>): void {
    this.state = { ...this.state, ...partial };
    this.emit();
  }

  addOrUpdateDevice(device: BleDevice): void {
    const existing = this.state.devices.find((d) => d.id === device.id);
    const devices = existing
      ? this.state.devices.map((d) => (d.id === device.id ? { ...d, ...device } : d))
      : [...this.state.devices, device];

    const currentSession = this.state.sessions[device.id];
    const sessions = currentSession
      ? {
          ...this.state.sessions,
          [device.id]: {
            ...currentSession,
            deviceName: device.name ?? currentSession.deviceName,
          },
        }
      : this.state.sessions;

    this.setState({ devices, sessions });
  }

  clearDevices(): void {
    this.setState({ devices: [] });
  }

  resetRuntimeState(): void {
    this.state = { ...defaultState };
    this.emit();
  }

  updateSession(
    deviceId: string,
    partial: Partial<BleSession>,
    options?: {
      makeActive?: boolean;
      clearIfMissing?: boolean;
    },
  ): void {
    const existing = this.state.sessions[deviceId];
    if (!existing && options?.clearIfMissing) {
      return;
    }
    const fallbackDevice = this.state.devices.find((device) => device.id === deviceId);
    const nextSession: BleSession = {
      ...existing,
      deviceId,
      deviceName: fallbackDevice?.name ?? existing?.deviceName,
      connectionState: existing?.connectionState ?? 'idle',
      reconnectAttempts: existing?.reconnectAttempts ?? 0,
      ...partial,
    };

    const sessions = {
      ...this.state.sessions,
      [deviceId]: nextSession,
    };

    const activeDeviceId = options?.makeActive
      ? deviceId
      : this.state.connectedDeviceId === deviceId || !this.state.connectedDeviceId
        ? this.choosePreferredActiveDeviceId(sessions, this.state.connectedDeviceId)
        : this.choosePreferredActiveDeviceId(sessions, this.state.connectedDeviceId);

    const aggregate = this.computeAggregateState(
      sessions,
      activeDeviceId,
      this.state.connectionState === 'scanning',
    );

    this.setState({
      sessions,
      connectedDeviceId: aggregate.connectedDeviceId,
      connectionState: aggregate.connectionState,
      lastError: aggregate.lastError,
    });
  }

  clearSession(deviceId: string): void {
    if (!this.state.sessions[deviceId]) {
      return;
    }
    const sessions = { ...this.state.sessions };
    delete sessions[deviceId];
    const aggregate = this.computeAggregateState(
      sessions,
      this.choosePreferredActiveDeviceId(sessions, this.state.connectedDeviceId),
      this.state.connectionState === 'scanning',
    );
    this.setState({
      sessions,
      connectedDeviceId: aggregate.connectedDeviceId,
      connectionState: aggregate.connectionState,
      lastError: aggregate.lastError,
    });
  }

  setScanning(scanning: boolean): void {
    const aggregate = this.computeAggregateState(
      this.state.sessions,
      this.choosePreferredActiveDeviceId(this.state.sessions, this.state.connectedDeviceId),
      scanning,
    );
    this.setState({
      connectionState: aggregate.connectionState,
      connectedDeviceId: aggregate.connectedDeviceId,
      lastError: aggregate.lastError,
    });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  private choosePreferredActiveDeviceId(
    sessions: Record<string, BleSession>,
    preferredDeviceId?: string,
  ): string | undefined {
    if (
      preferredDeviceId &&
      sessions[preferredDeviceId] &&
      ['connected', 'connecting', 'reconnecting'].includes(sessions[preferredDeviceId].connectionState)
    ) {
      return preferredDeviceId;
    }

    const connected = Object.values(sessions).find((session) => session.connectionState === 'connected');
    if (connected) {
      return connected.deviceId;
    }

    const connecting = Object.values(sessions).find((session) =>
      ['connecting', 'reconnecting'].includes(session.connectionState),
    );
    return connecting?.deviceId;
  }

  private computeAggregateState(
    sessions: Record<string, BleSession>,
    activeDeviceId: string | undefined,
    scanning: boolean,
  ): {
    connectionState: ConnectionState;
    connectedDeviceId?: string;
    lastError?: { code: BleErrorCode; message: string };
  } {
    if (scanning) {
      return {
        connectionState: 'scanning',
        connectedDeviceId: activeDeviceId,
      };
    }

    const activeSession = activeDeviceId ? sessions[activeDeviceId] : undefined;
    if (activeSession) {
      if (activeSession.connectionState === 'connected') {
        return {
          connectionState: 'connected',
          connectedDeviceId: activeSession.deviceId,
          lastError: activeSession.lastError,
        };
      }
      return {
        connectionState: activeSession.connectionState,
        connectedDeviceId: activeDeviceId,
        lastError: activeSession.lastError,
      };
    }

    const connected = Object.values(sessions).find((session) => session.connectionState === 'connected');
    if (connected) {
      return {
        connectionState: 'connected',
        connectedDeviceId: connected.deviceId,
        lastError: connected.lastError,
      };
    }

    const reconnecting = Object.values(sessions).find((session) =>
      ['reconnecting', 'connecting'].includes(session.connectionState),
    );
    if (reconnecting) {
      return {
        connectionState: reconnecting.connectionState,
        connectedDeviceId: reconnecting.deviceId,
        lastError: reconnecting.lastError,
      };
    }

    const errorSession = Object.values(sessions).find((session) => session.lastError);
    if (errorSession?.lastError) {
      return {
        connectionState: errorSession.connectionState,
        connectedDeviceId: errorSession.deviceId,
        lastError: errorSession.lastError,
      };
    }

    return {
      connectionState: 'idle',
      connectedDeviceId: undefined,
      lastError: undefined,
    };
  }
}
