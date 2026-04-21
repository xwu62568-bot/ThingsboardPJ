import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";
import { Link } from "react-router-dom";
import { useWorkspace } from "@/components/workspace-provider";
import {
  deleteFieldAssetRecord,
  saveFieldAssetRecord,
  saveFieldSchedulerEvent,
  type TbFieldAssetConfig,
} from "@/lib/client/thingsboard";
import type { DeviceSummary } from "@/lib/domain/types";
import type { FieldSummary } from "@/lib/domain/workspace";

type BoundaryPoint = [number, number];

type AMapInstance = {
  destroy: () => void;
  setFitView: (overlays?: unknown[]) => void;
  clearMap: () => void;
  on?: (eventName: string, handler: (event: { lnglat?: { lng: number; lat: number } }) => void) => void;
  off?: (eventName: string, handler: (event: { lnglat?: { lng: number; lat: number } }) => void) => void;
};

type AMapOverlay = {
  setMap?: (target: AMapInstance) => void;
  on?: (eventName: string, handler: (event?: { lnglat?: { lng: number; lat: number } }) => void) => void;
  getPath?: () => Array<{ lng: number; lat: number }>;
};

type AMapMouseTool = {
  polygon: (options: Record<string, unknown>) => void;
  close: (clear?: boolean) => void;
  on: (eventName: string, handler: (event: { obj?: AMapOverlay }) => void) => void;
};

type AMapConstructor = {
  Map: new (
    container: HTMLDivElement,
    options: {
      center: BoundaryPoint;
      zoom: number;
      viewMode?: string;
      mapStyle?: string;
    },
  ) => AMapInstance;
  Marker: new (options: {
    position: BoundaryPoint;
    title: string;
    content: string;
    offset?: unknown;
    draggable?: boolean;
  }) => AMapOverlay;
  Polygon: new (options: {
    path: BoundaryPoint[];
    strokeColor: string;
    strokeWeight: number;
    strokeOpacity: number;
    fillColor: string;
    fillOpacity: number;
    zIndex?: number;
  }) => AMapOverlay;
  Pixel: new (x: number, y: number) => unknown;
  MouseTool?: new (map: AMapInstance) => AMapMouseTool;
  plugin?: (plugins: string | string[], callback: () => void) => void;
};

type FieldZone = NonNullable<FieldSummary["mapZones"]>[number];
type DeviceMarker = NonNullable<FieldSummary["deviceMarkers"]>[number];

declare global {
  interface Window {
    AMap?: AMapConstructor;
    _AMapSecurityConfig?: {
      securityJsCode?: string;
    };
  }
}

type FieldFormState = {
  name: string;
  code: string;
  cropType: string;
  growthStage: string;
  areaMu: string;
  kc: string;
  irrigationEfficiency: string;
};

type ZoneFormState = {
  name: string;
  deviceBindings: Array<{
    deviceId: string;
    siteNumber: string;
    rpcTargetName?: string;
    lng?: number;
    lat?: number;
  }>;
};

type WorkflowStep = "browse" | "field-draw" | "field-info" | "zone-draw" | "zone-bind";

const AMAP_KEY = import.meta.env.VITE_AMAP_KEY?.trim() || "";
const AMAP_SECURITY_CODE = import.meta.env.VITE_AMAP_SECURITY_CODE?.trim() || "";
let amapLoadingPromise: Promise<AMapConstructor> | null = null;

