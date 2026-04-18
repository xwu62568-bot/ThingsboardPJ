import { LoginForm } from "@/components/login-form";

export function LoginPage() {
  return (
    <main className="loginPage">
      <section className="loginShowcase">
        <div className="eyebrow">ThingsBoard User App</div>
        <h2>专业灌溉前台</h2>
        <p>
          首版聚焦设备状态、传感状态、连接控制、时长设置和手动开关阀，实时更新通道采用直连
          ThingsBoard WebSocket。
        </p>
      </section>
      <LoginForm />
    </main>
  );
}
