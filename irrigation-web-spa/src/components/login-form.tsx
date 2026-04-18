"use client";

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DEFAULT_TB_BASE_URL, loginToThingsBoard } from "@/lib/client/thingsboard";
import { getStoredSession, storeSession } from "@/lib/client/session";

const TB_BASE_URL_OPTIONS = [
  DEFAULT_TB_BASE_URL,
  "https://thingsboard.cloud/",
];

export function LoginForm() {
  const navigate = useNavigate();
  const [baseUrl, setBaseUrl] = useState(DEFAULT_TB_BASE_URL);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (getStoredSession()) {
      navigate("/devices", { replace: true });
    }
  }, [navigate]);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const session = await loginToThingsBoard({ baseUrl, username, password });
      storeSession(session);
      navigate("/devices", { replace: true });
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
        前端直接连接 ThingsBoard：HTTP 直连加载数据，WebSocket 直连接收遥测与属性更新。
      </p>

      <label className="field">
        <span>ThingsBoard 地址</span>
        <select
          name="baseUrl"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
        >
          {TB_BASE_URL_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
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
        <p>这里输入 ThingsBoard 的账号密码，浏览器会在本地保存当前会话。</p>
        <p>地址支持下拉选择，已包含本地平台和 `https://thingsboard.cloud/`。</p>
      </div>
    </form>
  );
}
