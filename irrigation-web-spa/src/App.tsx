import { Navigate, Route, Routes } from "react-router-dom";
import { WorkspaceShell } from "@/components/workspace-shell";
import { DashboardPage } from "@/pages/dashboard-page";
import { DevicePage } from "@/pages/device-page";
import { DevicesPage } from "@/pages/devices-page";
import { FieldDetailPage } from "@/pages/field-detail-page";
import { FieldsPage } from "@/pages/fields-page";
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
        <Route path="/fields" element={<FieldsPage />} />
        <Route path="/fields/:fieldId" element={<FieldDetailPage />} />
        <Route path="/plans" element={<PlansPage />} />
        <Route path="/strategies" element={<StrategiesPage />} />
        <Route path="/devices" element={<DevicesPage />} />
        <Route path="/devices/:deviceId" element={<DevicePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