export function MapPage() {
  const { session, devices, fields, refreshFields } = useWorkspace();
  const [localFields, setLocalFields] = useState<FieldSummary[]>([]);
  const [deletedFieldIds, setDeletedFieldIds] = useState<string[]>([]);
  const [drawingMode, setDrawingMode] = useState<"field" | "zone" | null>(null);
  const [draftBoundary, setDraftBoundary] = useState<BoundaryPoint[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [zoneFormOpen, setZoneFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingFieldId, setDeletingFieldId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState<FieldFormState>(() => buildEmptyForm());
  const [zoneForm, setZoneForm] = useState<ZoneFormState>(() => buildEmptyZoneForm());
  const mapFields = useMemo(
    () => mergeFields(fields, localFields).filter((field) => !deletedFieldIds.includes(field.id)),
    [deletedFieldIds, fields, localFields],
  );
  const draftDeviceMarkers = useMemo(
    () =>
      zoneForm.deviceBindings
        .map((binding) => {
          if (binding.lng === undefined || binding.lat === undefined) {
            return null;
          }
          const device = devices.find((item) => item.id === binding.deviceId);
          return {
            deviceId: binding.deviceId,
            name: device?.name ?? "现场设备",
            rpcTargetName: device?.rpcTargetName,
            role: device?.isGateway ? "gateway" : "controller",
            lng: binding.lng,
            lat: binding.lat,
            siteNumber: Math.max(1, Math.round(parseOptionalNumber(binding.siteNumber) ?? 1)),
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item)),
    [devices, zoneForm.deviceBindings],
  );
  const [selectedFieldId, setSelectedFieldId] = useState("");
  const selectedField = selectedFieldId
    ? mapFields.find((field) => field.id === selectedFieldId)
    : undefined;
  const activeMapFieldId = formOpen || drawingMode === "field" ? undefined : selectedField?.id;
  const workflowStep = resolveWorkflowStep({
    drawingMode,
    formOpen,
    zoneFormOpen,
    selectedField,
  });

  useEffect(() => {
    if (formOpen || drawingMode === "field") {
      return;
    }
    if (!selectedFieldId && mapFields[0]?.id) {
      setSelectedFieldId(mapFields[0].id);
      return;
    }
    if (selectedFieldId && !mapFields.some((field) => field.id === selectedFieldId) && mapFields[0]?.id) {
      setSelectedFieldId(mapFields[0].id);
    }
  }, [drawingMode, formOpen, mapFields, selectedFieldId]);

  const startCreate = () => {
    setMessage("");
    setError("");
    setDraftBoundary([]);
    setForm(buildEmptyForm());
    setSelectedFieldId("");
    setFormOpen(true);
    setZoneFormOpen(false);
    setDrawingMode("field");
  };

  const startZoneCreate = () => {
    if (!selectedField) {
      setError("请先选择一个地块");
      return;
    }
    if (!selectedField.boundary?.length) {
      setError("当前地块还没有边界，不能继续绘制分区");
      return;
    }
    setMessage("");
    setError("");
    setDraftBoundary([]);
    setFormOpen(false);
    setZoneForm(buildEmptyZoneForm(selectedField));
    setZoneFormOpen(true);
    setDrawingMode("zone");
  };

  const useFallbackBoundary = () => {
    const boundary = buildFallbackBoundary(selectedField);
    setDraftBoundary(boundary);
    setForm((current) => mergeFieldFormWithBoundary(current, boundary));
    setFormOpen(true);
    setDrawingMode(null);
  };

  const handleBoundaryDrawn = (boundary: BoundaryPoint[]) => {
    setDraftBoundary(boundary);
    if (drawingMode === "zone") {
      setZoneFormOpen(true);
      setDrawingMode(null);
      return;
    }
    setForm((current) => mergeFieldFormWithBoundary(current, boundary));
    setFormOpen(true);
    setDrawingMode(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");
    try {
      if (draftBoundary.length < 3) {
        throw new Error("请先在地图上圈出地块范围");
      }
      const saved = await saveFieldAssetRecord({
        session,
        name: form.name.trim(),
        config: buildFieldConfig(form, draftBoundary),
      });
      let schedulerMessage = "";
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
      const nextField = buildLocalFieldSummary(saved.id, form, draftBoundary);
      setLocalFields((current) => mergeFields([nextField], current));
      setSelectedFieldId(nextField.id);
      setFormOpen(false);
      setDraftBoundary([]);
      setZoneForm(buildEmptyZoneForm(nextField));
      setZoneFormOpen(true);
      setDrawingMode("zone");
      setMessage(`地块已保存${schedulerMessage}，请继续在地图上绘制分区`);
      void refreshFields();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "地块保存失败");
    } finally {
      setSaving(false);
    }
  };

  const submitZone = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedField) {
      setError("请先选择地块");
      return;
    }
    setSaving(true);
    setMessage("");
    setError("");
    try {
      if (draftBoundary.length < 3) {
        throw new Error("请先在地图上圈出分区范围");
      }
      if (zoneForm.deviceBindings.length === 0) {
        throw new Error("请先选择分区设备和站点");
      }
      if (
        zoneForm.deviceBindings.some(
          (binding) => binding.lng === undefined || binding.lat === undefined,
        )
      ) {
        throw new Error("请先在地图上放置每台设备的位置");
      }
      const fieldId = await ensureThingsBoardField(session, selectedField);
      const nextConfig = buildUpdatedFieldConfigForZone(
        selectedField,
        zoneForm,
        draftBoundary,
        devices,
        fieldId,
      );
      await saveFieldAssetRecord({
        session,
        id: fieldId,
        name: selectedField.name,
        config: nextConfig,
      });
      const nextField = buildFieldSummaryFromConfig(
        fieldId,
        selectedField,
        nextConfig,
        devices.find((device) => device.id === nextConfig.deviceId),
      );
      setLocalFields((current) => mergeFields(current, [nextField]));
      setSelectedFieldId(nextField.id);
      setZoneFormOpen(false);
      setDraftBoundary([]);
      setMessage("分区与设备已保存到 ThingsBoard");
      void refreshFields();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "分区保存失败");
    } finally {
      setSaving(false);
    }
  };

  const deleteField = async (field: FieldSummary) => {
    if (!isThingsBoardId(field.id)) {
      setLocalFields((current) => current.filter((item) => item.id !== field.id));
      setDeletedFieldIds((current) => [...current, field.id]);
      if (selectedFieldId === field.id) {
        setSelectedFieldId("");
      }
      setMessage("地块已从本地列表移除");
      return;
    }
    if (!window.confirm(`确认删除「${field.name}」？删除后地块、分区、计划和策略配置都会从 ThingsBoard 移除。`)) {
      return;
    }
    setDeletingFieldId(field.id);
    setMessage("");
    setError("");
    setDeletedFieldIds((current) => [...current, field.id]);
    try {
      await deleteFieldAssetRecord({ session, fieldId: field.id });
      setLocalFields((current) => current.filter((item) => item.id !== field.id));
      if (selectedFieldId === field.id) {
        setSelectedFieldId("");
      }
      await refreshFields();
      setMessage("地块已删除");
    } catch (deleteError) {
      setDeletedFieldIds((current) => current.filter((item) => item !== field.id));
      setError(deleteError instanceof Error ? deleteError.message : "地块删除失败");
    } finally {
      setDeletingFieldId("");
    }
  };

  useEffect(() => {
    if (deletedFieldIds.length === 0) {
      return;
    }
    setDeletedFieldIds((current) => current.filter((fieldId) => fields.some((field) => field.id === fieldId)));
  }, [deletedFieldIds.length, fields]);

  useEffect(() => {
    const onCreateField = () => startCreate();
    const onCreateZone = () => startZoneCreate();
    window.addEventListener("irrigation-map:create-field", onCreateField);
    window.addEventListener("irrigation-map:create-zone", onCreateZone);
    return () => {
      window.removeEventListener("irrigation-map:create-field", onCreateField);
      window.removeEventListener("irrigation-map:create-zone", onCreateZone);
    };
  });

  return (
    <main className="workspacePage">
      {error && <div className="noticeBar noticeBar--error">{error}</div>}

      <section className="mapHero">
        <article className="mapSurface">
          <div className="mapSurfaceHead">
            <span className="mapHint">{getStepDescription(workflowStep, selectedField)}</span>
          </div>

          <AmapFieldCanvas
            devices={devices}
            drawingMode={drawingMode}
            draftBoundary={draftBoundary}
            draftDeviceMarkers={zoneFormOpen ? draftDeviceMarkers : []}
            fields={mapFields}
            markerEditable={zoneFormOpen && drawingMode === null}
            onDeviceMarkerMove={(deviceId, point) => {
              updateZoneDevicePosition(setZoneForm, deviceId, point);
              setMessage("设备位置已更新，可继续拖动微调");
              setError("");
            }}
            selectedFieldId={activeMapFieldId}
            editing={workflowStep !== "browse"}
            onSelectField={(fieldId) => {
              if (!formOpen && drawingMode !== "field") {
                setSelectedFieldId(fieldId);
              }
            }}
            onBoundaryDrawn={handleBoundaryDrawn}
            onDrawFailed={(drawError) => {
              setDrawingMode(null);
              setError(drawError);
            }}
          />
        </article>

        <aside className="workspacePanel mapLegend">
          {formOpen ? (
            <FieldCreatePanel
              draftBoundary={draftBoundary}
              form={form}
              saving={saving}
              setForm={setForm}
              onCancel={() => {
                setFormOpen(false);
              }}
              onSubmit={submit}
            />
          ) : zoneFormOpen && selectedField ? (
            <ZoneCreatePanel
              devices={devices}
              draftBoundary={draftBoundary}
              form={zoneForm}
              saving={saving}
              selectedField={selectedField}
              setForm={setZoneForm}
              onCancel={() => {
                setZoneFormOpen(false);
              }}
              onSubmit={submitZone}
            />
          ) : (
            <SelectedFieldPanel
              deleting={selectedField ? deletingFieldId === selectedField.id : false}
              selectedField={selectedField}
              onCreateZone={startZoneCreate}
              onDeleteField={deleteField}
            />
          )}
        </aside>
      </section>

      <section className="fieldCardGrid mapFieldCardGrid" aria-label="地块列表">
        {mapFields.map((field) => (
          <article
            className={`fieldCard mapFieldCard${activeMapFieldId === field.id ? " fieldCard--active" : ""}`}
            key={field.id}
            role="button"
            tabIndex={0}
            onClick={() => setSelectedFieldId(field.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setSelectedFieldId(field.id);
              }
            }}
          >
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
                <strong>{field.mapZones?.length ?? field.zoneCount} 个</strong>
              </div>
            </div>

            <div className="fieldMetricsBar">
              <span>湿度 {field.soilMoisture}%</span>
              <span>ET0 {field.et0.toFixed(1)}</span>
              <span>Kc {field.kc.toFixed(2)}</span>
              <span>ETc {field.etc.toFixed(2)}</span>
            </div>
            <div className="fieldCardActions">
              <button
                className="ghostButton"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setSelectedFieldId(field.id);
                }}
              >
                地图定位
              </button>
              <Link
                className="inlineLink"
                to={`/fields/${field.id}`}
                onClick={(event) => event.stopPropagation()}
              >
                查看详情
              </Link>
              <button
                className="ghostButton dangerButton"
                type="button"
                disabled={deletingFieldId === field.id}
                onClick={(event) => {
                  event.stopPropagation();
                  void deleteField(field);
                }}
              >
                {deletingFieldId === field.id ? "删除中..." : "删除"}
              </button>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}

function AmapFieldCanvas({
  devices,
  drawingMode,
  draftBoundary,
  draftDeviceMarkers,
  editing,
  fields,
  markerEditable,
  onDeviceMarkerMove,
  selectedFieldId,
  onSelectField,
  onBoundaryDrawn,
  onDrawFailed,
}: {
  devices: DeviceSummary[];
  drawingMode: "field" | "zone" | null;
  draftBoundary: BoundaryPoint[];
  draftDeviceMarkers: Array<{
    deviceId: string;
    name: string;
    role: string;
    lng: number;
    lat: number;
    siteNumber?: number;
  }>;
  editing: boolean;
  fields: FieldSummary[];
  markerEditable: boolean;
  onDeviceMarkerMove: (deviceId: string, point: BoundaryPoint) => void;
  selectedFieldId?: string;
  onSelectField: (fieldId: string) => void;
  onBoundaryDrawn: (boundary: BoundaryPoint[]) => void;
  onDrawFailed: (message: string) => void;
}) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const amapRef = useRef<AMapConstructor | null>(null);
  const mapInstanceRef = useRef<AMapInstance | null>(null);
  const mouseToolRef = useRef<AMapMouseTool | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [loadState, setLoadState] = useState<"fallback" | "loading" | "ready" | "error">(
    AMAP_KEY ? "loading" : "fallback",
  );
  const initialCenterRef = useRef<BoundaryPoint | null>(null);
  if (!initialCenterRef.current) {
    const first = fields[0];
    initialCenterRef.current = first ? [first.centerLng, first.centerLat] : [120.58319, 31.29834];
  }

  useEffect(() => {
    if (!AMAP_KEY || !mapRef.current) {
      setLoadState("fallback");
      return;
    }

    let disposed = false;
    setLoadState("loading");

    loadAmap()
      .then((AMap) => {
        if (disposed || !mapRef.current) {
          return;
        }
        amapRef.current = AMap;
        mapInstanceRef.current = new AMap.Map(mapRef.current, {
          center: initialCenterRef.current ?? [120.58319, 31.29834],
          zoom: 13,
          viewMode: "2D",
          mapStyle: "amap://styles/whitesmoke",
        });
        setLoadState("ready");
      })
      .catch(() => {
        if (!disposed) {
          setLoadState("error");
        }
      });

    return () => {
      disposed = true;
      mouseToolRef.current?.close(true);
      mouseToolRef.current = null;
      mapInstanceRef.current?.destroy();
      mapInstanceRef.current = null;
      amapRef.current = null;
    };
  }, [reloadKey]);

  useEffect(() => {
    const AMap = amapRef.current;
    const map = mapInstanceRef.current;
    if (!AMap || !map || loadState !== "ready") {
      return;
    }

    mouseToolRef.current?.close(true);
    mouseToolRef.current = null;
    map.clearMap();

    const overlays: AMapOverlay[] = [];
    for (const field of fields) {
      const fieldStyle = getFieldMapStyle(field);
      if (field.boundary?.length) {
        const polygon = new AMap.Polygon({
          path: field.boundary,
          strokeColor: fieldStyle.stroke,
          strokeWeight: selectedFieldId === field.id ? 3 : 2,
          strokeOpacity: 0.9,
          fillColor: fieldStyle.fill,
          fillOpacity: selectedFieldId === field.id ? fieldStyle.fillOpacity + 0.06 : fieldStyle.fillOpacity,
          zIndex: 8,
        });
        polygon.setMap?.(map);
        polygon.on?.("click", () => {
          onSelectField(field.id);
        });
        overlays.push(polygon);
      }

      for (const zone of field.mapZones ?? []) {
        const zoneStyle = getZoneMapStyle(field);
        const zonePolygon = new AMap.Polygon({
          path: zone.boundary,
          strokeColor: zoneStyle.stroke,
          strokeWeight: zoneStyle.strokeWeight,
          strokeOpacity: 0.82,
          fillColor: zoneStyle.fill,
          fillOpacity: zoneStyle.fillOpacity,
          zIndex: 12,
        });
        zonePolygon.setMap?.(map);
        overlays.push(zonePolygon);

        const zoneCenter = calculateCenter(zone.boundary);
        const zoneMarker = new AMap.Marker({
          position: zoneCenter,
          title: zone.name,
          content: buildZoneMarkerContent(zone),
          offset: new AMap.Pixel(-18, -12),
        });
        zoneMarker.setMap?.(map);
        overlays.push(zoneMarker);
      }

      for (const deviceMarker of field.deviceMarkers ?? []) {
        const displayName = resolveMapDeviceMarkerName(deviceMarker, devices);
        const markerMeta = resolveDeviceMarkerMeta(
          devices.find((device) => device.id === deviceMarker.deviceId),
        );
        const marker = new AMap.Marker({
          position: [deviceMarker.lng, deviceMarker.lat],
          title: displayName,
          content: buildDeviceMarkerContent({ ...deviceMarker, name: displayName }, markerMeta),
          offset: new AMap.Pixel(-14, -28),
          draggable: false,
        });
        marker.on?.("click", () => {
          if (!editing) {
            window.location.hash = `#/devices/${deviceMarker.deviceId}`;
          }
        });
        marker.setMap?.(map);
        overlays.push(marker);
      }

      const marker = new AMap.Marker({
        position: [field.centerLng, field.centerLat],
        title: field.name,
        content: buildMarkerContent(field),
        offset: new AMap.Pixel(-42, -14),
      });
      marker.on?.("click", () => {
        onSelectField(field.id);
      });
      marker.setMap?.(map);
      overlays.push(marker);
    }

    for (const deviceMarker of draftDeviceMarkers) {
      const markerMeta = resolveDeviceMarkerMeta(
        devices.find((device) => device.id === deviceMarker.deviceId),
      );
      const marker = new AMap.Marker({
        position: [deviceMarker.lng, deviceMarker.lat],
        title: deviceMarker.name,
        content: buildDeviceMarkerContent(deviceMarker, markerMeta),
        offset: new AMap.Pixel(-14, -28),
        draggable: markerEditable,
      });
      marker.on?.("dragend", (event) => {
        const lng = event?.lnglat?.lng;
        const lat = event?.lnglat?.lat;
        if (lng === undefined || lat === undefined) {
          return;
        }
        onDeviceMarkerMove(deviceMarker.deviceId, [
          Number(lng.toFixed(6)),
          Number(lat.toFixed(6)),
        ]);
      });
      marker.setMap?.(map);
      overlays.push(marker);
    }

    if (draftBoundary.length >= 3) {
      const draft = new AMap.Polygon({
        path: draftBoundary,
        strokeColor: "#16a34a",
        strokeWeight: 3,
        strokeOpacity: 1,
        fillColor: "#16a34a",
        fillOpacity: 0.16,
        zIndex: 20,
      });
      draft.setMap?.(map);
      overlays.push(draft);
    }

    if (overlays.length > 0) {
      map.setFitView(overlays);
    }
  }, [devices, draftBoundary, draftDeviceMarkers, editing, fields, loadState, markerEditable, onDeviceMarkerMove, onSelectField, selectedFieldId]);

  useEffect(() => {
    const AMap = amapRef.current;
    const map = mapInstanceRef.current;
    if (!drawingMode || !AMap || !map || loadState !== "ready") {
      return;
    }

    let disposed = false;

    loadAmapPlugin(AMap, "AMap.MouseTool")
      .then(() => {
        if (disposed) {
          return;
        }
        if (!AMap.MouseTool) {
          onDrawFailed("当前高德地图未加载绘制工具，请检查 Key 或刷新页面");
          return;
        }
        mouseToolRef.current?.close(true);
        const mouseTool = new AMap.MouseTool(map);
        mouseToolRef.current = mouseTool;
        mouseTool.on("draw", (event) => {
          const path = event.obj?.getPath?.() ?? [];
          const boundary = path.map((point) => [point.lng, point.lat] as BoundaryPoint);
          if (boundary.length < 3) {
            onDrawFailed("地块边界至少需要 3 个点");
            return;
          }
          onBoundaryDrawn(boundary);
          mouseTool.close(false);
        });
        mouseTool.polygon({
          strokeColor: "#16a34a",
          strokeWeight: 3,
          strokeOpacity: 1,
          fillColor: "#16a34a",
          fillOpacity: 0.18,
        });
      })
      .catch(() => {
        if (!disposed) {
          onDrawFailed("高德地图绘制工具加载失败，请刷新页面后重试");
        }
      });

    return () => {
      disposed = true;
      mouseToolRef.current?.close(false);
      mouseToolRef.current = null;
    };
  }, [drawingMode, loadState, onBoundaryDrawn, onDrawFailed]);

  if (!AMAP_KEY || loadState === "error") {
    return (
      <MockFieldMap
        fields={fields}
        message={!AMAP_KEY ? "未配置高德地图 Key，已切换为预览模式" : "高德地图加载失败"}
        canRetry={Boolean(AMAP_KEY)}
        onSelectField={onSelectField}
        onRetry={() => {
          amapLoadingPromise = null;
          setLoadState("loading");
          setReloadKey((key) => key + 1);
        }}
      />
    );
  }

  return (
    <div className="amapCanvasShell">
      {loadState === "loading" && <div className="mapLoading">地图加载中...</div>}
      {drawingMode && (
        <div className="mapDrawNotice">
          {drawingMode === "zone" ? "点击地图绘制分区边界，双击完成" : "点击地图绘制地块边界，双击完成"}
        </div>
      )}
      {markerEditable && !drawingMode ? (
        <div className="mapDrawNotice">设备已默认放入分区，可直接拖动调整位置</div>
      ) : null}
      <MapStatusLegend />
      <div className="amapCanvas" ref={mapRef} />
    </div>
  );
}

