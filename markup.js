/**
 * Render TRMNL-compatible HTML markup for a PostHog insight.
 * 800×480 black-and-white e-ink display.
 *
 * All positioning is done with explicit inline styles — we do NOT rely on
 * TRMNL's external CSS for layout (it caused the title_bar to overlap content).
 *
 * Layout:
 *  ┌─────────────────────────────────────────────────────┐
 *  │  TRENDS • Jan 2024 – Feb 2026           (meta line) │
 *  │  Pageview count                         (title)     │
 *  ├─────────────────────────────────────────────────────┤
 *  │                                                     │
 *  │  chart / funnel / list (type-dependent)             │
 *  │                                                     │
 *  ├─────────────────────────────────────────────────────┤
 *  │  [logo]  PostHog Insight  · Pageview count          │  40px
 *  └─────────────────────────────────────────────────────┘
 */

const FONT       = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const TITLE_H    = 40;   // px — height of the bottom title bar
const PAD_H      = 18;   // px — horizontal padding for the content area
const PAD_V      = 16;   // px — top padding for the content area

// ---------------------------------------------------------------------------
// Main render
// ---------------------------------------------------------------------------

function renderMarkup({ title, type, display = '', primaryValue, secondaryLabel, series }) {
  const typeLabel = formatType(type, display);
  const safeTitle = esc(title);

  // Derived flags
  const isPie     = display === 'ActionsPie';
  const isBigNum  = display === 'BoldNumber';
  const isBar     = display.startsWith('ActionsBar') || display === 'ActionsUnstackedBar' ||
                    display === 'ActionsStackedBar' || display === 'ActionsBarValue';

  // Choose chart renderer by insight type / display variant
  const chart = (() => {
    if (isBigNum)                                         return renderBigNumber(primaryValue, secondaryLabel);
    if (isPie    && series && series.length >= 2)         return renderPieChart(series);
    if (isBar    && series && series.length >= 2)         return renderBarChart(series);
    if (type === 'FUNNEL' && series && series.length >= 2) return renderFunnelChart(series);
    if (type === 'PATHS'  && series && series.length >= 1) return renderPathsList(series, primaryValue);
    if (series && series.length >= 2)                     return renderLineChart(series);
    return renderEmptyChart();
  })();

  // Meta line: "TRENDS • Jan 2024 – Feb 2026"
  // For big number and pie, the series labels are not dates — skip date range.
  const dateRange = (isBigNum || isPie) ? '' : seriesDateRange(series);
  const metaLine  = `${typeLabel.toUpperCase()}${dateRange ? ' \u2022 ' + dateRange : ''}`;

  return `
<div style="position:absolute;top:0;left:0;right:0;bottom:${TITLE_H}px;
            display:flex;flex-direction:column;
            padding:${PAD_V}px ${PAD_H}px 0;
            font-family:${FONT};">

  <!-- Meta line -->
  <div style="flex-shrink:0;font-size:11px;font-weight:600;letter-spacing:0.1em;
              opacity:0.4;text-transform:uppercase;margin-bottom:5px;"
    >${esc(metaLine)}</div>

  <!-- Insight title -->
  <div style="flex-shrink:0;font-size:24px;font-weight:700;letter-spacing:-0.4px;
              margin-bottom:10px;line-height:1.15;"
    >${safeTitle}</div>

  <!-- Chart area — grows to fill remaining space -->
  <div style="flex:1;min-height:0;display:flex;flex-direction:column;">
    ${chart}
  </div>

</div>

<!-- Bottom title bar — fully self-contained, no external CSS needed -->
<div style="position:absolute;bottom:0;left:0;right:0;height:${TITLE_H}px;
            border-top:1px solid #e0e0e0;
            display:flex;align-items:center;gap:8px;
            padding:0 ${PAD_H}px;
            font-family:${FONT};">
  <img src="https://app.posthog.com/static/posthog-logo.svg"
       style="height:18px;width:auto;flex-shrink:0;" alt=""
       onerror="this.style.display='none'">
  <span style="font-size:13px;font-weight:600;white-space:nowrap;">PostHog Insight</span>
  <span style="font-size:13px;opacity:0.4;white-space:nowrap;overflow:hidden;
               text-overflow:ellipsis;">\u00b7 ${safeTitle}</span>
</div>
`.trim();
}

