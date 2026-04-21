import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useWorkspace } from "@/components/workspace-provider";
import type { DeviceSummary } from "@/lib/domain/types";
import type { FieldSummary, IrrigationPlanSummary, StrategySummary } from "@/lib/domain/workspace";

type BoundaryPoint = [number, number];

type PlanWithDate = IrrigationPlanSummary & {
  nextRunAtMinutes: number;
  nextRunLabel: string;
};

type FieldRisk = FieldSummary & {
  riskScore: number;
  riskLevel: "高" | "中" | "低";
  riskReason: string;
  deficitMm: number;
};

type Et0ForecastDay = {
  date: string;
  et0: number;
};

type RainForecastDay = {
  date: string;
  rainMm: number;
};

type WeatherOverview = {
  todayRainMm: number;
  next24hRainMm: number;
  rainProbability: number;
  recommendation: string;
  dailyRain: RainForecastDay[];
};

const DEFAULT_ET0_LAT = 31.314011616279796;
const DEFAULT_ET0_LNG = 120.67671489354876;
const DEFAULT_CROP_COEFFICIENT = 0.8;
const AMAP_KEY = import.meta.env.VITE_AMAP_KEY?.trim() || "";
const AMAP_SECURITY_CODE = import.meta.env.VITE_AMAP_SECURITY_CODE?.trim() || "";
let dashboardAmapLoadingPromise: Promise<DashboardAmapConstructor> | null = null;

type DashboardAmapInstance = {
  destroy: () => void;
  clearMap: () => void;
  setFitView: (overlays?: unknown[]) => void;
};

type DashboardAmapOverlay = {
  setMap?: (target: DashboardAmapInstance) => void;
  on?: (eventName: string, handler: (event?: { lnglat?: { lng: number; lat: number } }) => void) => void;
};

type DashboardAmapConstructor = {
  Map: new (
    container: HTMLDivElement,
    options: {
      center: [number, number];
      zoom: number;
      viewMode?: string;
      mapStyle?: string;
    },
  ) => DashboardAmapInstance;
  Marker: new (options: {
    position: BoundaryPoint;
    title: string;
    content: string;
    offset?: unknown;
  }) => DashboardAmapOverlay;
  Polygon: new (options: {
    path: BoundaryPoint[];
    strokeColor: string;
    strokeWeight: number;
    strokeOpacity: number;
    fillColor: string;
    fillOpacity: number;
    zIndex?: number;
  }) => DashboardAmapOverlay;
  Pixel: new (x: number, y: number) => unknown;
};

