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
  fetchDeviceList,
  fetchDeviceListBasic,
  getCachedDeviceList,
  hasFullCachedDeviceList,
} from "@/lib/client/thingsboard";
import type { DeviceSummary } from "@/lib/domain/types";
import {
  buildDashboardSnapshot,
  buildFieldSummaries,
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
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: PropsWithChildren) {
  const navigate = useNavigate();
  const [session] = useState<TbSession | null>(() => getStoredSession());
  const [devices, setDevices] = useState<DeviceSummary[]>(() => getCachedDeviceList(session));
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
        if (hasFullCachedDeviceList(session)) {
          setLoading(false);
          return;
        }
        const full = await fetchDeviceList(session);
        if (disposed) {
          return;
        }
        setDevices(full);
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
    return {
      session,
      devices,
      fields,
      plans: buildPlanSummaries(fields),
      strategies: buildStrategySummaries(fields),
      dashboard: buildDashboardSnapshot(fields),
      loading,
      error,
      refreshDevices: async () => {
        const full = await fetchDeviceList(session);
        setDevices(full);
        setError("");
      },
    };
  }, [devices, error, loading, session]);

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