function MapStatusLegend() {
  return (
    <div className="mapStatusLegend" aria-label="地图图例">
      <span><i className="mapLegendSwatch mapLegendSwatch--online" />在线</span>
      <span><i className="mapLegendSwatch mapLegendSwatch--offline" />离线</span>
    </div>
  );
}

function MockFieldMap({
  canRetry,
  fields,
  message,
  onSelectField,
  onRetry,
}: {
  canRetry?: boolean;
  fields: FieldSummary[];
  message?: string;
  onSelectField: (fieldId: string) => void;
  onRetry?: () => void;
}) {
  return (
    <div className="mockMapCanvas">
      <div className="mapGrid" />
      {message && (
        <div className="mapFallbackNotice">
          <span>{message}</span>
          {canRetry ? (
            <button type="button" onClick={onRetry}>
              重新加载
            </button>
          ) : null}
        </div>
      )}
      {fields.slice(0, 8).map((field, index) => (
        <button
          type="button"
          className={`mapPin ${field.irrigationState}`}
          key={field.id}
          style={{
            left: `${10 + (index % 4) * 22}%`,
            top: `${18 + Math.floor(index / 4) * 34}%`,
          }}
          onClick={() => onSelectField(field.id)}
        >
          <strong>{field.code}</strong>
          <span>{field.name}</span>
        </button>
      ))}
    </div>
  );
}

