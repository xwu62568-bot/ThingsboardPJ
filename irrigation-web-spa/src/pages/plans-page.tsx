import { useEffect, useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useWorkspace } from "@/components/workspace-provider";
import {
  requestManualPlanExecution,
  saveFieldAssetRecord,
  saveFieldRotationPlans,
  type TbRotationPlanConfig,
} from "@/lib/client/thingsboard";
import type { DeviceSummary } from "@/lib/domain/types";
import type { FieldSummary, IrrigationPlanSummary } from "@/lib/domain/workspace";

type PlanFormState = {
  id?: string;
  name: string;
  fieldId: string;
  scheduleType: "daily" | "weekly" | "interval";
  weekdays: string[];
  intervalDays: string;
  startAt: string;
  enabled: boolean;
  skipIfRain: boolean;
  mode: "manual" | "semi-auto" | "auto";
  executionMode: "duration" | "quota";
  targetWaterM3PerMu: string;
  flowRateM3h: string;
  irrigationEfficiency: string;
  maxDurationMinutes: string;
  splitRounds: boolean;
  zones: ZonePlanFormState[];
};

type ZonePlanFormState = {
  zoneId: string;
  zoneName: string;
  siteNumber: string;
  deviceId: string;
  deviceIds: string[];
  deviceBindings: Array<{
    deviceId: string;
    siteNumber?: number;
    deviceName?: string;
    rpcTargetName?: string;
  }>;
  order: string;
  durationMinutes: string;
  enabled: boolean;
};

const WEEKDAY_OPTIONS = [
  { label: "周一", value: 1 },
  { label: "周二", value: 2 },
  { label: "周三", value: 3 },
  { label: "周四", value: 4 },
  { label: "周五", value: 5 },
  { label: "周六", value: 6 },
  { label: "周日", value: 7 },
];

