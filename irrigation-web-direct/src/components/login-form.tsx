"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_TB_BASE_URL, loginToThingsBoard } from "@/lib/client/thingsboard";
import { storeSession } from "@/lib/client/session";

export function LoginForm() {
  const router = useRouter();
  const [baseUrl, setBaseUrl] = useState(DEFAULT_TB_BASE_URL);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const session = await loginToThingsBoard({ baseUrl, username, password });
      storeSession(session);
      router.push("/devices");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "登录失败");
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      className="loginCard"
      onSubmit={onSubmit}
    >
      <div className="eyebrow">Professional Irrigation Console</div>
      <h1>登录灌溉前台</h1>
      <p className="muted">
        当前已改为标准前端项目，页面直接调用 ThingsBoard REST API 与 WebSocket。
      </p>

      <label className="field">
        <span>ThingsBoard 地址</span>
        <input
          name="baseUrl"
          autoComplete="url"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
        />
      </label>

      <label className="field">
        <span>账号</span>
        <input
          name="username"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
      </label>

      <label className="field">
        <span>密码</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>

      {error ? <p className="errorMessage">{error}</p> : null}

      <button className="primaryButton" type="submit" disabled={pending}>
        {pending ? "登录中..." : "进入设备控制台"}
      </button>

      <div className="credentialsCard">
        <strong>登录说明</strong>
        <p>这里直接输入 ThingsBoard 的账号密码。</p>
        <p>默认地址已预填为 `http://58.210.46.6:8888`。</p>
      </div>
    </form>
  );
}
