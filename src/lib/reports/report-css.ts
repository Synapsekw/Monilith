// src/lib/reports/report-css.ts
// Self-contained: NOT app Tailwind, so the same markup renders identically in
// the preview iframe and in headless Chromium via setContent. Font stays the
// original system sans; hierarchy comes from size/weight/rules, not a typeface.
export const REPORT_CSS = `
  :root {
    --peri:#5866c4; --ink:#1a1c22; --muted:#7c8290;
    --line:#e7e8ee; --line-strong:#cfd3dc; --zebra:#fafbfc;
  }
  * { box-sizing:border-box; }
  body {
    margin:0; color:var(--ink); background:#fff;
    font:13px/1.6 -apple-system,"Segoe UI",Roboto,sans-serif;
    -webkit-font-smoothing:antialiased;
  }

  /* ---- cover ---- */
  .r-cover { padding:22mm 18mm 16mm; min-height:170mm; display:flex; flex-direction:column; page-break-after:always; }
  .r-cover-top { display:flex; justify-content:space-between; align-items:center; border-top:2px solid var(--ink); padding-top:10px; }
  .r-cover-kicker { font-size:10px; letter-spacing:.2em; text-transform:uppercase; color:var(--muted); font-weight:600; }
  .r-cover-mid { margin:auto 0; }
  .r-cover h1 { font-size:40px; line-height:1.1; letter-spacing:-.015em; font-weight:700; margin:0 0 16px; max-width:16ch; }
  .r-accent { width:52px; height:3px; background:var(--peri); margin:0 0 18px; }
  .r-cover-lede { font-size:15px; line-height:1.6; color:#3a3f4b; max-width:52ch; margin:0; }
  .r-cover-foot { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; border-top:1px solid var(--line); padding-top:14px; margin-top:20px; }
  .r-cf-lbl { font-size:9px; letter-spacing:.14em; text-transform:uppercase; color:var(--muted); margin-bottom:4px; }
  .r-cf-val { font-size:13px; font-weight:500; }

  /* ---- sections ---- */
  .r-section { padding:0 4mm; margin-bottom:9mm; }
  .r-section:first-child { margin-top:2mm; }
  /* section header: a labelled hairline divider */
  .r-kicker {
    font-size:11px; letter-spacing:.16em; text-transform:uppercase;
    color:var(--ink); font-weight:700;
    border-bottom:1.5px solid var(--ink); padding-bottom:7px; margin-bottom:13px;
  }
  .r-narrative { white-space:pre-wrap; font-size:14px; line-height:1.7; color:#2b2f3a; margin:0; max-width:70ch; }

  /* ---- KPIs: editorial figures split by hairlines, not boxes ---- */
  .r-kpis { display:grid; grid-template-columns:repeat(3,1fr); }
  .r-kpi { padding:2px 22px; border-left:1px solid var(--line); }
  .r-kpi:first-child { border-left:0; padding-left:0; }
  .r-kpi .n { font-size:34px; line-height:1; font-weight:700; letter-spacing:-.02em; color:var(--ink); }
  .r-kpi:nth-child(2) .n { color:var(--peri); }
  .r-kpi .l { font-size:10px; letter-spacing:.14em; text-transform:uppercase; color:var(--muted); margin-top:8px; }

  /* ---- table ---- */
  .r-grp { margin-bottom:16px; }
  .r-grp:last-child { margin-bottom:0; }
  .r-grp-head { display:flex; align-items:center; gap:9px; margin:0 0 7px; }
  .r-grp-tick { width:4px; height:14px; border-radius:2px; flex:0 0 auto; }
  .r-grp-name { font-weight:700; font-size:13px; }
  .r-grp-meta { margin-left:auto; font-size:9.5px; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); }
  table.r-table { width:100%; border-collapse:collapse; }
  table.r-table th {
    text-align:left; font-size:9px; letter-spacing:.1em; text-transform:uppercase;
    color:var(--muted); font-weight:600; padding:6px 9px; border-bottom:1.5px solid var(--line-strong);
  }
  table.r-table td { padding:7px 9px; border-bottom:1px solid var(--line); font-size:12px; }
  table.r-table tbody tr:nth-child(even) { background:var(--zebra); }
  table.r-table th.r-num, table.r-table td.r-num { text-align:right; font-variant-numeric:tabular-nums; }
  .r-cell-name { font-weight:600; }
  .r-subrow .r-cell-name { font-weight:500; color:#3a3f4b; }
  .r-sub-caret { color:var(--muted); }
  .r-pill { display:inline-block; font-size:10.5px; font-weight:600; padding:2px 9px; border-radius:20px; line-height:1.5; white-space:nowrap; }

  /* ---- group summaries: progress bars ---- */
  .r-gs-row { display:grid; grid-template-columns:170px 1fr 48px; align-items:center; gap:14px; padding:8px 0; border-bottom:1px solid var(--line); }
  .r-gs-row:last-child { border-bottom:0; }
  .r-gs-name { font-weight:600; font-size:13px; }
  .r-gs-track { height:6px; background:#eef0f4; border-radius:3px; overflow:hidden; }
  .r-gs-fill { height:100%; background:var(--peri); border-radius:3px; }
  .r-gs-pct { text-align:right; font-size:12px; font-weight:700; color:var(--peri); }

  /* ---- spotlight record cards ---- */
  .r-record { border:1px solid var(--line); border-left:3px solid var(--peri); border-radius:8px; padding:11px 13px; margin-bottom:9px; }
  .r-record .nm { font-weight:700; font-size:14px; margin-bottom:7px; }
  .r-kv { display:grid; grid-template-columns:auto 1fr; gap:4px 12px; font-size:12px; }
  .r-kv .k { color:var(--muted); text-transform:uppercase; font-size:8.5px; letter-spacing:.06em; align-self:center; }

  /* ---- charts: static SVG / CSS only, no client JS ---- */
  .r-chart { display:grid; grid-template-columns:auto 1fr; align-items:center; gap:20px; page-break-inside:avoid; }
  .r-chart.r-chart-bars { display:block; }
  .r-chart-ring { flex:0 0 auto; }
  .r-chart-total { font-size:22px; font-weight:700; letter-spacing:-.02em; fill:var(--ink); }
  .r-chart-total-l { font-size:8.5px; letter-spacing:.14em; text-transform:uppercase; fill:var(--muted); }
  .r-chart-legend { display:flex; flex-direction:column; gap:5px; }
  .r-lg-row { display:grid; grid-template-columns:9px 1fr auto auto; align-items:center; gap:9px; font-size:11.5px; }
  .r-lg-sw { width:9px; height:9px; border-radius:2px; }
  .r-lg-n { font-variant-numeric:tabular-nums; font-weight:600; }
  .r-lg-p { font-variant-numeric:tabular-nums; color:var(--muted); min-width:38px; text-align:right; }
  .r-bar-row { display:grid; grid-template-columns:150px 1fr auto auto; align-items:center; gap:12px; padding:3px 0; }
  .r-bar-name { font-size:12px; font-weight:600; overflow-wrap:anywhere; }
  .r-bar-track { height:14px; background:#f2f3f7; border-radius:3px; overflow:hidden; }
  .r-bar-fill { height:100%; border-radius:0 4px 4px 0; }
  .r-bar-n { font-size:12px; font-variant-numeric:tabular-nums; font-weight:600; }
  .r-bar-p { font-size:11px; font-variant-numeric:tabular-nums; color:var(--muted); min-width:38px; text-align:right; }
  .r-chart-empty { font-size:12px; color:var(--muted); }
  .r-chart-stat { font-size:15px; }
  .r-chart-stat b { font-size:22px; font-weight:700; letter-spacing:-.02em; }

  @page { size: A4 landscape; margin:14mm 12mm; }
`;
