import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getPageUser } from "@/lib/server/session";

type Props = {
  searchParams: Promise<{ error?: string }>;
};

export default async function LoginPage({ searchParams }: Props) {
  const user = await getPageUser();
  if (user) {
    redirect("/devices");
  }

  const { error } = await searchParams;
  const errorMessage =
    error === "invalid"
      ? "账号或密码错误"
      : error === "missing"
        ? "请输入地址、账号和密码"
        : "";

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
      {errorMessage ? <div className="errorBanner">{errorMessage}</div> : null}
      <LoginForm />
    </main>
  );
}
