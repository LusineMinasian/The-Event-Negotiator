import { useEffect } from "react";
import { clearTheme } from "../palette";
import KeysPanel from "./KeysPanel";

export default function Settings() {
  useEffect(() => { clearTheme(); }, []);
  return (
    <div className="container" style={{ maxWidth: 640 }}>
      <div className="section-eyebrow">Your account</div>
      <h1>Settings · API keys</h1>
      <p className="sub">Add your own keys to run everything for real. Leave blank to keep the app in
        simulation. There's a fuller walkthrough of each integration on the <a href="/overview"
        style={{ color: "var(--brand)", fontWeight: 600 }}>Overview</a> page.</p>
      <div className="card pad" style={{ marginTop: 8 }}><KeysPanel /></div>
    </div>
  );
}
