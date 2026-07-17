// src/lib/reports/report-css.ts
// Self-contained: NOT app Tailwind, so the same markup renders identically in
// the preview iframe and in headless Chromium via setContent.
export const REPORT_CSS = `
  :root { --peri:#5866c4; --ink:#1a1c22; --muted:#8a8f9c; --line:#e7e8ee; }
  * { box-sizing: border-box; }
  body { margin:0; color:var(--ink); background:#fff; font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif; }
  .r-section { padding:0 4mm 8mm; }
  .r-kicker { font-size:9px; letter-spacing:.16em; text-transform:uppercase; color:var(--muted); }
  .r-cover { text-align:center; padding:40mm 10mm; page-break-after:always; }
  .r-cover h1 { font-size:26px; margin:12px 0 6px; letter-spacing:-.01em; }
  .r-accent { width:40px; height:2px; background:var(--peri); margin:14px auto; }
  .r-kpis { display:flex; gap:10px; }
  .r-kpi { flex:1; text-align:center; padding:12px 6px; border:1px solid var(--line); border-radius:8px; }
  .r-kpi .n { font-size:26px; font-weight:700; color:var(--peri); line-height:1; }
  .r-kpi .l { font-size:9px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin-top:4px; }
  table.r-table { width:100%; border-collapse:collapse; font-size:11px; }
  table.r-table th { text-align:left; font-size:8px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); border-bottom:1.5px solid #d7dae2; padding:5px 7px; }
  table.r-table td { padding:5px 7px; border-bottom:1px solid var(--line); }
  .r-group-head { font-weight:700; font-size:12px; margin:10px 0 6px; }
  .r-record { border:1px solid var(--line); border-radius:8px; padding:10px 12px; margin-bottom:10px; }
  .r-record .nm { font-weight:700; margin-bottom:6px; }
  .r-kv { display:grid; grid-template-columns:auto 1fr; gap:3px 10px; font-size:11px; }
  .r-kv .k { color:var(--muted); text-transform:uppercase; font-size:8px; letter-spacing:.04em; }
  .r-narrative { white-space:pre-wrap; }
  @page { size: A4 landscape; }
`;