export function DashboardPage() {
  const { dashboard, devices, fields, plans, strategies } = useWorkspace();
  const forecastLocation = useMemo(() => getForecastLocation(fields), [fields]);
  const [et0Forecast, setEt0Forecast] = useState<Et0ForecastDay[]>([]);
  const [et0Error, setEt0Error] = useState("");
  const [weatherOverview, setWeatherOverview] = useState<WeatherOverview | null>(null);
  const [weatherError, setWeatherError] = useState("");
  const duePlans = buildDuePlans(plans).slice(0, 5);
  const fieldRisks = buildFieldRisks(fields).slice(0, 5);
  const decision = buildDecision(fields, duePlans, strategies);
  const et0Trend = et0Forecast.length > 0 ? et0Forecast : buildFallbackEt0Forecast(fields);
  const todayEt0 = et0Trend[0]?.et0 ?? 0;
  const etAverages = buildEtAverages(fields, todayEt0);
  const waterBalance = buildWaterBalance(fields, todayEt0);
  const strategyState = buildStrategyState(strategies);
  const sensorOverview = buildSensorOverview(fields, devices);
  const supplyOverview = buildSupplyOverview(dashboard, devices, plans, duePlans, strategies);
  const weather = weatherOverview ?? buildFallbackWeatherOverview(fields);

  useEffect(() => {
    const controller = new AbortController();
    setEt0Error("");
    fetchEt0Forecast(forecastLocation.lat, forecastLocation.lng, controller.signal)
      .then((rows) => setEt0Forecast(rows))
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }
        setEt0Forecast([]);
        setEt0Error(error instanceof Error ? error.message : "ET0 趋势获取失败");
      });
    return () => controller.abort();
  }, [forecastLocation.lat, forecastLocation.lng]);

  useEffect(() => {
    const controller = new AbortController();
    setWeatherError("");
    fetchWeatherOverview(forecastLocation.lat, forecastLocation.lng, controller.signal)
      .then((overview) => setWeatherOverview(overview))
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }
        setWeatherOverview(null);
        setWeatherError(error instanceof Error ? error.message : "天气数据获取失败");
      });
    return () => controller.abort();
  }, [forecastLocation.lat, forecastLocation.lng]);

  return (
    <main className="workspacePage dashboardCockpit dashboardOverview">
      <section className="dashboardOverviewTop">
        <article className="workspacePanel overviewInsightCard overviewInsightCard--weather">
          <div className="overviewCardHead">
            <div>
              <h3>天气与雨量</h3>
            </div>
            <span className="overviewChip">{weather.recommendation}</span>
          </div>
          <div className="overviewHeroMetric">
            <strong>{weather.next24hRainMm.toFixed(1)} mm</strong>
            <span>未来 24 小时降雨</span>
          </div>
          <div className="overviewMetricGrid">
            <MetricBlock label="今日累计雨量" value={`${weather.todayRainMm.toFixed(1)} mm`} />
            <MetricBlock label="降雨概率" value={`${weather.rainProbability}%`} />
          </div>
          <RainEtMiniSummary rainRows={weather.dailyRain} etRows={et0Trend} />
        </article>

        <article className="workspacePanel overviewInsightCard">
          <div className="overviewCardHead">
            <div>
              <h3>土壤与环境传感</h3>
            </div>
            <span className="overviewChip overviewChip--soft">传感聚合</span>
          </div>
          <div className="overviewHeroMetric">
            <strong>{sensorOverview.averageSoilMoisture.toFixed(0)}%</strong>
            <span>平均土壤湿度</span>
          </div>
          <div className="overviewMetricGrid">
            <MetricBlock
              label="最低湿度地块"
              value={sensorOverview.driestField ? `${sensorOverview.driestField.name} · ${sensorOverview.driestField.soilMoisture}%` : "暂无"}
            />
            <MetricBlock label="链路异常" value={sensorOverview.connectivityAlerts} />
          </div>
          <SoilMoistureSummary fields={fields} />
        </article>

        <article className="workspacePanel overviewInsightCard overviewInsightCard--water">
          <div className="overviewCardHead">
            <div>
              <h3>ET / 水量平衡</h3>
            </div>
            <span className="overviewChip overviewChip--cyan">蒸散趋势</span>
          </div>
          <div className="overviewHeroMetric">
            <strong>{waterBalance.netDeficitMm.toFixed(1)} mm</strong>
            <span>净需水量</span>
          </div>
          <div className="overviewMetricGrid">
            <MetricBlock label="今日 ET0" value={`${waterBalance.et0Mm.toFixed(1)} mm`} />
            <MetricBlock label="平均 ETc" value={`${waterBalance.etcMm.toFixed(1)} mm`} />
          </div>
          <EtWaterSummary waterBalance={waterBalance} etError={et0Error} />
        </article>

        <article className="workspacePanel overviewInsightCard">
          <div className="overviewCardHead">
            <div>
              <h3>供水执行健康</h3>
            </div>
            <span className="overviewChip overviewChip--soft">系统健康</span>
          </div>
          <div className="overviewHeroMetric">
            <strong>{supplyOverview.scheduledFlowM3h.toFixed(1)} m³/h</strong>
            <span>近期待执行总流量</span>
          </div>
          <div className="overviewMetricGrid">
            <MetricBlock label="在线设备" value={`${dashboard.onlineDevices}/${dashboard.totalDevices}`} />
            <MetricBlock label="供压/链路风险" value={supplyOverview.systemRiskCount} />
          </div>
          <div className="supplyHealthStrip">
            <div>
              <span>自动策略覆盖</span>
              <strong>{strategyState.autoEnabled}</strong>
            </div>
            <div>
              <span>运行分区</span>
              <strong>{dashboard.runningZones}</strong>
            </div>
            <div>
              <span>平均电量</span>
              <strong>{dashboard.averageBatteryLevel.toFixed(0)}%</strong>
            </div>
          </div>
        </article>
      </section>

      <section className="dashboardOverviewMiddle">
        <article className="workspacePanel dashboardOverviewMapPanel">
          <PanelHead title="地块态势地图" to="/map" action="进入地图" />
          <p className="dashboardOverviewMapIntro">地块状态作为主视觉，灌溉中的分区和设备在线状态作为辅助图层。</p>
          <DashboardAmapOverview devices={devices} fields={fields} fieldRisks={fieldRisks} />
        </article>

        <div className="dashboardOverviewRail">
          <article className={`workspacePanel overviewDecisionPanel overviewDecisionPanel--${decision.level}`}>
            <div className="overviewCardHead">
              <div>
                <h3>今日灌溉决策</h3>
              </div>
            </div>
            <div className="overviewDecisionHero">
              <strong>{decision.title}</strong>
              <p>{decision.reason}</p>
            </div>
            <div className="overviewMetricGrid">
              <MetricBlock label="待执行计划" value={duePlans.length} />
              <MetricBlock label="预计时长" value={`${decision.durationMinutes} 分钟`} />
              <MetricBlock label="高风险地块" value={fieldRisks.filter((field) => field.riskLevel === "高").length} />
              <MetricBlock label="雨天锁定策略" value={strategyState.rainLocked} />
            </div>
          </article>

          <article className="workspacePanel overviewRiskPanel">
            <PanelHead title="灌溉风险排行" to="/map" action="查看地图" />
            <div className="stackList">
              {fieldRisks.length > 0 ? (
                fieldRisks.slice(0, 4).map((field) => (
                  <Link className="riskItem compactRiskItem" key={field.id} to={`/fields/${field.id}`}>
                    <div className={`riskBadge riskBadge--${field.riskLevel}`}>{field.riskLevel}</div>
                    <div>
                      <strong>{field.name}</strong>
                      <p>{field.riskReason}</p>
                    </div>
                    <div className="riskMetrics">
                      <span>{field.soilMoisture}%</span>
                      <em>{field.deficitMm.toFixed(1)} mm</em>
                    </div>
                  </Link>
                ))
              ) : (
                <EmptyHint title="暂无地块数据" text="先在地块地图中创建地块和分区。" />
              )}
            </div>
          </article>
        </div>
      </section>

      <section className="dashboardOverviewBottom">
        <article className="workspacePanel">
          <PanelHead title="执行计划" to="/plans" action="管理计划" />
          <div className="stackList">
            {duePlans.length > 0 ? (
              duePlans.slice(0, 4).map((plan) => (
                <Link className="scheduleItem" key={plan.id} to={`/plans/${plan.id}`}>
                  <div>
                    <strong>{plan.name}</strong>
                    <p>
                      {plan.fieldName} · {formatPlanMode(plan.mode)} · {plan.zoneCount} 个分区
                    </p>
                  </div>
                  <div>
                    <span>{plan.nextRunLabel}</span>
                    <em>{plan.totalDurationMinutes} 分钟</em>
                  </div>
                </Link>
              ))
            ) : (
              <EmptyHint title="暂无待执行计划" text="新增轮灌计划后，这里会显示未来 24 小时的任务。" />
            )}
          </div>
        </article>

        <article className="workspacePanel">
          <PanelHead title="自动策略" to="/strategies" action="管理策略" />
          <div className="strategyStatusGrid">
            <MetricBlock label="启用策略" value={strategyState.enabled} />
            <MetricBlock label="自动执行" value={strategyState.autoEnabled} />
            <MetricBlock label="雨天锁定" value={strategyState.rainLocked} />
            <MetricBlock label="最近触发" value={strategyState.triggered} />
          </div>
          <div className="stackList">
            {strategies.length > 0 ? (
              strategies.slice(0, 3).map((strategy) => (
                <Link className="scheduleItem" key={strategy.id} to={`/strategies/${strategy.id}`}>
                  <div>
                    <strong>{strategy.name}</strong>
                    <p>
                      {strategy.fieldName} · {formatStrategyType(strategy.type)} · {formatStrategyMode(strategy.mode)}
                    </p>
                  </div>
                  <div>
                    <span>{strategy.enabled ? "已启用" : "已停用"}</span>
                    <em>{strategy.rainLockEnabled ? "雨天锁定" : "未锁定"}</em>
                  </div>
                </Link>
              ))
            ) : (
              <EmptyHint title="暂无自动策略" text="配置阈值或 ETc 策略后，这里会显示自动执行能力。" />
            )}
          </div>
        </article>
      </section>
    </main>
  );
}

