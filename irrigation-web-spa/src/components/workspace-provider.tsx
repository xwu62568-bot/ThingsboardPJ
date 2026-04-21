"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getStoredSession, type TbSession } from "@/lib/client/session";
import {
  fetchFieldAssetRecords,
  fetchDeviceDetail,
  fetchDeviceList,
  fetchDeviceListBasic,
  getCachedDeviceDetail,
  getCachedDeviceList,
  getCachedFieldAssetRecords,
  hasFullCachedDeviceList,
  type TbFieldAssetRecord,
} from "@/lib/client/thingsboard";
import type { DeviceState, DeviceSummary } from "@/lib/domain/types";
import {
  buildDashboardSnapshot,
  buildFieldSummariesFromRecords,
  buildPlanSummaries,
  buildStrategySummaries,
  type DashboardSnapshot,
  type FieldSummary,
  type IrrigationPlanSummary,
  type StrategySummary,
} from "@/lib/domain/workspace";

type WorkspaceContextValue = {
  session: TbSession;
  devices: DeviceSummary[];
  fields: FieldSummary[];
  plans: IrrigationPlanSummary[];
  strategies: StrategySummary[];
  dashboard: DashboardSnapshot;
  loading: boolean;
  error: string;
  refreshDevices: () => Promise<void>;
  refreshFields: () => Promise<void>;
  refreshWorkspace: () => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: PropsWithChildren) {
  const navigate = useNavigate();
  const location = useLocation();
  const [session] = useState<TbSession | null>(() => getStoredSession());
  const cachedDevices = getCachedDeviceList(session);
  const cachedFields = getCachedFieldAssetRecords(session);
  const [devices, setDevices] = useState<DeviceSummary[]>(() => cachedDevices);
  const [fieldRecords, setFieldRecords] = useState<TbFieldAssetRecord[]>(() => cachedFields);
  const [deviceDetailsById, setDeviceDetailsById] = useState<Record<string, DeviceState>>({});
  const [loading, setLoading] = useState(() => cachedDevices.length === 0 && cachedFields.length === 0);
  const [error, setError] = useState("");

  const mergeFieldRecords = (nextRecords: TbFieldAssetRecord[]) => {
    setFieldRecords((current) => {
      if (nextRecords.length === 0 && current.length > 0) {
        return current;
      }
      return nextRecords;
    });
  };

  useEffect(() => {
    if (!session) {
      navigate("/login", { replace: true });
      return;
    }

    let disposed = false;

    const load = async () => {
      try {
        if (devices.length === 0) {
          setLoading(true);
          const basic = await fetchDeviceListBasic(session);
          if (disposed) {
            return;
          }
          setDevices(basic);
        }
        const [full, fieldsFromTb] = await Promise.all([
          hasFullCachedDeviceList(session) ? Promise.resolve(getCachedDeviceList(session)) : fetchDeviceList(session),
          fetchFieldAssetRecords(session).catch((fieldError) => {
            console.warn("[workspace] 地块资产读取失败，使用设备推导地块", fieldError);
            return [];
          }),
        ]);
        if (disposed) {
          return;
        }
        const linkedDeviceDetails = await fetchLinkedDeviceDetails(session, fieldsFromTb);
        if (disposed) {
          return;
        }
        setDevices(full);
        mergeFieldRecords(fieldsFromTb);
        setDeviceDetailsById(linkedDeviceDetails);
        setError("");
      } catch (loadError) {
        if (!disposed) {
          setError(loadError instanceof Error ? loadError.message : "灌溉工作台数据加载失败");
        }
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      disposed = true;
    };
  }, [devices.length, navigate, session]);

  useEffect(() => {
    if (!session) {
      return;
    }

    let disposed = false;

    const refreshOnMenuSwitch = async () => {
      try {
        const [full, fieldsFromTb] = await Promise.all([
          fetchDeviceList(session),
          fetchFieldAssetRecords(session).catch(() => []),
        ]);
        if (disposed) {
          return;
        }
        const linkedDeviceDetails = await fetchLinkedDeviceDetails(session, fieldsFromTb);
        if (disposed) {
          return;
        }
        setDevices(full);
        mergeFieldRecords(fieldsFromTb);
        setDeviceDetailsById((current) => ({ ...current, ...linkedDeviceDetails }));
        setError("");
      } catch (refreshError) {
        if (!disposed) {
          setError(refreshError instanceof Error ? refreshError.message : "工作台数据刷新失败");
        }
      }
    };

    void refreshOnMenuSwitch();
    return () => {
      disposed = true;
    };
  }, [location.pathname, session]);

  const value = useMemo<WorkspaceContextValue | null>(() => {
    if (!session) {
      return null;
    }
    const tbFields =
      fieldRecords.length > 0 ? buildFieldSummariesFromRecords(fieldRecords, devices) : [];
    const liveFields = applyDeviceRuntimeToFields(tbFields, deviceDetailsById);
    return {
      session,
      devices,
      fields: liveFields,
      plans: buildPlanSummaries(liveFields, fieldRecords),
      strategies: buildStrategySummaries(liveFields, fieldRecords),
      dashboard: buildDashboardSnapshot(liveFields),
      loading,
      error,
      refreshDevices: async () => {
        const full = await fetchDeviceList(session);
        setDevices(full);
        setError("");
      },
      refreshFields: async () => {
        const fieldsFromTb = await fetchFieldAssetRecords(session).catch(() => []);
        const linkedDeviceDetails = await fetchLinkedDeviceDetails(session, fieldsFromTb);
        mergeFieldRecords(fieldsFromTb);
        setDeviceDetailsById((current) => ({ ...current, ...linkedDeviceDetails }));
        setError("");
      },
      refreshWorkspace: async () => {
        const [full, fieldsFromTb] = await Promise.all([
          fetchDeviceList(session),
          fetchFieldAssetRecords(session).catch(() => []),
        ]);
        const linkedDeviceDetails = await fetchLinkedDeviceDetails(session, fieldsFromTb);
        setDevices(full);
        mergeFieldRecords(fieldsFromTb);
        setDeviceDetailsById((current) => ({ ...current, ...linkedDeviceDetails }));
        setError("");
      },
    };
  }, [deviceDetailsById, devices, error, fieldRecords, loading, session]);

  if (!value) {
    return <main className="appPage">会话检查中...</main>;
  }

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error("useWorkspace must be used within WorkspaceProvider");
  }
  return context;
}

