/**
 * Fetch and parse a PostHog public shared insight.
 *
 * PostHog shared insight URLs look like:
 *   https://us.posthog.com/shared/ABC123
 *   https://eu.posthog.com/shared/ABC123
 *
 * PostHog server-side renders the shared page and embeds the insight data
 * as JSON inside a <script id="posthog-exported-data"> tag — there is no
 * separate JSON API endpoint. We fetch the HTML page and extract that tag.
 */

const fetch = require('node-fetch');

const SHARED_PATH_RE = /\/shared\/([A-Za-z0-9_-]+)/;

// Matches: <script id="posthog-exported-data" ...>...</script>
const EXPORTED_DATA_RE =
  /<script[^>]+id=["']posthog-exported-data["'][^>]*>([\s\S]*?)<\/script>/i;

function tokenFromUrl(url) {
  const m = url.match(SHARED_PATH_RE);
  if (!m) throw new Error('Could not extract share token from URL');
  return m[1];
}

/**
 * Returns { title, type, primaryValue, secondaryLabel, series }
 */
async function fetchInsight(shareUrl) {
  // Normalise: strip trailing slashes / query strings
  const cleanUrl = shareUrl.split('?')[0].replace(/\/+$/, '');

  const res = await fetch(cleanUrl, {
    headers: {
      // Do NOT send an Accept header — PostHog returns 406 if it doesn't
      // recognise the value. Omitting it lets the server default to text/html.
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });

  if (!res.ok) {
    throw new Error(`PostHog returned ${res.status} for ${cleanUrl}`);
  }

  const html = await res.text();

  // Extract the embedded JSON blob
  const match = html.match(EXPORTED_DATA_RE);
  if (!match) {
    throw new Error(
      'Could not find posthog-exported-data in page. ' +
      'Make sure the insight is shared publicly.'
    );
  }

  // PostHog double-encodes the value: JSON.parse(JSON.parse(...))
  let data;
  try {
    const raw = match[1].trim();
    // Try double-decode first, fall back to single
    try {
      data = JSON.parse(JSON.parse(raw));
    } catch {
      data = JSON.parse(raw);
    }
  } catch (e) {
    throw new Error('Failed to parse posthog-exported-data JSON: ' + e.message);
  }

  // PostHog wraps the payload in a scene envelope: { type: 'scene', insight, ... }
  // Unwrap it so parsers always receive the insight/dashboard object directly.
  const payload = data.insight || data;

  // Shared insight (single query) vs shared dashboard (multiple tiles)
  if (payload.tiles) {
    return parseDashboard(payload);
  }
  return parseInsight(payload);
}

function parseDashboard(dashboard) {
  const title = dashboard.name || 'PostHog Dashboard';
  const tiles = (dashboard.tiles || []).filter(
    (t) => t.insight && (t.insight.result ?? t.insight.query_status?.results)
  );

  if (tiles.length === 0) {
    return { title, type: 'empty', primaryValue: '—', secondaryLabel: '', series: [] };
  }

  // Use the first tile with real data
  const tile = tiles[0];
  const insight = tile.insight;
  const insightTitle = insight.name || insight.derived_name || title;
  return parseInsightData(insightTitle, insight);
}

function parseInsight(insight) {
  const title = insight.name || insight.derived_name || 'PostHog Insight';
  return parseInsightData(title, insight);
}

function parseInsightData(title, insight) {
  // Newer PostHog insights use `query` (HogQL/DataNode); older ones use `filters`.
  // Derive a canonical type string from whichever is present.
  let type = 'TRENDS';
  if (insight.filters && insight.filters.insight) {
    type = insight.filters.insight;
  } else if (insight.query) {
    const kind = insight.query.source?.kind || insight.query.kind || '';
    if (kind.includes('Funnel') || kind.includes('funnel')) type = 'FUNNEL';
    else if (kind.includes('Retention') || kind.includes('retention')) type = 'RETENTION';
    else if (kind.includes('Path') || kind.includes('path')) type = 'PATHS';
    else if (kind.includes('Lifecycle') || kind.includes('lifecycle')) type = 'LIFECYCLE';
    else if (kind.includes('Stickiness') || kind.includes('stickiness')) type = 'STICKINESS';
    else type = 'TRENDS'; // TrendsQuery, DataTableNode, etc.
  }

  // Extract display variant (pie, bold number, bar, etc.).
  // Legacy insights: insight.filters.display
  // Modern query-based: insight.query.trendsFilter?.display or chartSettings?.display
  const display =
    insight.filters?.display ||
    insight.query?.trendsFilter?.display ||
    insight.query?.source?.trendsFilter?.display ||
    insight.query?.chartSettings?.display ||
    '';

  // `result` lives at the top level for legacy insights; for query-based
  // insights it may be nested under the query response cache.
  const result = insight.result ?? insight.query_status?.results;

  let primaryValue = '—';
  let secondaryLabel = '';
  let series = [];

  try {
    if (type === 'TRENDS' || type === 'LIFECYCLE' || type === 'STICKINESS') {
      // result is an array of series, each with { label, data, count, ... }
      if (Array.isArray(result) && result.length > 0) {

        // BoldNumber: single aggregate value, no time-series
        if (display === 'BoldNumber') {
          const total = result.reduce((sum, s) => sum + (s.count ?? sumData(s.data) ?? 0), 0);
          primaryValue = formatNumber(total);
          secondaryLabel = result[0].label || '';
          // series stays empty — renderBigNumber will be used
          return { title, type, display, primaryValue, secondaryLabel, series };
        }

        // ActionsPie: each series item is one slice (its total count)
        if (display === 'ActionsPie') {
          series = result.map((s) => ({
            label: s.label || s.name || '',
            value:  s.count ?? sumData(s.data) ?? 0,
          }));
          const total = series.reduce((sum, s) => sum + s.value, 0);
          primaryValue = formatNumber(total);
          secondaryLabel = `${series.length} series`;
          return { title, type, display, primaryValue, secondaryLabel, series };
        }

        // Bar charts (vertical): same data shape as line but rendered differently
        // ActionsBar, ActionsStackedBar, ActionsUnstackedBar, ActionsBarValue
        const isBar = display.startsWith('ActionsBar') || display === 'ActionsUnstackedBar' ||
                      display === 'ActionsStackedBar' || display === 'ActionsBarValue';

        const first = result[0];
        // Latest aggregate count
        primaryValue = formatNumber(first.count ?? sumData(first.data));
        secondaryLabel = first.label || '';

        if (isBar) {
          // For bar charts, each data point is one bar; use the same series shape
          // but pass all series (not just the first) so a multi-series bar is possible.
          // For simplicity we use the first series only (like the line chart does).
          series = (first.data || []).map((v, i) => ({
            label: (first.labels || [])[i] || '',
            value: v,
          }));
        } else {
          // Line / area chart (default)
          // Pass all data points so the chart shows the full date range
          series = (first.data || []).map((v, i) => ({
            label: (first.labels || [])[i] || '',
            value: v,
          }));
        }
      }
    } else if (type === 'FUNNEL') {
      // result is an array of steps
      if (Array.isArray(result) && result.length >= 2) {
        const first = result[0];
        const last = result[result.length - 1];
        const conversionRate =
          first.count > 0
            ? ((last.count / first.count) * 100).toFixed(1)
            : '0';
        primaryValue = `${conversionRate}%`;
        secondaryLabel = `${first.name} → ${last.name}`;
        series = result.map((step) => ({ label: step.name, value: step.count }));
      }
    } else if (type === 'RETENTION') {
      // result is an array of cohorts, each with { values: [{ count, label }] }
      if (Array.isArray(result) && result.length > 0) {
        const latest   = result[0];
        const day0Count = latest.values?.[0]?.count || 0;
        // Build a retention curve: % retained per day for the most recent cohort
        series = (latest.values || []).map((v, i) => ({
          label: `Day ${i}`,
          value: day0Count > 0 ? Math.round((v.count / day0Count) * 100) : 0,
        }));
        // Show Day 1 retention as the headline stat (Day 0 is always 100%)
        if (series.length > 1) {
          primaryValue   = series[1].value + '%';
          secondaryLabel = 'Day 1 retention';
        } else {
          primaryValue   = formatNumber(day0Count);
          secondaryLabel = 'Retained (Day 0)';
        }
      }
    } else if (type === 'PATHS') {
      // result is an array of path edges: { source, target, edge_weight/count }
      primaryValue   = Array.isArray(result) ? formatNumber(result.length) : '—';
      secondaryLabel = 'total paths';
      series = (Array.isArray(result) ? result : [])
        .filter((p) => p.source && p.target)
        .sort((a, b) => (b.edge_weight || b.count || 0) - (a.edge_weight || a.count || 0))
        .slice(0, 6)
        .map((p) => ({
          label: `${p.source} \u2192 ${p.target}`,
          value: p.edge_weight || p.count || 0,
        }));
    } else {
      // Generic fallback
      if (Array.isArray(result) && result.length > 0) {
        const first = result[0];
        primaryValue = formatNumber(first.count ?? first.aggregated_value ?? 0);
        secondaryLabel = first.label || '';
      }
    }
  } catch (e) {
    console.error('Error parsing PostHog result:', e);
  }

  return { title, type, display, primaryValue, secondaryLabel, series };
}

function sumData(arr) {
  if (!Array.isArray(arr)) return 0;
  return arr.reduce((sum, v) => sum + (v || 0), 0);
}

function formatNumber(n) {
  const num = Number(n);
  if (isNaN(num)) return String(n);
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
  return String(num);
}

module.exports = { fetchInsight };