function SelectedFieldPanel({
  deleting,
  selectedField,
  onCreateZone,
  onDeleteField,
}: {
  deleting: boolean;
  selectedField?: FieldSummary;
  onCreateZone: () => void;
  onDeleteField: (field: FieldSummary) => void;
}) {
  if (!selectedField) {
    return (
      <div className="mapSidePanel">
        <h3>未选择地块</h3>
        <p>点击顶部“新建地块”，先在地图上绘制地块范围。</p>
      </div>
    );
  }

  return (
    <div className="mapSidePanel">
      <div className="sidePanelHead">
        <div>
          <h3>{selectedField.name}</h3>
        </div>
        <em>{formatFieldState(selectedField.irrigationState)}</em>
      </div>
      <div className="sideMetricGrid">
        <div>
          <span>面积</span>
          <strong>{selectedField.areaMu.toFixed(1)} 亩</strong>
        </div>
        <div>
          <span>作物</span>
          <strong>{selectedField.cropType}</strong>
        </div>
        <div>
          <span>生育期</span>
          <strong>{selectedField.growthStage}</strong>
        </div>
        <div>
          <span>土壤湿度</span>
          <strong>{selectedField.soilMoisture}%</strong>
        </div>
        <div>
          <span>参考 ET0</span>
          <strong>{selectedField.et0.toFixed(1)}</strong>
        </div>
        <div>
          <span>作物系数 Kc</span>
          <strong>{selectedField.kc.toFixed(2)}</strong>
        </div>
        <div>
          <span>作物 ETc</span>
          <strong>{selectedField.etc.toFixed(2)}</strong>
        </div>
        <div>
          <span>分区 / 设备</span>
          <strong>
            {selectedField.mapZones?.length ?? selectedField.zoneCount} /{" "}
            {selectedField.deviceMarkers?.length ?? 0}
          </strong>
        </div>
      </div>
      <div className="mapWorkflowActions">
        <button className="ghostButton" type="button" onClick={onCreateZone}>
          新增分区
        </button>
        <Link className="primaryButton" to={`/fields/${selectedField.id}`}>
          编辑详情
        </Link>
        <button
          className="ghostButton dangerButton"
          type="button"
          disabled={deleting}
          onClick={() => onDeleteField(selectedField)}
        >
          {deleting ? "删除中..." : "删除地块"}
        </button>
      </div>
    </div>
  );
}

