"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { useNavigate } from "react-router-dom";
import { getStoredSession, type TbSession } from "@/lib/client/session";
import {
  fetchFieldAssetRecords,
  fetchDeviceList,
  fetchDeviceListBasic,
  getCachedDeviceList,
  hasFullCachedDeviceList,
  type TbFieldAssetRecord,
} from "@/lib/client/thingsboard";
import type { DeviceSummary } from "@/lib/domain/types";
import {
  buildDashboardSnapshot,
  buildFieldSummaries,
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
  refreshWorkspace: () => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: PropsWithChildren) {
  const navigate = useNavigate();
  const [session] = useState<TbSession | null>(() => getStoredSession());
  const [devices, setDevices] = useState<DeviceSummary[]>(() => getCachedDeviceList(session));
  const [fieldRecords, setFieldRecords] = useState<TbFieldAssetRecord[]>([]);
  const [loading, setLoading] = useState(() => getCachedDeviceList(session).length === 0);
  const [error, setError] = useState("");

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
        setDevices(full);
        setFieldRecords(fieldsFromTb);
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

  const value = useMemo<WorkspaceContextValue | null>(() => {
    if (!session) {
      return null;
    }
    const fields = buildFieldSummaries(devices);
    const tbFields =
      fieldRecords.length > 0 ? buildFieldSummariesFromRecords(fieldRecords, devices) : fields;
    return {
      session,
      devices,
      fields: tbFields,
      plans: buildPlanSummaries(tbFields, fieldRecords),
      strategies: buildStrategySummaries(tbFields, fieldRecords),
      dashboard: buildDashboardSnapshot(tbFields),
      loading,
      error,
      refreshDevices: async () => {
        const [full, fieldsFromTb] = await Promise.all([
          fetchDeviceList(session),
          fetchFieldAssetRecords(session).catch(() => []),
        ]);
        setDevices(full);
        setFieldRecords(fieldsFromTb);
        setError("");
      },
      refreshWorkspace: async () => {
        const [full, fieldsFromTb] = await Promise.all([
          fetchDeviceList(session),
          fetchFieldAssetRecords(session).catch(() => []),
        ]);
        setDevices(full);
        setFieldRecords(fieldsFromTb);
        setError("");
      },
    };
  }, [devices, error, fieldRecords, loading, session]);

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
