import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "./auth";
import { api } from "./api";
import { Loading } from "./ui";
import Login from "./screens/Login";
import Dashboard from "./screens/Dashboard";
import CreateEvent from "./screens/CreateEvent";
import VibeToSpec from "./screens/VibeToSpec";
import Confirm from "./screens/Confirm";
import Discovery from "./screens/Discovery";
import WarRoom from "./screens/WarRoom";
import LiveDashboard from "./screens/LiveDashboard";
import Receipt from "./screens/Receipt";
import Postmortem from "./screens/Postmortem";
import ConfigSwitch from "./screens/ConfigSwitch";
import SegmentStudio from "./screens/SegmentStudio";
import SystemCheck from "./screens/SystemCheck";

function TopBar() {
  const { user, logout } = useAuth();
  const [mode, setMode] = useState<{ call_mode: string; live: boolean } | null>(null);
  useEffect(() => {
    api.meta().then((m) => setMode({ call_mode: m.call_mode, live: m.live_calls_available })).catch(() => {});
  }, []);
  return (
    <div className="topbar">
      <NavLink to="/" className="brand" style={{ textDecoration: "none" }}>
        <span className="dot" /> <span className="brand-name">The Event Negotiator</span>
      </NavLink>
      <nav className="topnav">
        <NavLink to="/" end>Events</NavLink>
        <NavLink to="/config">Config Switch</NavLink>
        <NavLink to="/segments">Segment Studio</NavLink>
        <NavLink to="/system-check">System Check</NavLink>
      </nav>
      <div className="spacer" />
      {mode && (
        <span className={`chip ${mode.live ? "live" : "sim"}`}>
          {mode.live ? "● live calls" : "● simulation"}
        </span>
      )}
      <span className="small user-email">{user?.email}</span>
      <button className="btn ghost sm" onClick={logout}>Sign out</button>
    </div>
  );
}

function Protected({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" state={{ from: loc }} replace />;
  return (
    <div className="app">
      <TopBar />
      <div className="page" key={loc.pathname}>{children}</div>
    </div>
  );
}

// Immersive, full-screen (no top nav) — for the event-creation wizard.
function ProtectedBare({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" state={{ from: loc }} replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/new" element={<ProtectedBare><CreateEvent /></ProtectedBare>} />
      <Route path="/spec/:specId" element={<Protected><VibeToSpec /></Protected>} />
      <Route path="/spec/:specId/confirm" element={<Protected><Confirm /></Protected>} />
      <Route path="/spec/:specId/discovery" element={<Protected><Discovery /></Protected>} />
      <Route path="/campaign/:campaignId/live" element={<Protected><LiveDashboard /></Protected>} />
      <Route path="/campaign/:campaignId/warroom" element={<Protected><WarRoom /></Protected>} />
      <Route path="/campaign/:campaignId/receipt" element={<Protected><Receipt /></Protected>} />
      <Route path="/campaign/:campaignId/postmortem" element={<Protected><Postmortem /></Protected>} />
      <Route path="/config" element={<Protected><ConfigSwitch /></Protected>} />
      <Route path="/segments" element={<Protected><SegmentStudio /></Protected>} />
      <Route path="/system-check" element={<Protected><SystemCheck /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
