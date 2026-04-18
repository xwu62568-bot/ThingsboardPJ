"use client";

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  connectDevice,
  disconnectDevice,
  fetchDeviceDetail,
  fetchDeviceList,
  openTelemetrySocket,
  refreshDevice,
  runIrrigation,
  stopIrrigation,
} from "@/lib/client/thingsboard";
import type { DeviceState, DeviceSummary } from "@/lib/domain/types";

type Props = {
  initialDevice: DeviceState;
  devices: DeviceSummary[];
  activeDeviceId: string;
};

type ActionKind = "connect" | "disconnect" | "refresh" | "run" | "stop" | null;

export function DeviceConsole({
  initialDevice,
  devices,
  activeDeviceId,
}: Props) {
  const [device, setDevice] = useState(initialDevice);
  const [deviceList, setDeviceList] = useState(devices);
  const [selectedSiteNumber, setSelectedSiteNumber] = useState(
    initialDevice.selectedSiteNumber,
  );
  const [durationSeconds, setDurationSeconds] = useState(
    String(
      initialDevice.sites.find(
        (site) => site.siteNumber === initialDevice.selectedSiteNumber,
      )?.manualDurationSeconds ?? 600,
    ),
  );
  const [pendingAction, setPendingAction] = useState<ActionKind>(null);
  const [error, setError] = useState("");
  const [wsState, setWsState] = useState<"connecting" | "connected" | "disconnected" | "error">(
    "connecting",
  );
  const [lastPushAt, setLastPushAt] = useState(0);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshInFlightRef = useRef(false);

  useEffect(() => {
    setDevice(initialDevice);
  }, [initialDevice]);

  useEffect(() => {
    setDeviceList(devices);
  }, [devices]);

  useEffect(() => {
    setSelectedSiteNumber((current) => {
      const hasCurrent = device.sites.some((site) => site.siteNumber === current);
      return hasCurrent ? current : device.selectedSiteNumber;
    });
  }, [device.selectedSiteNumber, device.sites]);

  useEffect(() => {
    const nextCurrentSite =
      device.sites.find((site) => site.siteNumber === selectedSiteNumber) ?? device.sites[0];
    setDurationSeconds(String(nextCurrentSite?.manualDurationSeconds ?? 600));
  }, [device.sites, selectedSiteNumber]);

  useEffect(() => {
    let disposed = false;

    const ws = openTelemetrySocket(null, [activeDeviceId], () => {
      if (disposed) {
        return;
      }
      setLastPushAt(Date.now());
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
      refreshTimerRef.current = setTimeout(() => {
        if (disposed || refreshInFlightRef.current) {
          return;
        }
        refreshInFlightRef.current = true;
        void fetchDeviceDetail(null, activeDeviceId)
          .then((nextDevice) => {
            setDevice(nextDevice);
            void fetchDeviceList(null)
              .then((nextDevices) => {
                setDeviceList(nextDevices);
              })
              .catch(() => undefined);
          })
          .catch(() => undefined)
          .finally(() => {
            refreshInFlightRef.current = false;
          });
      }, 800);
    });
    setWsState("connecting");

    ws.addEventListener("open", () => {
      if (disposed) {
        ws.close();
        return;
      }
      setWsState("connected");
    });

    ws.addEventListener("error", () => {
      if (!disposed) {
        setWsState("error");
      }
    });

    ws.addEventListener("close", () => {
      if (!disposed) {
        setWsState("disconnected");
      }
    });

    return () => {
      disposed = true;
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, [activeDeviceId]);

  const runAction = async (
    action: Exclude<ActionKind, null>,
    operation: () => Promise<DeviceState>,
    body?: Record<string, unknown>,
  ) => {
    setPendingAction(action);
    setError("");
    setDevice((current) => ({
      ...current,
      lastCommand: {
        kind: action,
        siteNumber: typeof body?.siteNumber === "number" ? body.siteNumber : undefined,
        durationSeconds:
          typeof body?.durationSeconds === "number" ? body.durationSeconds : undefined,
        result: "pending",
        at: Date.now(),
        message: "命令已发送，等待设备状态回读",
      },
    }));
    try {
      if (body && action === "run") {
        const durationSeconds = Number(body.durationSeconds);
        if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
          throw new Error("请输入有效时长");
        }
      }

      const nextDevice = await operation();
      setDevice(nextDevice);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "操作失败");
    } finally {
      setPendingAction(null);
    }
  };

  const currentSite =
    device.sites.find((site) => site.siteNumber === selectedSiteNumber) ?? device.sites[0];
  const railDevices =
    deviceList.length > 0
      ? deviceList
      : [
          {
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
          },
        ];

  return (
    <div className="consoleLayout">
      <aside className="deviceRail">
        <div className="panelTitle">设备清单</div>
        <div className="deviceRailList">
          {railDevices.map((item) => (
            <Link
              key={item.id}
              className={`deviceRailCard ${item.id === activeDeviceId ? "active" : ""}`}
              to={`/devices/${item.id}`}
            >
              <div>
                <strong>{item.name}</strong>
                <p>{item.model}</p>
              </div>
              <span className={`statusPill ${item.connectivityState}`}>
                {formatConnectionState(item.connectivityState)}
              </span>
            </Link>
          ))}
        </div>
      </aside>

      <main className="deviceMain">
        <section className="heroPanel">
          <div>
            <div className="eyebrow">{device.model}</div>
            <h1>{device.name}</h1>
            <p className="muted">
              设备编号 {device.serialNumber} · 最后更新 {formatTime(device.lastSeenAt)}
            </p>
          </div>
          <div className="wsBanner">
            <span className={`statusPill ${wsState}`}>{formatWsState(wsState)}</span>
            <span className="muted">最近推送 {formatTime(lastPushAt)}</span>
          </div>
          <div className="heroMetrics">
            <MetricCard
              label="平台状态"
              value={formatPlatformState(device.platformState)}
              tone={device.platformState === "active" ? "good" : "warn"}
            />
            <MetricCard
              label="连接状态"
              value={formatConnectionState(device.connectivityState)}
              tone={device.connectivityState === "connected" ? "good" : "warn"}
            />
            <MetricCard
              label="电量"
              value={`${device.batteryLevel}%`}
              tone={device.batteryLevel > 30 ? "good" : "warn"}
            />
            <MetricCard label="雨感" value={device.rainSensorWet ? "有雨" : "无雨"} />
            <MetricCard label="土壤湿度" value={`${device.soilMoisture.toFixed(1)}%`} />
          </div>
        </section>

        <section className="contentGrid">
          <div className="panel">
            <div className="panelHeader">
              <div>
                <div className="panelTitle">连接控制</div>
                <p className="muted">对应网关里的 connect / disconnect / refresh。</p>
              </div>
            </div>
            <div className="actionRow">
              <button
                className="primaryButton"
                disabled={pendingAction !== null}
                onClick={() => {
                  void runAction("connect", () => connectDevice(null, device.id));
                }}
              >
                {pendingAction === "connect" ? "连接中..." : "连接设备"}
              </button>
              <button
                className="ghostButton"
                disabled={pendingAction !== null}
                onClick={() => {
                  void runAction("disconnect", () => disconnectDevice(null, device.id));
                }}
              >
                断开连接
              </button>
              <button
                className="ghostButton"
                disabled={pendingAction !== null}
                onClick={() => {
                  void runAction("refresh", () => refreshDevice(null, device.id));
                }}
              >
                刷新状态
              </button>
            </div>
            <dl className="infoList">
              <InfoRow
                label="平台活跃"
                value={formatPlatformState(device.platformState)}
              />
              <InfoRow
                label="最后活跃时间"
                value={formatTime(device.platformLastActivityAt)}
              />
              <InfoRow
                label="控制目标"
                value={device.rpcTargetName || "--"}
              />
              <InfoRow
                label="RPC 网关"
                value={device.rpcGatewayName || device.rpcGatewayId || "自动发现中"}
              />
              <InfoRow label="RSSI" value={`${device.signalRssi} dBm`} />
              <InfoRow label="RTC 时间" value={formatTime(device.rtcTimestamp)} />
              <InfoRow label="选中路数" value={`${device.selectedSiteNumber} / ${device.siteCount}`} />
              <InfoRow label="电压" value={`${device.batteryVoltage.toFixed(2)} V`} />
            </dl>
          </div>

          <div className="panel">
            <div className="panelHeader">
              <div>
                <div className="panelTitle">手动灌溉控制</div>
                <p className="muted">首版按路数和时长下发开关阀。</p>
              </div>
            </div>
            <div className="fieldGrid">
              <label className="field">
                <span>路数</span>
                <select
                  value={selectedSiteNumber}
                  onChange={(event) => setSelectedSiteNumber(Number(event.target.value))}
                >
                  {device.sites.map((site) => (
                    <option key={site.siteNumber} value={site.siteNumber}>
                      {site.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>时长（秒）</span>
                <input
                  inputMode="numeric"
                  value={durationSeconds}
                  onChange={(event) => setDurationSeconds(event.target.value)}
                />
              </label>
            </div>
            <div className="actionRow">
              <button
                className="primaryButton"
                disabled={pendingAction !== null}
                onClick={() => {
                  void runAction(
                    "run",
                    () =>
                      runIrrigation(
                        null,
                        device.id,
                        selectedSiteNumber,
                        Number(durationSeconds),
                      ),
                    {
                      siteNumber: selectedSiteNumber,
                      durationSeconds: Number(durationSeconds),
                    },
                  );
                }}
              >
                {pendingAction === "run" ? "下发中..." : "开阀运行"}
              </button>
              <button
                className="ghostButton"
                disabled={pendingAction !== null}
                onClick={() => {
                  void runAction("stop", () => stopIrrigation(null, device.id, selectedSiteNumber), {
                    siteNumber: selectedSiteNumber,
                  });
                }}
              >
                关闭当前路
              </button>
            </div>
            <div className="subtleBlock">
              <strong>当前选中</strong>
              <p>
                {currentSite.label} · {currentSite.open ? "运行中" : "待机"} · 剩余{" "}
                {formatSeconds(currentSite.remainingSeconds)}
              </p>
            </div>
          </div>

          <div className="panel">
            <div className="panelHeader">
              <div>
                <div className="panelTitle">传感与运行状态</div>
                <p className="muted">
                  浏览器直连 ThingsBoard WebSocket；遥测或属性变化时刷新界面。
                </p>
              </div>
            </div>
            <div className="metricsGrid">
              <MetricCard label="土壤湿度" value={`${device.soilMoisture.toFixed(1)}%`} />
              <MetricCard label="雨感状态" value={device.rainSensorWet ? "湿" : "干"} />
              <MetricCard label="电池电压" value={`${device.batteryVoltage.toFixed(2)}V`} />
              <MetricCard
                label="开启路数"
                value={`${device.sites.filter((site) => site.open).length}`}
              />
            </div>
          </div>

          <div className="panel panelWide">
            <div className="panelHeader">
              <div>
                <div className="panelTitle">路数实时状态</div>
                <p className="muted">对应网关解析后的站点状态、剩余时长和开启累计时长。</p>
              </div>
            </div>
            <div className="siteTable">
              {device.sites.map((site) => (
                <div key={site.siteNumber} className="siteRow">
                  <div>
                    <strong>{site.label}</strong>
                    <p>
                      手动时长 {formatSeconds(site.manualDurationSeconds)} · 已累计{" "}
                      {formatSeconds(site.openingDurationSeconds)}
                    </p>
                  </div>
                  <div className="siteMeta">
                    <span className={`statusPill ${site.open ? "connected" : "disconnected"}`}>
                      {site.open ? "运行中" : "已关闭"}
                    </span>
                    <span>{formatSeconds(site.remainingSeconds)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {device.lastCommand ? (
          <section className="footerNotice">
            最近操作：{device.lastCommand.message} · {formatTime(device.lastCommand.at)}
          </section>
        ) : null}
        {error ? <section className="errorBanner">{error}</section> : null}
      </main>
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "warn";
}) {
  return (
    <div className={`metricCard ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="infoRow">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatConnectionState(state: DeviceState["connectivityState"]) {
  switch (state) {
    case "connected":
      return "已连接";
    case "connecting":
      return "连接中";
    case "error":
      return "异常";
    default:
      return "未连接";
  }
}

function formatPlatformState(state: DeviceState["platformState"]) {
  return state === "active" ? "活跃" : "未活跃";
}

function formatWsState(state: "connecting" | "connected" | "disconnected" | "error") {
  switch (state) {
    case "connected":
      return "WS 已连接";
    case "connecting":
      return "WS 连接中";
    case "error":
      return "WS 异常";
    default:
      return "WS 已断开";
  }
}

function formatTime(value: number) {
  if (!value) {
    return "--";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatSeconds(value: number) {
  const safe = Math.max(0, Math.round(value));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}
