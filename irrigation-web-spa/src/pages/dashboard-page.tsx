import { Link } from "react-router-dom";
import { useWorkspace } from "@/components/workspace-provider";

export function DashboardPage() {
  const { dashboard, fields, plans, strategies } = useWorkspace();
  const featuredFields = fields.slice(0, 3);

  return (
    <main className="workspacePage">
      <section className="operationsBar">
        <div>
          <div className="eyebrow">Today</div>
          <h2>今日概况</h2>
        </div>
        <div className="heroActions">
          <Link className="primaryButton" to="/fields">
            地块管理
          </Link>
          <Link className="ghostButton" to="/plans">
            轮灌计划
          </Link>
        </div>
      </section>

      <section className="statsGrid">
        <StatCard label="地块数" value={dashboard.totalFields} />
        <StatCard label="在线设备" value={dashboard.onlineDevices} />
        <StatCard label="灌溉中" value={dashboard.runningZones} />
        <StatCard label="平均电量" value={`${dashboard.averageBatteryLevel.toFixed(0)}%`} />
        <StatCard label="平均 ET0" value={`${dashboard.averageEt0.toFixed(1)} mm`} />
        <StatCard label="平均 ETc" value={`${dashboard.averageEtc.toFixed(1)} mm`} />
      </section>

      <section className="twoColumnGrid">
        <article className="workspacePanel">
          <div className="sectionHead">
            <div>
              <div className="eyebrow">Field Focus</div>
              <h3>重点地块</h3>
            </div>
            <Link className="inlineLink" to="/map">
              打开地图
            </Link>
          </div>
          <div className="stackList">
            {featuredFields.map((field) => (
              <Link className="fieldStrip" key={field.id} to={`/fields/${field.id}`}>
                <div>
                  <strong>{field.name}</strong>
                  <p>
                    {field.cropType} · {field.growthStage} · {field.zoneCount} 个分区
                  </p>
                </div>
                <div className="fieldStripMetrics">
                  <span>{field.soilMoisture}% 湿度</span>
                  <span>{field.etc.toFixed(2)} ETc</span>
                </div>
              </Link>
            ))}
          </div>
        </article>

        <article className="workspacePanel">
          <div className="sectionHead">
            <div>
              <div className="eyebrow">Automation</div>
              <h3>今日执行建议</h3>
            </div>
          </div>
          <div className="stackList">
            {plans.slice(0, 2).map((plan) => (
              <div className="summaryCard" key={plan.id}>
                <strong>{plan.name}</strong>
                <p>
                  {plan.fieldName} · {plan.startAt} · {plan.totalDurationMinutes} 分钟
                </p>
              </div>
            ))}
            {strategies.slice(0, 2).map((strategy) => (
              <div className="summaryCard" key={strategy.id}>
                <strong>{strategy.name}</strong>
                <p>
                  触发 ETc {strategy.etcTriggerMm.toFixed(1)} mm · 墒情下限 {strategy.moistureMin}%
                </p>
              </div>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <article className="statCard">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}
