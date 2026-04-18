import { LoginForm } from "@/components/login-form";

export function LoginPage() {
  return (
    <main className="loginPage">
      <section className="loginShowcase">
        <div className="eyebrow">Smart Irrigation</div>
        <h2>专业灌溉前台</h2>
        <p>
          面向现场管理和日常运维，集中查看地块、计划、自动策略与设备状态。
        </p>
      </section>
      <LoginForm />
    </main>
  );
}
