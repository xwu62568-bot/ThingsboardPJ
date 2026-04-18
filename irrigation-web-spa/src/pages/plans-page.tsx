import { useWorkspace } from "@/components/workspace-provider";

export function PlansPage() {
  const { plans } = useWorkspace();

  return (
    <main className="workspacePage">
      <section className="sectionHead">
        <div>
          <h2>轮灌计划</h2>
        </div>
      </section>

      <section className="stackList">
        {plans.map((plan) => (
          <article className="workspacePanel planPanel" key={plan.id}>
            <div className="planPanelHead">
              <div>
                <div className="eyebrow">{plan.mode}</div>
                <h3>{plan.name}</h3>
                <p className="muted">
                  {plan.fieldName} · {plan.zoneCount} 个分区 · {plan.totalDurationMinutes} 分钟
                </p>
              </div>
              <span className={`statusPill ${plan.enabled ? "connected" : "disconnected"}`}>
                {plan.enabled ? "已启用" : "已停用"}
              </span>
            </div>
            <div className="planMetaRow">
              <span>执行时间 {plan.startAt}</span>
              <span>{plan.skipIfRain ? "雨天跳过" : "雨天照常"}</span>
              <span>模式 {plan.mode}</span>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