// ---------------------------------------------------------------------------
// Line / area chart  (TRENDS, LIFECYCLE, STICKINESS, RETENTION)
// ---------------------------------------------------------------------------

function renderLineChart(series) {
  const values = series.map((s) => s.value);
  const labels = series.map((s) => s.label);

  const { ticks: yTicks, axisMax } = niceYAxis(Math.max(...values));

  const VW   = 760;
  const VH   = 240;
  const padT = 10;
  const padB = 26;
  const padL = 52;
  const padR = 8;
  const innerW = VW - padL - padR;
  const innerH = VH - padT - padB;

  const xOf = (i) => padL + (i / Math.max(values.length - 1, 1)) * innerW;
  const yOf = (v)  => padT + innerH - (v / (axisMax || 1)) * innerH;

  const baseY  = yOf(0).toFixed(1);
  const areaD  = [
    `M ${xOf(0).toFixed(1)},${baseY}`,
    ...values.map((v, i) => `L ${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`),
    `L ${xOf(values.length - 1).toFixed(1)},${baseY}`,
    'Z',
  ].join(' ');

  const linePts = values
    .map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`)
    .join(' ');

  const yAxisSvg = yTicks.map((tick) => {
    const y = yOf(tick).toFixed(1);
    return `<line x1="${padL}" y1="${y}" x2="${VW - padR}" y2="${y}"
        stroke="black" stroke-width="0.5" opacity="0.15"/>
  <text x="${padL - 6}" y="${y}" text-anchor="end" dominant-baseline="middle"
        style="font-size:10px;fill:black;opacity:0.45;font-family:monospace;"
        >${esc(formatAxisNum(tick))}</text>`;
  }).join('\n  ');

  const xIdxs   = evenlySpaced(values.length, Math.min(values.length, 6));
  const xAxisSvg = xIdxs.map((i) => {
    const x      = xOf(i).toFixed(1);
    const anchor = i === 0 ? 'start' : i === values.length - 1 ? 'end' : 'middle';
    return `<text x="${x}" y="${VH - 4}" text-anchor="${anchor}"
      style="font-size:10px;fill:black;opacity:0.4;font-family:monospace;"
      >${esc(labels[i] || '')}</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${VW} ${VH}" width="100%" height="100%"
     xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet"
     style="display:block;overflow:visible;">

  ${yAxisSvg}

  <path d="${areaD}" fill="black" fill-opacity="0.06"/>

  <polyline points="${linePts}"
    fill="none" stroke="black" stroke-width="2.5"
    stroke-linejoin="round" stroke-linecap="round"/>

  <circle cx="${xOf(values.length - 1).toFixed(1)}" cy="${yOf(values[values.length - 1]).toFixed(1)}"
    r="4" fill="black"/>

  <line x1="${padL}" y1="${baseY}" x2="${VW - padR}" y2="${baseY}"
        stroke="black" stroke-width="1" opacity="0.2"/>

  ${xAxisSvg}

</svg>`;
}

// ---------------------------------------------------------------------------
// Funnel chart — horizontal bars, one per step
// ---------------------------------------------------------------------------

function renderFunnelChart(series) {
  const maxVal  = series[0].value || 1;   // first step = 100%
  const VW      = 760;
  const rowH    = 36;
  const labelW  = 200;                    // left column for step labels
  const barMaxW = VW - labelW - 80;       // right column for bars (leave 80px for pct)
  const VH      = Math.min(series.length * (rowH + 8) + 10, 240);

  const rows = series.map((step, i) => {
    const pct     = maxVal > 0 ? ((step.value / maxVal) * 100).toFixed(1) : '0';
    const barW    = (step.value / maxVal) * barMaxW;
    const y       = i * (rowH + 8);
    const safeLabel = esc(truncate(step.label || `Step ${i + 1}`, 28));
    const countStr  = esc(formatAxisNum(step.value));

    return `
  <!-- Step ${i + 1} -->
  <text x="0" y="${y + rowH * 0.65}" dominant-baseline="auto"
        style="font-size:12px;fill:black;font-family:${FONT};">${safeLabel}</text>
  <rect x="${labelW}" y="${y + 4}" width="${barW.toFixed(1)}" height="${rowH - 8}"
        fill="black" opacity="${i === 0 ? '0.85' : '0.55'}" rx="2"/>
  <text x="${labelW + barW + 8}" y="${y + rowH * 0.65}" dominant-baseline="auto"
        style="font-size:11px;fill:black;opacity:0.7;font-family:monospace;"
        >${countStr} (${pct}%)</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${VW} ${VH}" width="100%" height="100%"
     xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMinYMin meet"
     style="display:block;overflow:visible;">
  ${rows}
</svg>`;
}

// ---------------------------------------------------------------------------
// Big number (BoldNumber) — single headline stat
// ---------------------------------------------------------------------------

function renderBigNumber(primaryValue, secondaryLabel) {
  return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;
                      justify-content:center;text-align:center;padding:0 24px;">
  <div style="font-size:72px;font-weight:700;letter-spacing:-2px;line-height:1;
              font-variant-numeric:tabular-nums;">${esc(String(primaryValue))}</div>
  ${secondaryLabel ? `<div style="margin-top:14px;font-size:14px;opacity:0.45;
                                  letter-spacing:0.03em;">${esc(secondaryLabel)}</div>` : ''}
</div>`;
}

// ---------------------------------------------------------------------------
// Pie chart (ActionsPie) — SVG donut with legend
// ---------------------------------------------------------------------------

function renderPieChart(series) {
  const total = series.reduce((s, d) => s + d.value, 0) || 1;

  // Layout: pie on the left, legend on the right
  const CX = 140, CY = 120, R = 100, RI = 52; // outer/inner radius (donut)
  const VW = 760, VH = 240;

  // Build arc paths
  let angle = -Math.PI / 2; // start at top
  const OPACITIES = [0.9, 0.65, 0.45, 0.30, 0.20, 0.12]; // B&W-friendly fills
  const slices = series.map((item, i) => {
    const sweep    = (item.value / total) * Math.PI * 2;
    const a1       = angle;
    const a2       = angle + sweep;
    angle          = a2;
    const x1 = CX + R  * Math.cos(a1), y1 = CY + R  * Math.sin(a1);
    const x2 = CX + R  * Math.cos(a2), y2 = CY + R  * Math.sin(a2);
    const ix1= CX + RI * Math.cos(a1), iy1= CY + RI * Math.sin(a1);
    const ix2= CX + RI * Math.cos(a2), iy2= CY + RI * Math.sin(a2);
    const lg = sweep > Math.PI ? 1 : 0;
    const pct = ((item.value / total) * 100).toFixed(1);
    const d = [
      `M ${x1.toFixed(2)} ${y1.toFixed(2)}`,
      `A ${R} ${R} 0 ${lg} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
      `L ${ix2.toFixed(2)} ${iy2.toFixed(2)}`,
      `A ${RI} ${RI} 0 ${lg} 0 ${ix1.toFixed(2)} ${iy1.toFixed(2)}`,
      'Z',
    ].join(' ');
    return { d, opacity: OPACITIES[i % OPACITIES.length], pct, item };
  });

  const arcsSvg = slices.map(({ d, opacity }) =>
    `<path d="${d}" fill="black" opacity="${opacity}" stroke="white" stroke-width="1.5"/>`
  ).join('\n  ');

  // Legend: right side, up to 6 items
  const legendX = CX * 2 + 20;
  const legendItems = series.slice(0, 6).map((item, i) => {
    const y = 20 + i * 34;
    return `<rect x="${legendX}" y="${y}" width="12" height="12" rx="2"
          fill="black" opacity="${OPACITIES[i % OPACITIES.length]}"/>
  <text x="${legendX + 18}" y="${y + 9}" dominant-baseline="middle"
        style="font-size:11px;fill:black;font-family:${FONT};"
        >${esc(truncate(item.label, 32))}</text>
  <text x="${VW - 4}" y="${y + 9}" text-anchor="end" dominant-baseline="middle"
        style="font-size:11px;fill:black;opacity:0.55;font-family:monospace;"
        >${slices[i].pct}%</text>`;
  }).join('\n  ');

  return `<svg viewBox="0 0 ${VW} ${VH}" width="100%" height="100%"
     xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet"
     style="display:block;overflow:visible;">
  ${arcsSvg}
  ${legendItems}
</svg>`;
}

