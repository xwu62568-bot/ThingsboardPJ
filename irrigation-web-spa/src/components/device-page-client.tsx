"use client";

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useWorkspace } from "@/components/workspace-provider";
import { DeviceConsole } from "@/components/device-console";
import {
  fetchDeviceDetail,
  getCachedDeviceDetail,
} from "@/lib/client/thingsboard";
import type { DeviceState, DeviceSummary } from "@/lib/domain/types";

const DEFAULT_MANUAL_DURATION_SECONDS = 60;

export function DevicePageClient() {
  const params = useParams<{ deviceId: string }>();
  const { session, devices, updateDeviceFromDetail } = useWorkspace();
  const deviceId = String(params.deviceId);
  const [device, setDevice] = useState<DeviceState | null>(() =>
    getCachedDeviceDetail(session, deviceId),
  );
  const [ready, setReady] = useState(() => getCachedDeviceDetail(session, deviceId) !== null);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetchDeviceDetail(session, deviceId)
      .then((currentDevice) => {
        setDevice(currentDevice);
        updateDeviceFromDetail(currentDevice);
        setError("");
        setReady(true);
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "设备加载失败");
        setReady(true);
      });
  }, [deviceId, session, updateDeviceFromDetail]);

  if (!ready) {
    return <main className="workspacePage">加载中...</main>;
  }

  if (!device) {
    return (
      <main className="workspacePage">
        <section className="errorBanner">{error || "设备不存在"}</section>
      </main>
    );
  }

  return (
    <main className="workspacePage">
      <section className="sectionHead">
        <div>
          <Link className="backLink" to="/devices">
            返回设备列表
          </Link>
          <div className="eyebrow">设备详情</div>
          <h2>{device.name}</h2>
        </div>
        <div className="headerActions">
          <Link className="ghostButton" to="/plans">
            去轮灌计划
          </Link>
        </div>
      </section>
      {error ? <section className="errorBanner">{error}</section> : null}
      <DeviceConsole
        key={deviceId}
        initialDevice={device}
        devices={devices}
        activeDeviceId={deviceId}
        onDeviceChange={updateDeviceFromDetail}
      />
    </main>
  );
}

function reconcileDeviceSiteCount(
  device: DeviceState | null,
  summary: DeviceSummary,
): DeviceState | null {
  if (!device || summary.siteCount === device.siteCount) {
    return device;
  }
  const siteCount = Math.max(1, summary.siteCount);
  return {
    ...device,
    siteCount,
    selectedSiteNumber: Math.min(device.selectedSiteNumber, siteCount),
    sites: Array.from({ length: siteCount }, (_, index) => {
      const siteNumber = index + 1;
      const current = device.sites.find((site) => site.siteNumber === siteNumber);
      return (
        current ?? {
          siteNumber,
          label: `站点${siteNumber}`,
          valveState: "unknown",
          open: false,
          remainingSeconds: 0,
          openingDurationSeconds: 0,
          manualDurationSeconds: device.sites[0]?.manualDurationSeconds ?? DEFAULT_MANUAL_DURATION_SECONDS,
        }
      );
    }),
  };
}