async function fetchLinkedDeviceDetails(session: TbSession, fieldRecords: TbFieldAssetRecord[]) {
  const linkedDeviceIds = Array.from(
    new Set(
      fieldRecords.flatMap((record) => {
        const ids = [
          typeof record.config.deviceId === "string" ? record.config.deviceId : "",
          ...((record.config.deviceMarkers ?? []).map((marker) => marker.deviceId).filter(Boolean) as string[]),
        ];
        return ids.filter(Boolean);
      }),
    ),
  );

  const details = await Promise.all(
    linkedDeviceIds.map(async (deviceId) => {
      try {
        const detail = await fetchDeviceDetail(session, deviceId);
        return [deviceId, detail] as const;
      } catch {
        const cached = getCachedDeviceDetail(session, deviceId);
        return cached ? ([deviceId, cached] as const) : null;
      }
    }),
  );

  return Object.fromEntries(details.filter((entry): entry is readonly [string, DeviceState] => entry !== null));
}

function applyDeviceRuntimeToFields(fields: FieldSummary[], deviceDetailsById: Record<string, DeviceState>) {
  return fields.map((field) => {
    const linkedDetails = [
      deviceDetailsById[field.deviceId],
      ...(field.deviceMarkers ?? []).map((marker) => deviceDetailsById[marker.deviceId]),
    ].filter((detail): detail is DeviceState => Boolean(detail));

    if (
      linkedDetails.some((detail) =>
        detail.sites.some((site) => site.open || site.remainingSeconds > 0),
      )
    ) {
      return {
        ...field,
        irrigationState: "running" as const,
      };
    }

    return field;
  });
}
