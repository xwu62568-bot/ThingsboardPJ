"use client";

import { NavLink, Outlet, useLocation } from "react-router-dom";
import { LogoutButton } from "@/components/logout-button";
import { WorkspaceProvider, useWorkspace } from "@/components/workspace-provider";

const NAV_ITEMS = [
  { to: "/dashboard", label: "总览" },
  { to: "/map", label: "地图" },
  { to: "/fields", label: "地块" },
  { to: "/plans", label: "轮灌计划" },
  { to: "/strategies", label: "自动策略" },
  { to: "/devices", label: "设备" },
];

export function WorkspaceShell() {
  return (
    <WorkspaceProvider>
      <WorkspaceShellInner />
    </WorkspaceProvider>
  );
}

function WorkspaceShellInner() {
  const location = useLocation();
  const { session, loading, error } = useWorkspace();

  return (
    <div className="workspaceFrame">
      <aside className="workspaceSidebar">
        <div className="brandBlock">
          <div className="brandSeal">IR</div>
          <div>
            <strong>专业灌溉中心</strong>
          </div>
        </div>

        <nav className="workspaceNav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              className={({ isActive }) =>
                `workspaceNavItem${isActive ? " active" : ""}`
              }
              to={item.to}
            >
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="workspaceMain">
        <header className="workspaceTopbar">
          <div>
            <h1>{resolvePageTitle(location.pathname)}</h1>
          </div>

          <div className="topbarAside">
            <div className="userBadge">
              <strong>{session.user.name}</strong>
              <span>当前账号</span>
            </div>
            <LogoutButton />
          </div>
        </header>

        {loading ? <section className="loadingBanner">正在更新灌区最新状态...</section> : null}
        {error ? <section className="errorBanner">{error}</section> : null}

        <Outlet />
      </div>
    </div>
  );
}

function resolvePageTitle(pathname: string) {
  if (pathname.startsWith("/map")) {
    return "灌区地图";
  }
  if (pathname.startsWith("/fields")) {
    return pathname.split("/").length > 2 ? "地块详情" : "地块中心";
  }
  if (pathname.startsWith("/plans")) {
    return "轮灌计划";
  }
  if (pathname.startsWith("/strategies")) {
    return "自动策略";
  }
  if (pathname.startsWith("/devices")) {
    return pathname.split("/").length > 2 ? "设备控制台" : "设备中心";
  }
  return "灌溉总览";
}
