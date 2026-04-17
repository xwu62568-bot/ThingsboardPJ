const SITE_ON_OFF = { key: 0x01, keyId: 0x01, len: 1 } as const;
const MANUAL_TIME = { key: 0x02, keyId: 0x01, len: 2 } as const;
const SITE_ON_OFF_STATE = { key: 0x03, keyId: 0x01, len: 1 } as const;
const SITE_REMAINING_TIME = { key: 0x03, keyId: 0x03 } as const;
const SITE_TOTAL_TIME = { key: 0x03, keyId: 0x04 } as const;
const BATTERY = { key: 0x03, keyId: 0x05, len: 1 } as const;
const SYNC_TIME = { key: 0x03, keyId: 0x06, len: 4 } as const;
const SOIL_SENSOR_STATE = { key: 0x03, keyId: 0x08, len: 1 } as const;
const WIRED_RAIN_SENSOR_STATE = { key: 0x03, keyId: 0x09, len: 1 } as const;
const SEND_HEAD = [0x7b, 0xca] as const;
const REQUEST_HEAD = [0x7b, 0xcb] as const;

export type GatewayDeviceTelemetry = Record<string, unknown>;

export function buildSiteOnOffCommand(siteNumber: number, onOff: boolean): number[] {
  if (siteNumber < 1 || siteNumber > 8) {
    throw new Error(`Invalid site number: ${siteNumber}`);
  }

  const siteOnOff = onOff ? 1 << (siteNumber - 1) : 0;
  const command = commandToByteArray(SITE_ON_OFF, siteOnOff);
  const messageId = nextMessageId();
  const bytes = packSendCommand(messageId, command);
  console.log('[CMD] build siteOnOff', {
    siteNumber,
    onOff,
    siteMask: siteOnOff,
    messageId,
    commandHex: bytesToHex(command),
    packetHex: bytesToHex(bytes),
  });
  return bytes;
}

function buildManualDurationPayload(
  siteCount: number,
  siteNumber: number,
  durationSeconds: number,
): number[] {
  const normalizedSiteCount = normalizeSiteCount(siteCount);
  const normalizedSiteNumber = normalizeSiteNumber(siteNumber, normalizedSiteCount);
  if (!Number.isInteger(durationSeconds) || durationSeconds < 0 || durationSeconds > 0xffff) {
    throw new Error(`Invalid manual duration: ${durationSeconds}`);
  }

  const durations = Array.from({ length: normalizedSiteCount }, () => 0);
  durations[normalizedSiteNumber - 1] = durationSeconds;
  const encodedDurations = [...durations].reverse();
  const payload = commandToByteArray(
    { ...MANUAL_TIME, len: normalizedSiteCount * 2 },
    encodedDurations,
  );
  console.log('[CMD] build manualDuration payload', {
    siteCount: normalizedSiteCount,
    siteNumber: normalizedSiteNumber,
    durationSeconds,
    durationsBySite: durations,
    encodedDurations,
    commandHex: bytesToHex(payload),
  });
  return payload;
}

export function buildManualDurationCommand(
  siteCount: number,
  siteNumber: number,
  durationSeconds: number,
): number[] {
  const command = buildManualDurationPayload(siteCount, siteNumber, durationSeconds);
  const messageId = nextMessageId();
  const bytes = packSendCommand(messageId, command);
  console.log('[CMD] build manualDuration', {
    siteCount: normalizeSiteCount(siteCount),
    siteNumber: normalizeSiteNumber(siteNumber, siteCount),
    durationSeconds,
    messageId,
    commandHex: bytesToHex(command),
    packetHex: bytesToHex(bytes),
  });
  return bytes;
}

