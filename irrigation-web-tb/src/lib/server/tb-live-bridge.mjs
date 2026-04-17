import WebSocket from "ws";
import { getTbWsSubscriptionKeyLists } from "./thingsboard.js";

/**
 * BFF 上游连接 ThingsBoard `ws(s)://host/api/ws`，订阅遥测与属性；
 * 仅在收到带 subscriptionId 的推送时回调（经防抖合并突发帧）。
 */
export function createTbLiveBridge({ baseUrl, token, getDeviceIds, onChange }) {
  let upstream;
  let debounceTimer;

  function tbWsUrl() {
    const u = new URL(baseUrl);
    const wsProto = u.protocol === "https:" ? "wss:" : "ws:";
    return `${wsProto}//${u.host}/api/ws`;
  }

  function debouncedOnChange() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      try {
        onChange();
      } catch {
        // ignore
      }
    }, 280);
  }

  function shouldTriggerDownstream(parsed) {
    if (parsed == null) {
      return false;
    }
    if (Array.isArray(parsed)) {
      return parsed.some(shouldTriggerDownstream);
    }
    if (typeof parsed === "object" && typeof parsed.subscriptionId === "number") {
      return true;
    }
    return false;
  }

  function buildSubscriptionMessage(deviceIds) {
    const lists = getTbWsSubscriptionKeyLists();
    const cmds = [];
    let cmdId = 1;
    const now = Date.now();
    const weekMs = 7 * 24 * 60 * 60 * 1000;

    for (const entityId of deviceIds) {
      if (typeof entityId !== "string" || !entityId.trim()) {
        continue;
      }
      cmds.push({
        type: "TIMESERIES",
        cmdId: cmdId++,
        entityType: "DEVICE",
        entityId: entityId.trim(),
        keys: lists.telemetry,
        scope: "LATEST_TELEMETRY",
        startTs: now - weekMs,
        timeWindow: weekMs,
        interval: 0,
        limit: 200,
        agg: "NONE",
      });
      cmds.push({
        type: "ATTRIBUTES",
        cmdId: cmdId++,
        entityType: "DEVICE",
        entityId: entityId.trim(),
        keys: lists.clientKeys,
        scope: "CLIENT_SCOPE",
      });
      cmds.push({
        type: "ATTRIBUTES",
        cmdId: cmdId++,
        entityType: "DEVICE",
        entityId: entityId.trim(),
        keys: lists.sharedKeys,
        scope: "SHARED_SCOPE",
      });
    }

    return JSON.stringify({
      authCmd: { cmdId: 0, token },
      cmds,
    });
  }

  function stop() {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
    if (upstream) {
      try {
        upstream.removeAllListeners();
        upstream.close();
      } catch {
        // ignore
      }
      upstream = undefined;
    }
  }

  function start() {
    stop();
    const ids = (getDeviceIds?.() ?? []).filter((id) => typeof id === "string" && id.trim().length > 0);
    if (!token || !baseUrl || ids.length === 0) {
      return;
    }

    const url = tbWsUrl();
    const ws = new WebSocket(url);
    upstream = ws;

    ws.on("open", () => {
      const body = buildSubscriptionMessage(ids);
      const parsed = JSON.parse(body);
      if (!parsed.cmds?.length) {
        ws.close();
        return;
      }
      ws.send(body);
    });

    ws.on("message", (data) => {
      try {
        const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
        const parsed = JSON.parse(text);
        if (shouldTriggerDownstream(parsed)) {
          debouncedOnChange();
        }
      } catch {
        // ignore non-JSON frames
      }
    });

    ws.on("error", (err) => {
      if (process.env.TB_SERVER_DEBUG === "1") {
        console.warn("[tb-live-bridge] upstream ws error", err?.message ?? err);
      }
    });
  }

  return {
    start,
    stop,
    restart() {
      stop();
      start();
    },
  };
}
