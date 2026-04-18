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
    return <Navigate replace to="/fields" />;
  }

  return (
    <main className="workspacePage">
      <section className="detailHero">
        <div>
          <Link className="backLink" to="/fields">
            返回地块列表
          </Link>
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
              <div className="eyebrow">ET Insight</div>
              <h3>蒸散与策略输入</h3>
            </div>
          </div>
          <div className="metricsRibbon">
            <div className="metricTile">
              <span>ET0</span>
              <strong>{detail.et0.toFixed(1)} mm</strong>
            </div>
            <div className="metricTile">
              <span>Kc</span>
              <strong>{detail.kc.toFixed(2)}</strong>
            </div>
            <div className="metricTile">
              <span>ETc</span>
              <strong>{detail.etc.toFixed(2)} mm</strong>
            </div>
          </div>
          <p className="muted">
            结合 ET0、植物系数和 ETc，判断当前耗水水平并估算后续灌溉节奏。
          </p>
        </article>

        <article className="workspacePanel">
          <div className="sectionHead">
            <div>
              <div className="eyebrow">Field Status</div>
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
            <div className="eyebrow">Zones</div>
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
