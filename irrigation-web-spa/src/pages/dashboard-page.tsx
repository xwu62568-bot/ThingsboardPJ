import { Link } from "react-router-dom";
import { useWorkspace } from "@/components/workspace-provider";
import type { FieldSummary, IrrigationPlanSummary, StrategySummary } from "@/lib/domain/workspace";

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

export function DashboardPage() {
  const { dashboard, fields, plans, strategies } = useWorkspace();
  const duePlans = buildDuePlans(plans).slice(0, 5);
  const fieldRisks = buildFieldRisks(fields).slice(0, 5);
  const decision = buildDecision(fields, duePlans, strategies);
  const waterBalance = buildWaterBalance(fields);
  const strategyState = buildStrategyState(strategies);

  return (
    <main className="workspacePage dashboardCockpit">
      <section className={`decisionPanel decisionPanel--${decision.level}`}>
        <div>
          <span className="eyebrow">今日灌溉决策</span>
          <h2>{decision.title}</h2>
          <p>{decision.reason}</p>
        </div>
        <div className="decisionMetrics">
          <MetricBlock label="待执行计划" value={duePlans.length} />
          <MetricBlock label="预计时长" value={`${decision.durationMinutes} 分钟`} />
          <MetricBlock label="风险地块" value={fieldRisks.filter((field) => field.riskLevel !== "低").length} />
          <MetricBlock label="自动策略" value={strategyState.autoEnabled} />
        </div>
      </section>

      <section className="statsGrid">
        <StatCard label="地块数" value={dashboard.totalFields} />
        <StatCard label="平均湿度" value={`${average(fields.map((field) => field.soilMoisture)).toFixed(0)}%`} />
        <StatCard label="平均 ET0" value={`${dashboard.averageEt0.toFixed(1)} mm`} />
        <StatCard label="平均 ETc" value={`${dashboard.averageEtc.toFixed(1)} mm`} />
        <StatCard label="启用策略" value={strategyState.enabled} />
      </section>

      <section className="dashboardGrid">
        <article className="workspacePanel">
          <PanelHead title="待执行计划" to="/plans" action="管理计划" />
          <div className="stackList">
            {duePlans.length > 0 ? (
              duePlans.map((plan) => (
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
          <PanelHead title="地块风险排行" to="/map" action="查看地图" />
          <div className="stackList">
            {fieldRisks.length > 0 ? (
              fieldRisks.map((field) => (
                <Link className="riskItem" key={field.id} to={`/fields/${field.id}`}>
                  <div className={`riskBadge riskBadge--${field.riskLevel}`}>{field.riskLevel}</div>
                  <div>
                    <strong>{field.name}</strong>
                    <p>{field.riskReason}</p>
                  </div>
                  <div className="riskMetrics">
                    <span>{field.soilMoisture}%</span>
                    <em>缺水 {field.deficitMm.toFixed(1)}mm</em>
                  </div>
                </Link>
              ))
            ) : (
              <EmptyHint title="暂无地块数据" text="先在地块地图中创建地块和分区。" />
            )}
          </div>
        </article>

        <article className="workspacePanel waterBalancePanel">
          <PanelHead title="ET / ETc 水分平衡" to="/strategies" action="配置策略" />
          <div className="waterBalanceHero">
            <span>净缺水</span>
            <strong>{waterBalance.netDeficitMm.toFixed(1)} mm</strong>
            <p>
              ETc 消耗 {waterBalance.etcMm.toFixed(1)}mm，估算有效降雨 {waterBalance.effectiveRainMm.toFixed(1)}mm。
            </p>
          </div>
          <div className="waterBalanceRows">
            <MetricBlock label="ET0 总量" value={`${waterBalance.et0Mm.toFixed(1)} mm`} />
            <MetricBlock label="平均 Kc" value={waterBalance.averageKc.toFixed(2)} />
            <MetricBlock label="建议补水" value={`${waterBalance.suggestWaterMm.toFixed(1)} mm`} />
          </div>
        </article>

        <article className="workspacePanel">
          <PanelHead title="自动策略状态" to="/strategies" action="管理策略" />
          <div className="strategyStatusGrid">
            <MetricBlock label="启用策略" value={strategyState.enabled} />
            <MetricBlock label="自动执行" value={strategyState.autoEnabled} />
            <MetricBlock label="雨天锁定" value={strategyState.rainLocked} />
            <MetricBlock label="已触发" value={strategyState.triggered} />
          </div>
          <div className="stackList">
            {strategies.slice(0, 3).map((strategy) => (
              <Link className="summaryCard strategySummaryLink" key={strategy.id} to={`/strategies/${strategy.id}`}>
                <strong>{strategy.name}</strong>
                <p>
                  {formatStrategyType(strategy.type)} · {formatStrategyMode(strategy.mode)} · {strategy.enabled ? "启用" : "停用"}
                </p>
              </Link>
            ))}
            {strategies.length === 0 ? (
              <EmptyHint title="暂无自动策略" text="可创建阈值、定量或 ETc 策略作为计划执行判断。" />
            ) : null}
          </div>
        </article>
      </section>
    </main>
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

function buildWaterBalance(fields: FieldSummary[]) {
  const et0Mm = sum(fields.map((field) => field.et0));
  const etcMm = sum(fields.map((field) => field.etc));
  const averageKc = average(fields.map((field) => field.kc));
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

function buildStrategyState(strategies: StrategySummary[]) {
  const enabledStrategies = strategies.filter((strategy) => strategy.enabled);
  return {
    enabled: enabledStrategies.length,
    autoEnabled: enabledStrategies.filter((strategy) => strategy.mode === "auto").length,
    rainLocked: enabledStrategies.filter((strategy) => strategy.rainLockEnabled).length,
    triggered: enabledStrategies.filter((strategy) => strategy.mode === "auto").length,
  };
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
    case "quota":
      return "定量灌溉";
    case "etc":
      return "ETc 灌溉";
    default:
      return "阈值灌溉";
  }
}