function FieldCreatePanel({
  draftBoundary,
  form,
  saving,
  setForm,
  onCancel,
  onSubmit,
}: {
  draftBoundary: BoundaryPoint[];
  form: FieldFormState;
  saving: boolean;
  setForm: Dispatch<SetStateAction<FieldFormState>>;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="mapSidePanel">
      <div className="sidePanelHead">
        <div>
          <h3>新建地块</h3>
        </div>
      </div>
      <p className="sidePanelTip">
        {draftBoundary.length >= 3
          ? `已圈出 ${draftBoundary.length} 个边界点，面积约 ${calculateAreaMu(draftBoundary).toFixed(2)} 亩。`
          : "请先在地图上绘制地块边界，完成后再保存。"}
      </p>
      <form className="mapSideForm" onSubmit={onSubmit}>
        <label>
          <span>地块名称</span>
          <input required value={form.name} onChange={(event) => setFormValue(setForm, "name", event.target.value)} />
        </label>
        <label>
          <span>地块编号</span>
          <input value={form.code} onChange={(event) => setFormValue(setForm, "code", event.target.value)} />
        </label>
        <label>
          <span>作物</span>
          <input value={form.cropType} onChange={(event) => setFormValue(setForm, "cropType", event.target.value)} />
        </label>
        <label>
          <span>生育期</span>
          <input value={form.growthStage} onChange={(event) => setFormValue(setForm, "growthStage", event.target.value)} />
        </label>
        <label>
          <span>面积（亩）</span>
          <input min="0" step="0.01" type="number" value={form.areaMu} onChange={(event) => setFormValue(setForm, "areaMu", event.target.value)} />
        </label>
        <label>
          <span>作物系数</span>
          <input min="0" step="0.01" type="number" value={form.kc} onChange={(event) => setFormValue(setForm, "kc", event.target.value)} />
        </label>
        <label>
          <span>灌溉效率</span>
          <input min="0" max="1" step="0.01" type="number" value={form.irrigationEfficiency} onChange={(event) => setFormValue(setForm, "irrigationEfficiency", event.target.value)} />
        </label>
        <div className="fieldEditorActions">
          <button className="ghostButton" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="primaryButton" type="submit" disabled={saving}>
            {saving ? "保存中..." : "保存地块"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ZoneCreatePanel({
  devices,
  draftBoundary,
  form,
  saving,
  selectedField,
  setForm,
  onCancel,
  onSubmit,
}: {
  devices: DeviceSummary[];
  draftBoundary: BoundaryPoint[];
  form: ZoneFormState;
  saving: boolean;
  selectedField: FieldSummary;
  setForm: Dispatch<SetStateAction<ZoneFormState>>;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="mapSidePanel">
      <div className="sidePanelHead">
        <div>
          <h3>新建分区</h3>
        </div>
      </div>
      <p className="sidePanelTip">
        当前地块：{selectedField.name}，已圈出 {draftBoundary.length} 个分区边界点。
      </p>
      <p className="sidePanelTip">设备添加后会默认落在分区内，直接拖动地图上的设备图标即可调整位置。</p>
      <form className="mapSideForm" onSubmit={onSubmit}>
        <label>
          <span>分区名称</span>
          <input required value={form.name} onChange={(event) => setZoneFormValue(setForm, "name", event.target.value)} />
        </label>
        <label>
          <span>添加设备</span>
          <select
            value=""
            onChange={(event) => {
              if (event.target.value) {
                const device = devices.find((item) => item.id === event.target.value);
                addZoneDeviceBinding(
                  setForm,
                  event.target.value,
                  draftBoundary,
                  device?.rpcTargetName,
                );
              }
            }}
          >
            <option value="">选择设备</option>
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {formatDeviceChoiceLabel(device)}
              </option>
            ))}
          </select>
        </label>
        <div className="zoneDeviceList side">
          {form.deviceBindings.length === 0 ? (
            <p>一个分区可添加多台设备；添加后会先默认放到分区上，可再手动调整位置。</p>
          ) : (
            form.deviceBindings.map((binding) => {
              const device = devices.find((item) => item.id === binding.deviceId);
              const markerMeta = resolveDeviceMarkerMeta(device);
              return (
                <div className="zoneDeviceRow side" key={binding.deviceId}>
                  <div className="zoneDeviceRowHead">
                    <strong>{device ? formatDeviceChoiceLabel(device) : shortenDeviceIdentity(binding.deviceId)}</strong>
                    <span className={`statusPill ${markerMeta.pillClass}`}>{markerMeta.label}</span>
                  </div>
                  <label>
                    <span>站点</span>
                    <select
                      value={binding.siteNumber}
                      onChange={(event) => updateZoneDeviceSite(setForm, binding.deviceId, event.target.value)}
                    >
                      {Array.from({ length: Math.max(1, device?.siteCount ?? 1) }, (_, index) => (
                        <option key={index + 1} value={String(index + 1)}>
                          {index + 1} 号站点
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="devicePlacementMeta">
                    <span>
                      {binding.lng !== undefined && binding.lat !== undefined
                        ? `已放置：${binding.lng.toFixed(6)}, ${binding.lat.toFixed(6)}`
                        : "将自动放置在分区内"}
                    </span>
                  </div>
                  <button
                    className="ghostButton"
                    type="button"
                    onClick={() => removeZoneDeviceBinding(setForm, binding.deviceId)}
                  >
                    移除
                  </button>
                </div>
              );
            })
          )}
        </div>
        <div className="fieldEditorActions">
          <button className="ghostButton" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="primaryButton" type="submit" disabled={saving}>
            {saving ? "保存中..." : "保存分区"}
          </button>
        </div>
      </form>
    </div>
  );
}

function MapWorkflowPanel({
  selectedField,
  step,
  onCreateField,
  onCreateZone,
}: {
  selectedField?: FieldSummary;
  step: WorkflowStep;
  onCreateField: () => void;
  onCreateZone: () => void;
}) {
  const steps: Array<{ id: WorkflowStep; label: string }> = [
    { id: "field-draw", label: "绘制地块" },
    { id: "field-info", label: "地块资料" },
    { id: "zone-draw", label: "绘制分区" },
    { id: "zone-bind", label: "设备站点" },
  ];
  return (
    <div className="mapWorkflow">
      <div className="sectionHead">
        <div>
          <h3>{getStepTitle(step)}</h3>
          <p>{getStepDescription(step, selectedField)}</p>
        </div>
      </div>
      <div className="mapStepList">
        {steps.map((item, index) => (
          <span className={item.id === step ? "active" : ""} key={item.id}>
            {index + 1}. {item.label}
          </span>
        ))}
      </div>
      <div className="mapWorkflowActions">
        <button className="primaryButton" type="button" onClick={onCreateField}>
          新建地块
        </button>
        <button className="ghostButton" type="button" onClick={onCreateZone} disabled={!selectedField?.boundary?.length}>
          新增分区
        </button>
      </div>
    </div>
  );
}

function loadAmap() {
  if (window.AMap) {
    return Promise.resolve(window.AMap);
  }
  if (amapLoadingPromise) {
    return amapLoadingPromise;
  }
  if (AMAP_SECURITY_CODE) {
    window._AMapSecurityConfig = {
      securityJsCode: AMAP_SECURITY_CODE,
    };
  }
  amapLoadingPromise = new Promise<AMapConstructor>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://webapi.amap.com/maps?v=2.0&plugin=AMap.MouseTool&key=${encodeURIComponent(
      AMAP_KEY,
    )}`;
    script.async = true;
    script.onload = () => {
      if (window.AMap) {
        resolve(window.AMap);
      } else {
        reject(new Error("高德地图初始化失败"));
      }
    };
    script.onerror = () => reject(new Error("高德地图脚本加载失败"));
    document.head.appendChild(script);
  });
  return amapLoadingPromise;
}

function loadAmapPlugin(AMap: AMapConstructor, pluginName: string) {
  if (pluginName === "AMap.MouseTool" && AMap.MouseTool) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    if (!AMap.plugin) {
      reject(new Error("高德插件加载接口不可用"));
      return;
    }
    AMap.plugin(pluginName, () => {
      if (pluginName === "AMap.MouseTool" && !AMap.MouseTool) {
        reject(new Error("MouseTool 插件不可用"));
        return;
      }
      resolve();
    });
  });
}

function buildEmptyForm(): FieldFormState {
  return {
    name: "",
    code: "",
    cropType: "",
    growthStage: "",
    areaMu: "",
    kc: "0.8",
    irrigationEfficiency: "0.85",
  };
}

function buildEmptyZoneForm(field?: FieldSummary): ZoneFormState {
  return {
    name: `${(field?.mapZones?.length ?? 0) + 1}区`,
    deviceBindings: [],
  };
}

function buildFormFromBoundary(boundary: BoundaryPoint[]): FieldFormState {
  return {
    ...buildEmptyForm(),
    areaMu: calculateAreaMu(boundary).toFixed(2),
  };
}

function mergeFieldFormWithBoundary(
  form: FieldFormState,
  boundary: BoundaryPoint[],
): FieldFormState {
  return {
    ...form,
    areaMu: form.areaMu || calculateAreaMu(boundary).toFixed(2),
  };
}

function buildFieldConfig(form: FieldFormState, boundary: BoundaryPoint[]): TbFieldAssetConfig {
  const center = calculateCenter(boundary);
  return {
    code: form.code.trim() || undefined,
    cropType: form.cropType.trim() || undefined,
    growthStage: form.growthStage.trim() || undefined,
    areaMu: parseOptionalNumber(form.areaMu) ?? calculateAreaMu(boundary),
    centerLng: center[0],
    centerLat: center[1],
    boundary,
    zones: [],
    deviceMarkers: [],
    zoneCount: 0,
    kc: parseOptionalNumber(form.kc),
    irrigationEfficiency: parseOptionalNumber(form.irrigationEfficiency),
  };
}

function buildLocalFieldSummary(
  id: string,
  form: FieldFormState,
  boundary: BoundaryPoint[],
): FieldSummary {
  const center = calculateCenter(boundary);
  const areaMu = parseOptionalNumber(form.areaMu) ?? calculateAreaMu(boundary);
  const kc = parseOptionalNumber(form.kc) ?? 0;
  return {
    id,
    name: form.name.trim() || "未命名地块",
    code: form.code.trim() || "新地块",
    groupName: "",
    cropType: form.cropType.trim() || "未设置",
    growthStage: form.growthStage.trim() || "未设置",
    areaMu,
    deviceId: "",
    centerLng: center[0],
    centerLat: center[1],
    boundary,
    mapZones: [],
    deviceMarkers: [],
    zoneCount: 0,
    batteryLevel: 0,
    soilMoisture: 0,
    irrigationState: "idle",
    gatewayState: "unknown",
    et0: 0,
    kc,
    etc: 0,
    et0UpdatedAt: 0,
    et0Source: "",
  };
}

function buildFieldSummaryFromConfig(
  id: string,
  fallbackField: FieldSummary,
  config: TbFieldAssetConfig,
  device?: DeviceSummary,
): FieldSummary {
  return {
    ...fallbackField,
    id,
    groupName: config.groupName || fallbackField.groupName,
    cropType: config.cropType || fallbackField.cropType,
    growthStage: config.growthStage || fallbackField.growthStage,
    areaMu: config.areaMu ?? fallbackField.areaMu,
    centerLng: config.centerLng ?? fallbackField.centerLng,
    centerLat: config.centerLat ?? fallbackField.centerLat,
    boundary: config.boundary ?? fallbackField.boundary,
    mapZones: config.zones ?? fallbackField.mapZones,
    deviceMarkers: config.deviceMarkers ?? fallbackField.deviceMarkers,
    deviceId: config.deviceId || fallbackField.deviceId,
    zoneCount: config.zoneCount ?? fallbackField.zoneCount,
    kc: config.kc ?? fallbackField.kc,
    batteryLevel: device?.batteryLevel ?? fallbackField.batteryLevel,
    irrigationState: "idle",
    gatewayState: device?.gatewayState ?? fallbackField.gatewayState,
  };
}

function buildUpdatedFieldConfigForZone(
  field: FieldSummary,
  zoneForm: ZoneFormState,
  boundary: BoundaryPoint[],
  devices: DeviceSummary[],
  fieldId: string,
): TbFieldAssetConfig {
  const siteNumber = getNextZoneNumber(field);
  const deviceBindings = zoneForm.deviceBindings.map((binding) => ({
    deviceId: binding.deviceId,
    siteNumber: Math.max(1, Math.round(parseOptionalNumber(binding.siteNumber) ?? 1)),
    rpcTargetName: binding.rpcTargetName,
    lng: binding.lng,
    lat: binding.lat,
  }));
  const nextZone: FieldZone = {
    id: `${fieldId}-zone-${Date.now()}`,
    name: zoneForm.name.trim() || `${siteNumber}区`,
    siteNumber,
    boundary,
    deviceId: deviceBindings[0]?.deviceId,
    deviceIds: deviceBindings.map((binding) => binding.deviceId),
    deviceBindings,
    valveSiteNumber: siteNumber,
  };
  const zones = [...(field.mapZones ?? []), nextZone].sort(
    (left, right) => left.siteNumber - right.siteNumber,
  );
  const existingMarkers = (field.deviceMarkers ?? []).filter((marker) => marker.zoneId !== nextZone.id);
  const zoneMarkers = buildZoneDeviceMarkers(nextZone, devices);
  return {
    code: field.code,
    groupName: field.groupName,
    cropType: field.cropType,
    growthStage: field.growthStage,
    areaMu: field.areaMu,
    centerLng: field.centerLng,
    centerLat: field.centerLat,
    boundary: field.boundary,
    zones,
    deviceId: field.deviceId,
    deviceMarkers: [...existingMarkers, ...zoneMarkers],
    zoneCount: Math.max(field.zoneCount, zones.length),
    kc: field.kc,
    irrigationEfficiency: 0.85,
  };
}

function getNextZoneNumber(field: FieldSummary) {
  const existingNumbers = (field.mapZones ?? [])
    .map((zone) => zone.siteNumber)
    .filter((siteNumber) => Number.isFinite(siteNumber));
  return existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;
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
      groupName: field.groupName,
      cropType: field.cropType,
      growthStage: field.growthStage,
      areaMu: field.areaMu,
      centerLat: field.centerLat,
      centerLng: field.centerLng,
      boundary: field.boundary,
      zones: field.mapZones,
      deviceId: field.deviceId,
      deviceMarkers: field.deviceMarkers,
      zoneCount: field.zoneCount,
      kc: field.kc,
      irrigationEfficiency: 0.85,
    },
  });
  return saved.id;
}

function mergeFields(primary: FieldSummary[], secondary: FieldSummary[]) {
  const byId = new Map<string, FieldSummary>();
  for (const field of [...primary, ...secondary]) {
    const current = byId.get(field.id);
    if (!current) {
      byId.set(field.id, field);
      continue;
    }
    const shouldKeepCurrentBoundary = current.boundary?.length && !field.boundary?.length;
    byId.set(field.id, shouldKeepCurrentBoundary ? current : { ...current, ...field });
  }
  return Array.from(byId.values());
}

function buildZones(boundary: BoundaryPoint[], zoneCount: number, deviceId?: string): FieldZone[] {
  const count = Math.max(1, Math.min(64, Math.round(zoneCount || 1)));
  const lngs = boundary.map((point) => point[0]);
  const lats = boundary.map((point) => point[1]);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const step = (maxLng - minLng) / count;
  return Array.from({ length: count }, (_, index) => {
    const left = minLng + step * index;
    const right = index === count - 1 ? maxLng : minLng + step * (index + 1);
    return {
      id: `zone-${index + 1}`,
      name: `${index + 1}区`,
      siteNumber: index + 1,
      boundary: [
        [Number(left.toFixed(6)), Number(minLat.toFixed(6))],
        [Number(right.toFixed(6)), Number(minLat.toFixed(6))],
        [Number(right.toFixed(6)), Number(maxLat.toFixed(6))],
        [Number(left.toFixed(6)), Number(maxLat.toFixed(6))],
      ],
      deviceId: deviceId || undefined,
      valveSiteNumber: index + 1,
    };
  });
}

function buildZoneDeviceMarkers(zone: FieldZone, devices: DeviceSummary[]): DeviceMarker[] {
  const bindings =
    zone.deviceBindings?.length
      ? zone.deviceBindings
      : (zone.deviceIds ?? (zone.deviceId ? [zone.deviceId] : [])).map((deviceId) => ({
          deviceId,
          siteNumber: zone.siteNumber,
        }));
  if (bindings.length === 0) {
    return [];
  }
  const normalizedBindings = bindings.map((binding) => {
    const withPosition = binding as typeof binding & { lng?: number; lat?: number };
    return {
      ...binding,
      lng: typeof withPosition.lng === "number" ? withPosition.lng : undefined,
      lat: typeof withPosition.lat === "number" ? withPosition.lat : undefined,
    };
  });
  const center = calculateCenter(zone.boundary);
  const radiusLng = 0.00018;
  const radiusLat = 0.00012;
  return normalizedBindings.map((binding, index) => {
    const device = devices.find((item) => item.id === binding.deviceId);
    const angle = (Math.PI * 2 * index) / Math.max(bindings.length, 1);
    return {
      deviceId: binding.deviceId,
      name: device?.name ?? `设备${index + 1}`,
      rpcTargetName:
        device?.rpcTargetName ??
        ("rpcTargetName" in binding ? binding.rpcTargetName : undefined),
      role: device?.isGateway ? "gateway" : "controller",
      lng: Number(((typeof binding.lng === "number" ? binding.lng : center[0] + Math.cos(angle) * radiusLng)).toFixed(6)),
      lat: Number(((typeof binding.lat === "number" ? binding.lat : center[1] + Math.sin(angle) * radiusLat)).toFixed(6)),
      zoneId: zone.id,
      siteNumber: binding.siteNumber ?? zone.siteNumber,
    };
  });
}

function calculateCenter(boundary: BoundaryPoint[]): BoundaryPoint {
  if (boundary.length === 0) {
    return [120.58319, 31.29834];
  }
  const sum = boundary.reduce(
    (acc, point) => {
      acc.lng += point[0];
      acc.lat += point[1];
      return acc;
    },
    { lng: 0, lat: 0 },
  );
  return [
    Number((sum.lng / boundary.length).toFixed(6)),
    Number((sum.lat / boundary.length).toFixed(6)),
  ];
}

function calculateAreaMu(boundary: BoundaryPoint[]) {
  if (boundary.length < 3) {
    return 0;
  }
  const centerLat = calculateCenter(boundary)[1];
  const metersPerLng = 111_320 * Math.cos((centerLat * Math.PI) / 180);
  const metersPerLat = 110_540;
  const points = boundary.map(([lng, lat]) => [lng * metersPerLng, lat * metersPerLat]);
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index] ?? [0, 0];
    const next = points[(index + 1) % points.length] ?? [0, 0];
    area += current[0] * next[1] - next[0] * current[1];
  }
  return Math.abs(area / 2) / 666.6667;
}

function buildFallbackBoundary(field?: FieldSummary): BoundaryPoint[] {
  const centerLng = field?.centerLng ?? 120.58319;
  const centerLat = field?.centerLat ?? 31.29834;
  const deltaLng = 0.003;
  const deltaLat = 0.002;
  return [
    [Number((centerLng - deltaLng).toFixed(6)), Number((centerLat - deltaLat).toFixed(6))],
    [Number((centerLng + deltaLng).toFixed(6)), Number((centerLat - deltaLat).toFixed(6))],
    [Number((centerLng + deltaLng).toFixed(6)), Number((centerLat + deltaLat).toFixed(6))],
    [Number((centerLng - deltaLng).toFixed(6)), Number((centerLat + deltaLat).toFixed(6))],
  ];
}

function setFormValue(
  setForm: Dispatch<SetStateAction<FieldFormState>>,
  key: keyof FieldFormState,
  value: string,
) {
  setForm((current) => ({ ...current, [key]: value }));
}

function setZoneFormValue(
  setForm: Dispatch<SetStateAction<ZoneFormState>>,
  key: keyof ZoneFormState,
  value: string,
) {
  setForm((current) => ({ ...current, [key]: value }));
}

function addZoneDeviceBinding(
  setForm: Dispatch<SetStateAction<ZoneFormState>>,
  deviceId: string,
  boundary: BoundaryPoint[],
  rpcTargetName?: string,
) {
  setForm((current) => {
    if (current.deviceBindings.some((binding) => binding.deviceId === deviceId)) {
      return current;
    }
    const nextIndex = current.deviceBindings.length;
    const defaultPosition = buildDefaultDevicePlacement(boundary, nextIndex);
    return {
      ...current,
      deviceBindings: [
        ...current.deviceBindings,
        {
          deviceId,
          siteNumber: "1",
          rpcTargetName,
          lng: defaultPosition[0],
          lat: defaultPosition[1],
        },
      ],
    };
  });
}

function updateZoneDeviceSite(
  setForm: Dispatch<SetStateAction<ZoneFormState>>,
  deviceId: string,
  siteNumber: string,
) {
  setForm((current) => ({
    ...current,
    deviceBindings: current.deviceBindings.map((binding) =>
      binding.deviceId === deviceId ? { ...binding, siteNumber } : binding,
    ),
  }));
}

function updateZoneDevicePosition(
  setForm: Dispatch<SetStateAction<ZoneFormState>>,
  deviceId: string,
  point: BoundaryPoint,
) {
  setForm((current) => ({
    ...current,
    deviceBindings: current.deviceBindings.map((binding) =>
      binding.deviceId === deviceId ? { ...binding, lng: point[0], lat: point[1] } : binding,
    ),
  }));
}

function buildDefaultDevicePlacement(boundary: BoundaryPoint[], index: number): BoundaryPoint {
  const center = calculateCenter(boundary);
  const radiusLng = 0.00016;
  const radiusLat = 0.0001;
  const angle = (Math.PI * 2 * index) / Math.max(index + 1, 3);
  return [
    Number((center[0] + Math.cos(angle) * radiusLng).toFixed(6)),
    Number((center[1] + Math.sin(angle) * radiusLat).toFixed(6)),
  ];
}

function removeZoneDeviceBinding(
  setForm: Dispatch<SetStateAction<ZoneFormState>>,
  deviceId: string,
) {
  setForm((current) => ({
    ...current,
    deviceBindings: current.deviceBindings.filter((binding) => binding.deviceId !== deviceId),
  }));
}

function parseOptionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getFieldMapStyle(field: FieldSummary) {
  if (field.irrigationState === "running") {
    return {
      stroke: "#0284c7",
      fill: "#0284c7",
      fillOpacity: 0.28,
    };
  }
  if (field.irrigationState === "attention") {
    return {
      stroke: "#d97706",
      fill: "#d97706",
      fillOpacity: 0.3,
    };
  }
  return {
    stroke: "#16a34a",
    fill: "#16a34a",
    fillOpacity: 0.24,
  };
}

function getZoneMapStyle(field: FieldSummary) {
  if (field.irrigationState === "running") {
    return {
      stroke: "#0284c7",
      fill: "#0ea5e9",
      fillOpacity: 0.24,
      strokeWeight: 2,
    };
  }
  return {
    stroke: "#15803d",
    fill: "#86efac",
    fillOpacity: 0.22,
    strokeWeight: 1,
  };
}

function formatFieldState(state: FieldSummary["irrigationState"]) {
  if (state === "running") {
    return "灌溉中";
  }
  if (state === "attention") {
    return "需关注";
  }
  return "待机";
}

function mapStateToPill(state: FieldSummary["irrigationState"]) {
  if (state === "running") {
    return "connected";
  }
  if (state === "attention") {
    return "error";
  }
  return "connecting";
}

function isThingsBoardId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function buildMarkerContent(field: FieldSummary) {
  return `
    <div class="amapFieldMarker">
      <strong>${escapeHtml(getCompactFieldLabel(field.name))}</strong>
    </div>
  `;
}

function buildZoneMarkerContent(zone: FieldZone) {
  return `
    <div class="amapZoneMarker">
      ${escapeHtml(zone.name)}
    </div>
  `;
}

function buildDeviceMarkerContent(
  marker: DeviceMarker | (DeviceMarker & { siteNumber?: number }),
  meta: { className: string; icon: string },
) {
  const shortName = getCompactDeviceLabel(marker.name);
  return `
    <div class="amapDeviceMarker ${meta.className}" title="${escapeHtml(marker.name)}">
      <span>${meta.icon}</span>
      <strong>${escapeHtml(shortName)}${marker.siteNumber ? ` · ${marker.siteNumber}站` : ""}</strong>
    </div>
  `;
}

function resolveMapDeviceMarkerName(marker: DeviceMarker, devices: DeviceSummary[]) {
  const liveName = devices.find((item) => item.id === marker.deviceId)?.name?.trim();
  if (liveName) {
    return liveName;
  }
  const markerName = marker.name?.trim();
  if (markerName && !looksLikeMapPlaceholderName(markerName)) {
    return markerName;
  }
  return `设备 ${shortMapDeviceIdentity(marker.deviceId)}`;
}

function looksLikeMapPlaceholderName(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === "default" || normalized === "device" || normalized === "现场设备" || normalized.startsWith("ble-");
}

function shortMapDeviceIdentity(value: string) {
  const normalized = value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (!normalized) {
    return "未识别";
  }
  return normalized.length <= 6 ? normalized : normalized.slice(-6);
}

function resolveDeviceMarkerMeta(device?: DeviceSummary) {
  const icon = device?.isGateway ? buildGatewayIcon() : buildControllerIcon();
  if (device?.isGateway) {
    if (device.gatewayState === "online") {
      return {
        className: "amapDeviceMarker--online",
        label: "在线",
        pillClass: "connected",
        icon,
      };
    }
    if (device.gatewayState === "offline") {
      return {
        className: "amapDeviceMarker--offline",
        label: "离线",
        pillClass: "disconnected",
        icon,
      };
    }
  }
  switch (device?.bleConnectivityState ?? device?.connectivityState) {
    case "connected":
      return {
        className: "amapDeviceMarker--online",
        label: "在线",
        pillClass: "connected",
        icon,
      };
    case "error":
      return {
        className: "amapDeviceMarker--error",
        label: "异常",
        pillClass: "error",
        icon,
      };
    case "connecting":
      return {
        className: "amapDeviceMarker--pending",
        label: "连接中",
        pillClass: "connecting",
        icon,
      };
    default:
      return {
        className: "amapDeviceMarker--offline",
        label: "离线",
        pillClass: "disconnected",
        icon,
      };
  }
}

function getCompactFieldLabel(name: string) {
  const trimmed = name.trim();
  if (trimmed.length <= 8) {
    return trimmed;
  }
  return `${trimmed.slice(0, 8)}…`;
}

function getCompactDeviceLabel(name: string) {
  const normalized = name
    .replace(/(控制器|网关|设备|终端)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const base = normalized || name.trim();
  if (base.length <= 6) {
    return base;
  }
  return `${base.slice(0, 6)}…`;
}

function formatDeviceChoiceLabel(device: DeviceSummary) {
  return `${device.name} · ${shortenDeviceIdentity(device.blePeripheralId || device.id)}`;
}

function shortenDeviceIdentity(value: string) {
  const normalized = value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (!normalized) {
    return "未识别";
  }
  if (normalized.length <= 6) {
    return normalized;
  }
  return normalized.slice(-6);
}

function buildControllerIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6" y="4" width="12" height="16" rx="2.5"></rect>
      <path d="M9 2v2M15 2v2M9 20v2M15 20v2"></path>
      <circle cx="12" cy="9" r="1.6"></circle>
      <path d="M9.5 13h5M9.5 16h5"></path>
    </svg>
  `;
}

function buildGatewayIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 6a7 7 0 0 1 7 7"></path>
      <path d="M12 9a4 4 0 0 1 4 4"></path>
      <path d="M12 3a10 10 0 0 1 10 10"></path>
      <circle cx="12" cy="16.5" r="2.2"></circle>
    </svg>
  `;
}

function resolveWorkflowStep(input: {
  drawingMode: "field" | "zone" | null;
  formOpen: boolean;
  zoneFormOpen: boolean;
  selectedField?: FieldSummary;
}): WorkflowStep {
  if (input.drawingMode === "field") {
    return "field-draw";
  }
  if (input.formOpen) {
    return "field-info";
  }
  if (input.drawingMode === "zone") {
    return "zone-draw";
  }
  if (input.zoneFormOpen) {
    return "zone-bind";
  }
  return "browse";
}

function getStepTitle(step: WorkflowStep) {
  switch (step) {
    case "field-draw":
      return "绘制地块";
    case "field-info":
      return "填写地块资料";
    case "zone-draw":
      return "绘制分区";
    case "zone-bind":
      return "绑定设备与站点";
    default:
      return "地图浏览";
  }
}

function getStepDescription(step: WorkflowStep, selectedField?: FieldSummary) {
  switch (step) {
    case "field-draw":
      return "在地图上依次点击地块边界点，双击结束绘制。";
    case "field-info":
      return "补充地块分组、作物、面积、Kc 和主设备。";
    case "zone-draw":
      return `正在为 ${selectedField?.name ?? "当前地块"} 绘制分区边界。`;
    case "zone-bind":
      return "为分区添加设备；多站点设备需要选择具体站点。";
    default:
      return selectedField ? "选择地块后可继续新增分区或进入详情。" : "先从地图上绘制一个地块。";
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
