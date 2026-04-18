"use client";

import { useNavigate } from "react-router-dom";
import { logoutFromThingsBoard } from "@/lib/client/thingsboard";
import { clearStoredSession } from "@/lib/client/session";

export function LogoutButton() {
  const navigate = useNavigate();

  const onLogout = async () => {
    await logoutFromThingsBoard();
    clearStoredSession();
    navigate("/login", { replace: true });
  };

  return (
    <button className="ghostButton" type="button" onClick={onLogout}>
      退出登录
    </button>
  );
}
