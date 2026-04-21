import { useEffect, useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useWorkspace } from "@/components/workspace-provider";
import {
  saveFieldAssetRecord,
  saveFieldAutomationStrategies,
  type TbAutomationStrategyConfig,
} from "@/lib/client/thingsboard";
import type { FieldSummary, StrategySummary } from "@/lib/domain/workspace";

type StrategyType = "threshold" | "etc";

type StrategyFormState = {
  id?: string;
  name: string;
  fieldId: string;
  type: StrategyType;
  enabled: boolean;
  scope: "field" | "zones";
  zoneIds: string[];
  moistureMin: string;
  moistureRecover: string;
  etcTriggerMm: string;
  targetWaterMm: string;
  targetWaterM3PerMu: string;
  flowRateM3h: string;
  irrigationEfficiency: string;
  effectiveRainfallRatio: string;
  replenishRatio: string;
  executionMode: "duration" | "quota" | "etc";
  minIntervalHours: string;
  maxDurationMinutes: string;
  splitRounds: boolean;
  rainLockEnabled: boolean;
  mode: "advisory" | "semi-auto" | "auto";
};

const STRATEGY_TYPES: Array<{ type: StrategyType; title: string; desc: string }> = [
  { type: "threshold", title: "阈值灌溉", desc: "根据土壤湿度下限和恢复阈值触发灌溉。" },
  { type: "etc", title: "ETc 灌溉", desc: "按 ET0、作物系数、有效降雨和缺水阈值决策。" },
];

