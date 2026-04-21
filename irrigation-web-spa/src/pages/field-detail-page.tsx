import { useMemo } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useWorkspace } from "@/components/workspace-provider";
import { buildFieldDetail } from "@/lib/domain/workspace";
import { getCachedDeviceDetail } from "@/lib/client/thingsboard";

export function FieldDetailPage() {
  const params = useParams<{ fieldId: string }>();
  const { session, fields } = useWorkspace();
  const field = fields.find((item) => item.id === params.fieldId);

  const detail = useMemo(() => {
    if (!field) {
      return null;
    }
    const cachedDevice = getCachedDeviceDetail(session, field.deviceId);
    return buildFieldDetail(field, cachedDevice);
  }, [field, session]);

  if (!detail) {
    return <Navigate replace to="/map" />;
  }

  return (
    <main className="workspacePage">
      <section className="detailHero">
        <div>
          <div className="eyebrow">{detail.code}</div>
          <h2>{detail.name}</h2>
          <p className="muted">
            {detail.cropType} · {detail.growthStage} · {detail.areaMu} 亩
          </p>
        </div>
        <div className="detailMetrics">
          <div>
            <span>建议灌溉</span>
            <strong>{detail.suggestedDurationMinutes} 分钟</strong>
          </div>
          <div>
            <span>降雨预估</span>
            <strong>{detail.rainfallForecastMm.toFixed(1)} mm</strong>
          </div>
        </div>
      </section>

      <section className="twoColumnGrid">
        <article className="workspacePanel">
          <div className="sectionHead">
            <div>
              <h3>蒸散状态</h3>
            </div>
          </div>
          <div className="metricsRibbon">
            <div className="metricTile">
              <span>参考 ET0</span>
              <strong>{detail.et0.toFixed(1)} mm</strong>
            </div>
            <div className="metricTile">
              <span>作物系数 Kc</span>
              <strong>{detail.kc.toFixed(2)}</strong>
            </div>
            <div className="metricTile">
              <span>作物 ETc</span>
              <strong>{detail.etc.toFixed(2)} mm</strong>
            </div>
          </div>
          <p className="muted">
            ET0 与 ETc 由系统按气象数据和作物系数计算，仅用于展示和策略判断。更新时间：
            {formatEtUpdatedAt(detail.et0UpdatedAt)}
          </p>
        </article>

        <article className="workspacePanel">
          <div className="sectionHead">
            <div>
              <h3>运行概况</h3>
            </div>
          </div>
          <div className="metricsRibbon">
            <div className="metricTile">
              <span>土壤湿度</span>
              <strong>{detail.soilMoisture}%</strong>
            </div>
            <div className="metricTile">
              <span>电量</span>
              <strong>{detail.batteryLevel}%</strong>
            </div>
            <div className="metricTile">
              <span>分区数</span>
              <strong>{detail.zoneCount}</strong>
            </div>
          </div>
        </article>
      </section>

      <section className="workspacePanel">
        <div className="sectionHead">
          <div>
            <h3>分区与站点</h3>
          </div>
          <Link className="inlineLink" to={`/devices/${detail.deviceId}`}>
            查看现场设备
          </Link>
        </div>

        <div className="tableLike">
          {detail.zones.map((zone) => (
            <div className="tableRow" key={zone.id}>
              <strong>{zone.name}</strong>
              <span>{zone.open ? "灌溉中" : "待机"}</span>
              <span>剩余 {Math.round(zone.remainingSeconds / 60)} 分钟</span>
              <span>计划 {Math.round(zone.plannedDurationSeconds / 60)} 分钟</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function formatEtUpdatedAt(value: number) {
  if (!value) {
    return "暂无";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
