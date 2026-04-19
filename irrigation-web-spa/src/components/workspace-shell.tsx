"use client";

import type { LucideIcon } from "lucide-react";
import {
  CalendarClock,
  Cpu,
  Droplets,
  LayoutDashboard,
  ListOrdered,
  Map,
  Menu,
  SlidersHorizontal,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { WorkspaceProvider, useWorkspace } from "@/components/workspace-provider";

const NAV_ITEMS: { to: string; label: string; Icon: LucideIcon }[] = [
  { to: "/dashboard", label: "总览", Icon: LayoutDashboard },
  { to: "/map", label: "地块地图", Icon: Map },
  { to: "/plans", label: "轮灌计划", Icon: ListOrdered },
  { to: "/strategies", label: "自动策略", Icon: SlidersHorizontal },
  { to: "/devices", label: "设备", Icon: Cpu },
  { to: "/account", label: "账户", Icon: UserRound },
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
  const { loading, error } = useWorkspace();
  const isDashboard = location.pathname === "/dashboard";
  const isMap = location.pathname === "/map";
  const isFieldDetail = /^\/fields\/[^/]+/.test(location.pathname);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [location.pathname]);

  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 900px)");
    const syncBodyScroll = () => {
      if (mobile.matches && drawerOpen) {
        document.body.style.overflow = "hidden";
      } else {
        document.body.style.overflow = "";
      }
    };
    syncBodyScroll();
    mobile.addEventListener("change", syncBodyScroll);
    return () => {
      mobile.removeEventListener("change", syncBodyScroll);
      document.body.style.overflow = "";
    };
  }, [drawerOpen]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 901px)");
    const closeOnDesktop = () => {
      if (mq.matches) {
        setDrawerOpen(false);
      }
    };
    mq.addEventListener("change", closeOnDesktop);
    return () => mq.removeEventListener("change", closeOnDesktop);
  }, []);

  useEffect(() => {
    if (!drawerOpen) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const frameClass = `workspaceFrame${drawerOpen ? " workspaceFrame--drawerOpen" : ""}`;

  return (
    <div className={frameClass}>
      <aside className="workspaceSidebar" id="workspace-sidebar">
        <div className="brandBlock">
          <div className="brandSeal" aria-hidden>
            <Droplets size={20} strokeWidth={2.25} />
          </div>
          <div className="brandText">
            <strong>灌溉中心</strong>
          </div>
        </div>

        <nav className="workspaceNav">
          {NAV_ITEMS.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              className={({ isActive }) => `workspaceNavItem${isActive ? " active" : ""}`}
              to={to}
              onClick={() => setDrawerOpen(false)}
            >
              <span className="workspaceNavIcon" aria-hidden>
                <Icon size={18} strokeWidth={2} />
              </span>
              <span className="workspaceNavLabel">{label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="workspaceMain">
        {isFieldDetail ? (
          <nav className="detailTopNav detailTopNav--workspace" aria-label="地块详情导航">
            <Link className="backLink" to="/map">
              返回地块地图
            </Link>
          </nav>
        ) : null}

        <header className="workspaceTopbar">
          <div className="topbarLeading">
            <button
              type="button"
              className="mobileNavToggle"
              aria-label={drawerOpen ? "关闭菜单" : "打开菜单"}
              aria-expanded={drawerOpen}
              aria-controls="workspace-sidebar"
              onClick={() => setDrawerOpen((open) => !open)}
            >
              {drawerOpen ? <X size={20} strokeWidth={2} aria-hidden /> : <Menu size={20} strokeWidth={2} aria-hidden />}
            </button>
            <div className="topbarTitleBlock">
              <h1>{resolvePageTitle(location.pathname)}</h1>
              {isMap ? null : <p className="topbarSubtitle">{resolvePageSubtitle(location.pathname)}</p>}
            </div>
          </div>
          {isDashboard ? (
            <div className="headerActions">
              <Link className="primaryButton" to="/map">
                <Map size={16} strokeWidth={2} aria-hidden />
                地块地图
              </Link>
              <Link className="ghostButton" to="/plans">
                <CalendarClock size={16} strokeWidth={2} aria-hidden />
                灌溉计划
              </Link>
            </div>
          ) : null}
          {isMap ? (
            <div className="headerActions">
              <button
                className="primaryButton"
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent("irrigation-map:create-field"))}
              >
                新建地块
              </button>
            </div>
          ) : null}
        </header>

        {loading ? <section className="loadingBanner">正在更新灌区最新状态...</section> : null}
        {error ? <section className="errorBanner">{error}</section> : null}

        <Outlet />

        <button
          type="button"
          className="workspaceMobileBackdrop"
          aria-label="关闭菜单"
          tabIndex={drawerOpen ? 0 : -1}
          onClick={() => setDrawerOpen(false)}
        />
      </div>
    </div>
  );
}

function resolvePageTitle(pathname: string) {
  if (pathname.startsWith("/map")) {
    return "地块地图";
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
  if (pathname.startsWith("/account")) {
    return "账户";
  }
  return "灌溉总览";
}

function resolvePageSubtitle(pathname: string) {
  if (pathname.startsWith("/map")) {
    return "地块与设备空间分布与状态示意";
  }
  if (pathname.startsWith("/fields")) {
    return pathname.split("/").length > 2 ? "分区、设备与蒸散指标集中查看" : "按地块查看作物、墒情与分区概况";
  }
  if (pathname.startsWith("/plans")) {
    return "轮灌时段、顺序与时长配置与执行概览";
  }
  if (pathname.startsWith("/strategies")) {
    return "墒情、雨天锁定与蒸散触发的策略配置";
  }
  if (pathname.startsWith("/devices")) {
    return pathname.split("/").length > 2 ? "连接、刷新与阀门控制" : "在线状态与关键遥测一览";
  }
  if (pathname.startsWith("/account")) {
    return "当前登录身份与租户信息";
  }
  return "灌区关键指标与今日执行要点";
}