function DashboardAmapOverview({
  devices,
  fields,
  fieldRisks,
}: {
  devices: DeviceSummary[];
  fields: FieldSummary[];
  fieldRisks: FieldRisk[];
}) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const amapRef = useRef<DashboardAmapConstructor | null>(null);
  const mapInstanceRef = useRef<DashboardAmapInstance | null>(null);
  const [loadState, setLoadState] = useState<"fallback" | "loading" | "ready" | "error">(
    AMAP_KEY ? "loading" : "fallback",
  );
  const [reloadKey, setReloadKey] = useState(0);
  const initialCenterRef = useRef<[number, number] | null>(null);
  if (!initialCenterRef.current) {
    const location = getForecastLocation(fields);
    initialCenterRef.current = [location.lng, location.lat];
  }

  useEffect(() => {
    if (!AMAP_KEY || !mapRef.current) {
      setLoadState("fallback");
      return;
    }

    let disposed = false;
    setLoadState("loading");

    loadDashboardAmap()
      .then((AMap) => {
        if (disposed || !mapRef.current) {
          return;
        }
        amapRef.current = AMap;
        mapInstanceRef.current = new AMap.Map(mapRef.current, {
          center: initialCenterRef.current ?? [DEFAULT_ET0_LNG, DEFAULT_ET0_LAT],
          zoom: 13,
          viewMode: "2D",
          mapStyle: "amap://styles/whitesmoke",
        });
        setLoadState("ready");
      })
      .catch(() => {
        if (!disposed) {
          setLoadState("error");
        }
      });

    return () => {
      disposed = true;
      mapInstanceRef.current?.destroy();
      mapInstanceRef.current = null;
      amapRef.current = null;
    };
  }, [reloadKey]);

  useEffect(() => {
    const AMap = amapRef.current;
    const map = mapInstanceRef.current;
    if (!AMap || !map || loadState !== "ready") {
      return;
    }

    map.clearMap();
    const riskById = new Map(fieldRisks.map((field) => [field.id, field]));
    const overlays: DashboardAmapOverlay[] = [];

    for (const field of fields) {
      const status = getMapStatus(field, riskById.get(field.id));
      const fieldPoints = getFieldDisplayPoints(field);
      const polygon = new AMap.Polygon({
        path: fieldPoints,
        strokeColor: getDashboardMapColor(status),
        strokeWeight: 2,
        strokeOpacity: 0.94,
        fillColor: getDashboardMapColor(status),
        fillOpacity: status === "offline" ? 0.14 : 0.2,
        zIndex: 8,
      });
      polygon.on?.("click", () => {
        window.location.hash = `#/fields/${field.id}`;
      });
      polygon.setMap?.(map);
      overlays.push(polygon);

      for (const [zoneIndex, zone] of getFieldDisplayZones(field).entries()) {
        const zoneStatus = getZoneMapStatus(field, zoneIndex);
        const zoneStyle = getDashboardZoneStyle(zoneStatus);
        const zonePolygon = new AMap.Polygon({
          path: zone.boundary,
          strokeColor: zoneStyle.stroke,
          strokeWeight: zoneStatus === "running" ? 2 : 1,
          strokeOpacity: 0.92,
          fillColor: zoneStyle.fill,
          fillOpacity: zoneStyle.fillOpacity,
          zIndex: zoneStatus === "running" ? 12 : 10,
        });
        zonePolygon.on?.("click", () => {
          window.location.hash = `#/fields/${field.id}`;
        });
        zonePolygon.setMap?.(map);
        overlays.push(zonePolygon);

        const zoneCenter = calculateDashboardCenter(zone.boundary);
        const zoneMarker = new AMap.Marker({
          position: zoneCenter,
          title: zone.name,
          content: buildDashboardZoneMarkerContent(zone.name, zoneStatus),
          offset: new AMap.Pixel(-18, -12),
        });
        zoneMarker.on?.("click", () => {
          window.location.hash = `#/fields/${field.id}`;
        });
        zoneMarker.setMap?.(map);
        overlays.push(zoneMarker);
      }

      const center = getFieldDisplayCenter(field);
      const fieldMarker = new AMap.Marker({
        position: center,
        title: field.name,
        content: buildDashboardFieldMarkerContent(field, status),
        offset: new AMap.Pixel(-42, -14),
      });
      fieldMarker.on?.("click", () => {
        window.location.hash = `#/fields/${field.id}`;
      });
      fieldMarker.setMap?.(map);
      overlays.push(fieldMarker);

      for (const marker of field.deviceMarkers ?? []) {
        const displayName = resolveDashboardDeviceMarkerName(marker, devices);
        const markerMeta = resolveDashboardDeviceMarkerMeta(
          devices.find((device) => device.id === marker.deviceId),
        );
        const deviceMarker = new AMap.Marker({
          position: [marker.lng, marker.lat],
          title: displayName,
          content: buildDashboardDeviceMarkerContent(displayName, marker.siteNumber, markerMeta),
          offset: new AMap.Pixel(-14, -28),
        });
        deviceMarker.on?.("click", () => {
          window.location.hash = `#/devices/${marker.deviceId}`;
        });
        deviceMarker.setMap?.(map);
        overlays.push(deviceMarker);
      }
    }

    if (overlays.length > 0) {
      map.setFitView(overlays);
    }
  }, [devices, fieldRisks, fields, loadState]);

  if (!AMAP_KEY || loadState === "error") {
    return (
      <div className="dashboardMapFallback">
        <FieldStatusMap fields={fields} fieldRisks={fieldRisks} />
      </div>
    );
  }

  return (
    <div className="dashboardMapFrame">
      <div className="amapCanvasShell dashboardAmapShell">
        {loadState === "loading" ? <span className="mapLoading">高德地图加载中...</span> : null}
        {fields.length === 0 && loadState === "ready" ? (
          <div className="dashboardMapEmptyOverlay">
            <strong>暂无地块边界</strong>
            <p>在地块地图中创建地块后，这里会显示真实地图状态。</p>
            <Link className="inlineLink" to="/map">去创建地块</Link>
          </div>
        ) : null}
        <DashboardMapLegend />
        <div className="dashboardAmapCanvas" ref={mapRef} />
      </div>
    </div>
  );
}

