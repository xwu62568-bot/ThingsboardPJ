import { useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { useWorkspace } from "@/components/workspace-provider";
import {
  saveFieldAssetRecord,
  saveFieldAutomationStrategies,
  type TbAutomationStrategyConfig,
} from "@/lib/client/thingsboard";
import type { FieldSummary, StrategySummary } from "@/lib/domain/workspace";

type StrategyFormState = {
  id?: string;
  name: string;
  fieldId: string;
  enabled: boolean;
  moistureMin: string;
  moistureRecover: string;
  etcTriggerMm: string;
  rainLockEnabled: boolean;
  mode: "advisory" | "semi-auto" | "auto";
};

export function StrategiesPage() {
  const { session, fields, strategies, refreshWorkspace } = useWorkspace();
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<StrategyFormState>(() => buildEmptyForm(fields[0]));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const openCreate = () => {
    setForm(buildEmptyForm(fields[0]));
    setMessage("");
    setError("");
    setFormOpen(true);
  };

  const openEdit = (strategy: StrategySummary) => {
    setForm({
      id: strategy.id,
      name: strategy.name,
      fieldId: strategy.fieldId,
      enabled: strategy.enabled,
      moistureMin: String(strategy.moistureMin),
      moistureRecover: String(strategy.moistureRecover),
      etcTriggerMm: String(strategy.etcTriggerMm),
      rainLockEnabled: strategy.rainLockEnabled,
      mode: strategy.mode,
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
      const nextStrategy = buildStrategyConfig(form, realFieldId);
      const currentStrategies = strategies
        .filter((strategy) => strategy.fieldId === field.id || strategy.fieldId === realFieldId)
        .filter(
          (strategy) =>
            !form.id || strategy.id !== form.id || strategy.id.startsWith("strategy-field-"),
        )
        .map((strategy) => mapSummaryToConfig(strategy, realFieldId));
      await saveFieldAutomationStrategies({
        session,
        fieldId: realFieldId,
        strategies: dedupeStrategies([...currentStrategies, nextStrategy]),
      });
      await refreshWorkspace();
      setFormOpen(false);
      setMessage("自动策略已保存到 ThingsBoard");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "自动策略保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="workspacePage">
      <section className="moduleToolbar">
        <div>
          <h2>自动策略</h2>
          <p>配置墒情、作物蒸散和降雨锁定条件，作为自动灌溉决策依据。</p>
        </div>
        <button className="primaryButton" type="button" onClick={openCreate}>
          新增策略
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
              <h3>{form.id ? "编辑策略" : "新增策略"}</h3>
              <p>策略会保存到所选地块的服务端属性，自动执行后续接入规则链。</p>
            </div>
            <button className="ghostButton" type="button" onClick={() => setFormOpen(false)}>
              取消
            </button>
          </div>

          <form className="fieldEditorForm" onSubmit={submit}>
            <label>
              <span>策略名称</span>
              <input
                required
                value={form.name}
                onChange={(event) => setFormValue(setForm, "name", event.target.value)}
                placeholder="例如：东区墒情联动"
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
              <span>策略模式</span>
              <select
                value={form.mode}
                onChange={(event) =>
                  setFormValue(setForm, "mode", event.target.value as StrategyFormState["mode"])
                }
              >
                <option value="advisory">仅建议</option>
                <option value="semi-auto">确认后执行</option>
                <option value="auto">自动执行</option>
              </select>
            </label>
            <label>
              <span>墒情下限（%）</span>
              <input
                min="0"
                max="100"
                step="1"
                type="number"
                value={form.moistureMin}
                onChange={(event) => setFormValue(setForm, "moistureMin", event.target.value)}
              />
            </label>
            <label>
              <span>恢复阈值（%）</span>
              <input
                min="0"
                max="100"
                step="1"
                type="number"
                value={form.moistureRecover}
                onChange={(event) =>
                  setFormValue(setForm, "moistureRecover", event.target.value)
                }
              />
            </label>
            <label>
              <span>作物蒸散触发（mm）</span>
              <input
                min="0"
                max="30"
                step="0.1"
                type="number"
                value={form.etcTriggerMm}
                onChange={(event) => setFormValue(setForm, "etcTriggerMm", event.target.value)}
              />
            </label>
            <label className="checkboxLine">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) =>
                  setForm((current) => ({ ...current, enabled: event.target.checked }))
                }
              />
              <span>启用策略</span>
            </label>
            <label className="checkboxLine">
              <input
                type="checkbox"
                checked={form.rainLockEnabled}
                onChange={(event) =>
                  setForm((current) => ({ ...current, rainLockEnabled: event.target.checked }))
                }
              />
              <span>雨天锁定</span>
            </label>
            <div className="fieldEditorActions">
              <button className="ghostButton" type="button" onClick={() => setFormOpen(false)}>
                取消
              </button>
              <button className="primaryButton" type="submit" disabled={saving}>
                {saving ? "保存中..." : "保存策略"}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="strategyGrid">
        {strategies.map((strategy) => (
          <article className="workspacePanel" key={strategy.id}>
            <div className="planPanelHead">
              <div>
                <div className="eyebrow">{formatStrategyMode(strategy.mode)}</div>
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
                <span>作物蒸散触发</span>
                <strong>{strategy.etcTriggerMm.toFixed(1)} mm</strong>
              </div>
              <div>
                <span>雨天锁定</span>
                <strong>{strategy.rainLockEnabled ? "开启" : "关闭"}</strong>
              </div>
            </div>
            <div className="planActions">
              <button className="ghostButton" type="button" onClick={() => openEdit(strategy)}>
                编辑
              </button>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}

function buildEmptyForm(field?: FieldSummary): StrategyFormState {
  return {
    name: field ? `${field.name} 自动策略` : "",
    fieldId: field?.id ?? "",
    enabled: true,
    moistureMin: "28",
    moistureRecover: "36",
    etcTriggerMm: "4",
    rainLockEnabled: true,
    mode: "advisory",
  };
}

function buildStrategyConfig(
  form: StrategyFormState,
  fieldId: string,
): TbAutomationStrategyConfig {
  return {
    id:
      form.id && !form.id.startsWith("strategy-field-")
        ? form.id
        : `automation-${Date.now()}`,
    name: form.name.trim(),
    fieldId,
    enabled: form.enabled,
    moistureMin: clampNumber(Number(form.moistureMin), 0, 100),
    moistureRecover: clampNumber(Number(form.moistureRecover), 0, 100),
    etcTriggerMm: clampNumber(Number(form.etcTriggerMm), 0, 30),
    rainLockEnabled: form.rainLockEnabled,
    mode: form.mode,
  };
}

function mapSummaryToConfig(
  strategy: StrategySummary,
  fieldId: string,
): TbAutomationStrategyConfig {
  return {
    id: strategy.id,
    name: strategy.name,
    fieldId,
    enabled: strategy.enabled,
    moistureMin: strategy.moistureMin,
    moistureRecover: strategy.moistureRecover,
    etcTriggerMm: strategy.etcTriggerMm,
    rainLockEnabled: strategy.rainLockEnabled,
    mode: strategy.mode,
  };
}

async function ensureThingsBoardField(
  session: Parameters<typeof saveFieldAssetRecord>[0]["session"],
  field: FieldSummary,
) {
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

function dedupeStrategies(strategies: TbAutomationStrategyConfig[]) {
  const byId = new Map<string, TbAutomationStrategyConfig>();
  for (const strategy of strategies) {
    byId.set(strategy.id, strategy);
  }
  return Array.from(byId.values());
}

function setFormValue(
  setForm: Dispatch<SetStateAction<StrategyFormState>>,
  key: keyof StrategyFormState,
  value: string | boolean,
) {
  setForm((current) => ({ ...current, [key]: value }));
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

function isThingsBoardId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function formatStrategyMode(mode: "advisory" | "semi-auto" | "auto") {
  switch (mode) {
    case "auto":
      return "自动执行";
    case "semi-auto":
      return "确认后执行";
    default:
      return "仅建议";
  }
}