export function buildValveControlCommand(
  siteNumber: number,
  onOff: boolean,
  options?: { siteCount?: number; manualDurationSeconds?: number },
): number[] {
  if (siteNumber < 1 || siteNumber > 8) {
    throw new Error(`Invalid site number: ${siteNumber}`);
  }

  const payload: number[] = [];
  const siteCount = Math.max(options?.siteCount ?? siteNumber, siteNumber);
  if (onOff && options?.manualDurationSeconds !== undefined) {
    payload.push(
      ...buildManualDurationPayload(siteCount, siteNumber, options.manualDurationSeconds),
    );
  }

  const siteOnOff = onOff ? 1 << (siteNumber - 1) : 0;
  payload.push(...commandToByteArray(SITE_ON_OFF, siteOnOff));

  const messageId = nextMessageId();
  const bytes = packSendCommand(messageId, payload);
  console.log('[CMD] build valveControl', {
    siteNumber,
    onOff,
    siteCount,
    manualDurationSeconds: options?.manualDurationSeconds,
    siteMask: siteOnOff,
    messageId,
    commandHex: bytesToHex(payload),
    packetHex: bytesToHex(bytes),
  });
  return bytes;
}

export function bytesToHex(bytes: number[]): string {
  return bytes
    .map((byte) => {
      const hex = byte.toString(16);
      return hex.length === 1 ? `0${hex}` : hex;
    })
    .join(' ');
}

export function buildRequestDeviceStateCommand(siteCount: number): number[] {
  const normalizedSiteCount = normalizeSiteCount(siteCount);
  const command = [
    ...parseKlv(SITE_ON_OFF_STATE.key, SITE_ON_OFF_STATE.keyId, SITE_ON_OFF_STATE.len),
    ...parseKlv(SOIL_SENSOR_STATE.key, SOIL_SENSOR_STATE.keyId, SOIL_SENSOR_STATE.len),
    ...parseKlv(
      WIRED_RAIN_SENSOR_STATE.key,
      WIRED_RAIN_SENSOR_STATE.keyId,
      WIRED_RAIN_SENSOR_STATE.len,
    ),
    ...parseKlv(SITE_REMAINING_TIME.key, SITE_REMAINING_TIME.keyId, normalizedSiteCount * 2),
    ...parseKlv(SITE_TOTAL_TIME.key, SITE_TOTAL_TIME.keyId, normalizedSiteCount * 2),
  ];
  const packet = packRequestCommand(nextMessageId(), command);
  console.log('[CMD] build requestDeviceState', {
    siteCount: normalizedSiteCount,
    commandHex: bytesToHex(command),
    packetHex: bytesToHex(packet),
  });
  return packet;
}

export function buildRequestTimeAndBatteryCommand(): number[] {
  const command = [
    ...parseKlv(BATTERY.key, BATTERY.keyId, BATTERY.len),
    ...parseKlv(SYNC_TIME.key, SYNC_TIME.keyId, SYNC_TIME.len),
  ];
  const packet = packRequestCommand(nextMessageId(), command);
  console.log('[CMD] build requestTimeAndBattery', {
    commandHex: bytesToHex(command),
    packetHex: bytesToHex(packet),
  });
  return packet;
}

export function decodeIncomingPackets(
  bytes: number[],
  selectedSiteNumber: number,
): Array<{ packetHex: string; telemetry: GatewayDeviceTelemetry }> {
  const packets: Array<{ packetHex: string; telemetry: GatewayDeviceTelemetry }> = [];
  let offset = 0;

  while (offset + 7 <= bytes.length) {
    if (bytes[offset] !== 0x7b) {
      offset += 1;
      continue;
    }

    const packetLength = readUint16(bytes, offset + 2);
    if (!packetLength || offset + packetLength > bytes.length) {
      break;
    }

    const packet = bytes.slice(offset, offset + packetLength);
    offset += packetLength;
    if (!verifyPacket(packet)) {
      console.log('[CMD] skip invalid packet', { packetHex: bytesToHex(packet) });
      continue;
    }

    const body = packet.slice(5, packet.length - 2);
    const telemetry = decodePayload(body, selectedSiteNumber);
    if (Object.keys(telemetry).length === 0) {
      continue;
    }

    packets.push({
      packetHex: bytesToHex(packet),
      telemetry,
    });
  }

  return packets;
}

function parseKlv(key: number, keyId: number, len: number): number[] {
  const klv = (key << 12) | (keyId << 6) | len;
  return bufferUint16(klv & 0xffff);
}