function FieldStatusMap({
  fields,
  fieldRisks,
}: {
  fields: FieldSummary[];
  fieldRisks: FieldRisk[];
}) {
  const displayFields = fields.length > 0 ? fields : [buildDashboardMapPlaceholderField()];
  const riskById = new Map(fieldRisks.map((field) => [field.id, field]));
  const bounds = getFieldBounds(displayFields);

  return (
    <div className="dashboardFieldMap">
      <svg aria-label="地块状态地图" role="img" viewBox="0 0 1000 520">
        <defs>
          <pattern id="mapGrid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M 48 0 L 0 0 0 48" fill="none" stroke="rgba(20,83,45,0.08)" strokeWidth="1" />
          </pattern>
          <linearGradient id="mapGround" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#eef8f0" />
            <stop offset="100%" stopColor="#dcefe4" />
          </linearGradient>
        </defs>
        <rect width="1000" height="520" fill="url(#mapGround)" rx="24" />
        <rect width="1000" height="520" fill="url(#mapGrid)" rx="24" />
        {displayFields.map((field) => {
          const points = getFieldDisplayPoints(field);
          const polygon = points.map((point) => projectPoint(point, bounds)).join(" ");
          const center = projectPoint(getFieldDisplayCenter(field), bounds);
          const [centerX, centerY] = center.split(",").map(Number);
          const risk = riskById.get(field.id);
          const status = getMapStatus(field, risk);
          return (
            <g
              aria-label={`${field.name} 地块详情`}
              className={`dashboardMapField dashboardMapField--${status}${fields.length === 0 ? " dashboardMapField--placeholder" : ""}`}
              key={field.id}
            >
              <polygon points={polygon} />
              {getFieldDisplayZones(field).map((zone, zoneIndex) => {
                const zoneStatus = getZoneMapStatus(field, zoneIndex);
                const zonePolygon = zone.boundary.map((point) => projectPoint(point, bounds)).join(" ");
                return (
                  <polygon
                    className={`dashboardMapZone dashboardMapZone--${zoneStatus}`}
                    key={zone.id}
                    points={zonePolygon}
                  />
                );
              })}
              <circle cx={centerX} cy={centerY} r="9" />
              <text x={centerX} y={centerY - 16}>
                {field.name}
              </text>
            </g>
          );
        })}
      </svg>
      {fields.length === 0 ? (
        <div className="dashboardMapEmptyOverlay">
          <strong>暂无地块边界</strong>
          <p>在地块地图中创建地块后，这里会显示实时状态。</p>
          <Link className="inlineLink" to="/map">去创建地块</Link>
        </div>
      ) : (
        <div className="dashboardMapClickLayer">
          {fields.map((field) => {
            const center = projectPoint(getFieldDisplayCenter(field), bounds);
            const [left, top] = center.split(",").map(Number);
            return (
              <Link
                aria-label={`查看 ${field.name}`}
                className="dashboardMapHotspot"
                key={field.id}
                style={{
                  left: `${(left / 1000) * 100}%`,
                  top: `${(top / 520) * 100}%`,
                }}
                to={`/fields/${field.id}`}
              />
            );
          })}
        </div>
      )}
      <DashboardMapLegend />
    </div>
  );
}

function DashboardMapLegend() {
  return (
    <div className="dashboardMapLegend">
      <span><i className="legendDot legendDot--idle" />正常</span>
      <span><i className="legendDot legendDot--running" />灌溉中</span>
      <span><i className="legendDot legendDot--attention" />需关注</span>
      <span><i className="legendDot legendDot--offline" />离线</span>
    </div>
  );
}

function buildDashboardMapPlaceholderField(): FieldSummary {
  return {
    id: "dashboard-placeholder-field",
    name: "地块位置",
    code: "placeholder",
    groupName: "",
    cropType: "",
    growthStage: "",
    areaMu: 20,
    deviceId: "",
    centerLat: DEFAULT_ET0_LAT,
    centerLng: DEFAULT_ET0_LNG,
    zoneCount: 1,
    batteryLevel: 0,
    soilMoisture: 0,
    irrigationState: "idle",
    gatewayState: "unknown",
    et0: 0,
    kc: 0,
    etc: 0,
    et0UpdatedAt: 0,
    et0Source: "",
  };
}

