"use client";

import { useRouter } from "next/navigation";
import { clearStoredSession } from "@/lib/client/session";

export function LogoutButton() {
  const router = useRouter();

  const onLogout = () => {
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