export function StrategiesPage() {
  const { session, fields, strategies, refreshFields } = useWorkspace();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ strategyId: string }>();
  const isCreateMode = location.pathname === "/strategies/new";
  const isEditMode = Boolean(params.strategyId);
  const editorOpen = isCreateMode || isEditMode;
  const editingStrategy = isEditMode
    ? strategies.find((strategy) => strategy.id === params.strategyId)
    : undefined;
  const [form, setForm] = useState<StrategyFormState>(() => buildEmptyForm(fields[0]));
  const [saving, setSaving] = useState(false);
  const [updatingStrategyId, setUpdatingStrategyId] = useState("");
  const [deletingStrategyId, setDeletingStrategyId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selectedField = useMemo(
    () => fields.find((item) => item.id === form.fieldId),
    [fields, form.fieldId],
  );

  const openEdit = (strategy: StrategySummary) => {
    setMessage("");
    setError("");
    navigate(`/strategies/${strategy.id}`);
  };

  useEffect(() => {
    if (!editorOpen) {
      return;
    }
    if (isCreateMode) {
      setForm(buildEmptyForm(fields[0]));
      return;
    }
    if (editingStrategy) {
      setForm(mapStrategyToForm(editingStrategy));
    }
  }, [editorOpen, editingStrategy, fields, isCreateMode]);

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
      validateStrategyForm(form, field);
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
      await refreshFields();
      navigate("/strategies");
      setMessage("自动策略已保存到 ThingsBoard");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "自动策略保存失败");
    } finally {
      setSaving(false);
    }
  };

  const toggleStrategyEnabled = async (strategy: StrategySummary) => {
    setUpdatingStrategyId(strategy.id);
    setMessage("");
    setError("");
    try {
      await saveStrategiesForField(
        session,
        fields,
        strategies.map((item) =>
          item.id === strategy.id ? { ...item, enabled: !item.enabled } : item,
        ),
        strategy.fieldId,
      );
      await refreshFields();
      setMessage(strategy.enabled ? "策略已停用" : "策略已启用");
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "策略状态更新失败");
    } finally {
      setUpdatingStrategyId("");
    }
  };

  const deleteStrategy = async (strategy: StrategySummary) => {
    if (!window.confirm(`确认删除「${strategy.name}」？`)) {
      return;
    }
    setDeletingStrategyId(strategy.id);
    setMessage("");
    setError("");
    try {
      await saveStrategiesForField(
        session,
        fields,
        strategies.filter((item) => item.id !== strategy.id),
        strategy.fieldId,
      );
      await refreshFields();
      setMessage("策略已删除");
      if (params.strategyId === strategy.id) {
        navigate("/strategies");
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "策略删除失败");
    } finally {
      setDeletingStrategyId("");
    }
  };

  if (editorOpen) {
    return (
      <main className="workspacePage">
        <nav className="detailTopNav" aria-label="策略编辑导航">
          <Link className="backLink" to="/strategies">
            返回自动策略
          </Link>
        </nav>
        {(message || error) && (
          <div className={`noticeBar ${error ? "noticeBar--error" : ""}`}>
            {error || message}
          </div>
        )}
        {isEditMode && !editingStrategy ? (
          <section className="workspacePanel emptyStatePanel">
            <h3>未找到策略</h3>
            <p className="muted">该策略可能已删除或尚未加载完成。</p>
          </section>
        ) : (
        <section className="workspacePanel fieldEditorPanel strategyEditorPanel">
          <div className="sectionHead">
            <div>
              <h3>{isCreateMode ? "新增策略" : "编辑策略"}</h3>
              <p>策略保存到所选地块，后续由规则链在计划执行前判断。</p>
            </div>
            <button className="ghostButton" type="button" onClick={() => navigate("/strategies")}>
              取消
            </button>
          </div>

          <form className="fieldEditorForm" onSubmit={submit}>
            <div className="strategyTypePicker">
              {STRATEGY_TYPES.map((item) => (
                <button
                  className={`strategyTypeCard${form.type === item.type ? " active" : ""}`}
                  key={item.type}
                  type="button"
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      type: item.type,
                      executionMode: item.type === "etc" ? "etc" : current.executionMode === "etc" ? "duration" : current.executionMode,
                      name:
                        !current.name || STRATEGY_TYPES.some((type) => current.name.includes(type.title))
                          ? `${selectedField?.name ?? ""} ${item.title}`
                          : current.name,
                    }))
                  }
                >
                  <strong>{item.title}</strong>
                  <span>{item.desc}</span>
                </button>
              ))}
            </div>

            <label>
              <span>策略名称</span>
              <input
                required
                value={form.name}
                onChange={(event) => setFormValue(setForm, "name", event.target.value)}
                placeholder="例如：东区 ETc 智能补水"
              />
            </label>
            <label>
              <span>所属地块</span>
              <select
                required
                value={form.fieldId}
                onChange={(event) => {
                  const nextField = fields.find((field) => field.id === event.target.value);
                  setForm((current) => ({
                    ...current,
                    fieldId: event.target.value,
                    zoneIds: [],
                    name:
                      !current.name || fields.some((field) => current.name.startsWith(field.name))
                        ? `${nextField?.name ?? ""} ${formatStrategyType(current.type)}`
                        : current.name,
                  }));
                }}
              >
                {fields.map((field) => (
                  <option key={field.id} value={field.id}>
                    {field.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>执行模式</span>
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
              <span>作用范围</span>
              <select
                value={form.scope}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    scope: event.target.value as StrategyFormState["scope"],
                    zoneIds: event.target.value === "field" ? [] : current.zoneIds,
                  }))
                }
              >
                <option value="field">整个地块</option>
                <option value="zones">指定分区</option>
              </select>
            </label>

            {form.scope === "zones" ? (
              <div className="strategyZonePicker">
                <span>选择分区</span>
                <div>
                  {(selectedField?.mapZones ?? []).map((zone) => (
                    <label className="checkboxLine" key={zone.id}>
                      <input
                        type="checkbox"
                        checked={form.zoneIds.includes(zone.id)}
                        onChange={(event) => toggleZone(setForm, zone.id, event.target.checked)}
                      />
                      <span>{zone.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            {form.type === "threshold" ? (
              <ThresholdFields form={form} setForm={setForm} />
            ) : null}
            {form.type === "etc" ? <EtcFields form={form} setForm={setForm} /> : null}
            <ExecutionFields form={form} setForm={setForm} />

            <label>
              <span>最短触发间隔（小时）</span>
              <input
                min="1"
                max="168"
                step="1"
                type="number"
                value={form.minIntervalHours}
                onChange={(event) => setFormValue(setForm, "minIntervalHours", event.target.value)}
              />
            </label>
            <label>
              <span>单次最长时长（分钟）</span>
              <input
                min="1"
                max="360"
                step="1"
                type="number"
                value={form.maxDurationMinutes}
                onChange={(event) => setFormValue(setForm, "maxDurationMinutes", event.target.value)}
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
              <button className="ghostButton" type="button" onClick={() => navigate("/strategies")}>
                取消
              </button>
              <button className="primaryButton" type="submit" disabled={saving}>
                {saving ? "保存中..." : "保存策略"}
              </button>
            </div>
          </form>
        </section>
      )}
      </main>
    );
  }

  return (
    <main className="workspacePage">
      {(message || error) && (
        <div className={`noticeBar ${error ? "noticeBar--error" : ""}`}>
          {error || message}
        </div>
      )}
      <section className="strategyGrid">
        {strategies.map((strategy) => (
          <article className="workspacePanel strategyCard" key={strategy.id}>
            <div className="planPanelHead">
              <div>
                <div className="eyebrow">{formatStrategyMode(strategy.mode)}</div>
                <h3>{strategy.name}</h3>
                <p className="muted">
                  {strategy.fieldName} · {formatStrategyType(strategy.type)}
                </p>
              </div>
              <span className={`statusPill ${strategy.enabled ? "connected" : "disconnected"}`}>
                {strategy.enabled ? "启用中" : "已停用"}
              </span>
            </div>
            <div className="strategySummary">
              <strong>{formatStrategyPrimaryValue(strategy)}</strong>
              <span>{formatStrategyScope(strategy)}</span>
            </div>
            <div className="fieldMetaGrid">
              {buildStrategyMetrics(strategy).map((metric) => (
                <div key={metric.label}>
                  <span>{metric.label}</span>
                  <strong>{metric.value}</strong>
                </div>
              ))}
            </div>
            <div className="planActions">
              <button
                className="ghostButton"
                type="button"
                disabled={updatingStrategyId === strategy.id}
                onClick={() => void toggleStrategyEnabled(strategy)}
              >
                {strategy.enabled ? "停用" : "启用"}
              </button>
              <button className="ghostButton" type="button" onClick={() => openEdit(strategy)}>
                编辑
              </button>
              <button
                className="ghostButton dangerButton"
                type="button"
                disabled={deletingStrategyId === strategy.id}
                onClick={() => void deleteStrategy(strategy)}
              >
                {deletingStrategyId === strategy.id ? "删除中..." : "删除"}
              </button>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}

function ThresholdFields({
  form,
  setForm,
}: {
  form: StrategyFormState;
  setForm: Dispatch<SetStateAction<StrategyFormState>>;
}) {
  return (
    <>
      <label>
        <span>土壤湿度下限（%）</span>
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
          onChange={(event) => setFormValue(setForm, "moistureRecover", event.target.value)}
        />
      </label>
    </>
  );
}

function ExecutionFields({
  form,
  setForm,
}: {
  form: StrategyFormState;
  setForm: Dispatch<SetStateAction<StrategyFormState>>;
}) {
  const executionOptions =
    form.type === "etc"
      ? [
          { value: "etc", label: "按 ETc 缺水量" },
          { value: "quota", label: "定量灌溉" },
          { value: "duration", label: "按时长" },
        ]
      : [
          { value: "duration", label: "按时长" },
          { value: "quota", label: "定量灌溉" },
        ];

  return (
    <>
      <label>
        <span>执行方式</span>
        <select
          value={form.executionMode}
          onChange={(event) =>
            setFormValue(setForm, "executionMode", event.target.value as StrategyFormState["executionMode"])
          }
        >
          {executionOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {form.executionMode === "quota" ? (
        <>
      <label>
        <span>目标水量（m³/亩）</span>
        <input
          min="0.1"
          max="100"
          step="0.1"
          type="number"
          value={form.targetWaterM3PerMu}
          onChange={(event) => setFormValue(setForm, "targetWaterM3PerMu", event.target.value)}
        />
      </label>
      <label>
        <span>分区流量（m³/h）</span>
        <input
          min="0.1"
          max="200"
          step="0.1"
          type="number"
          value={form.flowRateM3h}
          onChange={(event) => setFormValue(setForm, "flowRateM3h", event.target.value)}
        />
      </label>
      <label>
        <span>灌溉效率</span>
        <input
          min="0.1"
          max="1"
          step="0.01"
          type="number"
          value={form.irrigationEfficiency}
          onChange={(event) => setFormValue(setForm, "irrigationEfficiency", event.target.value)}
        />
      </label>
      <label className="checkboxLine">
        <input
          type="checkbox"
          checked={form.splitRounds}
          onChange={(event) =>
            setForm((current) => ({ ...current, splitRounds: event.target.checked }))
          }
        />
        <span>允许拆分多轮执行</span>
      </label>
        </>
      ) : null}
      {form.executionMode === "duration" ? (
        <label>
          <span>固定执行时长（分钟）</span>
          <input
            min="1"
            max="360"
            step="1"
            type="number"
            value={form.maxDurationMinutes}
            onChange={(event) => setFormValue(setForm, "maxDurationMinutes", event.target.value)}
          />
        </label>
      ) : null}
    </>
  );
}

function EtcFields({
  form,
  setForm,
}: {
  form: StrategyFormState;
  setForm: Dispatch<SetStateAction<StrategyFormState>>;
}) {
  return (
    <>
      <label>
        <span>缺水触发阈值（mm）</span>
        <input
          min="0.1"
          max="80"
          step="0.1"
          type="number"
          value={form.etcTriggerMm}
          onChange={(event) => setFormValue(setForm, "etcTriggerMm", event.target.value)}
        />
      </label>
      <label>
        <span>单次补水比例</span>
        <input
          min="0.1"
          max="1"
          step="0.05"
          type="number"
          value={form.replenishRatio}
          onChange={(event) => setFormValue(setForm, "replenishRatio", event.target.value)}
        />
      </label>
      <label>
        <span>有效降雨折算</span>
        <input
          min="0"
          max="1"
          step="0.05"
          type="number"
          value={form.effectiveRainfallRatio}
          onChange={(event) => setFormValue(setForm, "effectiveRainfallRatio", event.target.value)}
        />
      </label>
      <label>
        <span>目标补水深度（mm）</span>
        <input
          min="0.1"
          max="80"
          step="0.1"
          type="number"
          value={form.targetWaterMm}
          onChange={(event) => setFormValue(setForm, "targetWaterMm", event.target.value)}
        />
      </label>
    </>
  );
}

function buildEmptyForm(field?: FieldSummary): StrategyFormState {
  return {
    name: field ? `${field.name} 阈值灌溉` : "",
    fieldId: field?.id ?? "",
    type: "threshold",
    enabled: true,
    scope: "field",
    zoneIds: [],
    moistureMin: "28",
    moistureRecover: "36",
    etcTriggerMm: "5",
    targetWaterMm: "8",
    targetWaterM3PerMu: "5",
    flowRateM3h: "2",
    irrigationEfficiency: "0.85",
    effectiveRainfallRatio: "0.7",
    replenishRatio: "0.8",
    executionMode: "duration",
    minIntervalHours: "12",
    maxDurationMinutes: "60",
    splitRounds: true,
    rainLockEnabled: true,
    mode: "advisory",
  };
}

function mapStrategyToForm(strategy: StrategySummary): StrategyFormState {
  return {
    id: strategy.id,
    name: strategy.name,
    fieldId: strategy.fieldId,
    type: strategy.type,
    enabled: strategy.enabled,
    scope: strategy.scope,
    zoneIds: strategy.zoneIds,
    moistureMin: String(strategy.moistureMin),
    moistureRecover: String(strategy.moistureRecover),
    etcTriggerMm: String(strategy.etcTriggerMm),
    targetWaterMm: String(strategy.targetWaterMm),
    targetWaterM3PerMu: String(strategy.targetWaterM3PerMu),
    flowRateM3h: String(strategy.flowRateM3h),
    irrigationEfficiency: String(strategy.irrigationEfficiency),
    effectiveRainfallRatio: String(strategy.effectiveRainfallRatio),
    replenishRatio: String(strategy.replenishRatio),
    executionMode: strategy.executionMode,
    minIntervalHours: String(strategy.minIntervalHours),
    maxDurationMinutes: String(strategy.maxDurationMinutes),
    splitRounds: strategy.splitRounds,
    rainLockEnabled: strategy.rainLockEnabled,
    mode: strategy.mode,
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
    type: form.type,
    enabled: form.enabled,
    scope: form.scope,
    zoneIds: form.scope === "zones" ? form.zoneIds : [],
    moistureMin: clampNumber(Number(form.moistureMin), 0, 100),
    moistureRecover: clampNumber(Number(form.moistureRecover), 0, 100),
    etcTriggerMm: clampNumber(Number(form.etcTriggerMm), 0, 80),
    targetWaterMm: clampNumber(Number(form.targetWaterMm), 0.1, 80),
    targetWaterM3PerMu: clampNumber(Number(form.targetWaterM3PerMu), 0.1, 100),
    flowRateM3h: clampNumber(Number(form.flowRateM3h), 0.1, 200),
    irrigationEfficiency: clampNumber(Number(form.irrigationEfficiency), 0.1, 1),
    effectiveRainfallRatio: clampNumber(Number(form.effectiveRainfallRatio), 0, 1),
    replenishRatio: clampNumber(Number(form.replenishRatio), 0.1, 1),
    executionMode: form.executionMode,
    minIntervalHours: clampNumber(Number(form.minIntervalHours), 1, 168),
    maxDurationMinutes: clampNumber(Number(form.maxDurationMinutes), 1, 360),
    splitRounds: form.splitRounds,
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
    type: strategy.type,
    enabled: strategy.enabled,
    scope: strategy.scope,
    zoneIds: strategy.zoneIds,
    moistureMin: strategy.moistureMin,
    moistureRecover: strategy.moistureRecover,
    etcTriggerMm: strategy.etcTriggerMm,
    targetWaterMm: strategy.targetWaterMm,
    targetWaterM3PerMu: strategy.targetWaterM3PerMu,
    flowRateM3h: strategy.flowRateM3h,
    irrigationEfficiency: strategy.irrigationEfficiency,
    effectiveRainfallRatio: strategy.effectiveRainfallRatio,
    replenishRatio: strategy.replenishRatio,
    executionMode: strategy.executionMode,
    minIntervalHours: strategy.minIntervalHours,
    maxDurationMinutes: strategy.maxDurationMinutes,
    splitRounds: strategy.splitRounds,
    rainLockEnabled: strategy.rainLockEnabled,
    mode: strategy.mode,
  };
}

async function saveStrategiesForField(
  session: Parameters<typeof saveFieldAssetRecord>[0]["session"],
  fields: FieldSummary[],
  nextStrategies: StrategySummary[],
  fieldId: string,
) {
  const field = fields.find((item) => item.id === fieldId);
  if (!field) {
    throw new Error("未找到策略所属地块");
  }
  const realFieldId = await ensureThingsBoardField(session, field);
  await saveFieldAutomationStrategies({
    session,
    fieldId: realFieldId,
    strategies: dedupeStrategies(
      nextStrategies
        .filter((strategy) => strategy.fieldId === field.id || strategy.fieldId === realFieldId)
        .map((strategy) => mapSummaryToConfig(strategy, realFieldId)),
    ),
  });
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

function validateStrategyForm(form: StrategyFormState, field: FieldSummary) {
  if (form.scope === "zones" && form.zoneIds.length === 0) {
    throw new Error("指定分区策略至少需要选择一个分区");
  }
  if (form.type === "threshold" && Number(form.moistureRecover) <= Number(form.moistureMin)) {
    throw new Error("恢复阈值必须大于土壤湿度下限");
  }
  if (form.executionMode === "quota" && field.areaMu <= 0) {
    throw new Error("定量执行需要地块面积大于 0");
  }
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

function toggleZone(
  setForm: Dispatch<SetStateAction<StrategyFormState>>,
  zoneId: string,
  checked: boolean,
) {
  setForm((current) => ({
    ...current,
    zoneIds: checked
      ? Array.from(new Set([...current.zoneIds, zoneId]))
      : current.zoneIds.filter((item) => item !== zoneId),
  }));
}

function buildStrategyMetrics(strategy: StrategySummary) {
  if (strategy.type === "etc") {
    return [
      { label: "缺水阈值", value: `${strategy.etcTriggerMm.toFixed(1)} mm` },
      { label: "补水比例", value: `${Math.round(strategy.replenishRatio * 100)}%` },
      { label: "执行方式", value: formatExecutionMode(strategy.executionMode) },
      { label: "雨天锁定", value: strategy.rainLockEnabled ? "开启" : "关闭" },
    ];
  }
  return [
    { label: "墒情下限", value: `${strategy.moistureMin}%` },
    { label: "恢复阈值", value: `${strategy.moistureRecover}%` },
    { label: "执行方式", value: formatExecutionMode(strategy.executionMode) },
    { label: "雨天锁定", value: strategy.rainLockEnabled ? "开启" : "关闭" },
  ];
}

function formatStrategyPrimaryValue(strategy: StrategySummary) {
  if (strategy.type === "etc") {
    return `累计缺水 >= ${strategy.etcTriggerMm.toFixed(1)} mm`;
  }
  return `湿度 < ${strategy.moistureMin}%`;
}

function formatStrategyScope(strategy: StrategySummary) {
  return strategy.scope === "zones" ? `指定 ${strategy.zoneIds.length} 个分区` : "整个地块";
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

function formatStrategyType(type: StrategyType) {
  switch (type) {
    case "etc":
      return "ETc 灌溉";
    default:
      return "阈值灌溉";
  }
}

function formatExecutionMode(mode: StrategySummary["executionMode"]) {
  switch (mode) {
    case "quota":
      return "定量灌溉";
    case "etc":
      return "按缺水量";
    default:
      return "按时长";
  }
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
