import { useState, useMemo } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine, Cell, AreaChart, Area
} from "recharts";

// ─── TARIFF & PHYSICAL CONSTANTS ─────────────────────────────────────────
const RATES = {
  peak:    { energy: 0.36977, hoursPerDay: 5  },
  offpeak: { energy: 0.15654, hoursPerDay: 14 },
  sop:     { energy: 0.13327, hoursPerDay: 5  },
};
const BLOCK_KW         = 50;
const BLOCK_COST       = 95.56;   // $/block/month
const OVERAGE_RATE     = 3.82;    // $/kW
const BATT_EFFICIENCY  = 0.84;
const HOURS_PER_MONTH  = 720;
const DAYS_PER_MONTH   = 30;
const AVG_SESSION_KWH  = 35;      // assumed average session energy

// Common DCFC power levels (kW)
const CHARGER_KW_OPTIONS = [200, 320, 400];

// ─── HELPERS ──────────────────────────────────────────────────────────────
const fmtD  = (v) => "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtK  = (v) => Math.abs(v) >= 1000 ? `$${(v/1000).toFixed(1)}k` : `$${v.toFixed(0)}`;
const fmtKA = (v) => Math.abs(v) >= 1000 ? `${(v/1000).toFixed(1)}k` : `${v.toFixed(0)}`;

// Session ↔ Utilization translation (based on effective station kW)
const sessionsFromUtil = (utilPct, effectiveKW) =>
  (effectiveKW * (utilPct / 100) * HOURS_PER_MONTH) / AVG_SESSION_KWH / DAYS_PER_MONTH;
const utilFromSessions = (sessions, effectiveKW) =>
  Math.min(50, (sessions * AVG_SESSION_KWH * DAYS_PER_MONTH) / (effectiveKW * HOURS_PER_MONTH) * 100);

// ─── CORE ECONOMICS ENGINE ────────────────────────────────────────────────
function calcEconomics({ blocks, utilPct, effectiveKW, peakSharePct, opSharePct, sopSharePct,
  retailRate, battKWh, battKW, battEnabled }) {
  // Use effectiveKW for energy throughput, blocks × 50 for subscription cost
  const subscriptionKW = blocks * BLOCK_KW;
  const totalKWh  = effectiveKW * (utilPct / 100) * HOURS_PER_MONTH;
  const peakKWh   = totalKWh * (peakSharePct / 100);
  const opKWh     = totalKWh * (opSharePct   / 100);
  const sopKWh    = totalKWh * (sopSharePct  / 100);

  let subBlocks = blocks, subCost = blocks * BLOCK_COST;
  let battSubSaving = 0, battEnergySaving = 0;
  let gridPeakKWh = peakKWh, gridSopExtra = 0;

  if (battEnabled && battKWh > 0 && battKW > 0) {
    const blocksReduced = Math.floor(Math.min(battKW, subscriptionKW) / BLOCK_KW);
    const newBlocks = Math.max(1, blocks - blocksReduced);
    battSubSaving = (blocks - newBlocks) * BLOCK_COST;
    subBlocks = newBlocks;
    subCost   = newBlocks * BLOCK_COST;
    const monthlyShift = battKWh * DAYS_PER_MONTH * BATT_EFFICIENCY;
    const shiftable    = Math.min(monthlyShift, peakKWh);
    battEnergySaving   = shiftable * (RATES.peak.energy - RATES.sop.energy / BATT_EFFICIENCY);
    gridPeakKWh  = peakKWh - shiftable;
    gridSopExtra = shiftable / BATT_EFFICIENCY;
  }

  const energyCostPeak  = gridPeakKWh * RATES.peak.energy;
  const energyCostOp    = opKWh       * RATES.offpeak.energy;
  const energyCostSop   = (sopKWh + gridSopExtra) * RATES.sop.energy;
  const totalEnergyCost = energyCostPeak + energyCostOp + energyCostSop;
  const totalCost       = subCost + totalEnergyCost;
  const revenue         = totalKWh * retailRate;
  const netMargin       = revenue - totalCost;
  const effectiveRate   = totalKWh > 0 ? totalCost / totalKWh : 0;

  return {
    subscriptionKW, totalKWh, peakKWh, opKWh, sopKWh,
    subCost, subBlocks, totalEnergyCost, totalCost,
    energyCostPeak, energyCostOp, energyCostSop,
    revenue, netMargin, effectiveRate,
    battSubSaving, battEnergySaving,
    totalBattSaving: battSubSaving + battEnergySaving,
  };
}

// ─── UI PRIMITIVES ────────────────────────────────────────────────────────
function Slider({ label, value, min, max, step = 1, onChange, color = "#f59e0b", fmtFn }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
        <span style={{ fontSize: 11, color: "#94a3b8", letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</span>
        <span style={{ fontSize: 13, color, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>
          {fmtFn ? fmtFn(value) : value}
        </span>
      </div>
      <div style={{ position: "relative", height: 6, background: "#1e293b", borderRadius: 3 }}>
        <div style={{ position: "absolute", left: 0, width: `${Math.min(100, pct)}%`, height: "100%", background: color, borderRadius: 3 }} />
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(Number(e.target.value))}
          style={{ position: "absolute", inset: 0, width: "100%", opacity: 0, cursor: "pointer", height: "100%" }} />
      </div>
    </div>
  );
}

function MetricCard({ label, value, sub, color = "#f59e0b" }) {
  return (
    <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderTop: `2px solid ${color}`, borderRadius: 4, padding: "12px 14px" }}>
      <div style={{ fontSize: 10, color: "#64748b", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 20, fontFamily: "'JetBrains Mono', monospace", color, fontWeight: 700, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#475569", marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

function CostBar({ label, value, total, color }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: "#94a3b8" }}>{label}</span>
        <span style={{ fontSize: 12, color: "#e2e8f0", fontFamily: "'JetBrains Mono', monospace" }}>
          {fmtD(value)} <span style={{ color: "#475569" }}>({pct.toFixed(0)}%)</span>
        </span>
      </div>
      <div style={{ height: 4, background: "#1e293b", borderRadius: 2 }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 2 }} />
      </div>
    </div>
  );
}

function Section({ label, color = "#f59e0b", children }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 10, color, letterSpacing: "0.15em", textTransform: "uppercase", fontWeight: 600,
        marginBottom: 12, borderBottom: "1px solid #1e293b", paddingBottom: 7 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 4, padding: "10px 14px" }}>
      <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ fontSize: 12, color: p.color || "#e2e8f0", fontFamily: "'JetBrains Mono', monospace", marginBottom: 2 }}>
          {p.name}: {typeof p.value === "number"
            ? (Math.abs(p.value) < 5 ? `$${p.value.toFixed(4)}` : fmtD(p.value))
            : p.value}
        </div>
      ))}
    </div>
  );
};

