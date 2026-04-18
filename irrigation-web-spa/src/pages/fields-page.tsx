import { Link } from "react-router-dom";
import { useWorkspace } from "@/components/workspace-provider";

export function FieldsPage() {
  const { fields } = useWorkspace();

  return (
    <main className="workspacePage">
      <section className="sectionHead">
        <div>
          <h2>地块中心</h2>
        </div>
      </section>

      <section className="fieldCardGrid">
        {fields.map((field) => (
          <Link className="fieldCard" key={field.id} to={`/fields/${field.id}`}>
            <div className="fieldCardTop">
              <div>
                <div className="eyebrow">{field.code}</div>
                <h3>{field.name}</h3>
              </div>
              <span className={`statusPill ${mapStateToPill(field.irrigationState)}`}>
                {formatFieldState(field.irrigationState)}
              </span>
            </div>

            <div className="fieldMetaGrid">
              <div>
                <span>作物</span>
                <strong>{field.cropType}</strong>
              </div>
              <div>
                <span>生育期</span>
                <strong>{field.growthStage}</strong>
              </div>
              <div>
                <span>面积</span>
                <strong>{field.areaMu} 亩</strong>
              </div>
              <div>
                <span>分区</span>
                <strong>{field.zoneCount} 个</strong>
              </div>
            </div>

            <div className="fieldMetricsBar">
              <span>湿度 {field.soilMoisture}%</span>
              <span>ET0 {field.et0.toFixed(1)}</span>
              <span>Kc {field.kc.toFixed(2)}</span>
              <span>ETc {field.etc.toFixed(2)}</span>
            </div>
          </Link>
        ))}
      </section>
    </main>
  );
}

function formatFieldState(state: "idle" | "running" | "attention") {
  switch (state) {
    case "running":
      return "灌溉中";
    case "attention":
      return "需关注";
    default:
      return "待执行";
  }
}

function mapStateToPill(state: "idle" | "running" | "attention") {
  switch (state) {
    case "running":
      return "connected";
    case "attention":
      return "error";
    default:
      return "connecting";
  }
}
