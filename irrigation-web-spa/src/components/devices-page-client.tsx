"use client";

import { Link } from "react-router-dom";
import { useWorkspace } from "@/components/workspace-provider";
import { DeviceListLive } from "@/components/device-list-live";

export function DevicesPageClient() {
  const { devices, loading, refreshDevices } = useWorkspace();

  if (loading && devices.length === 0) {
    return <main className="workspacePage">加载设备中...</main>;
  }

  return (
    <main className="workspacePage">
      <section className="sectionHead">
        <div>
          <h2>设备中心</h2>
        </div>
        <div className="headerActions">
          <Link className="ghostButton" to="/fields">
            去地块中心
          </Link>
          <button className="primaryButton" type="button" onClick={() => void refreshDevices()}>
            刷新设备
          </button>
        </div>
      </section>

      <section className="devicePageIntro">
        <article className="miniFeatureCard">
          <strong>状态巡检</strong>
          <p>快速查看设备在线状态、电量和最近活动时间。</p>
        </article>
        <article className="miniFeatureCard">
          <strong>现场控制</strong>
          <p>进入设备详情后可进行连接、刷新和手动开关阀。</p>
        </article>
        <article className="miniFeatureCard">
          <strong>实时更新</strong>
          <p>列表会自动刷新关键状态，适合日常运维和值守查看。</p>
        </article>
      </section>
      <DeviceListLive initialDevices={devices} />
    </main>
  );
}
