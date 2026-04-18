import { useWorkspace } from "@/components/workspace-provider";

export function StrategiesPage() {
  const { strategies } = useWorkspace();

  return (
    <main className="workspacePage">
      <section className="sectionHead">
        <div>
          <h2>自动策略</h2>
        </div>
      </section>

      <section className="strategyGrid">
        {strategies.map((strategy) => (
          <article className="workspacePanel" key={strategy.id}>
            <div className="planPanelHead">
              <div>
                <div className="eyebrow">{strategy.mode}</div>
                <h3>{strategy.name}</h3>
                <p className="muted">{strategy.fieldName}</p>
              </div>
              <span className={`statusPill ${strategy.enabled ? "connected" : "disconnected"}`}>
                {strategy.enabled ? "启用中" : "已停用"}
              </span>
            </div>
            <div className="fieldMetaGrid">
              <div>
                <span>墒情下限</span>
                <strong>{strategy.moistureMin}%</strong>
              </div>
              <div>
                <span>恢复阈值</span>
                <strong>{strategy.moistureRecover}%</strong>
              </div>
              <div>
                <span>ETc 触发</span>
                <strong>{strategy.etcTriggerMm.toFixed(1)} mm</strong>
              </div>
              <div>
                <span>雨天锁定</span>
                <strong>{strategy.rainLockEnabled ? "开启" : "关闭"}</strong>
              </div>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
