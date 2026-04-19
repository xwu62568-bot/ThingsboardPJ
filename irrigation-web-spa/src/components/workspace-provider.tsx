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
  getCachedFieldAssetRecords,
  hasFullCachedDeviceList,
  type TbFieldAssetRecord,
} from "@/lib/client/thingsboard";
import type { DeviceSummary } from "@/lib/domain/types";
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
  const [session] = useState<TbSession | null>(() => getStoredSession());
  const cachedDevices = getCachedDeviceList(session);
  const cachedFields = getCachedFieldAssetRecords(session);
  const [devices, setDevices] = useState<DeviceSummary[]>(() => cachedDevices);
  const [fieldRecords, setFieldRecords] = useState<TbFieldAssetRecord[]>(() => cachedFields);
  const [loading, setLoading] = useState(() => cachedDevices.length === 0 && cachedFields.length === 0);
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
    const tbFields = fieldRecords.length > 0 ? buildFieldSummariesFromRecords(fieldRecords, devices) : [];
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
        const full = await fetchDeviceList(session);
        setDevices(full);
        setError("");
      },
      refreshFields: async () => {
        const fieldsFromTb = await fetchFieldAssetRecords(session).catch(() => []);
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
