import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "./auth";
import { api } from "./api";
import Login from "./screens/Login";
import Dashboard from "./screens/Dashboard";
import Onboarding from "./screens/Onboarding";
import VibeToSpec from "./screens/VibeToSpec";
import Confirm from "./screens/Confirm";
import Discovery from "./screens/Discovery";
import WarRoom from "./screens/WarRoom";
import Receipt from "./screens/Receipt";
import Postmortem from "./screens/Postmortem";
import ConfigSwitch from "./screens/ConfigSwitch";
import SegmentStudio from "./screens/SegmentStudio";

function TopBar() {
  const { user, logout } = useAuth();
  const [mode, setMode] = useState<{ call_mode: string; live: boolean } | null>(null);
  useEffect(() => {
    api.meta().then((m) => setMode({ call_mode: m.call_mode, live: m.live_calls_available })).catch(() => {});
  }, []);
  return (
    <div className="topbar">
      <NavLink to="/" className="brand" style={{ textDecoration: "none" }}>
        <span className="dot" /> The Event Negotiator
      </NavLink>
      <nav className="topnav">
        <NavLink to="/" end>Events</NavLink>
        <NavLink to="/config">Config Switch</NavLink>
        <NavLink to="/segments">Segment Studio</NavLink>
      </nav>
      <div className="spacer" />
      {mode && (
        <span className={`chip ${mode.live ? "live" : "sim"}`}>
          {mode.live ? "● live calls" : "● simulation"}
        </span>
      )}
      <span className="small">{user?.email}</span>
      <button className="btn ghost sm" onClick={logout}>Sign out</button>
    </div>
  );
}

function Protected({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="center">Loading…</div>;
  if (!user) return <Navigate to="/login" state={{ from: loc }} replace />;
  return (
    <div className="app">
      <TopBar />
      {children}
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/new" element={<Protected><Onboarding /></Protected>} />
      <Route path="/spec/:specId" element={<Protected><VibeToSpec /></Protected>} />
      <Route path="/spec/:specId/confirm" element={<Protected><Confirm /></Protected>} />
      <Route path="/spec/:specId/discovery" element={<Protected><Discovery /></Protected>} />
      <Route path="/campaign/:campaignId/warroom" element={<Protected><WarRoom /></Protected>} />
      <Route path="/campaign/:campaignId/receipt" element={<Protected><Receipt /></Protected>} />
      <Route path="/campaign/:campaignId/postmortem" element={<Protected><Postmortem /></Protected>} />
      <Route path="/config" element={<Protected><ConfigSwitch /></Protected>} />
      <Route path="/segments" element={<Protected><SegmentStudio /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