// ---------------------------------------------------------------------------
// Vertical bar chart (ActionsBar and variants)
// ---------------------------------------------------------------------------

function renderBarChart(series) {
  const values = series.map((s) => s.value);
  const labels = series.map((s) => s.label);

  const { ticks: yTicks, axisMax } = niceYAxis(Math.max(...values));

  const VW    = 760;
  const VH    = 240;
  const padT  = 10;
  const padB  = 26;
  const padL  = 52;
  const padR  = 8;
  const innerW = VW - padL - padR;
  const innerH = VH - padT - padB;

  // Bar width: leave 20% gap between bars, min 2px
  const n    = values.length;
  const barW = Math.max(2, Math.floor((innerW / n) * 0.72));
  const gap  = (innerW - barW * n) / Math.max(n - 1, 1);

  const xOf  = (i) => padL + i * (barW + gap);
  const yOf  = (v) => padT + innerH - (v / (axisMax || 1)) * innerH;
  const baseY = padT + innerH;

  const barsSvg = values.map((v, i) => {
    const x = xOf(i);
    const y = yOf(v);
    const h = Math.max(1, baseY - y);
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${h.toFixed(1)}"
        fill="black" opacity="0.75" rx="1"/>`;
  }).join('\n  ');

  const yAxisSvg = yTicks.map((tick) => {
    const y = yOf(tick).toFixed(1);
    return `<line x1="${padL}" y1="${y}" x2="${VW - padR}" y2="${y}"
        stroke="black" stroke-width="0.5" opacity="0.15"/>
  <text x="${padL - 6}" y="${y}" text-anchor="end" dominant-baseline="middle"
        style="font-size:10px;fill:black;opacity:0.45;font-family:monospace;"
        >${esc(formatAxisNum(tick))}</text>`;
  }).join('\n  ');

  // X-axis labels: show evenly-spaced subset to avoid overlap
  const xIdxs   = evenlySpaced(n, Math.min(n, 6));
  const xAxisSvg = xIdxs.map((i) => {
    const x      = (xOf(i) + barW / 2).toFixed(1);
    const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
    return `<text x="${x}" y="${VH - 4}" text-anchor="${anchor}"
      style="font-size:10px;fill:black;opacity:0.4;font-family:monospace;"
      >${esc(labels[i] || '')}</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${VW} ${VH}" width="100%" height="100%"
     xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet"
     style="display:block;overflow:visible;">

  ${yAxisSvg}

  ${barsSvg}

  <line x1="${padL}" y1="${baseY}" x2="${VW - padR}" y2="${baseY}"
        stroke="black" stroke-width="1" opacity="0.2"/>

  ${xAxisSvg}

</svg>`;
}

// ---------------------------------------------------------------------------
// Paths list — ranked table of top paths
// ---------------------------------------------------------------------------

function renderPathsList(series, totalCount) {
  const rows = series.map((p, i) => {
    const rank  = i + 1;
    const label = esc(truncate(p.label, 60));
    const val   = esc(formatAxisNum(p.value));
    const bg    = i % 2 === 0 ? 'background:rgba(0,0,0,0.03);' : '';
    return `<div style="display:flex;align-items:center;gap:10px;padding:7px 8px;
                        border-radius:4px;${bg}">
      <span style="font-size:11px;opacity:0.35;font-variant-numeric:tabular-nums;
                   min-width:16px;text-align:right;">${rank}</span>
      <span style="flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;
                   white-space:nowrap;">${label}</span>
      <span style="font-size:11px;font-family:monospace;opacity:0.6;
                   white-space:nowrap;">${val}</span>
    </div>`;
  }).join('');

  return `<div style="flex:1;display:flex;flex-direction:column;gap:0;overflow:hidden;">
  <div style="font-size:11px;opacity:0.4;text-transform:uppercase;letter-spacing:0.07em;
              margin-bottom:6px;padding:0 8px;">Top paths · ${esc(String(totalCount))} total</div>
  ${rows}
</div>`;
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function renderEmptyChart() {
  return `<div style="flex:1;display:flex;align-items:center;justify-content:center;opacity:0.25;">
  <span style="font-size:12px;letter-spacing:0.07em;text-transform:uppercase;
               font-family:${FONT};">No chart data</span>
</div>`;
}

// ---------------------------------------------------------------------------
// Error / no-config states
// ---------------------------------------------------------------------------

function renderBottomBar(instanceText) {
  return `<div style="position:absolute;bottom:0;left:0;right:0;height:${TITLE_H}px;
            border-top:1px solid #e0e0e0;
            display:flex;align-items:center;gap:8px;
            padding:0 ${PAD_H}px;font-family:${FONT};">
  <span style="font-size:13px;font-weight:600;">PostHog Insight</span>
  <span style="font-size:13px;opacity:0.4;">\u00b7 ${esc(instanceText)}</span>
</div>`;
}

function renderError(message) {
  return `
<div style="position:absolute;top:0;left:0;right:0;bottom:${TITLE_H}px;
            display:flex;align-items:center;justify-content:center;font-family:${FONT};">
  <div style="text-align:center;padding:0 40px;">
    <div style="font-size:28px;margin-bottom:14px;">&#9888;</div>
    <div style="font-size:14px;opacity:0.55;line-height:1.55;">${esc(message)}</div>
  </div>
</div>
${renderBottomBar('Error')}`.trim();
}

function renderNoConfig() {
  return `
<div style="position:absolute;top:0;left:0;right:0;bottom:${TITLE_H}px;
            display:flex;align-items:center;justify-content:center;font-family:${FONT};">
  <div style="text-align:center;padding:0 40px;">
    <div style="font-size:28px;margin-bottom:14px;">&#128202;</div>
    <div style="font-size:15px;font-weight:600;margin-bottom:8px;">No PostHog URL configured</div>
    <div style="font-size:13px;opacity:0.45;line-height:1.5;">
      Visit plugin settings to add your shared insight URL.
    </div>
  </div>
</div>
${renderBottomBar('Setup required')}`.trim();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function niceYAxis(rawMax) {
  if (rawMax <= 0) return { ticks: [0], axisMax: 1 };
  const roughStep = rawMax / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const step = magnitude * ([1, 2, 2.5, 5, 10].find((s) => s * magnitude >= roughStep) || 1);
  const axisMax = Math.ceil(rawMax / step) * step;
  const ticks = [];
  for (let t = 0; t <= axisMax + step * 0.01; t += step) ticks.push(Math.round(t));
  return { ticks, axisMax };
}

function formatAxisNum(n) {
  const num = Number(n);
  if (isNaN(num)) return String(n);
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(num % 1_000_000 === 0 ? 0 : 1) + 'M';
  if (num >= 1_000)     return (num / 1_000).toFixed(num % 1_000 === 0 ? 0 : 1) + 'K';
  return String(num);
}

function evenlySpaced(total, count) {
  if (total <= count) return Array.from({ length: total }, (_, i) => i);
  const idxs = [0];
  for (let i = 1; i < count - 1; i++) idxs.push(Math.round((i / (count - 1)) * (total - 1)));
  idxs.push(total - 1);
  return [...new Set(idxs)];
}

function seriesDateRange(series) {
  if (!series || series.length < 2) return '';
  const first = series[0].label;
  const last  = series[series.length - 1].label;
  return first && last ? `${first} \u2013 ${last}` : '';
}

function formatType(type, display = '') {
  // Display-variant overrides take precedence for TRENDS sub-types
  if (display === 'BoldNumber')     return 'Big number';
  if (display === 'ActionsPie')     return 'Pie chart';
  if (display === 'ActionsBar' || display === 'ActionsUnstackedBar' ||
      display === 'ActionsStackedBar' || display === 'ActionsBarValue') return 'Bar chart';
  if (display === 'ActionsAreaGraph') return 'Area chart';
  return { TRENDS: 'Trends', FUNNEL: 'Funnel', RETENTION: 'Retention',
           PATHS: 'Paths', LIFECYCLE: 'Lifecycle', STICKINESS: 'Stickiness' }[type] || type || 'Insight';
}

function truncate(str, len) {
  return String(str).length > len ? String(str).slice(0, len - 1) + '\u2026' : String(str);
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

module.exports = { renderMarkup, renderError, renderNoConfig };
