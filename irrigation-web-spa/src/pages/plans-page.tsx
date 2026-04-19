import { useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { useWorkspace } from "@/components/workspace-provider";
import {
  saveFieldAssetRecord,
  saveFieldRotationPlans,
  type TbRotationPlanConfig,
} from "@/lib/client/thingsboard";
import type { FieldSummary, IrrigationPlanSummary } from "@/lib/domain/workspace";

type PlanFormState = {
  id?: string;
  name: string;
  fieldId: string;
  startAt: string;
  enabled: boolean;
  skipIfRain: boolean;
  mode: "manual" | "semi-auto" | "auto";
  zoneCount: string;
  durationMinutes: string;
};

export function PlansPage() {
  const { session, fields, plans, refreshWorkspace } = useWorkspace();
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<PlanFormState>(() => buildEmptyForm(fields[0]));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const openCreate = () => {
    setForm(buildEmptyForm(fields[0]));
    setMessage("");
    setError("");
    setFormOpen(true);
  };

  const openEdit = (plan: IrrigationPlanSummary) => {
    setForm({
      id: plan.id,
      name: plan.name,
      fieldId: plan.fieldId,
      startAt: plan.startAt,
      enabled: plan.enabled,
      skipIfRain: plan.skipIfRain,
      mode: plan.mode,
      zoneCount: String(plan.zoneCount || 1),
      durationMinutes: String(plan.zones[0]?.durationMinutes || 10),
    });
    setMessage("");
    setError("");
    setFormOpen(true);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const field = fields.find((item) => item.id === form.fieldId) ?? fields[0];
      if (!field) {
        throw new Error("请先创建地块");
      }
      const realFieldId = await ensureThingsBoardField(session, field);
      const nextPlan = buildPlanConfig(form, realFieldId);
      const currentPlans = plans
        .filter((plan) => plan.fieldId === field.id || plan.fieldId === realFieldId)
        .filter((plan) => !form.id || plan.id !== form.id || plan.id.startsWith("plan-field-"))
        .map((plan) => mapSummaryToConfig(plan, realFieldId));
      const nextPlans = [...currentPlans, nextPlan];
      await saveFieldRotationPlans({
        session,
        fieldId: realFieldId,
        plans: dedupePlans(nextPlans),
      });
      await refreshWorkspace();
      setFormOpen(false);
      setMessage("轮灌计划已保存到 ThingsBoard");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "轮灌计划保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="workspacePage">
      <section className="moduleToolbar">
        <div>
          <h2>轮灌计划</h2>
          <p>为地块配置按分区依次执行的灌溉计划。</p>
        </div>
        <button className="primaryButton" type="button" onClick={openCreate}>
          新增计划
        </button>
      </section>

      {(message || error) && (
        <div className={`noticeBar ${error ? "noticeBar--error" : ""}`}>
          {error || message}
        </div>
      )}

      {formOpen && (
        <section className="workspacePanel fieldEditorPanel">
          <div className="sectionHead">
            <div>
              <h3>{form.id ? "编辑计划" : "新增计划"}</h3>
              <p>计划会保存到所选地块的服务端属性，自动执行后续接入规则链。</p>
            </div>
            <button className="ghostButton" type="button" onClick={() => setFormOpen(false)}>
              取消
            </button>
          </div>

          <form className="fieldEditorForm" onSubmit={submit}>
            <label>
              <span>计划名称</span>
              <input
                required
                value={form.name}
                onChange={(event) => setFormValue(setForm, "name", event.target.value)}
                placeholder="例如：东区晨间轮灌"
              />
            </label>
            <label>
              <span>所属地块</span>
              <select
                required
                value={form.fieldId}
                onChange={(event) => setFormValue(setForm, "fieldId", event.target.value)}
              >
                {fields.map((field) => (
                  <option key={field.id} value={field.id}>
                    {field.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>执行时间</span>
              <input
                required
                type="time"
                value={form.startAt}
                onChange={(event) => setFormValue(setForm, "startAt", event.target.value)}
              />
            </label>
            <label>
              <span>执行模式</span>
              <select
                value={form.mode}
                onChange={(event) =>
                  setFormValue(setForm, "mode", event.target.value as PlanFormState["mode"])
                }
              >
                <option value="manual">手动执行</option>
                <option value="semi-auto">确认后执行</option>
                <option value="auto">自动执行</option>
              </select>
            </label>
            <label>
              <span>分区数量</span>
              <input
                min="1"
                max="64"
                step="1"
                type="number"
                value={form.zoneCount}
                onChange={(event) => setFormValue(setForm, "zoneCount", event.target.value)}
              />
            </label>
            <label>
              <span>每区时长（分钟）</span>
              <input
                min="1"
                max="240"
                step="1"
                type="number"
                value={form.durationMinutes}
                onChange={(event) => setFormValue(setForm, "durationMinutes", event.target.value)}
              />
            </label>
            <label className="checkboxLine">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))}
              />
              <span>启用计划</span>
            </label>
            <label className="checkboxLine">
              <input
                type="checkbox"
                checked={form.skipIfRain}
                onChange={(event) =>
                  setForm((current) => ({ ...current, skipIfRain: event.target.checked }))
                }
              />
              <span>雨天跳过</span>
            </label>
            <div className="fieldEditorActions">
              <button className="ghostButton" type="button" onClick={() => setFormOpen(false)}>
                取消
              </button>
              <button className="primaryButton" type="submit" disabled={saving}>
                {saving ? "保存中..." : "保存计划"}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="stackList">
        {plans.map((plan) => (
          <article className="workspacePanel planPanel" key={plan.id}>
            <div className="planPanelHead">
              <div>
                <div className="eyebrow">{formatPlanMode(plan.mode)}</div>
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
              <span>模式 {formatPlanMode(plan.mode)}</span>
            </div>
            <div className="planActions">
              <button className="ghostButton" type="button" onClick={() => openEdit(plan)}>
                编辑
              </button>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}

function buildEmptyForm(field?: FieldSummary): PlanFormState {
  return {
    name: field ? `${field.name} 轮灌计划` : "",
    fieldId: field?.id ?? "",
    startAt: "05:30",
    enabled: true,
    skipIfRain: true,
    mode: "semi-auto",
    zoneCount: String(field?.zoneCount || 1),
    durationMinutes: "10",
  };
}

function buildPlanConfig(form: PlanFormState, fieldId: string): TbRotationPlanConfig {
  const zoneCount = clampInt(Number(form.zoneCount), 1, 64);
  const durationMinutes = clampInt(Number(form.durationMinutes), 1, 240);
  return {
    id: form.id && !form.id.startsWith("plan-field-") ? form.id : `rotation-${Date.now()}`,
    name: form.name.trim(),
    fieldId,
    startAt: form.startAt,
    enabled: form.enabled,
    skipIfRain: form.skipIfRain,
    mode: form.mode,
    zones: Array.from({ length: zoneCount }, (_, index) => ({
      siteNumber: index + 1,
      durationMinutes,
    })),
  };
}

function mapSummaryToConfig(
  plan: IrrigationPlanSummary,
  fieldId: string,
): TbRotationPlanConfig {
  return {
    id: plan.id,
    name: plan.name,
    fieldId,
    startAt: plan.startAt,
    enabled: plan.enabled,
    skipIfRain: plan.skipIfRain,
    mode: plan.mode,
    zones: plan.zones,
  };
}

async function ensureThingsBoardField(session: Parameters<typeof saveFieldAssetRecord>[0]["session"], field: FieldSummary) {
  if (isThingsBoardId(field.id)) {
    return field.id;
  }
  const saved = await saveFieldAssetRecord({
    session,
    name: field.name,
    config: {
      code: field.code,
      cropType: field.cropType,
      growthStage: field.growthStage,
      areaMu: field.areaMu,
      centerLat: field.centerLat,
      centerLng: field.centerLng,
      deviceId: field.deviceId,
      zoneCount: field.zoneCount,
      kc: field.kc,
      irrigationEfficiency: 0.85,
    },
  });
  return saved.id;
}

function dedupePlans(plans: TbRotationPlanConfig[]) {
  const byId = new Map<string, TbRotationPlanConfig>();
  for (const plan of plans) {
    byId.set(plan.id, plan);
  }
  return Array.from(byId.values());
}

function setFormValue(
  setForm: Dispatch<SetStateAction<PlanFormState>>,
  key: keyof PlanFormState,
  value: string | boolean,
) {
  setForm((current) => ({ ...current, [key]: value }));
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}

function isThingsBoardId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function formatPlanMode(mode: "manual" | "semi-auto" | "auto") {
  switch (mode) {
    case "auto":
      return "自动执行";
    case "semi-auto":
      return "确认后执行";
    default:
      return "手动执行";
  }
}