function Et0TrendChart({ rows, error, compact = false }: { rows: Et0ForecastDay[]; error: string; compact?: boolean }) {
  const max = Math.max(1, ...rows.map((row) => row.et0));
  const points = rows
    .map((row, index) => {
      const x = rows.length === 1 ? 50 : 8 + (index / (rows.length - 1)) * 84;
      const y = 86 - (row.et0 / max) * 68;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className={`et0TrendPanel${compact ? " et0TrendPanel--compact" : ""}`}>
      <div className="sectionHead compactSectionHead">
        <div>
          <h3>7 天 ET0 趋势</h3>
          <p>{error ? "外部接口暂不可用，显示本地估算趋势。" : "Open-Meteo FAO 参考蒸散量。"}</p>
        </div>
      </div>
      <svg className="et0TrendChart" viewBox="0 0 100 100" preserveAspectRatio="none">
        <polyline fill="none" points={points} stroke="#0284c7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.6" />
        {rows.map((row, index) => {
          const x = rows.length === 1 ? 50 : 8 + (index / (rows.length - 1)) * 84;
          const y = 86 - (row.et0 / max) * 68;
          return <circle cx={x} cy={y} fill="#0ea5e9" key={row.date} r="2.6" />;
        })}
      </svg>
      <div className="et0TrendLabels">
        {rows.map((row) => (
          <span key={row.date}>
            <strong>{row.et0.toFixed(1)}</strong>
            <em>{formatShortDate(row.date)}</em>
          </span>
        ))}
      </div>
    </div>
  );
}

function RainEtMiniSummary({
  rainRows,
  etRows,
}: {
  rainRows: RainForecastDay[];
  etRows: Et0ForecastDay[];
}) {
  const next3Rain = rainRows.slice(0, 3).reduce((total, row) => total + row.rainMm, 0);
  const next3Et0 = etRows.slice(0, 3).reduce((total, row) => total + row.et0, 0);

  return (
    <div className="overviewInlineSummary">
      <span><i className="legendSwatch legendSwatch--rain" />3日雨量 {next3Rain.toFixed(1)} mm</span>
      <span><i className="legendSwatch legendSwatch--et" />3日 ET0 {next3Et0.toFixed(1)} mm</span>
    </div>
  );
}

function SoilMoistureSummary({ fields }: { fields: FieldSummary[] }) {
  const bands = [
    { label: "< 30%", count: fields.filter((field) => field.soilMoisture > 0 && field.soilMoisture < 30).length },
    {
      label: "30-40%",
      count: fields.filter((field) => field.soilMoisture >= 30 && field.soilMoisture < 40).length,
    },
    {
      label: "40-50%",
      count: fields.filter((field) => field.soilMoisture >= 40 && field.soilMoisture < 50).length,
    },
    { label: ">= 50%", count: fields.filter((field) => field.soilMoisture >= 50).length },
  ];
  const topBand = [...bands].sort((left, right) => right.count - left.count)[0];

  return (
    <div className="overviewInlineSummary">
      <span>主要湿度区间 {topBand?.label ?? "--"}</span>
      <span>低湿地块 {bands[0]?.count ?? 0} 个</span>
    </div>
  );
}

function EtWaterSummary({
  waterBalance,
  etError,
}: {
  waterBalance: ReturnType<typeof buildWaterBalance>;
  etError: string;
}) {
  return (
    <div className="overviewInlineSummary">
      <span>建议补水 {waterBalance.suggestWaterMm.toFixed(1)} mm</span>
      <span>{etError ? "ET 使用估算值" : "ET 使用实时趋势"}</span>
    </div>
  );
}

function buildDecision(fields: FieldSummary[], duePlans: PlanWithDate[], strategies: StrategySummary[]) {
  const riskFields = buildFieldRisks(fields).filter((field) => field.riskLevel !== "低");
  const autoStrategies = strategies.filter((strategy) => strategy.enabled && strategy.mode === "auto");
  const durationMinutes = duePlans.reduce((sum, plan) => sum + plan.totalDurationMinutes, 0);
  if (duePlans.length > 0 && autoStrategies.length > 0) {
    return {
      level: "go",
      title: "有计划等待执行",
      reason: `${duePlans[0]?.fieldName ?? "地块"} 将在 ${duePlans[0]?.nextRunLabel ?? "今日"} 执行，自动策略会在执行前判断。`,
      durationMinutes,
    };
  }
  if (riskFields.length > 0) {
    return {
      level: "warn",
      title: "存在缺水风险",
      reason: `${riskFields[0].name} 风险最高，建议检查 ETc、墒情和计划配置。`,
      durationMinutes,
    };
  }
  return {
    level: "calm",
    title: "暂不需要干预",
    reason: "当前没有明显缺水地块，也没有未来 24 小时内的自动计划。",
    durationMinutes,
  };
}

function buildDuePlans(plans: IrrigationPlanSummary[]): PlanWithDate[] {
  const now = new Date();
  const today = now.getDay() === 0 ? 7 : now.getDay();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return plans
    .filter((plan) => plan.enabled)
    .map((plan) => {
      const [hour = 0, minute = 0] = plan.startAt.split(":").map(Number);
      const startMinutes = hour * 60 + minute;
      const nextRunAtMinutes = startMinutes >= nowMinutes ? startMinutes : startMinutes + 1440;
      return {
        ...plan,
        nextRunAtMinutes,
        nextRunLabel: `${nextRunAtMinutes >= 1440 ? "明日" : "今日"} ${plan.startAt}`,
      };
    })
    .filter((plan) => {
      if (plan.nextRunAtMinutes - nowMinutes > 1440) {
        return false;
      }
      if (plan.scheduleType === "weekly") {
        return plan.weekdays.includes(today) || plan.nextRunAtMinutes >= 1440;
      }
      return true;
    })
    .sort((left, right) => left.nextRunAtMinutes - right.nextRunAtMinutes);
}

function buildFieldRisks(fields: FieldSummary[]): FieldRisk[] {
  return fields
    .map((field) => {
      const deficitMm = Math.max(0, field.etc - Math.max(0, field.soilMoisture - 25) * 0.08);
      const moistureRisk = field.soilMoisture > 0 ? Math.max(0, 38 - field.soilMoisture) : 8;
      const etcRisk = deficitMm * 3;
      const offlineRisk = field.gatewayState === "offline" ? 8 : 0;
      const riskScore = moistureRisk + etcRisk + offlineRisk;
      const riskLevel: FieldRisk["riskLevel"] = riskScore >= 18 ? "高" : riskScore >= 9 ? "中" : "低";
      return {
        ...field,
        riskScore,
        riskLevel,
        deficitMm,
        riskReason: buildRiskReason(field, deficitMm, offlineRisk > 0),
      };
    })
    .sort((left, right) => right.riskScore - left.riskScore);
}

function buildRiskReason(field: FieldSummary, deficitMm: number, offline: boolean) {
  if (offline) {
    return "设备离线，需先确认执行链路";
  }
  if (field.soilMoisture > 0 && field.soilMoisture < 30) {
    return "土壤湿度偏低";
  }
  if (deficitMm >= 3) {
    return "ETc 缺水累计偏高";
  }
  return "状态稳定";
}

function buildEtAverages(fields: FieldSummary[], fallbackEt0: number) {
  return {
    et0: areaWeightedAverage(fields, (field) => getEffectiveEt0(field, fallbackEt0)),
    etc: areaWeightedAverage(fields, (field) => getEffectiveEtc(field, fallbackEt0)),
  };
}

function buildWaterBalance(fields: FieldSummary[], fallbackEt0: number) {
  const et0Mm = areaWeightedAverage(fields, (field) => getEffectiveEt0(field, fallbackEt0));
  const etcMm = areaWeightedAverage(fields, (field) => getEffectiveEtc(field, fallbackEt0));
  const averageKc = areaWeightedAverage(fields, getEffectiveKc);
  const effectiveRainMm = 0;
  const netDeficitMm = Math.max(0, etcMm - effectiveRainMm);
  return {
    et0Mm,
    etcMm,
    averageKc,
    effectiveRainMm,
    netDeficitMm,
    suggestWaterMm: netDeficitMm * 0.8,
  };
}

function getEffectiveEt0(field: FieldSummary, fallbackEt0: number) {
  return field.et0 > 0 ? field.et0 : Math.max(0, fallbackEt0);
}

function getEffectiveKc(field: FieldSummary) {
  return field.kc > 0 ? field.kc : DEFAULT_CROP_COEFFICIENT;
}

function getEffectiveEtc(field: FieldSummary, fallbackEt0: number) {
  if (field.etc > 0) {
    return field.etc;
  }
  return Number((getEffectiveEt0(field, fallbackEt0) * getEffectiveKc(field)).toFixed(2));
}

function buildStrategyState(strategies: StrategySummary[]) {
  const enabledStrategies = strategies.filter((strategy) => strategy.enabled);
  return {
    enabled: enabledStrategies.length,
    autoEnabled: enabledStrategies.filter((strategy) => strategy.mode === "auto").length,
    rainLocked: enabledStrategies.filter((strategy) => strategy.rainLockEnabled).length,
    triggered: enabledStrategies.filter((strategy) => strategy.mode === "auto").length,
  };
}

async function fetchEt0Forecast(lat: number, lng: number, signal: AbortSignal): Promise<Et0ForecastDay[]> {
  const query = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    daily: "et0_fao_evapotranspiration",
    timezone: "auto",
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query.toString()}`, {
    signal,
  });
  if (!response.ok) {
    throw new Error(`ET0 接口失败 ${response.status}`);
  }
  const payload = (await response.json()) as {
    daily?: {
      time?: string[];
      et0_fao_evapotranspiration?: number[];
    };
  };
  const times = payload.daily?.time ?? [];
  const values = payload.daily?.et0_fao_evapotranspiration ?? [];
  return times
    .map((date, index) => ({
      date,
      et0: Number(values[index] ?? 0),
    }))
    .filter((row) => row.date && Number.isFinite(row.et0));
}

async function fetchWeatherOverview(lat: number, lng: number, signal: AbortSignal): Promise<WeatherOverview> {
  const query = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    hourly: "precipitation",
    daily: "precipitation_sum,precipitation_probability_max",
    forecast_days: "7",
    timezone: "auto",
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query.toString()}`, {
    signal,
  });
  if (!response.ok) {
    throw new Error(`天气接口失败 ${response.status}`);
  }
  const payload = (await response.json()) as {
    hourly?: {
      time?: string[];
      precipitation?: number[];
    };
    daily?: {
      time?: string[];
      precipitation_sum?: number[];
      precipitation_probability_max?: number[];
    };
  };
  const hourlyRain = payload.hourly?.precipitation ?? [];
  const next24hRainMm = hourlyRain.slice(0, 24).reduce((total, value) => total + (value ?? 0), 0);
  const dailyTimes = payload.daily?.time ?? [];
  const dailyRain = payload.daily?.precipitation_sum ?? [];
  const probability = payload.daily?.precipitation_probability_max ?? [];
  const todayRainMm = Number(dailyRain[0] ?? 0);
  const rainProbability = Math.round(Number(probability[0] ?? 0));
  return {
    todayRainMm,
    next24hRainMm: Number(next24hRainMm.toFixed(1)),
    rainProbability,
    recommendation: getRainRecommendation(next24hRainMm, rainProbability),
    dailyRain: dailyTimes.map((date, index) => ({
      date,
      rainMm: Number(dailyRain[index] ?? 0),
    })),
  };
}

