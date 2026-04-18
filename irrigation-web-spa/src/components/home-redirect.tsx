"use client";

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getStoredSession } from "@/lib/client/session";

export function HomeRedirect() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate(getStoredSession() ? "/dashboard" : "/login", { replace: true });
  }, [navigate]);

  return <main className="appPage">跳转中...</main>;
}
