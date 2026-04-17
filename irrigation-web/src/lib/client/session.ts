import type { IrrigationUser } from "@/lib/domain/types";

export const TB_SESSION_KEY = "tb_frontend_session";

export type TbSession = {
  baseUrl: string;
  token: string;
  refreshToken?: string;
  user: IrrigationUser & {
    email?: string;
    role: string;
  };
};

export function getStoredSession(): TbSession | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(TB_SESSION_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as TbSession;
  } catch {
    window.localStorage.removeItem(TB_SESSION_KEY);
    return null;
  }
}

export function storeSession(session: TbSession): void {
  window.localStorage.setItem(TB_SESSION_KEY, JSON.stringify(session));
}

export function clearStoredSession(): void {
  window.localStorage.removeItem(TB_SESSION_KEY);
}