function getForecastLocation(fields: FieldSummary[]) {
  const locatedFields = fields.filter((field) => Number.isFinite(field.centerLat) && Number.isFinite(field.centerLng));
  if (locatedFields.length === 0) {
    return { lat: DEFAULT_ET0_LAT, lng: DEFAULT_ET0_LNG };
  }
  return {
    lat: average(locatedFields.map((field) => field.centerLat)),
    lng: average(locatedFields.map((field) => field.centerLng)),
  };
}

function buildFallbackWeatherOverview(fields: FieldSummary[]): WeatherOverview {
  const moisturePressure = average(fields.map((field) => Math.max(0, 42 - field.soilMoisture)));
  const next24hRainMm = Number(Math.max(0, 5.6 - moisturePressure * 0.08).toFixed(1));
  const today = new Date();
  return {
    todayRainMm: Number((next24hRainMm * 0.46).toFixed(1)),
    next24hRainMm,
    rainProbability: Math.min(88, Math.max(18, Math.round(next24hRainMm * 12))),
    recommendation: getRainRecommendation(next24hRainMm, Math.round(next24hRainMm * 12)),
    dailyRain: Array.from({ length: 7 }, (_, index) => {
      const date = new Date(today);
      date.setDate(today.getDate() + index);
      return {
        date: date.toISOString().slice(0, 10),
        rainMm: Number(Math.max(0, next24hRainMm * (0.8 - index * 0.08)).toFixed(1)),
      };
    }),
  };
}

function getRainRecommendation(next24hRainMm: number, rainProbability: number) {
  if (next24hRainMm >= 8 || rainProbability >= 75) {
    return "建议跳灌";
  }
  if (next24hRainMm >= 3 || rainProbability >= 45) {
    return "建议延后";
  }
  return "可按计划灌溉";
}

function buildSensorOverview(fields: FieldSummary[], devices: DeviceSummary[]) {
  const averageSoilMoisture = average(fields.map((field) => field.soilMoisture));
  const driestField = [...fields]
    .filter((field) => field.soilMoisture > 0)
    .sort((left, right) => left.soilMoisture - right.soilMoisture)[0];
  const connectivityAlerts = devices.filter((device) => {
    if (device.isGateway) {
      return device.gatewayState !== "online";
    }
    return (device.bleConnectivityState ?? device.connectivityState) !== "connected";
  }).length;
  return {
    averageSoilMoisture,
    driestField,
    connectivityAlerts,
  };
}

