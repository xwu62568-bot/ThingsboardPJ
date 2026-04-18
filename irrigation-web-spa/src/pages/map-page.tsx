import { Link } from "react-router-dom";
import { useWorkspace } from "@/components/workspace-provider";

export function MapPage() {
  const { fields } = useWorkspace();

  return (
    <main className="workspacePage">
      <section className="mapHero">
        <article className="mapSurface">
          <div className="mapSurfaceHead">
            <div>
              <h2>灌区地图</h2>
            </div>
            <span className="mapBadge">地块与设备分布</span>
          </div>

          <div className="mockMapCanvas">
            <div className="mapGrid" />
            {fields.slice(0, 6).map((field, index) => (
              <Link
                className={`mapPin ${field.irrigationState}`}
                key={field.id}
                style={{
                  left: `${14 + (index % 3) * 28}%`,
                  top: `${18 + Math.floor(index / 3) * 32}%`,
                }}
                to={`/fields/${field.id}`}
              >
                <strong>{field.code}</strong>
                <span>{field.name}</span>
              </Link>
            ))}
          </div>
        </article>

        <aside className="workspacePanel mapLegend">
          <div className="sectionHead">
            <div>
              <h3>状态说明</h3>
            </div>
          </div>
          <ul className="bulletList">
            <li>绿色：灌溉中</li>
            <li>橙色：需关注</li>
            <li>白色：正常待机</li>
          </ul>
          <div className="legendMetrics">
            <div>
              <span>地块</span>
              <strong>{fields.length}</strong>
            </div>
            <div>
              <span>运行中</span>
              <strong>{fields.filter((field) => field.irrigationState === "running").length}</strong>
            </div>
          </div>
        </aside>
      </section>

      <section className="workspacePanel">
        <div className="sectionHead">
          <div>
            <h3>地图中的地块</h3>
          </div>
        </div>
        <div className="tableLike">
          {fields.map((field) => (
            <div className="tableRow" key={field.id}>
              <strong>{field.name}</strong>
              <span>{field.centerLat.toFixed(4)}, {field.centerLng.toFixed(4)}</span>
              <span>{field.cropType}</span>
              <span>{field.zoneCount} 分区</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
