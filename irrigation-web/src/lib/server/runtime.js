import {
  connectDevice as tbConnectDevice,
  disconnectDevice as tbDisconnectDevice,
  fetchDeviceDetail,
  fetchDeviceList,
  refreshDevice as tbRefreshDevice,
  runIrrigation as tbRunIrrigation,
  stopIrrigation as tbStopIrrigation,
} from "./thingsboard.js";

function createDevice(seed) {
  return {
    id: seed.id,
    name: seed.name,
    model: seed.model,
    serialNumber: seed.serialNumber,
    rpcTargetName: seed.name,
    rpcGatewayId: undefined,
    rpcGatewayName: undefined,
    platformState: "inactive",
    platformLastActivityAt: 0,
    connectivityState: "disconnected",
    lastSeenAt: Date.now(),
    signalRssi: -71,
    siteCount: seed.siteCount,
    selectedSiteNumber: 1,
    batteryLevel: 84,
    batteryVoltage: 8.8,
    soilMoisture: 32,
    rainSensorWet: false,
    rtcTimestamp: Date.now(),
    lastCommand: undefined,
    sites: Array.from({ length: seed.siteCount }, (_, index) => ({
      siteNumber: index + 1,
      label: `${index + 1} 号路`,
      open: false,
      remainingSeconds: 0,
      openingDurationSeconds: 0,
      manualDurationSeconds: 600,
    })),
  };
}

class MockIrrigationRuntime {
  constructor() {
    this.devices = new Map([
      [
        "wc240bl-demo",
        createDevice({
          id: "wc240bl-demo",
          name: "北区主控器",
          model: "WC240BL",
          serialNumber: "TB-WC240BL-0007",
          siteCount: 4,
        }),
      ],
      [
        "wc120bl-yard",
        createDevice({
          id: "wc120bl-yard",
          name: "样板庭院控制器",
          model: "WC120BL",
          serialNumber: "TB-WC120BL-0012",
          siteCount: 2,
        }),
      ],
    ]);
  }

  async listDevices() {
    return Array.from(this.devices.values()).map((device) => ({
      id: device.id,
      name: device.name,
      model: device.model,
      serialNumber: device.serialNumber,
      platformState: device.platformState,
      platformLastActivityAt: device.platformLastActivityAt,
      connectivityState: device.connectivityState,
      lastSeenAt: device.lastSeenAt,
      selectedSiteNumber: device.selectedSiteNumber,
      siteCount: device.siteCount,
      batteryLevel: device.batteryLevel,
    }));
  }

  async getDefaultDeviceId() {
    return (await this.listDevices())[0]?.id ?? "wc240bl-demo";
  }

  async getDevice(_session, deviceId) {
    const device = this.devices.get(deviceId);
    return device ? structuredClone(device) : null;
  }

  async connectDevice(_session, deviceId) {
    const device = this.mustGet(deviceId);
    device.connectivityState = "connected";
    device.lastSeenAt = Date.now();
    device.platformState = "active";
    device.platformLastActivityAt = Date.now();
    device.lastCommand = {
      kind: "connect",
      result: "success",
      at: Date.now(),
      message: "设备已连接",
    };
    return structuredClone(device);
  }

  async disconnectDevice(_session, deviceId) {
    const device = this.mustGet(deviceId);
    device.connectivityState = "disconnected";
    device.lastCommand = {
      kind: "disconnect",
      result: "success",
      at: Date.now(),
      message: "设备已断开",
    };
    return structuredClone(device);
  }

  async refreshDevice(_session, deviceId) {
    const device = this.mustGet(deviceId);
    device.lastSeenAt = Date.now();
    device.platformLastActivityAt = Date.now();
    device.platformState = "active";
    device.lastCommand = {
      kind: "refresh",
      result: "success",
      at: Date.now(),
      message: "已刷新设备状态",
    };
    return structuredClone(device);
  }

  async runIrrigation(_session, deviceId, siteNumber, durationSeconds) {
    const device = this.mustGet(deviceId);
    const target = device.sites.find((site) => site.siteNumber === siteNumber);
    if (target) {
      target.open = true;
      target.remainingSeconds = durationSeconds;
      target.manualDurationSeconds = durationSeconds;
    }
    device.lastCommand = {
      kind: "run",
      result: "success",
      at: Date.now(),
      message: `已下发 ${siteNumber} 号路开阀命令`,
      siteNumber,
      durationSeconds,
    };
    return structuredClone(device);
  }

  async stopIrrigation(_session, deviceId, siteNumber) {
    const device = this.mustGet(deviceId);
    const target = device.sites.find((site) => site.siteNumber === siteNumber);
    if (target) {
      target.open = false;
      target.remainingSeconds = 0;
    }
    device.lastCommand = {
      kind: "stop",
      result: "success",
      at: Date.now(),
      message: `已下发 ${siteNumber} 号路关阀命令`,
      siteNumber,
    };
    return structuredClone(device);
  }

  mustGet(deviceId) {
    const device = this.devices.get(deviceId);
    if (!device) {
      throw new Error("设备不存在");
    }
    return device;
  }
}

export const irrigationRuntime = {
  mock: new MockIrrigationRuntime(),

  async listDevices(session) {
    if (!session?.tb) {
      return this.mock.listDevices();
    }
    return fetchDeviceList(session);
  },

  async getDefaultDeviceId(session) {
    if (!session?.tb) {
      return this.mock.getDefaultDeviceId();
    }
    return (await fetchDeviceList(session))[0]?.id ?? "wc240bl-demo";
  },

  async getDevice(session, deviceId) {
    if (!session?.tb) {
      return this.mock.getDevice(session, deviceId);
    }
    return fetchDeviceDetail(session, deviceId);
  },

  async connectDevice(session, deviceId) {
    if (!session?.tb) {
      return this.mock.connectDevice(session, deviceId);
    }
    return tbConnectDevice(session, deviceId);
  },

  async disconnectDevice(session, deviceId) {
    if (!session?.tb) {
      return this.mock.disconnectDevice(session, deviceId);
    }
    return tbDisconnectDevice(session, deviceId);
  },

  async refreshDevice(session, deviceId) {
    if (!session?.tb) {
      return this.mock.refreshDevice(session, deviceId);
    }
    return tbRefreshDevice(session, deviceId);
  },

  async runIrrigation(session, deviceId, siteNumber, durationSeconds) {
    if (!session?.tb) {
      return this.mock.runIrrigation(session, deviceId, siteNumber, durationSeconds);
    }
    return tbRunIrrigation(session, deviceId, siteNumber, durationSeconds);
  },

  async stopIrrigation(session, deviceId, siteNumber) {
    if (!session?.tb) {
      return this.mock.stopIrrigation(session, deviceId, siteNumber);
    }
    return tbStopIrrigation(session, deviceId, siteNumber);
  },
};
