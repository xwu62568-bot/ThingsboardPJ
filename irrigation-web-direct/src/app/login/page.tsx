"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getStoredSession } from "@/lib/client/session";

export default function LoginPage() {
  const router = useRouter();

  useEffect(() => {
    if (getStoredSession()) {
      router.replace("/devices");
    }
  }, [router]);

  return (
    <main className="loginPage">
      <section className="loginShowcase">
        <div className="eyebrow">ThingsBoard User App</div>
        <h2>专业灌溉前台</h2>
        <p>
          首版聚焦设备状态、传感状态、连接控制、时长设置和手动开关阀，实时更新通道采用
          WebSocket。
        </p>
      </section>
      <LoginForm />
    </main>
  );
}
