import { Navigate, Route, Routes } from "react-router-dom";
import { DevicePage } from "@/pages/device-page";
import { DevicesPage } from "@/pages/devices-page";
import { LoginPage } from "@/pages/login-page";
import { HomePage } from "@/pages/home-page";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/devices" element={<DevicesPage />} />
      <Route path="/devices/:deviceId" element={<DevicePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