function commandToByteArray(
  command: { key: number; keyId: number; len: number },
  value: number | number[],
): number[] {
  const byteArray = parseKlv(command.key, command.keyId, command.len);
  if (command.key === MANUAL_TIME.key && command.keyId === MANUAL_TIME.keyId) {
    if (!Array.isArray(value)) {
      throw new Error('Manual time command requires per-site durations');
    }
    for (const duration of value) {
      byteArray.push(...bufferUint16(duration));
    }
    return byteArray;
  }

  if (command.len !== 1 || Array.isArray(value)) {
    throw new Error(`Unsupported command length: ${command.len}`);
  }
  byteArray.push(...bufferUint8(value));
  return byteArray;
}

function packSendCommand(messageId: number, command: number[]): number[] {
  return packCommand(SEND_HEAD, messageId, command);
}

function packRequestCommand(messageId: number, command: number[]): number[] {
  return packCommand(REQUEST_HEAD, messageId, command);
}

function packCommand(head: readonly number[], messageId: number, command: number[]): number[] {
  const byteArray: number[] = [];
  const len = bufferUint16(2 + 2 + 1 + command.length + 2);
  const msgId = bufferUint8(messageId);

  byteArray.push(...head);
  byteArray.push(...len);
  byteArray.push(...msgId);
  byteArray.push(...command);

  const crc = bufferUint16(calculateCrc(byteArray, byteArray.length));
  byteArray.push(crc[1], crc[0]);
  console.log('[CMD] pack command', {
    head: bytesToHex(Array.from(head)),
    messageId,
    payloadLength: command.length,
    crc: bytesToHex([crc[1], crc[0]]),
  });
  return byteArray;
}

function bufferUint8(value: number): number[] {
  const uint8Array = new Uint8Array(1);
  const dv = new DataView(uint8Array.buffer, 0);
  dv.setUint8(0, value);
  return Array.from(uint8Array);
}

function bufferUint16(value: number): number[] {
  const uint8Array = new Uint8Array(2);
  const dv = new DataView(uint8Array.buffer, 0);
  dv.setUint16(0, value);
  return Array.from(uint8Array);
}

function calculateCrc(byteArray: number[], len: number): number {
  let crc = 0xffff;
  for (let n = 0; n < len; n += 1) {
    crc ^= byteArray[n] ?? 0;
    for (let i = 0; i < 8; i += 1) {
      const tt = crc & 1;
      crc >>= 1;
      crc &= 0x7fff;
      if (tt === 1) {
        crc ^= 0xa001;
      }
      crc &= 0xffff;
    }
  }
  return crc;
}

function nextMessageId(): number {
  const globalState = globalThis as typeof globalThis & { __bleMessageId?: number };
  if (!globalState.__bleMessageId || globalState.__bleMessageId >= 255) {
    globalState.__bleMessageId = 1;
  } else {
    globalState.__bleMessageId += 1;
  }
  return globalState.__bleMessageId;
}

