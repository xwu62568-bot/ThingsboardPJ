import type { NotifyPayload } from './BleTypes';

export type ProtocolConfig = {
  mtu?: number;
  maxChunkSize?: number;
  ackTimeoutMs?: number;
  maxRetries?: number;
};

export type Command = {
  opcode: number;
  payload?: number[];
  requireAck?: boolean;
};

export type Frame = {
  seq: number;
  opcode: number;
  payload: number[];
};

type Transport = {
  write: (bytes: number[], withResponse: boolean) => Promise<void>;
  onNotify: (handler: (payload: NotifyPayload) => void) => () => void;
};

const PREAMBLE = 0xaa;
const VERSION = 0x01;

export class Protocol {
  private transport: Transport;
  private seq = 0;
  private pendingAcks = new Map<number, (ok: boolean) => void>();
  private config: Required<ProtocolConfig>;
  private unsubscribe?: () => void;

  constructor(transport: Transport, config?: ProtocolConfig) {
    this.transport = transport;
    this.config = {
      mtu: config?.mtu ?? 23,
      maxChunkSize: config?.maxChunkSize ?? 20,
      ackTimeoutMs: config?.ackTimeoutMs ?? 1500,
      maxRetries: config?.maxRetries ?? 2,
    };
  }

  start(): void {
    this.unsubscribe = this.transport.onNotify((payload) => {
      const frames = decodeFrames(payload.value);
      for (const frame of frames) {
        this.handleFrame(frame);
      }
    });
  }

  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
  }

  async send(command: Command): Promise<void> {
    const seq = this.nextSeq();
    const frame = encodeFrame({
      seq,
      opcode: command.opcode,
      payload: command.payload ?? [],
    });

    const withResponse = command.requireAck ?? false;
    await this.sendWithRetry(frame, withResponse, seq, command.requireAck ?? false);
  }

  private async sendWithRetry(
    frame: number[],
    withResponse: boolean,
    seq: number,
    requireAck: boolean,
  ): Promise<void> {
    let attempt = 0;

    while (true) {
      attempt += 1;
      await this.writeChunked(frame, withResponse);

      if (!requireAck) {
        return;
      }

      const ok = await this.waitForAck(seq);
      if (ok) {
        return;
      }

      if (attempt > this.config.maxRetries) {
        throw new Error('ACK timeout');
      }
    }
  }

  private async writeChunked(bytes: number[], withResponse: boolean): Promise<void> {
    const chunks = chunk(bytes, this.config.maxChunkSize);
    for (const c of chunks) {
      await this.transport.write(c, withResponse);
    }
  }

  private waitForAck(seq: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingAcks.delete(seq);
        resolve(false);
      }, this.config.ackTimeoutMs);

      this.pendingAcks.set(seq, (ok) => {
        clearTimeout(timer);
        this.pendingAcks.delete(seq);
        resolve(ok);
      });
    });
  }

  private handleFrame(frame: Frame): void {
    if (frame.opcode === 0xff) {
      const ackSeq = frame.payload[0] ?? 0;
      const cb = this.pendingAcks.get(ackSeq);
      if (cb) {
        cb(true);
      }
      return;
    }
  }

  private nextSeq(): number {
    this.seq = (this.seq + 1) & 0xff;
    return this.seq;
  }
}

export function encodeFrame(frame: Frame): number[] {
  const payload = frame.payload ?? [];
  const length = payload.length + 2; // opcode + seq
  const header = [PREAMBLE, VERSION, frame.seq, frame.opcode, length & 0xff];
  const body = [...payload];
  const checksum = crc8([...header, ...body]);
  return [...header, ...body, checksum];
}

export function decodeFrames(bytes: number[]): Frame[] {
  const frames: Frame[] = [];
  let i = 0;
  while (i + 5 < bytes.length) {
    if (bytes[i] !== PREAMBLE) {
      i += 1;
      continue;
    }
    const version = bytes[i + 1];
    const seq = bytes[i + 2];
    const opcode = bytes[i + 3];
    const length = bytes[i + 4];
    const payloadLen = length - 2;
    const frameEnd = i + 5 + payloadLen + 1;
    if (version !== VERSION || payloadLen < 0 || frameEnd > bytes.length) {
      i += 1;
      continue;
    }
    const payload = bytes.slice(i + 5, i + 5 + payloadLen);
    const checksum = bytes[frameEnd - 1];
    const raw = bytes.slice(i, frameEnd - 1);
    if (crc8(raw) !== checksum) {
      i += 1;
      continue;
    }
    frames.push({ seq, opcode, payload });
    i = frameEnd;
  }
  return frames;
}

function chunk(bytes: number[], size: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < bytes.length; i += size) {
    out.push(bytes.slice(i, i + size));
  }
  return out;
}

function crc8(bytes: number[]): number {
  let crc = 0x00;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i += 1) {
      if (crc & 0x80) {
        crc = (crc << 1) ^ 0x07;
      } else {
        crc <<= 1;
      }
      crc &= 0xff;
    }
  }
  return crc & 0xff;
}