export function PlansPage() {
  const { session, devices, fields, plans, refreshFields } = useWorkspace();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ planId: string }>();
  const isCreateMode = location.pathname === "/plans/new";
  const isEditMode = Boolean(params.planId);
  const editorOpen = isCreateMode || isEditMode;
  const editingPlan = isEditMode ? plans.find((plan) => plan.id === params.planId) : undefined;
  const [executingPlanId, setExecutingPlanId] = useState("");
  const [updatingPlanId, setUpdatingPlanId] = useState("");
  const [deletingPlanId, setDeletingPlanId] = useState("");
  const [form, setForm] = useState<PlanFormState>(() => buildEmptyForm(fields[0]));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const openEdit = (plan: IrrigationPlanSummary) => {
    setMessage("");
    setError("");
    navigate(`/plans/${plan.id}`);
  };

  const selectedField = useMemo(
    () => fields.find((item) => item.id === form.fieldId),
    [fields, form.fieldId],
  );

  useEffect(() => {
    if (!editorOpen) {
      return;
    }
    if (isCreateMode) {
      setForm(buildEmptyForm(fields[0]));
      return;
    }
    if (editingPlan) {
      const field = fields.find((item) => item.id === editingPlan.fieldId);
      setForm({
        id: editingPlan.id,
        name: editingPlan.name,
        fieldId: editingPlan.fieldId,
        scheduleType: editingPlan.scheduleType,
        weekdays: editingPlan.weekdays.map(String),
        intervalDays: String(editingPlan.intervalDays || 1),
        startAt: editingPlan.startAt,
        enabled: editingPlan.enabled,
        skipIfRain: editingPlan.skipIfRain,
        mode: editingPlan.mode,
        executionMode: editingPlan.executionMode,
        targetWaterM3PerMu: String(editingPlan.targetWaterM3PerMu),
        flowRateM3h: String(editingPlan.flowRateM3h),
        irrigationEfficiency: String(editingPlan.irrigationEfficiency),
        maxDurationMinutes: String(editingPlan.maxDurationMinutes),
        splitRounds: editingPlan.splitRounds,
        zones: buildZoneFormRows(field, editingPlan),
      });
    }
  }, [editorOpen, editingPlan, fields, isCreateMode]);

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
      if (!field.mapZones?.length) {
        throw new Error("当前地块还没有分区，请先在地块地图中创建分区");
      }
      if (!form.zones.some((zone) => zone.enabled)) {
        throw new Error("请至少选择一个参与轮灌的分区");
      }
      const realFieldId = await ensureThingsBoardField(session, field);
      const nextPlan = buildPlanConfig(form, field, realFieldId, devices);
      const currentPlans = plans
        .filter((plan) => plan.fieldId === field.id || plan.fieldId === realFieldId)
        .filter((plan) => !form.id || plan.id !== form.id || plan.id.startsWith("plan-field-"))
        .map((plan) => mapSummaryToConfig(plan, realFieldId));
      const nextPlans = [...currentPlans, nextPlan];
      await saveFieldRotationPlans({
        session,
        fieldId: realFieldId,
        fieldName: field.name,
        plans: dedupePlans(nextPlans),
      });
      await refreshFields();
      navigate("/plans");
      setMessage("轮灌计划已保存到 ThingsBoard");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "轮灌计划保存失败");
    } finally {
      setSaving(false);
    }
  };

  const executePlan = async (plan: IrrigationPlanSummary) => {
    setExecutingPlanId(plan.id);
    setMessage("");
    setError("");
    try {
      if (!plan.zones.some((zone) => zone.enabled ?? true)) {
        throw new Error("当前计划没有可执行分区");
      }
      await requestManualPlanExecution({
        session,
        fieldId: plan.fieldId,
        fieldName: plan.fieldName,
        planId: plan.id,
        planName: plan.name,
      });
      setMessage("执行请求已提交，规则链正在启动轮灌");
      await refreshFields();
    } catch (executeError) {
      setError(executeError instanceof Error ? executeError.message : "计划执行失败");
    } finally {
      setExecutingPlanId("");
    }
  };

  const updatePlanMode = async (
    plan: IrrigationPlanSummary,
    mode: PlanFormState["mode"],
  ) => {
    setUpdatingPlanId(plan.id);
    setMessage("");
    setError("");
    try {
      await savePlansForField(
        session,
        fields,
        plans.map((item) => (item.id === plan.id ? { ...item, mode } : item)),
        plan.fieldId,
        devices,
      );
      await refreshFields();
      setMessage("计划模式已更新");
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "计划模式更新失败");
    } finally {
      setUpdatingPlanId("");
    }
  };

  const deletePlan = async (plan: IrrigationPlanSummary) => {
    if (!window.confirm(`确认删除「${plan.name}」？`)) {
      return;
    }
    setDeletingPlanId(plan.id);
    setMessage("");
    setError("");
    try {
      await savePlansForField(
        session,
        fields,
        plans.filter((item) => item.id !== plan.id),
        plan.fieldId,
        devices,
      );
      await refreshFields();
      if (params.planId === plan.id) {
        navigate("/plans");
      }
      setMessage("计划已删除");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "计划删除失败");
    } finally {
      setDeletingPlanId("");
    }
  };

  if (editorOpen) {
    return (
      <main className="workspacePage">
        <nav className="detailTopNav" aria-label="计划编辑导航">
          <Link className="backLink" to="/plans">
            返回轮灌计划
          </Link>
        </nav>
        {(message || error) && (
          <div className={`noticeBar ${error ? "noticeBar--error" : ""}`}>
            {error || message}
          </div>
        )}
        {isEditMode && !editingPlan ? (
          <section className="workspacePanel emptyStatePanel">
            <h3>未找到计划</h3>
            <p className="muted">该计划可能已删除或尚未加载完成。</p>
          </section>
        ) : (
          <PlanEditor
            devices={devices}
            fields={fields}
            form={form}
            saving={saving}
            selectedField={selectedField}
            setForm={setForm}
            title={isCreateMode ? "新增计划" : "编辑计划"}
            onCancel={() => navigate("/plans")}
            onSubmit={submit}
          />
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
              <span>{formatSchedule(plan)}</span>
              <span>{plan.skipIfRain ? "雨天跳过" : "雨天照常"}</span>
              <span>模式 {formatPlanMode(plan.mode)}</span>
              <span>{formatExecutionMode(plan.executionMode)}</span>
            </div>
            <div className="planZoneChips">
              {plan.zones
                .slice()
                .sort((left, right) => (left.order ?? left.siteNumber) - (right.order ?? right.siteNumber))
                .map((zone, index) => (
                  <span key={`${zone.zoneId ?? zone.siteNumber}-${index}`}>
                    {zone.zoneName ?? `${zone.siteNumber}区`} · 总时长 {zone.durationMinutes} 分钟
                  </span>
                ))}
            </div>
            <div className="planActions">
              <label className="planModeControl">
                <span>模式</span>
                <select
                  value={plan.mode}
                  disabled={updatingPlanId === plan.id || deletingPlanId === plan.id}
                  onChange={(event) =>
                    void updatePlanMode(plan, event.target.value as PlanFormState["mode"])
                  }
                >
                  <option value="manual">手动执行</option>
                  <option value="semi-auto">确认后执行</option>
                  <option value="auto">允许策略执行</option>
                </select>
              </label>
              {plan.mode === "manual" ? (
                <button
                  className="primaryButton"
                  type="button"
                  disabled={executingPlanId === plan.id}
                  onClick={() => void executePlan(plan)}
                >
                  {executingPlanId === plan.id ? "执行中..." : "执行计划"}
                </button>
              ) : null}
              <button className="ghostButton" type="button" onClick={() => openEdit(plan)}>
                编辑
              </button>
              <button
                className="ghostButton dangerButton"
                type="button"
                disabled={deletingPlanId === plan.id}
                onClick={() => void deletePlan(plan)}
              >
                {deletingPlanId === plan.id ? "删除中..." : "删除"}
              </button>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}

function PlanEditor({
  devices,
  fields,
  form,
  saving,
  selectedField,
  setForm,
  title,
  onCancel,
  onSubmit,
}: {
  devices: DeviceSummary[];
  fields: FieldSummary[];
  form: PlanFormState;
  saving: boolean;
  selectedField?: FieldSummary;
  setForm: Dispatch<SetStateAction<PlanFormState>>;
  title: string;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="workspacePanel fieldEditorPanel planInlineEditor">
      <div className="sectionHead">
        <div>
          <h3>{title}</h3>
          <p>计划会保存到所选地块的服务端属性。</p>
        </div>
        <button className="ghostButton" type="button" onClick={onCancel}>
          取消
        </button>
      </div>

      <form className="fieldEditorForm" onSubmit={onSubmit}>
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
            onChange={(event) => {
              const nextField = fields.find((field) => field.id === event.target.value);
              setForm((current) => ({
                ...current,
                fieldId: event.target.value,
                name:
                  !current.name || fields.some((field) => current.name === `${field.name} 轮灌计划`)
                    ? `${nextField?.name ?? ""} 轮灌计划`
                    : current.name,
                zones: buildZoneFormRows(nextField),
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
          <span>执行周期</span>
          <select
            value={form.scheduleType}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                scheduleType: event.target.value as PlanFormState["scheduleType"],
              }))
            }
          >
            <option value="daily">每天执行</option>
            <option value="weekly">每周执行</option>
            <option value="interval">间隔执行</option>
          </select>
        </label>
        <label>
          <span>开始时间</span>
          <input
            required
            type="time"
            value={form.startAt}
            onChange={(event) => setFormValue(setForm, "startAt", event.target.value)}
          />
        </label>
        {form.scheduleType === "weekly" ? (
          <div className="planWeekdayPicker">
            {WEEKDAY_OPTIONS.map((item) => (
              <label className="checkboxLine" key={item.value}>
                <input
                  type="checkbox"
                  checked={form.weekdays.includes(String(item.value))}
                  onChange={(event) => toggleWeekday(setForm, item.value, event.target.checked)}
                />
                <span>{item.label}</span>
              </label>
            ))}
          </div>
        ) : null}
        {form.scheduleType === "interval" ? (
          <label>
            <span>间隔天数</span>
            <input
              min="1"
              max="30"
              step="1"
              type="number"
              value={form.intervalDays}
              onChange={(event) => setFormValue(setForm, "intervalDays", event.target.value)}
            />
          </label>
        ) : null}
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
            <option value="auto">允许策略执行</option>
          </select>
        </label>
        <ExecutionFields form={form} setForm={setForm} />
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

        <div className="planZoneEditor">
          <div className="sectionHead">
            <div>
              <h3>分区轮灌顺序</h3>
              <p>
                {selectedField?.mapZones?.length
                  ? "按真实分区设置参与状态、顺序和灌溉时长。"
                  : "当前地块还没有分区，请先到地块地图中创建分区。"}
              </p>
            </div>
          </div>
          {form.zones.length > 0 ? (
            <div className="planZoneList">
              {form.zones.map((zone, index) => (
                <PlanZoneRow
                  key={zone.zoneId || `${zone.siteNumber}-${index}`}
                  index={index}
                  zone={zone}
                  devices={devices}
                  setForm={setForm}
                />
              ))}
            </div>
          ) : (
            <p className="muted">选择已有分区的地块后，可以配置轮灌顺序和时长。</p>
          )}
        </div>
        <div className="fieldEditorActions">
          <button className="ghostButton" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="primaryButton" type="submit" disabled={saving}>
            {saving ? "保存中..." : "保存计划"}
          </button>
        </div>
      </form>
    </section>
  );
}

function PlanZoneRow({
  devices,
  index,
  zone,
  setForm,
}: {
  devices: DeviceSummary[];
  index: number;
  zone: ZonePlanFormState;
  setForm: Dispatch<SetStateAction<PlanFormState>>;
}) {
  return (
    <div className={`planZoneRow${zone.enabled ? "" : " disabled"}`}>
      <label className="checkboxLine">
        <input
          type="checkbox"
          checked={zone.enabled}
          onChange={(event) => updateZoneFormRow(setForm, index, "enabled", event.target.checked)}
        />
        <span>{zone.zoneName}</span>
      </label>
      <div>
        <span>设备 / 站点</span>
        <strong>{formatZoneDevice(zone, devices)}</strong>
      </div>
      <label>
        <span>顺序</span>
        <input
          min="1"
          max="64"
          step="1"
          type="number"
          value={zone.order}
          onChange={(event) => updateZoneFormRow(setForm, index, "order", event.target.value)}
        />
      </label>
      <label>
        <span>分区总时长（分钟）</span>
        <input
          min="1"
          max="240"
          step="1"
          type="number"
          value={zone.durationMinutes}
          onChange={(event) =>
            updateZoneFormRow(setForm, index, "durationMinutes", event.target.value)
          }
        />
      </label>
    </div>
  );
}

function ExecutionFields({
  form,
  setForm,
}: {
  form: PlanFormState;
  setForm: Dispatch<SetStateAction<PlanFormState>>;
}) {
  return (
    <>
      <label>
        <span>执行方式</span>
        <select
          value={form.executionMode}
          onChange={(event) =>
            setFormValue(setForm, "executionMode", event.target.value as PlanFormState["executionMode"])
          }
        >
          <option value="duration">按时长</option>
          <option value="quota">定量灌溉</option>
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
          <label>
            <span>单区最长时长（分钟）</span>
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
              checked={form.splitRounds}
              onChange={(event) =>
                setForm((current) => ({ ...current, splitRounds: event.target.checked }))
              }
            />
            <span>允许拆分多轮执行</span>
          </label>
        </>
      ) : null}
    </>
  );
}

function buildEmptyForm(field?: FieldSummary): PlanFormState {
  return {
    name: field ? `${field.name} 轮灌计划` : "",
    fieldId: field?.id ?? "",
    scheduleType: "daily",
    weekdays: [],
    intervalDays: "1",
    startAt: "05:30",
    enabled: true,
    skipIfRain: true,
    mode: "semi-auto",
    executionMode: "duration",
    targetWaterM3PerMu: "5",
    flowRateM3h: "2",
    irrigationEfficiency: "0.85",
    maxDurationMinutes: "60",
    splitRounds: true,
    zones: buildZoneFormRows(field),
  };
}

function buildPlanConfig(
  form: PlanFormState,
  field: FieldSummary | undefined,
  fieldId: string,
  devices: DeviceSummary[],
): TbRotationPlanConfig {
  const zones = form.zones
    .filter((zone) => zone.enabled)
    .map((zone, index) => {
      const matchedZone = field?.mapZones?.find((item) => item.id === zone.zoneId);
      const deviceBindings =
        matchedZone?.deviceBindings?.length
          ? matchedZone.deviceBindings.map((binding) => ({
              deviceId: binding.deviceId,
              siteNumber: binding.siteNumber,
              deviceName: devices.find((device) => device.id === binding.deviceId)?.name,
              rpcTargetName: devices.find((device) => device.id === binding.deviceId)?.rpcTargetName,
            }))
          : zone.deviceId
            ? [
                {
                  deviceId: zone.deviceId,
                  siteNumber: clampInt(Number(zone.siteNumber), 1, 999),
                  deviceName: devices.find((device) => device.id === zone.deviceId)?.name,
                  rpcTargetName: devices.find((device) => device.id === zone.deviceId)?.rpcTargetName,
                },
              ]
            : [];

      return {
        zoneId: zone.zoneId || undefined,
        zoneName: zone.zoneName || undefined,
        siteNumber: clampInt(Number(zone.siteNumber), 1, 999),
        deviceId: deviceBindings[0]?.deviceId,
        deviceIds: deviceBindings.map((binding) => binding.deviceId),
        deviceBindings,
        deviceName: deviceBindings[0]?.deviceName,
        order: clampInt(Number(zone.order), 1, 64),
        durationMinutes: clampInt(Number(zone.durationMinutes), 1, 240),
        enabled: true,
        fallbackOrder: index + 1,
      };
    })
    .sort((left, right) => left.order - right.order || left.fallbackOrder - right.fallbackOrder)
    .map(({ fallbackOrder, ...zone }) => zone);
  return {
    id: form.id && !form.id.startsWith("plan-field-") ? form.id : `rotation-${Date.now()}`,
    name: form.name.trim(),
    fieldId,
    scheduleType: form.scheduleType,
    weekdays:
      form.scheduleType === "weekly"
        ? form.weekdays.map(Number).filter((weekday) => weekday >= 1 && weekday <= 7)
        : [],
    intervalDays:
      form.scheduleType === "interval" ? clampInt(Number(form.intervalDays), 1, 30) : 1,
    startAt: form.startAt,
    enabled: form.enabled,
    skipIfRain: form.skipIfRain,
    mode: form.mode,
    executionMode: form.executionMode,
    targetWaterM3PerMu: clampNumber(Number(form.targetWaterM3PerMu), 0.1, 100),
    flowRateM3h: clampNumber(Number(form.flowRateM3h), 0.1, 200),
    irrigationEfficiency: clampNumber(Number(form.irrigationEfficiency), 0.1, 1),
    maxDurationMinutes: clampInt(Number(form.maxDurationMinutes), 1, 360),
    splitRounds: form.splitRounds,
    zones,
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
    scheduleType: plan.scheduleType,
    weekdays: plan.weekdays,
    intervalDays: plan.intervalDays,
    startAt: plan.startAt,
    enabled: plan.enabled,
    skipIfRain: plan.skipIfRain,
    mode: plan.mode,
    executionMode: plan.executionMode,
    targetWaterM3PerMu: plan.targetWaterM3PerMu,
    flowRateM3h: plan.flowRateM3h,
    irrigationEfficiency: plan.irrigationEfficiency,
    maxDurationMinutes: plan.maxDurationMinutes,
    splitRounds: plan.splitRounds,
    zones: plan.zones.map((zone, index) => ({
      zoneId: zone.zoneId,
      zoneName: zone.zoneName,
      siteNumber: zone.siteNumber,
      deviceId: zone.deviceId,
      deviceIds: zone.deviceIds,
      deviceBindings: zone.deviceBindings,
      deviceName: zone.deviceName,
      order: zone.order ?? index + 1,
      durationMinutes: zone.durationMinutes,
      enabled: zone.enabled ?? true,
    })),
  };
}

function buildZoneFormRows(
  field?: FieldSummary,
  plan?: IrrigationPlanSummary,
): ZonePlanFormState[] {
  const planZones = new Map(
    (plan?.zones ?? []).map((zone, index) => [
      zone.zoneId || String(zone.siteNumber || index + 1),
      { ...zone, fallbackIndex: index },
    ]),
  );
  const rows = (field?.mapZones ?? []).map((zone, index) => {
    const binding = zone.deviceBindings?.[0];
    const deviceId = binding?.deviceId ?? zone.deviceId ?? zone.deviceIds?.[0] ?? "";
    const siteNumber = binding?.siteNumber ?? zone.valveSiteNumber ?? zone.siteNumber ?? index + 1;
    const saved = planZones.get(zone.id) ?? planZones.get(String(siteNumber));
    const savedBindings =
      saved?.deviceBindings?.length
        ? saved.deviceBindings
        : zone.deviceBindings?.length
          ? zone.deviceBindings
          : (zone.deviceIds ?? (zone.deviceId ? [zone.deviceId] : [])).map((deviceId) => ({
              deviceId,
              siteNumber,
            }));
    return {
      zoneId: zone.id,
      zoneName: zone.name || `${index + 1}区`,
      siteNumber: String(saved?.siteNumber ?? siteNumber),
      deviceId: saved?.deviceId ?? deviceId,
      deviceIds: saved?.deviceIds ?? savedBindings.map((item) => item.deviceId),
      deviceBindings: savedBindings,
      order: String(saved?.order ?? index + 1),
      durationMinutes: String(saved?.durationMinutes ?? 10),
      enabled: saved?.enabled ?? true,
    };
  });
  if (rows.length > 0) {
    return rows;
  }
  return (plan?.zones ?? []).map((zone, index) => ({
    zoneId: zone.zoneId ?? "",
    zoneName: zone.zoneName ?? `${zone.siteNumber || index + 1}区`,
    siteNumber: String(zone.siteNumber || index + 1),
    deviceId: zone.deviceId ?? "",
    deviceIds: zone.deviceIds ?? (zone.deviceId ? [zone.deviceId] : []),
    deviceBindings:
      zone.deviceBindings ??
      (zone.deviceId
        ? [
            {
              deviceId: zone.deviceId,
              siteNumber: zone.siteNumber,
              deviceName: zone.deviceName,
              rpcTargetName: undefined,
            },
          ]
        : []),
    order: String(zone.order ?? index + 1),
    durationMinutes: String(zone.durationMinutes || 10),
    enabled: zone.enabled ?? true,
  }));
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

async function savePlansForField(
  session: Parameters<typeof saveFieldAssetRecord>[0]["session"],
  fields: FieldSummary[],
  nextPlans: IrrigationPlanSummary[],
  fieldId: string,
  devices: DeviceSummary[],
) {
  const field = fields.find((item) => item.id === fieldId);
  if (!field) {
    throw new Error("未找到计划所属地块");
  }
  const realFieldId = await ensureThingsBoardField(session, field);
  const fieldPlans = nextPlans
    .filter((plan) => plan.fieldId === field.id || plan.fieldId === realFieldId)
    .map((plan) => mapSummaryToConfig(attachDeviceNames(plan, devices), realFieldId));
  await saveFieldRotationPlans({
    session,
    fieldId: realFieldId,
    fieldName: field.name,
    plans: dedupePlans(fieldPlans),
  });
}

function attachDeviceNames(
  plan: IrrigationPlanSummary,
  devices: DeviceSummary[],
): IrrigationPlanSummary {
  return {
    ...plan,
    zones: plan.zones.map((zone) => ({
      ...zone,
      deviceName:
        zone.deviceName ||
        (zone.deviceId ? devices.find((device) => device.id === zone.deviceId)?.name : undefined),
    })),
  };
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

function updateZoneFormRow(
  setForm: Dispatch<SetStateAction<PlanFormState>>,
  index: number,
  key: keyof ZonePlanFormState,
  value: string | boolean,
) {
  setForm((current) => ({
    ...current,
    zones: current.zones.map((zone, zoneIndex) =>
      zoneIndex === index ? { ...zone, [key]: value } : zone,
    ),
  }));
}

function toggleWeekday(
  setForm: Dispatch<SetStateAction<PlanFormState>>,
  weekday: number,
  checked: boolean,
) {
  setForm((current) => {
    const value = String(weekday);
    const weekdays = checked
      ? Array.from(new Set([...current.weekdays, value]))
      : current.weekdays.filter((item) => item !== value);
    return {
      ...current,
      weekdays: weekdays.sort((left, right) => Number(left) - Number(right)),
    };
  });
}

function formatZoneDevice(zone: ZonePlanFormState, devices: DeviceSummary[]) {
  const bindings =
    zone.deviceBindings.length > 0
      ? zone.deviceBindings
      : zone.deviceId
        ? [{ deviceId: zone.deviceId, siteNumber: Number(zone.siteNumber) || undefined }]
        : [];
  if (bindings.length === 0) {
    return "未绑定设备";
  }
  return bindings
    .map((binding) => {
      const device = devices.find((item) => item.id === binding.deviceId);
      const label = device
        ? formatPlanDeviceLabel(device)
        : `${binding.deviceName || "设备"} · ${shortenPlanDeviceIdentity(binding.deviceId)}`;
      return `${label} · ${binding.siteNumber ?? zone.siteNumber} 号站点`;
    })
    .join(" / ");
}

function formatPlanDeviceLabel(device: DeviceSummary) {
  return `${device.name} · ${shortenPlanDeviceIdentity(device.blePeripheralId || device.id)}`;
}

function shortenPlanDeviceIdentity(value: string) {
  const normalized = value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (!normalized) {
    return "未识别";
  }
  if (normalized.length <= 6) {
    return normalized;
  }
  return normalized.slice(-6);
}

function formatSchedule(plan: IrrigationPlanSummary) {
  if (plan.scheduleType === "weekly") {
    const labels = plan.weekdays
      .map((weekday) => WEEKDAY_OPTIONS.find((item) => item.value === weekday)?.label)
      .filter(Boolean)
      .join("、");
    return labels ? `每周 ${labels}` : "每周执行";
  }
  if (plan.scheduleType === "interval") {
    return `每 ${plan.intervalDays || 1} 天执行`;
  }
  return "每天执行";
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
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

function formatExecutionMode(mode: "duration" | "quota") {
  return mode === "quota" ? "定量灌溉" : "按时长";
}

function formatPlanMode(mode: "manual" | "semi-auto" | "auto") {
  switch (mode) {
    case "auto":
      return "允许策略执行";
    case "semi-auto":
      return "确认后执行";
    default:
      return "手动执行";
  }
}