function buildSupplyOverview(
  dashboard: ReturnType<typeof useWorkspace>["dashboard"],
  devices: DeviceSummary[],
  plans: IrrigationPlanSummary[],
  duePlans: PlanWithDate[],
  strategies: StrategySummary[],
) {
  const scheduledFlowM3h =
    sum((duePlans.length > 0 ? duePlans : plans.filter((plan) => plan.enabled).slice(0, 3)).map((plan) => plan.flowRateM3h)) ||
    sum(strategies.filter((strategy) => strategy.enabled).slice(0, 3).map((strategy) => strategy.flowRateM3h));
  const systemRiskCount =
    devices.filter((device) => (device.isGateway ? device.gatewayState !== "online" : (device.bleConnectivityState ?? device.connectivityState) !== "connected")).length +
    dashboard.attentionFields;
  return {
    scheduledFlowM3h,
    systemRiskCount,
  };
}

function buildFallbackEt0Forecast(fields: FieldSummary[]): Et0ForecastDay[] {
  const baseEt0 = average(fields.map((field) => field.et0)) || 3.6;
  const today = new Date();
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() + index);
    return {
      date: date.toISOString().slice(0, 10),
      et0: Number((baseEt0 + Math.sin(index / 1.4) * 0.35).toFixed(2)),
    };
  });
}

function getFieldBounds(fields: FieldSummary[]) {
  const points = fields.flatMap(getFieldDisplayPoints);
  const lngs = points.map((point) => point[0]);
  const lats = points.map((point) => point[1]);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const lngPadding = Math.max((maxLng - minLng) * 0.16, 0.002);
  const latPadding = Math.max((maxLat - minLat) * 0.16, 0.002);
  return {
    minLng: minLng - lngPadding,
    maxLng: maxLng + lngPadding,
    minLat: minLat - latPadding,
    maxLat: maxLat + latPadding,
  };
}

function getFieldDisplayPoints(field: FieldSummary): Array<[number, number]> {
  if (field.boundary && field.boundary.length >= 3) {
    return field.boundary;
  }
  const lng = field.centerLng || DEFAULT_ET0_LNG;
  const lat = field.centerLat || DEFAULT_ET0_LAT;
  const offset = 0.004 + Math.min(0.01, Math.sqrt(Math.max(field.areaMu, 1)) * 0.00025);
  return [
    [lng - offset, lat - offset * 0.72],
    [lng + offset * 0.92, lat - offset],
    [lng + offset, lat + offset * 0.72],
    [lng - offset * 0.86, lat + offset],
  ];
}

function getFieldDisplayCenter(field: FieldSummary): [number, number] {
  const lng = Number.isFinite(field.centerLng) ? field.centerLng : DEFAULT_ET0_LNG;
  const lat = Number.isFinite(field.centerLat) ? field.centerLat : DEFAULT_ET0_LAT;
  return [lng, lat];
}

function getFieldDisplayZones(field: FieldSummary) {
  return (field.mapZones ?? []).filter(
    (zone): zone is NonNullable<FieldSummary["mapZones"]>[number] =>
      Array.isArray(zone.boundary) &&
      zone.boundary.length >= 3 &&
      zone.boundary.every(
        (point) =>
          Array.isArray(point) &&
          point.length >= 2 &&
          Number.isFinite(point[0]) &&
          Number.isFinite(point[1]),
      ),
  );
}

function projectPoint(point: [number, number], bounds: ReturnType<typeof getFieldBounds>) {
  const width = Math.max(bounds.maxLng - bounds.minLng, 0.0001);
  const height = Math.max(bounds.maxLat - bounds.minLat, 0.0001);
  const x = 58 + ((point[0] - bounds.minLng) / width) * 884;
  const y = 462 - ((point[1] - bounds.minLat) / height) * 404;
  return `${x.toFixed(1)},${y.toFixed(1)}`;
}

function getMapStatus(field: FieldSummary, risk?: FieldRisk) {
  if (field.gatewayState === "offline") {
    return "offline";
  }
  if (field.irrigationState === "running") {
    return "running";
  }
  if (field.irrigationState === "attention") {
    return "attention";
  }
  return "idle";
}

function formatShortDate(date: string) {
  const [, month = "", day = ""] = date.split("-");
  return `${Number(month)}/${Number(day)}`;
}

