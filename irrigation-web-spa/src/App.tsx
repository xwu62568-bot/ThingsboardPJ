import { Navigate, Route, Routes } from "react-router-dom";
import { AccountPage } from "@/pages/account-page";
import { WorkspaceShell } from "@/components/workspace-shell";
import { DashboardPage } from "@/pages/dashboard-page";
import { DevicePage } from "@/pages/device-page";
import { DevicesPage } from "@/pages/devices-page";
import { FieldDetailPage } from "@/pages/field-detail-page";
import { LoginPage } from "@/pages/login-page";
import { HomePage } from "@/pages/home-page";
import { MapPage } from "@/pages/map-page";
import { PlansPage } from "@/pages/plans-page";
import { StrategiesPage } from "@/pages/strategies-page";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route element={<WorkspaceShell />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/map" element={<MapPage />} />
        <Route path="/fields" element={<Navigate to="/map" replace />} />
        <Route path="/fields/:fieldId" element={<FieldDetailPage />} />
        <Route path="/plans" element={<PlansPage />} />
        <Route path="/plans/new" element={<PlansPage />} />
        <Route path="/plans/:planId" element={<PlansPage />} />
        <Route path="/strategies" element={<StrategiesPage />} />
        <Route path="/strategies/new" element={<StrategiesPage />} />
        <Route path="/strategies/:strategyId" element={<StrategiesPage />} />
        <Route path="/devices" element={<DevicesPage />} />
        <Route path="/devices/:deviceId" element={<DevicePage />} />
        <Route path="/account" element={<AccountPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
