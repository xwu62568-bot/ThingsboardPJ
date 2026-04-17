"use client";

import { useRouter } from "next/navigation";
import { logoutFromThingsBoard } from "@/lib/client/thingsboard";
import { clearStoredSession } from "@/lib/client/session";

export function LogoutButton() {
  const router = useRouter();

  const onLogout = async () => {
    await logoutFromThingsBoard();
    clearStoredSession();
    router.push("/login");
    router.refresh();
  };

  return (
    <button className="ghostButton" type="button" onClick={onLogout}>
      退出登录
    </button>
  );
}