function loadDashboardAmap() {
  const dashboardWindow = window as Window & {
    AMap?: DashboardAmapConstructor;
    _AMapSecurityConfig?: {
      securityJsCode?: string;
    };
  };
  if (dashboardWindow.AMap) {
    return Promise.resolve(dashboardWindow.AMap);
  }
  if (dashboardAmapLoadingPromise) {
    return dashboardAmapLoadingPromise;
  }
  if (AMAP_SECURITY_CODE) {
    dashboardWindow._AMapSecurityConfig = {
      securityJsCode: AMAP_SECURITY_CODE,
    };
  }
  dashboardAmapLoadingPromise = new Promise<DashboardAmapConstructor>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(AMAP_KEY)}`;
    script.async = true;
    script.onload = () => {
      if (dashboardWindow.AMap) {
        resolve(dashboardWindow.AMap);
      } else {
        reject(new Error("高德地图初始化失败"));
      }
    };
    script.onerror = () => reject(new Error("高德地图脚本加载失败"));
    document.head.appendChild(script);
  });
  return dashboardAmapLoadingPromise;
}

function getDashboardMapColor(status: ReturnType<typeof getMapStatus>) {
  switch (status) {
    case "running":
      return "#0284c7";
    case "attention":
      return "#d97706";
    case "offline":
      return "#64748b";
    default:
      return "#16a34a";
  }
}

function getZoneMapStatus(field: FieldSummary, zoneIndex: number) {
  if (field.irrigationState === "running") {
    return zoneIndex === 0 ? "running" : "idle";
  }
  return "idle";
}

function getDashboardZoneStyle(status: ReturnType<typeof getZoneMapStatus>) {
  switch (status) {
    case "running":
      return {
        fill: "#0ea5e9",
        stroke: "#0284c7",
        fillOpacity: 0.56,
      };
    default:
      return {
        fill: "#86efac",
        stroke: "#15803d",
        fillOpacity: 0.46,
      };
  }
}

function calculateDashboardCenter(boundary: BoundaryPoint[]): BoundaryPoint {
  if (boundary.length === 0) {
    return [DEFAULT_ET0_LNG, DEFAULT_ET0_LAT];
  }
  const sum = boundary.reduce(
    (acc, point) => {
      acc.lng += point[0];
      acc.lat += point[1];
      return acc;
    },
    { lng: 0, lat: 0 },
  );
  return [
    Number((sum.lng / boundary.length).toFixed(6)),
    Number((sum.lat / boundary.length).toFixed(6)),
  ];
}

function buildDashboardFieldMarkerContent(field: FieldSummary, status: ReturnType<typeof getMapStatus>) {
  return `
    <div class="amapFieldMarker dashboardAmapMarker dashboardAmapMarker--${status}">
      <strong>${escapeHtml(getDashboardCompactFieldLabel(field.name))}</strong>
    </div>
  `;
}

function buildDashboardZoneMarkerContent(name: string, status: ReturnType<typeof getZoneMapStatus>) {
  return `
    <div class="amapZoneMarker${status === "running" ? " dashboardZoneMarker--running" : ""}">
      ${escapeHtml(name)}
    </div>
  `;
}

function buildDashboardDeviceMarkerContent(
  name: string,
  siteNumber: number | undefined,
  meta: { className: string; icon: string },
) {
  return `
    <div class="amapDeviceMarker ${meta.className}" title="${escapeHtml(name)}">
      <span>${meta.icon}</span>
      <strong>${escapeHtml(getDashboardCompactDeviceLabel(name))}${siteNumber ? ` · ${siteNumber}站` : ""}</strong>
    </div>
  `;
}

function resolveDashboardDeviceMarkerMeta(device?: DeviceSummary) {
  const icon = device?.isGateway ? buildDashboardGatewayIcon() : buildDashboardControllerIcon();
  if (device?.isGateway) {
    return {
      className: device.gatewayState === "online" ? "amapDeviceMarker--online" : "amapDeviceMarker--offline",
      icon,
    };
  }
  switch (device?.bleConnectivityState ?? device?.connectivityState) {
    case "connected":
      return { className: "amapDeviceMarker--online", icon };
    case "error":
      return { className: "amapDeviceMarker--error", icon };
    case "connecting":
      return { className: "amapDeviceMarker--pending", icon };
    default:
      return { className: "amapDeviceMarker--offline", icon };
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getDashboardCompactFieldLabel(name: string) {
  const trimmed = name.trim();
  return trimmed.length <= 8 ? trimmed : `${trimmed.slice(0, 8)}…`;
}

function getDashboardCompactDeviceLabel(name: string) {
  const normalized = name
    .replace(/(控制器|网关|设备|终端)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const base = normalized || name.trim();
  return base.length <= 6 ? base : `${base.slice(0, 6)}…`;
}

function resolveDashboardDeviceMarkerName(
  marker: NonNullable<FieldSummary["deviceMarkers"]>[number],
  devices: DeviceSummary[],
) {
  const liveName = devices.find((item) => item.id === marker.deviceId)?.name?.trim();
  if (liveName) {
    return liveName;
  }
  const markerName = marker.name?.trim();
  if (markerName && !looksLikeDashboardPlaceholderName(markerName)) {
    return markerName;
  }
  return `设备 ${shortDashboardDeviceIdentity(marker.deviceId)}`;
}

function looksLikeDashboardPlaceholderName(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === "default" || normalized === "device" || normalized === "现场设备" || normalized.startsWith("ble-");
}

function shortDashboardDeviceIdentity(value: string) {
  const normalized = value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (!normalized) {
    return "未识别";
  }
  return normalized.length <= 6 ? normalized : normalized.slice(-6);
}

function buildDashboardControllerIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6" y="4" width="12" height="16" rx="2.5"></rect>
      <path d="M9 2v2M15 2v2M9 20v2M15 20v2"></path>
      <circle cx="12" cy="9" r="1.6"></circle>
      <path d="M9.5 13h5M9.5 16h5"></path>
    </svg>
  `;
}

function buildDashboardGatewayIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 6a7 7 0 0 1 7 7"></path>
      <path d="M12 9a4 4 0 0 1 4 4"></path>
      <path d="M12 3a10 10 0 0 1 10 10"></path>
      <circle cx="12" cy="16.5" r="2.2"></circle>
    </svg>
  `;
}

function PanelHead({ title, to, action }: { title: string; to: string; action: string }) {
  return (
    <div className="sectionHead">
      <div>
        <h3>{title}</h3>
      </div>
      <Link className="inlineLink" to={to}>
        {action}
      </Link>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <article className="statCard">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function MetricBlock({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metricBlock">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EmptyHint({ title, text }: { title: string; text: string }) {
  return (
    <div className="emptyHint">
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

function average(values: number[]) {
  const valid = values.filter((value) => Number.isFinite(value));
  return valid.length ? sum(valid) / valid.length : 0;
}

function areaWeightedAverage<T extends { areaMu?: number }>(items: T[], selector: (item: T) => number) {
  const valid = items
    .map((item) => ({
      area: Number.isFinite(item.areaMu) && (item.areaMu ?? 0) > 0 ? item.areaMu ?? 0 : 1,
      value: selector(item),
    }))
    .filter((item) => Number.isFinite(item.value));
  const totalArea = sum(valid.map((item) => item.area));
  if (totalArea <= 0) {
    return 0;
  }
  return valid.reduce((total, item) => total + item.value * item.area, 0) / totalArea;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

function formatPlanMode(mode: IrrigationPlanSummary["mode"]) {
  switch (mode) {
    case "auto":
      return "允许策略执行";
    case "semi-auto":
      return "确认后执行";
    default:
      return "手动执行";
  }
}

function formatStrategyMode(mode: StrategySummary["mode"]) {
  switch (mode) {
    case "auto":
      return "自动执行";
    case "semi-auto":
      return "确认后执行";
    default:
      return "仅建议";
  }
}

function formatStrategyType(type: StrategySummary["type"]) {
  switch (type) {
    case "etc":
      return "ETc 灌溉";
    default:
      return "阈值灌溉";
  }
}