function decodePayload(bytes: number[], selectedSiteNumber: number): GatewayDeviceTelemetry {
  const telemetry: GatewayDeviceTelemetry = {};
  let offset = 0;

  while (offset + 2 <= bytes.length) {
    const descriptor = parseKlvBytes(bytes[offset], bytes[offset + 1]);
    offset += 2;
    const valueBytes = bytes.slice(offset, offset + descriptor.len);
    if (valueBytes.length < descriptor.len) {
      break;
    }
    offset += descriptor.len;

    const key = `${descriptor.key}:${descriptor.keyId}`;
    console.log('[CMD] decode klv', {
      key,
      len: descriptor.len,
      valueHex: bytesToHex(valueBytes),
    });
    switch (key) {
      case '3:1': {
        const raw = valueBytes[0] ?? 0;
        telemetry.siteOnOffStateRaw = raw;
        telemetry.valveOpen = (raw & (1 << (selectedSiteNumber - 1))) !== 0;
        for (let siteNumber = 1; siteNumber <= 8; siteNumber += 1) {
          telemetry[`station${siteNumber}Open`] = (raw & (1 << (siteNumber - 1))) !== 0;
        }
        break;
      }
      case '3:3': {
        const bySite = parseSiteDurations(valueBytes);
        telemetry.remainingDurationBySite = bySite;
        telemetry.remainingDuration =
          bySite[`site${normalizeSiteNumber(selectedSiteNumber, Object.keys(bySite).length)}`] ?? 0;
        for (const [siteKey, seconds] of Object.entries(bySite)) {
          const siteNumber = Number(siteKey.replace('site', ''));
          if (Number.isInteger(siteNumber) && siteNumber > 0) {
            telemetry[`station${siteNumber}RemainingSeconds`] = seconds;
          }
        }
        break;
      }
      case '3:4': {
        const bySite = parseSiteDurations(valueBytes);
        telemetry.openingDurationBySite = bySite;
        telemetry.openingDuration =
          bySite[`site${normalizeSiteNumber(selectedSiteNumber, Object.keys(bySite).length)}`] ?? 0;
        for (const [siteKey, seconds] of Object.entries(bySite)) {
          const siteNumber = Number(siteKey.replace('site', ''));
          if (Number.isInteger(siteNumber) && siteNumber > 0) {
            telemetry[`station${siteNumber}OpeningDurationSeconds`] = seconds;
          }
        }
        break;
      }
      case '3:5': {
        const raw = valueBytes[0] ?? 0;
        const batteryVoltage = raw / 10;
        telemetry.batteryVoltage = batteryVoltage;
        telemetry.batteryLevel = toBatteryLevel(batteryVoltage);
        break;
      }
      case '3:6':
        telemetry.rtcTimestamp = readUint32(valueBytes, 0);
        break;
      case '3:8':
        telemetry.soilMoisture = valueBytes[0] ?? 0;
        break;
      case '3:9':
        telemetry.rainSensorWet = (valueBytes[0] ?? 0) === 1;
        break;
      default:
        break;
    }
  }

  return telemetry;
}

function parseKlvBytes(byteHigh: number | undefined, byteLow: number | undefined) {
  const high = byteHigh ?? 0;
  const low = byteLow ?? 0;
  return {
    key: (high >> 4) & 0x0f,
    keyId: ((high & 0x0f) << 2) | ((low >> 6) & 0x03),
    len: low & 0x3f,
  };
}

function parseSiteDurations(valueBytes: number[]): Record<string, number> {
  const siteCount = Math.floor(valueBytes.length / 2);
  const result: Record<string, number> = {};
  for (let index = 0; index < siteCount; index += 1) {
    const siteNumber = siteCount - index;
    result[`site${siteNumber}`] = readUint16(valueBytes, index * 2);
  }
  return result;
}

function verifyPacket(packet: number[]): boolean {
  if (packet.length < 7) {
    return false;
  }
  const bodyWithoutCrc = packet.slice(0, packet.length - 2);
  const expected = calculateCrc(bodyWithoutCrc, bodyWithoutCrc.length);
  const actual = ((packet[packet.length - 1] ?? 0) << 8) | (packet[packet.length - 2] ?? 0);
  return expected === actual;
}

function readUint16(bytes: number[], offset: number): number {
  const buffer = new Uint8Array(2);
  buffer[0] = bytes[offset] ?? 0;
  buffer[1] = bytes[offset + 1] ?? 0;
  return new DataView(buffer.buffer).getUint16(0);
}

function readUint32(bytes: number[], offset: number): number {
  const buffer = new Uint8Array(4);
  buffer[0] = bytes[offset] ?? 0;
  buffer[1] = bytes[offset + 1] ?? 0;
  buffer[2] = bytes[offset + 2] ?? 0;
  buffer[3] = bytes[offset + 3] ?? 0;
  return new DataView(buffer.buffer).getUint32(0);
}

function toBatteryLevel(voltage: number): number {
  const normalized = ((voltage - 7.3) / (9.3 - 7.3)) * 100;
  return Math.max(0, Math.min(100, Math.round(normalized)));
}

function normalizeSiteCount(siteCount: number): number {
  if (!Number.isInteger(siteCount) || siteCount < 1) {
    return 1;
  }
  return Math.min(siteCount, 8);
}

function normalizeSiteNumber(siteNumber: number, siteCount: number): number {
  const count = normalizeSiteCount(siteCount);
  if (!Number.isInteger(siteNumber) || siteNumber < 1) {
    return 1;
  }
  return Math.min(siteNumber, count);
}
