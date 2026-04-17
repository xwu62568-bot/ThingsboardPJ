"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getStoredSession } from "@/lib/client/session";

export function HomeRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace(getStoredSession() ? "/devices" : "/login");
  }, [router]);

  return <main className="appPage">跳转中...</main>;
}
