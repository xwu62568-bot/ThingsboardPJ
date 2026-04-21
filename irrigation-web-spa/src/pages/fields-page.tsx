import { useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { Link } from "react-router-dom";
import { useWorkspace } from "@/components/workspace-provider";
import { saveFieldAssetRecord, saveFieldSchedulerEvent, type TbFieldAssetConfig } from "@/lib/client/thingsboard";
import type { FieldSummary } from "@/lib/domain/workspace";

type FieldFormState = {
  id?: string;
  name: string;
  code: string;
  cropType: string;
  growthStage: string;
  areaMu: string;
  centerLat: string;
  centerLng: string;
  zoneCount: string;
  kc: string;
  irrigationEfficiency: string;
  deviceId: string;
};

export function FieldsPage() {
  const { session, devices, fields, refreshFields } = useWorkspace();
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FieldFormState>(() => buildEmptyForm(devices[0]?.id));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const openCreate = () => {
    setForm(buildEmptyForm(devices[0]?.id));
    setMessage("");
    setError("");
    setFormOpen(true);
  };

  const openEdit = (field: FieldSummary) => {
    setForm({
      id: isThingsBoardId(field.id) ? field.id : undefined,
      name: field.name,
      code: field.code,
      cropType: field.cropType,
      growthStage: field.growthStage,
      areaMu: String(field.areaMu || ""),
      centerLat: String(field.centerLat || ""),
      centerLng: String(field.centerLng || ""),
      zoneCount: String(field.zoneCount || ""),
      kc: String(field.kc || ""),
      irrigationEfficiency: "0.85",
      deviceId: field.deviceId || devices[0]?.id || "",
    });
    setMessage("");
    setError("");
    setFormOpen(true);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const saved = await saveFieldAssetRecord({
        session,
        id: form.id,
        name: form.name.trim(),
        config: buildFieldConfig(form),
      });
      let schedulerMessage = "";
      if (!form.id) {
        try {
          await saveFieldSchedulerEvent({
            session,
            fieldId: saved.id,
            fieldName: saved.name,
          });
        } catch (schedulerError) {
          schedulerMessage =
            schedulerError instanceof Error
              ? `，但调度器创建失败：${schedulerError.message}`
              : "，但调度器创建失败";
        }
      }
      await refreshFields();
      setFormOpen(false);
      setMessage(`地块已保存到 ThingsBoard${schedulerMessage}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "地块保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="workspacePage">
      <section className="moduleToolbar">
        <div>
          <h2>地块管理</h2>
          <p>维护地块基础信息、作物参数、坐标和现场设备绑定。</p>
        </div>
        <button className="primaryButton" type="button" onClick={openCreate}>
          新增地块
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
              <h3>{form.id ? "编辑地块" : "新增地块"}</h3>
              <p>保存后会写入 ThingsBoard 的 Field 资产和服务端属性。</p>
            </div>
            <button className="ghostButton" type="button" onClick={() => setFormOpen(false)}>
              取消
            </button>
          </div>

          <form className="fieldEditorForm" onSubmit={submit}>
            <label>
              <span>地块名称</span>
              <input
                required
                value={form.name}
                onChange={(event) => setFormValue(setForm, "name", event.target.value)}
                placeholder="例如：东区一号地块"
              />
            </label>
            <label>
              <span>地块编号</span>
              <input
                value={form.code}
                onChange={(event) => setFormValue(setForm, "code", event.target.value)}
                placeholder="例如：F-01"
              />
            </label>
            <label>
              <span>作物</span>
              <input
                value={form.cropType}
                onChange={(event) => setFormValue(setForm, "cropType", event.target.value)}
                placeholder="例如：葡萄"
              />
            </label>
            <label>
              <span>生育期</span>
              <input
                value={form.growthStage}
                onChange={(event) => setFormValue(setForm, "growthStage", event.target.value)}
                placeholder="例如：膨果期"
              />
            </label>
            <label>
              <span>面积（亩）</span>
              <input
                min="0"
                step="0.01"
                type="number"
                value={form.areaMu}
                onChange={(event) => setFormValue(setForm, "areaMu", event.target.value)}
              />
            </label>
            <label>
              <span>作物系数</span>
              <input
                min="0"
                step="0.01"
                type="number"
                value={form.kc}
                onChange={(event) => setFormValue(setForm, "kc", event.target.value)}
              />
            </label>
            <label>
              <span>中心纬度</span>
              <input
                step="0.000001"
                type="number"
                value={form.centerLat}
                onChange={(event) => setFormValue(setForm, "centerLat", event.target.value)}
              />
            </label>
            <label>
              <span>中心经度</span>
              <input
                step="0.000001"
                type="number"
                value={form.centerLng}
                onChange={(event) => setFormValue(setForm, "centerLng", event.target.value)}
              />
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
              <span>灌溉效率</span>
              <input
                min="0"
                max="1"
                step="0.01"
                type="number"
                value={form.irrigationEfficiency}
                onChange={(event) =>
                  setFormValue(setForm, "irrigationEfficiency", event.target.value)
                }
              />
            </label>
            <label className="fieldEditorWide">
              <span>绑定设备</span>
              <select
                value={form.deviceId}
                onChange={(event) => setFormValue(setForm, "deviceId", event.target.value)}
              >
                <option value="">暂不绑定</option>
                {devices.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="fieldEditorActions">
              <button className="ghostButton" type="button" onClick={() => setFormOpen(false)}>
                取消
              </button>
              <button className="primaryButton" type="submit" disabled={saving}>
                {saving ? "保存中..." : "保存地块"}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="fieldCardGrid">
        {fields.map((field) => (
          <article className="fieldCard" key={field.id}>
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
            <div className="fieldCardActions">
              <Link className="inlineLink" to={`/fields/${field.id}`}>
                查看详情
              </Link>
              <button className="ghostButton" type="button" onClick={() => openEdit(field)}>
                编辑
              </button>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}

function buildEmptyForm(deviceId = ""): FieldFormState {
  return {
    name: "",
    code: "",
    cropType: "",
    growthStage: "",
    areaMu: "",
    centerLat: "31.29834",
    centerLng: "120.58319",
    zoneCount: "1",
    kc: "0.8",
    irrigationEfficiency: "0.85",
    deviceId,
  };
}

function buildFieldConfig(form: FieldFormState): TbFieldAssetConfig {
  return {
    code: form.code.trim() || undefined,
    cropType: form.cropType.trim() || undefined,
    growthStage: form.growthStage.trim() || undefined,
    areaMu: parseOptionalNumber(form.areaMu),
    centerLat: parseOptionalNumber(form.centerLat),
    centerLng: parseOptionalNumber(form.centerLng),
    zoneCount: parseOptionalNumber(form.zoneCount),
    kc: parseOptionalNumber(form.kc),
    irrigationEfficiency: parseOptionalNumber(form.irrigationEfficiency),
    deviceId: form.deviceId || undefined,
  };
}

function setFormValue(
  setForm: Dispatch<SetStateAction<FieldFormState>>,
  key: keyof FieldFormState,
  value: string,
) {
  setForm((current) => ({ ...current, [key]: value }));
}

function parseOptionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isThingsBoardId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
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
