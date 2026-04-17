import { createServer } from "node:http";
import next from "next";
import { WebSocketServer } from "ws";
import { decodeSession, getSessionFromCookieHeader, SESSION_COOKIE } from "./src/lib/server/session-token.js";
import { irrigationRuntime } from "./src/lib/server/runtime.js";
import { createTbLiveBridge } from "./src/lib/server/tb-live-bridge.mjs";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = Number(process.env.PORT || 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

await app.prepare();
const handleUpgrade = app.getUpgradeHandler();

const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (ws, request, session) => {
  let subscribedDeviceIds = [];

  const sendPulse = async (type = "device.updated") => {
    if (ws.readyState !== 1) {
      return;
    }
    const devices = await irrigationRuntime.listDevices(session);
    const activeDeviceId = subscribedDeviceIds[0];
    const activeDevice =
      activeDeviceId ? await irrigationRuntime.getDevice(session, activeDeviceId) : null;
    ws.send(
      JSON.stringify({
        type,
        deviceIds: subscribedDeviceIds,
        devices,
        activeDeviceId,
        activeDevice,
      }),
    );
  };

  const tbBridge =
    session?.tb?.token && session?.tb?.baseUrl
      ? createTbLiveBridge({
          baseUrl: session.tb.baseUrl,
          token: session.tb.token,
          getDeviceIds: () => subscribedDeviceIds,
          onChange: () => void sendPulse("device.updated"),
        })
      : null;

  ws.on("message", async (message) => {
    try {
      const payload = JSON.parse(String(message));
      if (Array.isArray(payload.deviceIds)) {
        subscribedDeviceIds = payload.deviceIds.filter((value) => typeof value === "string");
      }
      await sendPulse("session.ready");
      tbBridge?.restart();
    } catch {
      ws.send(JSON.stringify({ type: "session.ready" }));
    }
  });

  void sendPulse("session.ready");
  tbBridge?.restart();

  ws.on("close", () => {
    tbBridge?.stop();
  });
});

const server = createServer((req, res) => {
  handle(req, res);
});

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (url.pathname !== "/api/ws") {
    handleUpgrade(request, socket, head);
    return;
  }

  const rawToken = getSessionFromCookieHeader(request.headers.cookie, SESSION_COOKIE);
  const session = decodeSession(rawToken);
  if (!session) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request, session);
  });
});

server.listen(port, hostname, () => {
  console.log(`> Ready on http://${hostname}:${port}`);
});