// ─── PROFITABILITY HEATMAP ────────────────────────────────────────────────
function ProfitabilityHeatmap({ blocks, effectiveKW, peakSharePct, opSharePct, sopSharePct, battEnabled, battKWh, battKW }) {
  const retailSteps = [0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.60, 0.75];
  const utilSteps   = [2, 5, 8, 10, 12, 15, 18, 20, 30, 40, 50];
  const [hovered, setHovered] = useState(null);

  const grid = useMemo(() => retailSteps.map(r =>
    utilSteps.map(u => {
      const e = calcEconomics({ blocks, effectiveKW, utilPct: u, peakSharePct, opSharePct, sopSharePct,
        retailRate: r, battKWh, battKW, battEnabled });
      return { margin: e.netMargin, mPerKWh: e.totalKWh > 0 ? e.netMargin / e.totalKWh : 0 };
    })
  ), [blocks, effectiveKW, peakSharePct, opSharePct, sopSharePct, battEnabled, battKWh, battKW]);

  const allM   = grid.flat().map(c => c.margin);
  const maxAbs = Math.max(Math.abs(Math.min(...allM)), Math.abs(Math.max(...allM)), 1);

  const cellColor = (m) => {
    const i = Math.min(Math.abs(m) / maxAbs, 1);
    return m >= 0 ? `rgb(5, ${Math.round(55 + i*150)}, 20)` : `rgb(${Math.round(80 + i*120)}, 20, 20)`;
  };

  return (
    <div>
      <div style={{ fontSize: 12, color: "#94a3b8", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4, fontWeight: 600 }}>
        Profitability Map — Net Monthly Margin
      </div>
      <div style={{ fontSize: 11, color: "#475569", marginBottom: 10 }}>
        Green = profit, red = loss. Rows = utilization, columns = retail rate. Hover any cell.
      </div>
      <div style={{ display: "flex", marginLeft: 40, marginBottom: 2 }}>
        {retailSteps.map(r => <div key={r} style={{ flex: 1, textAlign: "center", fontSize: 9, color: "#64748b" }}>${r.toFixed(2)}</div>)}
      </div>
      <div style={{ fontSize: 9, color: "#475569", textAlign: "center", marginLeft: 40, marginBottom: 5 }}>← Retail Rate ($/kWh) →</div>
      {utilSteps.map((u, uIdx) => (
        <div key={u} style={{ display: "flex", alignItems: "center", marginBottom: 2 }}>
          <div style={{ width: 36, fontSize: 9, color: "#64748b", textAlign: "right", paddingRight: 4, flexShrink: 0 }}>{u}%</div>
          {retailSteps.map((r, rIdx) => {
            const cell = grid[rIdx][uIdx];
            const isH  = hovered?.u === uIdx && hovered?.r === rIdx;
            return (
              <div key={r} onMouseEnter={() => setHovered({ u: uIdx, r: rIdx })} onMouseLeave={() => setHovered(null)}
                style={{ flex: 1, height: 28, background: cellColor(cell.margin), display: "flex",
                  alignItems: "center", justifyContent: "center", cursor: "default", position: "relative",
                  outline: isH ? "2px solid #f59e0b" : "none" }}>
                <span style={{ fontSize: 8, color: "rgba(255,255,255,0.8)", fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>
                  {cell.margin >= 0 ? "+" : ""}{fmtKA(cell.margin)}
                </span>
                {isH && (
                  <div style={{ position: "absolute", bottom: "110%", left: "50%", transform: "translateX(-50%)",
                    background: "#0f172a", border: "1px solid #334155", borderRadius: 4,
                    padding: "8px 12px", zIndex: 10, whiteSpace: "nowrap" }}>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>
                      {u}% util · {sessionsFromUtil(u, effectiveKW).toFixed(1)} sess/day · ${r.toFixed(2)}/kWh
                    </div>
                    <div style={{ fontSize: 13, color: cell.margin >= 0 ? "#34d399" : "#f87171",
                      fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>
                      {cell.margin >= 0 ? "+" : ""}{fmtD(cell.margin)}/mo
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>
                      {cell.mPerKWh >= 0 ? "+" : ""}{(cell.mPerKWh * 100).toFixed(1)}¢/kWh margin
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
      <div style={{ display: "flex", gap: 14, marginTop: 8, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <div style={{ width: 10, height: 10, background: "rgb(5,160,20)", borderRadius: 2 }} />
          <span style={{ fontSize: 9, color: "#64748b" }}>Profitable</span>
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <div style={{ width: 10, height: 10, background: "rgb(170,20,20)", borderRadius: 2 }} />
          <span style={{ fontSize: 9, color: "#64748b" }}>Loss</span>
        </div>
        <span style={{ fontSize: 9, color: "#334155" }}>Hover for sessions/day + P&amp;L</span>
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────
export default function BEV2SEconomics() {
  // Equipment
  const [numChargers,    setNumChargers]    = useState(4);
  const [kWPerCharger,   setKWPerCharger]   = useState(200);
  const [sharingEnabled, setSharingEnabled] = useState(false);
  const [sharingFactor,  setSharingFactor]  = useState(75);  // % of nameplate

  // Activity — two-way linked: utilPct ↔ sessionsPerDay
  const [activityMode,   setActivityMode]   = useState("util");   // "util" | "sessions"
  const [utilPct,        setUtilPct]        = useState(15);
  const [manualSessions, setManualSessions] = useState(null);     // set when mode=sessions

  // Charging profile
  const [peakSharePct,   setPeakShare]      = useState(35);
  const [opSharePct,     setOpShare]        = useState(40);
  const [sopSharePct,    setSopShare]       = useState(25);
  const [retailRate,     setRetailRate]     = useState(0.45);

  // Battery
  const [battEnabled,    setBattEnabled]    = useState(false);
  const [battConfigIdx,  setBattConfigIdx]  = useState(0);

  const BESS_CONFIGS = [
    { label: "220 kWh / 125 kW", kWh: 220, kW: 125 },
    { label: "220 kWh / 250 kW", kWh: 220, kW: 250 },
    { label: "379 kWh / 250 kW", kWh: 379, kW: 250 },
  ];
  const battKWh = BESS_CONFIGS[battConfigIdx].kWh;
  const battKW  = BESS_CONFIGS[battConfigIdx].kW;

  const [activeTab,      setActiveTab]      = useState("overview");

  // ── Derived equipment values ────────────────────────────────────────────
  const totalNameplateKW = numChargers * kWPerCharger;
  const effectiveKW      = sharingEnabled
    ? Math.max(BLOCK_KW, Math.round(totalNameplateKW * sharingFactor / 100 / 5) * 5)  // round to 5 kW
    : totalNameplateKW;
  const blocks           = Math.ceil(effectiveKW / BLOCK_KW);
  const subscriptionKW   = blocks * BLOCK_KW;
  const wastedKW         = subscriptionKW - effectiveKW;  // unused subscription headroom

  // ── Activity: keep util and sessions in sync ───────────────────────────
  const maxSessions = sessionsFromUtil(50, effectiveKW);

  const currentUtil = activityMode === "sessions" && manualSessions !== null
    ? utilFromSessions(manualSessions, effectiveKW)
    : utilPct;
  const currentSessions = sessionsFromUtil(currentUtil, effectiveKW);
  const sessionsPerCharger = currentSessions / numChargers;

  const handleUtilChange = (v) => {
    setUtilPct(v);
    setActivityMode("util");
    setManualSessions(null);
  };
  const handleSessionsChange = (v) => {
    setManualSessions(v);
    setActivityMode("sessions");
  };

  // ── Normalize TOU shares ────────────────────────────────────────────────
  const total    = peakSharePct + opSharePct + sopSharePct;
  const normPeak = peakSharePct / total * 100;
  const normOp   = opSharePct   / total * 100;
  const normSop  = sopSharePct  / total * 100;

  const params = { blocks, effectiveKW, utilPct: currentUtil,
    peakSharePct: normPeak, opSharePct: normOp, sopSharePct: normSop,
    retailRate, battKWh, battKW, battEnabled };
  const eco = useMemo(() => calcEconomics(params),
    [blocks, effectiveKW, currentUtil, normPeak, normOp, normSop, retailRate, battKWh, battKW, battEnabled]);

  const isProfitable = eco.netMargin >= 0;

  // ── Chart data: fine-grained utilization steps (1–50%) ─────────────────
  const UTIL_STEPS = [1,2,3,4,5,6,7,8,9,10,12,14,16,18,20,25,30,35,40,45,50];

  // Utilization tab – cost decomposition
  const costDecompData = useMemo(() => UTIL_STEPS.map(u => {
    const e = calcEconomics({ ...params, utilPct: u, battEnabled: false });
    return {
      util:         `${u}%`,
      sessions:     sessionsFromUtil(u, effectiveKW).toFixed(1),
      subPerKWh:    e.totalKWh > 0 ? e.subCost / e.totalKWh : 0,
      energyPerKWh: e.totalKWh > 0 ? e.totalEnergyCost / e.totalKWh : 0,
    };
  }), [blocks, effectiveKW, normPeak, normOp, normSop]);

  // Utilization tab – TOU sensitivity at 3 realistic utilization levels
  const touSensData = useMemo(() => Array.from({ length: 11 }, (_, i) => {
    const pPct  = i * 10;
    const rest  = 100 - pPct;
    const oShare = rest * 0.6, sShare = rest * 0.4;
    const lo = calcEconomics({ ...params, peakSharePct: pPct, opSharePct: oShare, sopSharePct: sShare, utilPct: 10, battEnabled: false });
    const md = calcEconomics({ ...params, peakSharePct: pPct, opSharePct: oShare, sopSharePct: sShare, utilPct: 25, battEnabled: false });
    const hi = calcEconomics({ ...params, peakSharePct: pPct, opSharePct: oShare, sopSharePct: sShare, utilPct: 40, battEnabled: false });
    return { peakPct: `${pPct}%`, low10: lo.netMargin, mid25: md.netMargin, high40: hi.netMargin };
  }), [blocks, effectiveKW, retailRate]);

  // Equipment tab – sessions/charger vs utilization
  const sessPerChargerData = useMemo(() => UTIL_STEPS.map(u => ({
    util:     `${u}%`,
    sessions: sessionsFromUtil(u, effectiveKW),
    perCharger: sessionsFromUtil(u, effectiveKW) / numChargers,
  })), [effectiveKW, numChargers]);

  // Equipment tab – block boundary waste across # of chargers
  const chargerSizingData = useMemo(() => Array.from({ length: Math.min(12, Math.floor(2000 / kWPerCharger)) }, (_, i) => {
    const n         = i + 1;
    const effKW     = sharingEnabled ? Math.max(BLOCK_KW, Math.round(n * kWPerCharger * sharingFactor / 100 / 5) * 5) : n * kWPerCharger;
    const blks      = Math.ceil(effKW / BLOCK_KW);
    const subKW     = blks * BLOCK_KW;
    const waste     = subKW - effKW;
    const wastePct  = effKW > 0 ? waste / subKW * 100 : 0;
    const monthlySub = blks * BLOCK_COST;
    return { n, label: `${n}×`, effKW, subKW, waste, wastePct, monthlySub };
  }), [kWPerCharger, sharingEnabled, sharingFactor]);

  // Battery tab – payback
  const battPaybackData = useMemo(() => {
    if (!battEnabled || eco.totalBattSaving <= 0) return [];
    return [100, 150, 200, 250, 300, 400, 500, 600, 750, 1000].map(c => ({
      label: `$${c}`,
      paybackYears: Math.min(battKWh * c / eco.totalBattSaving / 12, 20),
    }));
  }, [battEnabled, battKWh, battKW, eco.totalBattSaving]);

  // Battery tab – savings by utilization
  const battSavingsData = useMemo(() => UTIL_STEPS.map(u => {
    const wb = calcEconomics({ ...params, utilPct: u, battEnabled: true });
    return { util: `${u}%`, subSaving: wb.battSubSaving, energySaving: wb.battEnergySaving };
  }), [blocks, effectiveKW, normPeak, normOp, normSop, retailRate, battKWh, battKW]);

  const tabs = ["overview", "utilization", "equipment", "battery"];

  // Sessions slider max: 50% utilization, rounded up to nearest integer
  const sessionsSliderMax = Math.ceil(maxSessions);

  return (
    <div style={{ fontFamily: "'Barlow', system-ui, sans-serif", background: "#060c18", minHeight: "100vh", color: "#e2e8f0", paddingBottom: 40 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700&family=Barlow:wght@300;400;500&family=JetBrains+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0a0f1a; }
        ::-webkit-scrollbar-thumb { background: #334155; }
        input[type=range] { -webkit-appearance: none; appearance: none; }
      `}</style>

      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <div style={{ background: "#0a1628", borderBottom: "1px solid #1e293b", padding: "14px 28px",
        display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 3, height: 26, background: "#f59e0b" }} />
          <div>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 21, fontWeight: 700, letterSpacing: "0.05em" }}>
              PG&amp;E BEV-2-S STATION ECONOMICS
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 20, fontFamily: "'JetBrains Mono', monospace" }}>
          {[
            { label: "Station",    val: `${numChargers}×${kWPerCharger}kW`,    color: "#94a3b8" },
            { label: "Effective",  val: `${effectiveKW} kW`,                    color: "#f59e0b" },
            { label: "Blocks",     val: `${blocks} (${subscriptionKW} kW sub)`, color: "#06b6d4" },
            { label: "Monthly P&L",val: (isProfitable ? "+" : "") + fmtD(eco.netMargin), color: isProfitable ? "#34d399" : "#f87171" },
          ].map(h => (
            <div key={h.label} style={{ textAlign: "right" }}>
              <div style={{ fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em" }}>{h.label}</div>
              <div style={{ fontSize: 15, color: h.color, fontWeight: 700 }}>{h.val}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "290px 1fr", minHeight: "calc(100vh - 64px)" }}>

        {/* ── LEFT CONTROLS ─────────────────────────────────────────────── */}
        <div style={{ background: "#080e1c", borderRight: "1px solid #1e293b", padding: "18px 16px", overflowY: "auto" }}>

          {/* ── 1. EQUIPMENT ──────────────────────────────────────────── */}
          <Section label="1. Equipment" color="#f59e0b">
            <Slider label="Number of Chargers" value={numChargers} min={1} max={20} onChange={setNumChargers}
              color="#f59e0b" fmtFn={v => `${v} chargers`} />

            {/* kW per charger — button select */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: "#94a3b8", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
                kW per Charger
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {CHARGER_KW_OPTIONS.map(kw => (
                  <button key={kw} onClick={() => setKWPerCharger(kw)} style={{
                    padding: "4px 8px", fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                    background: kWPerCharger === kw ? "#f59e0b" : "#0f172a",
                    color:      kWPerCharger === kw ? "#000" : "#64748b",
                    border: `1px solid ${kWPerCharger === kw ? "#f59e0b" : "#1e293b"}`,
                    borderRadius: 3, cursor: "pointer", fontWeight: kWPerCharger === kw ? 700 : 400,
                  }}>{kw}</button>
                ))}
              </div>
            </div>

            {/* Power sharing */}
            <div style={{ marginBottom: 14 }}>
              <div onClick={() => setSharingEnabled(!sharingEnabled)} style={{
                display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
                background: sharingEnabled ? "#1c0f00" : "#0f172a",
                border: `1px solid ${sharingEnabled ? "#f59e0b" : "#1e293b"}`,
                borderRadius: 4, padding: "8px 10px", marginBottom: sharingEnabled ? 10 : 0,
              }}>
                <div style={{ width: 32, height: 18, background: sharingEnabled ? "#f59e0b" : "#1e293b", borderRadius: 9, position: "relative" }}>
                  <div style={{ position: "absolute", top: 2, left: sharingEnabled ? 15 : 2, width: 14, height: 14, background: "white", borderRadius: "50%", transition: "left 0.2s" }} />
                </div>
                <span style={{ fontSize: 12, color: sharingEnabled ? "#f59e0b" : "#475569" }}>Power Sharing</span>
                <span style={{ fontSize: 10, color: "#334155", marginLeft: "auto" }}>cabinet / dynamic</span>
              </div>
              {sharingEnabled && (
                <Slider label="Simultaneous Draw (% of nameplate)" value={sharingFactor} min={30} max={99} step={1}
                  onChange={setSharingFactor} color="#f97316"
                  fmtFn={v => `${v}% → ${Math.max(BLOCK_KW, Math.round(totalNameplateKW * v / 100 / 5) * 5)} kW eff.`} />
              )}
            </div>

            {/* Equipment summary box */}
            <div style={{ background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 4, padding: "10px 12px" }}>
              {[
                { l: "Nameplate capacity",   v: `${totalNameplateKW} kW`,         c: "#94a3b8" },
                { l: "Effective peak draw",  v: `${effectiveKW} kW`,              c: "#f59e0b" },
                { l: "Subscription blocks",  v: `${blocks} blocks = ${subscriptionKW} kW`, c: "#06b6d4" },
                { l: "Unused sub headroom",  v: `${wastedKW} kW (${(wastedKW/subscriptionKW*100).toFixed(0)}%)`, c: wastedKW > 0 ? "#f97316" : "#34d399" },
                { l: "Monthly subscription", v: fmtD(blocks * BLOCK_COST),        c: "#f59e0b" },
              ].map(r => (
                <div key={r.l} style={{ display: "flex", justifyContent: "space-between", marginBottom: 5, alignItems: "baseline" }}>
                  <span style={{ fontSize: 10, color: "#475569" }}>{r.l}</span>
                  <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: r.c }}>{r.v}</span>
                </div>
              ))}
            </div>
          </Section>

          {/* ── 2. STATION ACTIVITY ───────────────────────────────────── */}
          <Section label="2. Station Activity" color="#a78bfa">
            {/* Mode toggle */}
            <div style={{ display: "flex", gap: 0, marginBottom: 14, background: "#0f172a", borderRadius: 4, padding: 3, border: "1px solid #1e293b" }}>
              {[["util", "Set Utilization %"], ["sessions", "Set Sessions/Day"]].map(([mode, lbl]) => (
                <button key={mode} onClick={() => setActivityMode(mode)} style={{
                  flex: 1, padding: "6px 8px", fontSize: 11, fontWeight: 600, letterSpacing: "0.05em",
                  background: activityMode === mode ? "#a78bfa" : "none",
                  color:      activityMode === mode ? "#000" : "#475569",
                  border: "none", borderRadius: 3, cursor: "pointer",
                  fontFamily: "'Barlow Condensed', sans-serif",
                }}>{lbl}</button>
              ))}
            </div>

            {activityMode === "util" ? (
              <Slider label="Utilization %" value={utilPct} min={1} max={50} step={1}
                onChange={handleUtilChange} color="#a78bfa" fmtFn={v => `${v}%`} />
            ) : (
              <Slider label="Sessions per Day" value={manualSessions ?? currentSessions}
                min={0.1} max={sessionsSliderMax} step={0.1}
                onChange={handleSessionsChange} color="#a78bfa"
                fmtFn={v => `${v.toFixed(1)} sessions`} />
            )}

            {/* Linked summary */}
            <div style={{ background: "#0f0a1e", border: "1px solid #2e1065", borderRadius: 4, padding: "10px 12px", marginBottom: 8 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[
                  { l: "Utilization",        v: `${currentUtil.toFixed(1)}%`,           c: "#a78bfa", dim: activityMode === "sessions" },
                  { l: "Sessions/day (stn)", v: currentSessions.toFixed(1),             c: "#a78bfa", dim: activityMode === "util" },
                  { l: "Sessions/charger",   v: sessionsPerCharger.toFixed(1) + "/day", c: "#c4b5fd", dim: false },
                  { l: "Monthly kWh",        v: eco.totalKWh.toFixed(0),               c: "#94a3b8", dim: false },
                ].map(r => (
                  <div key={r.l} style={{ opacity: r.dim ? 0.45 : 1 }}>
                    <div style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>{r.l}</div>
                    <div style={{ fontSize: 14, fontFamily: "'JetBrains Mono', monospace", color: r.c, fontWeight: 700 }}>{r.v}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #2e1065" }}>
                <div style={{ fontSize: 10, color: "#475569" }}>
                  Assumes <span style={{ color: "#a78bfa" }}>35 kWh avg session</span>.
                  Max at 50% util: <span style={{ color: "#64748b" }}>{maxSessions.toFixed(1)} sess/day</span> ·{" "}
                  <span style={{ color: "#64748b" }}>{(maxSessions/numChargers).toFixed(1)} per charger</span>
                </div>
              </div>
            </div>
          </Section>

          {/* ── 3. CHARGING TIME DISTRIBUTION ────────────────────────── */}
          <Section label="3. Charging Time Distribution" color="#06b6d4">
            <div style={{ fontSize: 11, color: "#475569", marginBottom: 8 }}>Auto-normalizes to 100%</div>
            <Slider label="Peak (4–9pm)" value={peakSharePct} min={0} max={100} onChange={setPeakShare}
              color="#f97316" fmtFn={() => `${normPeak.toFixed(0)}%`} />
            <Slider label="Off-Peak" value={opSharePct} min={0} max={100} onChange={setOpShare}
              color="#60a5fa" fmtFn={() => `${normOp.toFixed(0)}%`} />
            <Slider label="Super Off-Peak (9am–2pm)" value={sopSharePct} min={0} max={100} onChange={setSopShare}
              color="#34d399" fmtFn={() => `${normSop.toFixed(0)}%`} />
          </Section>

          {/* ── 4. RETAIL RATE ────────────────────────────────────────── */}
          <Section label="4. Retail Rate" color="#06b6d4">
            <Slider label="Retail Rate ($/kWh charged)" value={retailRate} min={0.10} max={1.00} step={0.01}
              onChange={setRetailRate} color="#06b6d4" fmtFn={v => `$${v.toFixed(2)}`} />
          </Section>

          {/* ── 5. BATTERY STORAGE ───────────────────────────────────── */}
          <Section label="5. Battery Storage (BESS)" color="#34d399">
            <div onClick={() => setBattEnabled(!battEnabled)} style={{
              display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
              background: battEnabled ? "#052e16" : "#0f172a",
              border: `1px solid ${battEnabled ? "#34d399" : "#1e293b"}`,
              borderRadius: 4, padding: "8px 10px", marginBottom: battEnabled ? 12 : 0,
            }}>
              <div style={{ width: 32, height: 18, background: battEnabled ? "#34d399" : "#1e293b", borderRadius: 9, position: "relative", transition: "background 0.2s" }}>
                <div style={{ position: "absolute", top: 2, left: battEnabled ? 15 : 2, width: 14, height: 14, background: "white", borderRadius: "50%", transition: "left 0.2s" }} />
              </div>
              <span style={{ fontSize: 12, color: battEnabled ? "#34d399" : "#475569" }}>{battEnabled ? "BESS Enabled" : "BESS Disabled"}</span>
            </div>
            {battEnabled && (
              <>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: "#94a3b8", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>BESS Configuration</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {BESS_CONFIGS.map((cfg, i) => (
                      <button key={i} onClick={() => setBattConfigIdx(i)} style={{
                        padding: "7px 10px", fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
                        background: battConfigIdx === i ? "#052e16" : "#0f172a",
                        color:      battConfigIdx === i ? "#34d399" : "#475569",
                        border: `1px solid ${battConfigIdx === i ? "#34d399" : "#1e293b"}`,
                        borderRadius: 3, cursor: "pointer", textAlign: "left",
                        fontWeight: battConfigIdx === i ? 700 : 400,
                      }}>{cfg.label}</button>
                    ))}
                  </div>
                </div>
                {eco.totalBattSaving > 0 && (
                  <div style={{ background: "#052e16", border: "1px solid #166534", borderRadius: 4, padding: "8px 12px" }}>
                    <div style={{ fontSize: 10, color: "#4ade80", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 3 }}>Monthly BESS Savings</div>
                    <div style={{ fontSize: 17, color: "#34d399", fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>+{fmtD(eco.totalBattSaving)}</div>
                    <div style={{ fontSize: 10, color: "#15803d", marginTop: 3 }}>Sub: {fmtD(eco.battSubSaving)} · Arb: {fmtD(eco.battEnergySaving)}</div>
                  </div>
                )}
              </>
            )}
          </Section>

          {/* Rate reference */}
          <div style={{ background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 4, padding: "10px 12px" }}>
            <div style={{ fontSize: 10, color: "#475569", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>BEV-2-S Rates</div>
            {[
              { l: "Peak (4–9pm)",  r: RATES.peak.energy,    c: "#f97316" },
              { l: "Off-Peak",      r: RATES.offpeak.energy, c: "#60a5fa" },
              { l: "Super Off-Pk", r: RATES.sop.energy,     c: "#34d399" },
            ].map(x => (
              <div key={x.l} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: x.c }}>{x.l}</span>
                <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: "#94a3b8" }}>${x.r.toFixed(5)}</span>
              </div>
            ))}
            <div style={{ borderTop: "1px solid #1e293b", marginTop: 6, paddingTop: 6 }}>
              {[
                { l: "Block (50 kW)", v: "$95.56/mo", c: "#f59e0b" },
                { l: "Overage",       v: "$3.82/kW",  c: "#f87171" },
                { l: "BESS RT Eff",   v: "84%",       c: "#34d399" },
              ].map(x => (
                <div key={x.l} style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>{x.l}</span>
                  <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: x.c }}>{x.v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── RIGHT PANEL ───────────────────────────────────────────────── */}
        <div style={{ padding: "18px 22px", overflowY: "auto" }}>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 2, marginBottom: 18, borderBottom: "1px solid #1e293b" }}>
            {tabs.map(t => (
              <button key={t} onClick={() => setActiveTab(t)} style={{
                background: "none", border: "none", cursor: "pointer",
                padding: "8px 16px", fontSize: 12, fontWeight: 600, letterSpacing: "0.08em",
                textTransform: "uppercase", color: activeTab === t ? "#f59e0b" : "#475569",
                borderBottom: activeTab === t ? "2px solid #f59e0b" : "2px solid transparent",
                marginBottom: -1, fontFamily: "'Barlow Condensed', sans-serif",
              }}>{t}</button>
            ))}
          </div>

          {/* ══ OVERVIEW ════════════════════════════════════════════════ */}
          {activeTab === "overview" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 18 }}>
                <MetricCard label="Monthly Revenue"    value={fmtD(eco.revenue)}      sub={`${eco.totalKWh.toFixed(0)} kWh @ $${retailRate.toFixed(2)}`} color="#06b6d4" />
                <MetricCard label="Total Monthly Cost" value={fmtD(eco.totalCost)}    sub={`Sub: ${fmtD(eco.subCost)} · Energy: ${fmtD(eco.totalEnergyCost)}`} color="#f59e0b" />
                <MetricCard label="Net Margin"         value={fmtD(eco.netMargin)}    sub={eco.totalKWh > 0 ? `${(eco.netMargin/eco.revenue*100).toFixed(1)}% margin` : "—"} color={isProfitable ? "#34d399" : "#f87171"} />
                <MetricCard label="Effective Cost/kWh" value={eco.totalKWh > 0 ? `$${eco.effectiveRate.toFixed(4)}` : "—"} sub="all-in breakeven rate" color="#a78bfa" />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "270px 1fr", gap: 18, marginBottom: 18 }}>
                <div style={{ background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 4, padding: "16px 18px" }}>
                  <div style={{ fontSize: 11, color: "#94a3b8", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 14, fontWeight: 600 }}>Cost Breakdown</div>
                  <CostBar label={`Subscription (${blocks} × $95.56)`} value={eco.subCost}        total={eco.totalCost} color="#f59e0b" />
                  <CostBar label="Peak Energy"                          value={eco.energyCostPeak} total={eco.totalCost} color="#f97316" />
                  <CostBar label="Off-Peak Energy"                      value={eco.energyCostOp}   total={eco.totalCost} color="#60a5fa" />
                  <CostBar label="Super Off-Peak Energy"                value={eco.energyCostSop}  total={eco.totalCost} color="#34d399" />
                  <div style={{ borderTop: "1px solid #1e293b", marginTop: 12, paddingTop: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                      <span style={{ fontSize: 11, color: "#64748b" }}>Monthly Total</span>
                      <span style={{ fontSize: 12, color: "#f59e0b", fontFamily: "'JetBrains Mono', monospace" }}>{fmtD(eco.totalCost)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 11, color: "#64748b" }}>Annual Total</span>
                      <span style={{ fontSize: 11, color: "#64748b", fontFamily: "'JetBrains Mono', monospace" }}>{fmtD(eco.totalCost * 12)}</span>
                    </div>
                  </div>
                </div>
                <div style={{ background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 4, padding: "16px 18px" }}>
                  <ProfitabilityHeatmap blocks={blocks} effectiveKW={effectiveKW}
                    peakSharePct={normPeak} opSharePct={normOp} sopSharePct={normSop}
                    battEnabled={battEnabled} battKWh={battKWh} battKW={battKW} />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
                {[
                  {
                    label: "Subscription Dominance", color: "#f59e0b",
                    value: `${(eco.subCost / eco.totalCost * 100).toFixed(0)}% fixed cost`,
                    body: eco.subCost / eco.totalCost > 0.5
                      ? "Fixed costs dominate. Adding sessions costs almost nothing at the margin — throughput is the primary profit lever."
                      : "Energy costs dominate. Retail pricing and TOU optimization matter more than incremental sessions.",
                  },
                  {
                    label: "Sessions to Break-even", color: "#a78bfa",
                    value: (() => {
                      for (let u = 1; u <= 50; u += 0.5) {
                        const e = calcEconomics({ ...params, utilPct: u });
                        if (e.revenue >= e.totalCost) {
                          return `${sessionsFromUtil(u, effectiveKW).toFixed(1)}/day`;
                        }
                      }
                      return ">${sessionsFromUtil(50, effectiveKW).toFixed(1)}/day";
                    })(),
                    body: `= ${(() => {
                      for (let u = 1; u <= 50; u += 0.5) {
                        const e = calcEconomics({ ...params, utilPct: u });
                        if (e.revenue >= e.totalCost) return `${(sessionsFromUtil(u, effectiveKW)/numChargers).toFixed(1)} sessions/charger/day`;
                      }
                      return "above 50% utilization";
                    })()} at $${retailRate.toFixed(2)}/kWh retail and current TOU mix.`,
                  },
                  {
                    label: "Peak:SOP Ratio", color: "#f97316",
                    value: `${(RATES.peak.energy / RATES.sop.energy).toFixed(2)}× spread`,
                    body: `Shifting a session from peak to SOP saves $${((RATES.peak.energy - RATES.sop.energy) * AVG_SESSION_KWH).toFixed(2)} gross per session. After 84% BESS round-trip, net arb per session shifted: $${((RATES.peak.energy - RATES.sop.energy / BATT_EFFICIENCY) * AVG_SESSION_KWH).toFixed(2)}.`,
                  },
                ].map(ins => (
                  <div key={ins.label} style={{ background: "#0a0f1a", borderLeft: `3px solid ${ins.color}`, borderRadius: 4, padding: "12px 14px" }}>
                    <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 5 }}>{ins.label}</div>
                    <div style={{ fontSize: 16, fontFamily: "'JetBrains Mono', monospace", color: ins.color, fontWeight: 700, marginBottom: 7, lineHeight: 1.2 }}>{ins.value}</div>
                    <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6 }}>{ins.body}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ══ UTILIZATION TAB ══════════════════════════════════════════ */}
          {activeTab === "utilization" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 18 }}>
                <MetricCard label="Utilization → Sessions" value={`${currentUtil.toFixed(1)}% → ${currentSessions.toFixed(1)}/day`} sub={`${sessionsPerCharger.toFixed(2)} per charger/day`} color="#a78bfa" />
                <MetricCard label="Effective Cost/kWh"     value={eco.totalKWh > 0 ? `$${eco.effectiveRate.toFixed(4)}` : "—"} sub="all-in delivered cost" color="#f59e0b" />
                <MetricCard label="Subscription Adder"     value={eco.totalKWh > 0 ? `$${(eco.subCost/eco.totalKWh).toFixed(4)}` : "—"} sub="fixed cost ÷ kWh delivered" color="#f97316" />
              </div>

              <div style={{ background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 4, padding: "16px 18px", marginBottom: 18 }}>
                <div style={{ fontSize: 12, color: "#94a3b8", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4, fontWeight: 600 }}>
                  All-In Cost/kWh Decomposition — {numChargers}×{kWPerCharger} kW Station (1–50% Utilization)
                </div>
                <div style={{ fontSize: 11, color: "#475569", marginBottom: 14 }}>
                  Amber = subscription $/kWh (shrinks steeply at low utilization — the fixed cost amortization effect). Teal = energy $/kWh (flat). The curve is steepest between 1–15%, where most real DCFC stations operate. Profitability begins where the stack drops below your retail rate.
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={costDecompData} margin={{ top: 5, right: 20, left: 0, bottom: 20 }}>
                    <defs>
                      <linearGradient id="subG"  x1="0" y1="0" x2="0" y2="1"><stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.55}/><stop offset="95%" stopColor="#f59e0b" stopOpacity={0.1}/></linearGradient>
                      <linearGradient id="engG"  x1="0" y1="0" x2="0" y2="1"><stop offset="5%"  stopColor="#06b6d4" stopOpacity={0.45}/><stop offset="95%" stopColor="#06b6d4" stopOpacity={0.1}/></linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a2435" />
                    <XAxis dataKey="util" tick={{ fontSize: 9, fill: "#64748b" }}
                      label={{ value: "← Low utilization (most DCFC stations) | Utilization % →", fill: "#475569", fontSize: 9, position: "insideBottom", dy: 16 }} />
                    <YAxis tick={{ fontSize: 10, fill: "#64748b" }} tickFormatter={v => `$${v.toFixed(3)}`} domain={[0,"auto"]} />
                    <Tooltip content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const d = costDecompData.find(x => x.util === label);
                      const total = (payload[0]?.value||0) + (payload[1]?.value||0);
                      return (
                        <div style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 4, padding: "10px 14px" }}>
                          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>{label} util · {d?.sessions} sessions/day</div>
                          {payload.map((p,i) => <div key={i} style={{ fontSize: 12, color: p.color, fontFamily: "monospace" }}>{p.name}: ${(p.value||0).toFixed(4)}/kWh</div>)}
                          <div style={{ fontSize: 12, color: "#f59e0b", fontFamily: "monospace", marginTop: 4, fontWeight: 700 }}>Total: ${total.toFixed(4)}/kWh</div>
                        </div>
                      );
                    }} />
                    <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                    <ReferenceLine y={retailRate} stroke="#34d399" strokeDasharray="5 3"
                      label={{ value: `Retail $${retailRate.toFixed(2)}`, fill: "#34d399", fontSize: 10, position: "insideTopRight" }} />
                    <Area type="monotone" dataKey="energyPerKWh" name="Energy Cost/kWh"   stackId="1" stroke="#06b6d4" fill="url(#engG)" strokeWidth={2} />
                    <Area type="monotone" dataKey="subPerKWh"    name="Subscription/kWh"  stackId="1" stroke="#f59e0b" fill="url(#subG)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div style={{ background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 4, padding: "16px 18px" }}>
                <div style={{ fontSize: 12, color: "#94a3b8", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4, fontWeight: 600 }}>
                  Net Margin vs % Peak Charging — at 10%, 25%, and 40% Utilization
                </div>
                <div style={{ fontSize: 11, color: "#475569", marginBottom: 14 }}>
                  Each 10% shift of sessions into peak hours directly penalizes margin. At 10% utilization this penalty is relatively small in absolute dollars but can be the difference between profit and loss. Remaining charging is split 60/40 Off-Peak/SOP.
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={touSensData} margin={{ top: 5, right: 20, left: 0, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a2435" />
                    <XAxis dataKey="peakPct"
                      label={{ value: "% of Charging During Peak Hours (4–9pm)", fill: "#64748b", fontSize: 10, position: "insideBottom", dy: 16 }}
                      tick={{ fontSize: 10, fill: "#64748b" }} />
                    <YAxis tick={{ fontSize: 10, fill: "#64748b" }} tickFormatter={fmtK} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                    <ReferenceLine y={0} stroke="#f87171" strokeWidth={1.5}
                      label={{ value: "Break-even", fill: "#f87171", fontSize: 9, position: "insideTopLeft" }} />
                    <Line type="monotone" dataKey="high40" name="40% Util" stroke="#34d399" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="mid25"  name="25% Util" stroke="#a78bfa" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="low10"  name="10% Util" stroke="#f97316" strokeWidth={2} dot={false} strokeDasharray="5 3" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

          {/* ══ EQUIPMENT TAB ════════════════════════════════════════════ */}
          {activeTab === "equipment" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 18 }}>
                <MetricCard label="Station Config"    value={`${numChargers}×${kWPerCharger} kW`}   sub={`${totalNameplateKW} kW nameplate`} color="#f59e0b" />
                <MetricCard label="Effective Peak kW" value={`${effectiveKW} kW`}                    sub={sharingEnabled ? `${sharingFactor}% of nameplate` : "no sharing"} color="#f97316" />
                <MetricCard label="Block Waste"       value={`${wastedKW} kW`}                       sub={`${(wastedKW/subscriptionKW*100).toFixed(0)}% of subscription unused`} color={wastedKW > 25 ? "#f87171" : "#34d399"} />
                <MetricCard label="Sub Cost/Charger"  value={fmtD(eco.subCost / numChargers)}        sub="per month, per charger" color="#06b6d4" />
              </div>

              {/* Chart 1: Sessions per charger per day across utilization */}
              <div style={{ background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 4, padding: "16px 18px", marginBottom: 18 }}>
                <div style={{ fontSize: 12, color: "#94a3b8", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4, fontWeight: 600 }}>
                  Sessions per Charger per Day vs Station Utilization — {numChargers}×{kWPerCharger} kW
                </div>
                <div style={{ fontSize: 11, color: "#475569", marginBottom: 14 }}>
                  The operational translation of utilization into daily throughput per charger. Reference lines show utilization targets at common commercial targets (4, 8, 12 sessions/charger/day). Use this to size a station to a known demand forecast: start with expected sessions/charger, read off the utilization rate, then check the cost chart.
                </div>
                <ResponsiveContainer width="100%" height={230}>
                  <LineChart data={sessPerChargerData} margin={{ top: 5, right: 20, left: 0, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a2435" />
                    <XAxis dataKey="util" tick={{ fontSize: 9, fill: "#64748b" }}
                      label={{ value: "Station Utilization %", fill: "#64748b", fontSize: 10, position: "insideBottom", dy: 16 }} />
                    <YAxis tick={{ fontSize: 10, fill: "#64748b" }} tickFormatter={v => `${v.toFixed(1)}`}
                      label={{ value: "Sessions/charger/day", angle: -90, fill: "#64748b", fontSize: 10, position: "insideLeft", dx: -5 }} />
                    <Tooltip content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const d = sessPerChargerData.find(x => x.util === label);
                      return (
                        <div style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 4, padding: "10px 14px" }}>
                          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>{label} utilization</div>
                          <div style={{ fontSize: 12, color: "#a78bfa", fontFamily: "monospace" }}>Station: {d?.sessions.toFixed(1)} sessions/day</div>
                          <div style={{ fontSize: 12, color: "#f59e0b", fontFamily: "monospace" }}>Per charger: {d?.perCharger.toFixed(2)} sessions/day</div>
                        </div>
                      );
                    }} />
                    {[4, 8, 12].map(s => (
                      <ReferenceLine key={s} y={s} stroke="#334155" strokeDasharray="4 4"
                        label={{ value: `${s} sess`, fill: "#475569", fontSize: 9, position: "insideTopRight" }} />
                    ))}
                    <Line type="monotone" dataKey="perCharger" name="Sessions/charger/day" stroke="#a78bfa" strokeWidth={2.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Chart 2: Block boundary efficiency across charger counts */}
              <div style={{ background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 4, padding: "16px 18px" }}>
                <div style={{ fontSize: 12, color: "#94a3b8", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4, fontWeight: 600 }}>
                  Subscription Boundary Efficiency — {kWPerCharger} kW Chargers{sharingEnabled ? ` @ ${sharingFactor}% sharing` : ""}
                </div>
                <div style={{ fontSize: 11, color: "#475569", marginBottom: 14 }}>
                  Because subscription blocks come in 50 kW steps, some equipment configurations "waste" purchased subscription headroom. Amber bars = unused kW you're paying for. Efficient configurations land exactly on a 50 kW boundary (waste = 0). Use this to choose a charger count that minimizes waste, or to right-size charger kW to your block count.
                </div>
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={chargerSizingData} margin={{ top: 5, right: 20, left: 0, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a2435" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }}
                      label={{ value: "Number of Chargers", fill: "#64748b", fontSize: 10, position: "insideBottom", dy: 16 }} />
                    <YAxis yAxisId="kw"  tick={{ fontSize: 10, fill: "#64748b" }} tickFormatter={v => `${v} kW`} />
                    <YAxis yAxisId="pct" orientation="right" tick={{ fontSize: 10, fill: "#64748b" }} tickFormatter={v => `${v.toFixed(0)}%`} domain={[0, 100]} />
                    <Tooltip content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const d = chargerSizingData.find(x => x.label === label);
                      return (
                        <div style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 4, padding: "10px 14px" }}>
                          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>{d?.n} × {kWPerCharger} kW = {d?.effKW} kW eff.</div>
                          <div style={{ fontSize: 12, color: "#06b6d4", fontFamily: "monospace" }}>Subscription: {d?.subKW} kW ({Math.ceil((d?.effKW||0)/50)} blocks)</div>
                          <div style={{ fontSize: 12, color: d?.waste > 0 ? "#f97316" : "#34d399", fontFamily: "monospace" }}>
                            Waste: {d?.waste} kW ({d?.wastePct.toFixed(0)}%) · {fmtD((d?.waste||0) * BLOCK_COST / BLOCK_KW)}/mo
                          </div>
                          <div style={{ fontSize: 12, color: "#f59e0b", fontFamily: "monospace" }}>Monthly sub: {fmtD(d?.monthlySub||0)}</div>
                        </div>
                      );
                    }} />
                    <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                    <Bar yAxisId="kw" dataKey="effKW"  name="Effective kW"       fill="#06b6d4" opacity={0.6} radius={[0,0,0,0]} />
                    <Bar yAxisId="kw" dataKey="waste"  name="Wasted sub kW"      fill="#f97316" opacity={0.85} radius={[2,2,0,0]}>
                      {chargerSizingData.map((d, i) => (
                        <Cell key={i} fill={d.waste === 0 ? "#34d399" : "#f97316"} opacity={0.85} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

          {/* ══ BATTERY TAB ════════════════════════════════════════════ */}
          {activeTab === "battery" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 18 }}>
                <MetricCard label="Net Arb Spread"   value={`$${(RATES.peak.energy - RATES.sop.energy / BATT_EFFICIENCY).toFixed(4)}`} sub="per kWh shifted (84% RT)" color="#34d399" />
                <MetricCard label="Per-Session Arb"  value={`$${((RATES.peak.energy - RATES.sop.energy / BATT_EFFICIENCY) * AVG_SESSION_KWH).toFixed(2)}`} sub="at 35 kWh avg session" color="#06b6d4" />
                <MetricCard label="RT Efficiency"    value="84%"                                                            sub="kWh out ÷ kWh in"              color="#a78bfa" />
                <MetricCard label="Monthly Savings"  value={battEnabled && eco.totalBattSaving > 0 ? fmtD(eco.totalBattSaving) : "—"}
                  sub={battEnabled ? `Sub ${fmtD(eco.battSubSaving)} + Arb ${fmtD(eco.battEnergySaving)}` : "Enable BESS on left"} color="#34d399" />
              </div>

              <div style={{ background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 4, padding: "16px 18px", marginBottom: 18 }}>
                <div style={{ fontSize: 12, color: "#94a3b8", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4, fontWeight: 600 }}>
                  BESS Payback Period vs Installed Capital Cost — {battEnabled ? BESS_CONFIGS[battConfigIdx].label : "Enable BESS to activate"}
                </div>
                <div style={{ fontSize: 11, color: "#475569", marginBottom: 14 }}>
                  Monthly savings = {battEnabled && eco.totalBattSaving > 0 ? fmtD(eco.totalBattSaving) : "$0"}. Bars show simple payback in years across installed $/kWh costs. Most commercial DCFC-adjacent BESS lands $250–$450/kWh installed. Green = &lt;5 yr, amber = 5–10, red = &gt;10.
                </div>
                {battEnabled && battPaybackData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={battPaybackData} margin={{ top: 5, right: 20, left: 0, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1a2435" />
                      <XAxis dataKey="label"
                        label={{ value: "BESS Installed Cost ($/kWh)", fill: "#64748b", fontSize: 10, position: "insideBottom", dy: 16 }}
                        tick={{ fontSize: 10, fill: "#64748b" }} />
                      <YAxis tick={{ fontSize: 10, fill: "#64748b" }} tickFormatter={v => `${v.toFixed(0)}yr`} domain={[0, 20]} />
                      <Tooltip content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const v = payload[0]?.value;
                        return (
                          <div style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 4, padding: "10px 14px" }}>
                            <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>Capital: {label}/kWh installed</div>
                            <div style={{ fontSize: 13, color: v >= 20 ? "#f87171" : v > 10 ? "#f87171" : v > 5 ? "#f59e0b" : "#34d399", fontFamily: "monospace", fontWeight: 700 }}>
                              {v >= 20 ? ">20 yrs" : `${v.toFixed(1)} yrs`}
                            </div>
                          </div>
                        );
                      }} />
                      <ReferenceLine y={5}  stroke="#34d399" strokeDasharray="4 4" label={{ value: "5yr", fill: "#34d399", fontSize: 9, position: "insideTopRight" }} />
                      <ReferenceLine y={10} stroke="#f87171" strokeDasharray="4 4" label={{ value: "10yr", fill: "#f87171", fontSize: 9, position: "insideTopRight" }} />
                      <Bar dataKey="paybackYears" name="Payback (years)" radius={[2,2,0,0]}>
                        {battPaybackData.map((d, i) => (
                          <Cell key={i} fill={d.paybackYears >= 20 ? "#4b0000" : d.paybackYears > 10 ? "#991b1b" : d.paybackYears > 5 ? "#b45309" : "#15803d"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ height: 220, display: "flex", alignItems: "center", justifyContent: "center", color: "#334155", fontSize: 13 }}>
                    Enable BESS on the left panel to see payback analysis
                  </div>
                )}
              </div>

              <div style={{ background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 4, padding: "16px 18px" }}>
                <div style={{ fontSize: 12, color: "#94a3b8", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4, fontWeight: 600 }}>
                  BESS Savings Decomposed by Utilization — {battEnabled ? BESS_CONFIGS[battConfigIdx].label : "Enable BESS to activate"}
                </div>
                <div style={{ fontSize: 11, color: "#475569", marginBottom: 14 }}>
                  Amber = subscription block savings (flat regardless of utilization — this is a fixed monthly benefit from shedding blocks). Teal = energy arbitrage savings (scales with throughput). At low utilization typical of most DCFC stations, subscription reduction is the dominant BESS value stream.
                </div>
                <ResponsiveContainer width="100%" height={210}>
                  <BarChart data={battSavingsData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a2435" />
                    <XAxis dataKey="util" tick={{ fontSize: 9, fill: "#64748b" }} />
                    <YAxis tick={{ fontSize: 10, fill: "#64748b" }} tickFormatter={fmtK} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                    <Bar dataKey="subSaving"    name="Subscription Savings (flat)"  stackId="a" fill="#f59e0b" />
                    <Bar dataKey="energySaving" name="Energy Arbitrage (scales up)" stackId="a" fill="#34d399" radius={[2,2,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
