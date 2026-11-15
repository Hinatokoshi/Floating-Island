'use strict';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const api = window.island;

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

const METRIC_LABELS = { cpu: 'CPU', gpu: 'GPU', ram: 'RAM', net: 'Network' };
const ACCENT_PRESETS = ['#ff6b35', '#f65d7d', '#c792ea', '#5ec8ff', '#7bd88f', '#f5c451', '#b8b8ff'];
const PROC_COLORS = ['#ff8a4c', '#5ec8ff', '#7bd88f', '#f5c451', '#c792ea', '#ff7b9c', '#8ab4f8', '#63e6be'];
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * 31;

const root = $('#root');
const islandEl = $('#island');
const pill = $('#pill');
const pillMetrics = $('#pillMetrics');
const tabsEl = $('#tabs');
const panes = $$('.pane');
const settingsBody = $('#settingsBody');
const launchGrid = $('#launchGrid');
const procList = $('#procList');
const procCount = $('#procCount');
const coresEl = $('#cores');
const coreCount = $('#coreCount');
const netChart = $('#netChart');
const netIface = $('#netIface');
const netTotals = $('#netTotals');
const netSessionDown = $('#netSessionDown');
const netSessionUp = $('#netSessionUp');
const netDown = $('#netDown');
const netDownUnit = $('#netDownUnit');
const netUp = $('#netUp');
const netUpUnit = $('#netUpUnit');
const netWindow = $('#netWindow');
const gpuInfo = $('#gpuInfo');
const footerInfo = $('#footerInfo');
const toastEl = $('#toast');
const statusDot = $('#statusDot');
const notesText = $('#notesText');
const notesCount = $('#notesCount');
const notesStatus = $('#notesStatus');
const btnNotesCopy = $('#btnNotesCopy');
const btnNotesClear = $('#btnNotesClear');

const TAB_DEFS = [
  {
    id: 'performance',
    label: 'Perf',
    icon: '<path d="M3 12h4l2.5-6 4 12L16 12h5"/>'
  },
  {
    id: 'processes',
    label: 'Tasks',
    icon: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>'
  },
  {
    id: 'quicklaunch',
    label: 'Launch',
    icon: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>'
  },
  {
    id: 'notes',
    label: 'Notes',
    icon: '<path d="M7 3.5h7.5L19 8v12.5H7z"/><path d="M14 3.5V8h4.5"/><path d="M10 12h6M10 15.5h6"/>'
  }
];

const GEAR_ICON =
  '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z"/>';

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

let settings = null;
let appInfo = { version: '1.0.0', settingsPath: '' };
let latestStats = null;
let expanded = false;
let pinned = false;
let peekExpanded = false;
let activeTab = 'performance';
let icons = {};
let history = { cpu: [], gpu: [], ram: [], down: [], up: [] };
let session = { down: 0, up: 0 };
let lastTickAt = 0;
let procTimer = null;
let procFetching = false;
let procQueued = false;
let saveTimer = null;
let dirty = false;
let saving = false;
let toastTimer = null;
let hoverTimer = null;
let peekCollapseTimer = null;
let drag = null;
let suppressToggleUntil = 0;
let resetArmed = false;
let resetTimer = null;
let lastLaunchSignature = '';
let pillCache = {};
let coreCache = [];
let gaugeCache = {};
let lastDotColor = '';
let lastFooterText = '';
let chartTheme = null;
let lastPaintAt = 0;
let notesSaveTimer = null;
let notesStatusTimer = null;
let notesClearTimer = null;
let notesDirty = false;
let notesLoaded = false;

// In battery-saver mode a collapsed capsule only repaints this often. The
// stats keep arriving (so history and session totals stay exact), but the DOM
// work — which is what actually wakes the GPU and costs battery — is skipped.
const BATTERY_PAINT_MS = 1000;

/* ------------------------------------------------------------------ */
/* DOM helpers                                                         */
/* ------------------------------------------------------------------ */

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key === 'style') Object.assign(node.style, value);
      else if (key === 'checked') node.checked = Boolean(value);
      else if (key === 'disabled') node.disabled = Boolean(value);
      else if (key === 'selected') node.selected = Boolean(value);
      else if (key === 'value') node.value = value;
      else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else {
        node.setAttribute(key, value);
      }
    }
  }
  for (const child of children.flat(6)) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function button(label, options = {}) {
  const node = el('button', {
    class: options.className || 'btn',
    type: 'button',
    title: options.title || null
  });
  node.textContent = label;
  if (options.onClick) node.addEventListener('click', options.onClick);
  return node;
}

function toast(text, kind) {
  if (!text) return;
  clearTimeout(toastTimer);
  toastEl.textContent = text;
  toastEl.classList.toggle('error', kind === 'error');
  toastEl.classList.add('show');
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2800);
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

function compactNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return '--';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}G`;
  if (n >= 100) return n.toFixed(0);
  if (n >= 10) return n.toFixed(1);
  return n.toFixed(n >= 1 ? 1 : 2);
}

function rateValue(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  return settings.metrics.netUnit === 'Mbps' ? (value * 8) / 1e6 : value / 1e6;
}

function shortRate(bytes) {
  return compactNumber(rateValue(bytes));
}

// Splits a transfer rate into a display number and its unit, scaling up to
// Gbps/GB/s when the rate is large enough.
function rateParts(bytes) {
  const bits = settings.metrics.netUnit === 'Mbps';
  const scaled = rateValue(bytes);
  if (scaled >= 1000) {
    const g = scaled / 1000;
    return { text: g >= 100 ? g.toFixed(0) : g.toFixed(g >= 10 ? 1 : 2), unit: bits ? 'Gbps' : 'GB/s' };
  }
  const unit = bits ? 'Mbps' : 'MB/s';
  if (scaled >= 100) return { text: scaled.toFixed(0), unit };
  if (scaled >= 10) return { text: scaled.toFixed(1), unit };
  return { text: scaled.toFixed(scaled >= 1 ? 1 : 2), unit };
}

function fullRate(bytes) {
  const parts = rateParts(bytes);
  return `${parts.text} ${parts.unit}`;
}

function formatRateValue(value) {
  const bits = settings.metrics.netUnit === 'Mbps';
  if (value >= 1000) {
    const g = value / 1000;
    return `${g >= 100 ? g.toFixed(0) : g.toFixed(g >= 10 ? 1 : 2)} ${bits ? 'Gbps' : 'GB/s'}`;
  }
  const unit = bits ? 'Mbps' : 'MB/s';
  if (value >= 100) return `${value.toFixed(0)} ${unit}`;
  if (value >= 10) return `${value.toFixed(1)} ${unit}`;
  return `${value.toFixed(value >= 1 ? 1 : 2)} ${unit}`;
}

function fmtLinkSpeed(bits) {
  const n = Number(bits) || 0;
  if (n >= 1e9) return `${(n / 1e9).toFixed(n % 1e9 === 0 ? 0 : 1)} Gbps`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)} Mbps`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} Kbps`;
  return n > 0 ? `${n} bps` : '';
}

function fmtBytes(bytes, digits = 1) {
  const n = Math.max(0, Number(bytes) || 0);
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(digits)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(digits)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${Math.round(n)} B`;
}

function formatUptime(seconds) {
  const total = Number(seconds) || 0;
  if (!total) return '--';
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function colorForName(name) {
  let hash = 0;
  for (const ch of String(name)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PROC_COLORS[hash % PROC_COLORS.length];
}

function hexToRgba(hex, alpha) {
  const value = String(hex).trim();
  let r = 255;
  let g = 107;
  let b = 53;
  if (/^#[0-9a-f]{6}$/i.test(value)) {
    r = parseInt(value.slice(1, 3), 16);
    g = parseInt(value.slice(3, 5), 16);
    b = parseInt(value.slice(5, 7), 16);
  } else if (/^#[0-9a-f]{3}$/i.test(value)) {
    r = parseInt(value[1] + value[1], 16);
    g = parseInt(value[2] + value[2], 16);
    b = parseInt(value[3] + value[3], 16);
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/* ------------------------------------------------------------------ */
/* Appearance                                                          */
/* ------------------------------------------------------------------ */

function resolveTheme() {
  if (!settings) return;
  const choice = settings.appearance.theme;
  const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
  const dark = choice === 'dark' || (choice === 'auto' && !prefersLight);
  root.dataset.theme = dark ? 'dark' : 'light';
}

function applyAppearance() {
  if (!settings) return;
  const appearance = settings.appearance;
  root.style.setProperty('--accent', appearance.accent);
  root.style.setProperty('--glass-opacity', String(appearance.opacity));
  root.style.setProperty('--blur', `${appearance.blur}px`);
  root.style.setProperty('--radius', `${appearance.radius}px`);
  root.classList.toggle('glow', appearance.glow);
  root.classList.toggle('no-border', !appearance.border);
  root.classList.toggle('battery-saver', Boolean(settings.behavior.batterySaver));
  // At fast refresh rates the CSS value transitions repaint non-stop; turning
  // them off keeps updates cheap while still looking smooth.
  root.classList.toggle('fast-updates', Number(settings.metrics.interval) <= 250);
  chartTheme = null;
  resolveTheme();
  requestAnimationFrame(drawChart);
}

/* ------------------------------------------------------------------ */
/* Expanded / collapsed state                                          */
/* ------------------------------------------------------------------ */

function applyExpandedDom() {
  root.classList.toggle('expanded', expanded);
  $('#btnChevron').title = expanded ? 'Collapse' : 'Expand';
  if (expanded) {
    showPane();
    lastPaintAt = 0;
    if (latestStats) {
      updatePill(latestStats);
      updatePerformance(latestStats);
    }
    requestAnimationFrame(drawChart);
  } else {
    stopProcessLoop();
    // Collapsing is a natural "done editing" point: persist anything pending.
    flushNotes();
    if (dirty) flush();
  }
}

function setExpandedState(value, { peek = false } = {}) {
  const next = Boolean(value);
  if (peek) {
    peekExpanded = next;
    pinned = false;
  } else {
    pinned = next;
    peekExpanded = false;
  }
  expanded = next;
  applyExpandedDom();
  // Always tell the main process the desired state so the renderer and the
  // window can never drift out of sync (which previously left the island
  // stuck and unable to expand).
  api.setExpanded(next);
}

function syncExpandedFromMain(value) {
  const next = Boolean(value);
  if (expanded === next) {
    applyExpandedDom();
    return;
  }
  expanded = next;
  if (!peekExpanded) {
    pinned = next;
  } else if (!next) {
    pinned = false;
    peekExpanded = false;
  }
  applyExpandedDom();
}

function pillActivate() {
  if (Date.now() < suppressToggleUntil) return;
  setExpandedState(!expanded);
}

function openSettingsTab(sectionId) {
  activeTab = 'settings';
  if (!expanded) {
    pinned = true;
    peekExpanded = false;
    expanded = true;
    applyExpandedDom();
    api.setExpanded(true);
  }
  renderTabs();
  showPane();
  if (sectionId) {
    setTimeout(() => {
      const section = $(`#settings-${sectionId}`);
      if (section) section.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }, 90);
  }
}

function openTab(id) {
  activeTab = id;
  if (!expanded) {
    pinned = true;
    peekExpanded = false;
    expanded = true;
    applyExpandedDom();
    api.setExpanded(true);
  }
  renderTabs();
  showPane();
}

/* ------------------------------------------------------------------ */
/* Capsule rendering                                                   */
/* ------------------------------------------------------------------ */

function buildMetric(id) {
  if (id === 'net') {
    const wrap = el('div', { class: 'metric metric-net', 'data-metric': 'net' });
    wrap.append(
      el('div', { class: 'metric-label' }, el('span', { class: 'tick' }), el('span', { text: 'NET' })),
      el(
        'div',
        { class: 'metric-value' },
        el('span', { class: 'down' }, el('span', { text: '\u2193 ' }), el('b', { 'data-val': 'net-down', text: '--' })),
        el('span', { class: 'up' }, el('span', { text: '\u2191 ' }), el('b', { 'data-val': 'net-up', text: '--' }))
      )
    );
    wrap.title = 'Network transfer';
    return wrap;
  }

  const wrap = el('div', { class: 'metric', 'data-metric': id });
  wrap.append(
    el(
      'div',
      { class: 'metric-label' },
      el('span', { class: 'tick' }),
      el('span', { text: METRIC_LABELS[id] || id.toUpperCase() })
    ),
    el(
      'div',
      { class: 'metric-value' },
      el('span', { 'data-val': id, text: '--' }),
      el('span', { class: 'unit', text: '%' })
    ),
    el('div', { class: 'metric-bar' }, el('span', { 'data-bar': id }))
  );
  return wrap;
}

function renderPill() {
  if (!settings) return;
  const visible = settings.metrics.order.filter((id) => !settings.metrics.hidden.includes(id));
  pillMetrics.innerHTML = '';
  pillCache = {};
  if (!visible.length) {
    pillMetrics.append(el('div', { class: 'pill-empty', text: 'Floating Island' }));
    return;
  }
  for (const id of visible) pillMetrics.append(buildMetric(id));
  if (latestStats) updatePill(latestStats);
}

function setPillValue(id, text) {
  if (pillCache[id] === text) return;
  pillCache[id] = text;
  const node = pillMetrics.querySelector(`[data-val="${id}"]`);
  if (node) node.textContent = text;
}

function setPillBar(id, pct) {
  const value = Math.max(0, Math.min(100, Number(pct) || 0));
  if (pillCache[`bar:${id}`] === value) return;
  pillCache[`bar:${id}`] = value;
  const node = pillMetrics.querySelector(`[data-bar="${id}"]`);
  if (node) node.style.width = `${value}%`;
}

function updatePill(stats) {
  if (!stats) return;
  if (stats.cpu === null || stats.cpu === undefined) {
    setPillValue('cpu', '--');
    setPillBar('cpu', 0);
  } else {
    setPillValue('cpu', `${Math.round(stats.cpu)}`);
    setPillBar('cpu', stats.cpu);
  }

  if (!stats.gpu || stats.gpu.pct === null || stats.gpu.pct === undefined) {
    setPillValue('gpu', '--');
    setPillBar('gpu', 0);
  } else {
    setPillValue('gpu', `${Math.round(stats.gpu.pct)}`);
    setPillBar('gpu', stats.gpu.pct);
  }

  if (!stats.ram || stats.ram.pct === null) {
    setPillValue('ram', '--');
    setPillBar('ram', 0);
  } else {
    setPillValue('ram', `${Math.round(stats.ram.pct)}`);
    setPillBar('ram', stats.ram.pct);
  }

  if (stats.net) {
    setPillValue('net-down', shortRate(stats.net.down));
    setPillValue('net-up', shortRate(stats.net.up));
    const metric = pillMetrics.querySelector('[data-metric="net"]');
    if (metric) {
      metric.title = `${fullRate(stats.net.down)} down \u00b7 ${fullRate(stats.net.up)} up`;
    }
  }
}

function updateStatusDot(stats) {
  const peak = Math.max(stats.cpu || 0, (stats.gpu && stats.gpu.pct) || 0, (stats.ram && stats.ram.pct) || 0);
  const color = peak >= 90 ? 'var(--c-danger)' : peak >= 70 ? 'var(--c-warn)' : 'var(--accent)';
  if (color === lastDotColor) return;
  lastDotColor = color;
  statusDot.style.background = color;
}

/* ------------------------------------------------------------------ */
/* Stats                                                               */
/* ------------------------------------------------------------------ */

function pushHistory(stats) {
  const interval = settings && settings.metrics ? settings.metrics.interval : 100;
  const netLimit = Math.max(12, Math.min(600, Math.round(60000 / Math.max(100, interval))));
  const push = (arr, value, limit) => {
    arr.push(Number.isFinite(value) ? value : 0);
    if (arr.length > limit) arr.shift();
  };
  push(history.cpu, stats.cpu, 48);
  push(history.gpu, stats.gpu ? stats.gpu.pct : 0, 48);
  push(history.ram, stats.ram ? stats.ram.pct : 0, 48);
  push(history.down, stats.net ? stats.net.down : 0, netLimit);
  push(history.up, stats.net ? stats.net.up : 0, netLimit);
}

function handleStats(stats) {
  if (!settings) return;
  latestStats = stats;

  if (lastTickAt) {
    const delta = Math.min(4000, stats.t - lastTickAt);
    if (delta > 0) {
      session.down += ((stats.net && stats.net.down) || 0) * (delta / 1000);
      session.up += ((stats.net && stats.net.up) || 0) * (delta / 1000);
    }
  }
  lastTickAt = stats.t;

  pushHistory(stats);
  // Battery saver throttles the collapsed capsule's repaint rate. The expanded
  // panel always paints so the charts and gauges stay responsive while the user
  // is actually looking at them.
  const now = Date.now();
  if (settings.behavior.batterySaver && !expanded && now - lastPaintAt < BATTERY_PAINT_MS) {
    return;
  }
  lastPaintAt = now;
  updatePill(stats);
  updateStatusDot(stats);
  updateFooter();
  if (expanded) updatePerformance(stats);
}

function updateGauge(name, pct) {
  const ring = $(`[data-ring="${name}"]`);
  const valueEl = $(`[data-gauge-value="${name}"]`);
  if (!ring || !valueEl) return;
  let offset;
  let text;
  if (pct === null || pct === undefined || !Number.isFinite(pct)) {
    offset = String(GAUGE_CIRCUMFERENCE);
    text = '--';
  } else {
    const clamped = Math.max(0, Math.min(100, pct));
    offset = (GAUGE_CIRCUMFERENCE * (1 - clamped / 100)).toFixed(2);
    text = `${Math.round(clamped)}%`;
  }
  const cache = gaugeCache[name] || (gaugeCache[name] = {});
  if (cache.offset !== offset) {
    cache.offset = offset;
    ring.style.strokeDashoffset = offset;
  }
  if (cache.text !== text) {
    cache.text = text;
    valueEl.textContent = text;
  }
}

function updateCores(cores) {
  if (!Array.isArray(cores) || !cores.length) return;
  if (coresEl.children.length !== cores.length) {
    coresEl.innerHTML = '';
    coreCache = [];
    for (let i = 0; i < cores.length; i += 1) {
      const core = el('div', { class: 'core', title: `Core ${i + 1}` });
      core.append(el('i'));
      coresEl.append(core);
    }
  }
  cores.forEach((pct, index) => {
    const rounded = Math.round(pct);
    if (coreCache[index] === rounded) return;
    coreCache[index] = rounded;
    const core = coresEl.children[index];
    if (!core) return;
    const bar = core.firstElementChild;
    bar.style.height = `${Math.max(2, Math.min(100, rounded))}%`;
    core.title = `Core ${index + 1} \u00b7 ${rounded}%`;
  });
  const label = `${cores.length} threads`;
  if (coreCount.textContent !== label) coreCount.textContent = label;
}

function updatePerformance(stats) {
  updateGauge('cpu', stats.cpu);
  updateGauge('gpu', stats.gpu ? stats.gpu.pct : null);
  updateGauge('ram', stats.ram ? stats.ram.pct : null);

  const ramGauge = $('[data-gauge="ram"]');
  if (ramGauge && stats.ram) {
    ramGauge.title = `${fmtBytes(stats.ram.used)} of ${fmtBytes(stats.ram.total)}`;
  }

  if (stats.gpu) {
    const parts = [stats.gpu.name || 'GPU'];
    if (stats.gpu.pct === null || stats.gpu.pct === undefined) {
      parts.push(settings.metrics.gpuEnabled ? 'counters unavailable' : 'GPU metrics off');
    } else if (stats.gpu.vram) {
      parts.push(`${fmtBytes(stats.gpu.vram)} VRAM`);
    }
    gpuInfo.textContent = parts.join(' \u00b7 ');
    gpuInfo.title = stats.gpu.name || '';
  }

  updateCores(stats.cores || []);

  if (stats.net) {
    const name = stats.net.name || stats.net.iface || '';
    const link = fmtLinkSpeed(stats.net.speed);
    netIface.textContent = [name, link].filter(Boolean).join(' \u00b7 ') || 'offline';
    netIface.title = [stats.net.iface, stats.net.type, link ? `${link} link speed` : '']
      .filter(Boolean)
      .join('\n');

    const down = rateParts(stats.net.down);
    const up = rateParts(stats.net.up);
    netDown.textContent = down.text;
    netDownUnit.textContent = down.unit;
    netUp.textContent = up.text;
    netUpUnit.textContent = up.unit;
  }

  if (settings.panel.showTotals) {
    netTotals.style.display = '';
    netSessionDown.textContent = fmtBytes(session.down);
    netSessionUp.textContent = fmtBytes(session.up);
  } else {
    netTotals.style.display = 'none';
  }

  drawChart();
}

function niceMax(value) {
  if (!(value > 0)) return 1;
  const exponent = Math.floor(Math.log10(value));
  const base = Math.pow(10, exponent);
  const norm = value / base;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * base;
}

// getComputedStyle forces a style recalculation, so resolve the chart palette
// once per theme instead of on every 10 Hz redraw.
function chartColors() {
  const theme = root.dataset.theme || 'dark';
  if (chartTheme && chartTheme.theme === theme) return chartTheme;
  const styles = getComputedStyle(root);
  chartTheme = {
    theme,
    grid: styles.getPropertyValue('--line').trim() || 'rgba(255,255,255,0.08)',
    label: styles.getPropertyValue('--dim-2').trim() || '#64647c',
    down: styles.getPropertyValue('--c-net-down').trim() || '#4cc2ff',
    up: styles.getPropertyValue('--c-net-up').trim() || '#ff9f43'
  };
  return chartTheme;
}

function drawChart() {
  if (!settings || !netChart) return;
  const show = Boolean(settings.metrics.sparkline);
  netChart.style.display = show ? 'block' : 'none';
  if (!show) return;

  const cssWidth = netChart.clientWidth;
  if (!cssWidth) return;
  if (netWindow) {
    const interval = settings.metrics.interval || 100;
    const seconds = Math.max(1, Math.round(((history.down.length || 1) * interval) / 1000));
    const label = `${seconds} s`;
    if (netWindow.textContent !== label) netWindow.textContent = label;
  }
  const cssHeight = netChart.clientHeight || 150;
  const dpr = window.devicePixelRatio || 1;
  if (netChart.width !== Math.round(cssWidth * dpr) || netChart.height !== Math.round(cssHeight * dpr)) {
    netChart.width = Math.round(cssWidth * dpr);
    netChart.height = Math.round(cssHeight * dpr);
  }

  const ctx = netChart.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const { grid: gridColor, label: labelColor, down: downColor, up: upColor } = chartColors();

  // Task Manager-style plot area: a little padding on the right for the scale.
  const padTop = 6;
  const padBottom = 16;
  const padRight = 4;
  const plotW = cssWidth - padRight;
  const plotH = cssHeight - padTop - padBottom;

  const downValues = history.down.map(rateValue);
  const upValues = history.up.map(rateValue);
  const peak = Math.max(0, ...downValues, ...upValues);
  const max = niceMax(peak);

  const yFor = (value) => padTop + plotH - Math.min(1, value / max) * plotH;
  const xFor = (index, length) => (length <= 1 ? 0 : (index / (length - 1)) * plotW);

  // Horizontal grid with scale labels.
  ctx.font = '8.5px "Segoe UI", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const fraction of [0, 0.5, 1]) {
    const y = Math.round(padTop + plotH - fraction * plotH) + 0.5;
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(plotW, y);
    ctx.stroke();
    const label = fraction === 0 ? '0' : formatRateValue(max * fraction);
    ctx.fillStyle = labelColor;
    ctx.fillText(label, 4, Math.max(8, Math.min(cssHeight - 4, y - 6)));
  }

  const drawSeries = (values, color, fill) => {
    if (!values.length) return;
    const points = values.map((value, index) => [xFor(index, values.length), yFor(value)]);

    if (fill) {
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (const [x, y] of points.slice(1)) ctx.lineTo(x, y);
      ctx.lineTo(points[points.length - 1][0], padTop + plotH);
      ctx.lineTo(points[0][0], padTop + plotH);
      ctx.closePath();
      const gradient = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
      gradient.addColorStop(0, hexToRgba(color, 0.42));
      gradient.addColorStop(1, hexToRgba(color, 0.04));
      ctx.fillStyle = gradient;
      ctx.fill();
    }

    ctx.beginPath();
    points.forEach(([x, y], index) => {
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  };

  drawSeries(downValues, downColor, true);
  drawSeries(upValues, upColor, true);
}

/* ------------------------------------------------------------------ */
/* Tabs                                                                */
/* ------------------------------------------------------------------ */

function renderTabs() {
  if (!settings) return;
  tabsEl.innerHTML = '';
  const visible = TAB_DEFS.filter((tab) => settings.panel.tabs[tab.id] !== false);
  if (!visible.some((tab) => tab.id === activeTab) && activeTab !== 'settings') {
    activeTab = visible.length ? visible[0].id : 'settings';
  }

  for (const tab of visible) {
    const tabButton = el('button', {
      class: `tab${activeTab === tab.id ? ' active' : ''}`,
      type: 'button',
      title: `${tab.label} view`
    });
    tabButton.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${tab.icon}</svg><span>${tab.label}</span>`;
    tabButton.addEventListener('click', () => selectTab(tab.id));
    tabsEl.append(tabButton);
  }

  const gear = el('button', {
    class: `tab settings${activeTab === 'settings' ? ' active' : ''}`,
    type: 'button',
    title: 'Settings'
  });
  gear.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${GEAR_ICON}</svg>`;
  gear.addEventListener('click', () => selectTab('settings'));
  tabsEl.append(gear);
}

function selectTab(id) {
  activeTab = id;
  renderTabs();
  showPane();
}

function showPane() {
  const current = activeTab;
  panes.forEach((pane) => pane.classList.toggle('active', pane.dataset.pane === current));
  if (current === 'processes') {
    updateProcSortUI();
    startProcessLoop();
  } else {
    stopProcessLoop();
  }
  if (current === 'performance') requestAnimationFrame(drawChart);
}

/* ------------------------------------------------------------------ */
/* Processes                                                           */
/* ------------------------------------------------------------------ */

function updateProcSortUI() {
  if (!settings) return;
  $$('#procSort button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.sort === settings.panel.processSort);
  });
}

function stopProcessLoop() {
  procQueued = false;
  if (procTimer) {
    clearTimeout(procTimer);
    procTimer = null;
  }
  procList.querySelectorAll('.end-btn[data-armed="1"]').forEach((btn) => {
    btn.dataset.armed = '0';
    btn.classList.remove('confirm');
    btn.textContent = 'End';
  });
}

function startProcessLoop() {
  if (procTimer) {
    clearTimeout(procTimer);
    procTimer = null;
  }
  if (!expanded || activeTab !== 'processes' || !settings.panel.tabs.processes) return;

  const loop = async () => {
    if (!expanded || activeTab !== 'processes') return;
    await fetchProcesses();
    if (!expanded || activeTab !== 'processes') return;
    procTimer = setTimeout(loop, Math.max(1000, settings.panel.processRefresh));
  };
  loop();
}

async function fetchProcesses() {
  if (procFetching) {
    procQueued = true;
    return;
  }
  procFetching = true;
  try {
    const data = await api.getProcesses({
      sort: settings.panel.processSort,
      count: settings.panel.processCount
    });
    if (expanded && activeTab === 'processes') renderProcesses(data);
  } catch {
    if (expanded && activeTab === 'processes') {
      procList.innerHTML = '';
      procList.append(el('div', { class: 'empty', text: 'Could not read process list' }));
    }
  } finally {
    procFetching = false;
    if (procQueued && expanded && activeTab === 'processes') {
      procQueued = false;
      fetchProcesses();
    } else {
      procQueued = false;
    }
  }
}

function renderProcesses(data) {
  const list = (data && data.list) || [];
  const total = (data && data.total) || 0;
  procCount.textContent = `${total} processes`;
  procList.innerHTML = '';

  if (!list.length) {
    procList.append(el('div', { class: 'empty', text: 'No process data available' }));
    return;
  }

  const sortingByMem = settings.panel.processSort === 'mem';
  const maxCpu = Math.max(1, ...list.map((p) => p.cpu || 0));
  const maxMem = Math.max(1, ...list.map((p) => p.mem || 0));

  for (const item of list) {
    const row = el('div', { class: 'proc' });
    row.append(
      el('span', {
        class: 'proc-icon',
        style: { '--c': colorForName(item.name) },
        text: String(item.name || '?').charAt(0).toUpperCase()
      })
    );

    row.append(
      el(
        'div',
        { class: 'proc-main' },
        el('div', { class: 'proc-name', text: item.name || 'Unknown' }),
        el('div', { class: 'proc-sub', text: `PID ${item.pid}` })
      )
    );

    const percent = sortingByMem
      ? Math.min(100, ((item.mem || 0) / maxMem) * 100)
      : Math.min(100, ((item.cpu || 0) / maxCpu) * 100);
    const valueText = sortingByMem ? fmtBytes(item.mem, 0) : `${(item.cpu || 0).toFixed(1)}%`;

    row.append(
      el(
        'div',
        { class: 'proc-stat' },
        el('span', { class: 'proc-bar' }, el('i', { style: { width: `${percent}%` } })),
        el('span', { class: 'proc-value', text: valueText })
      )
    );

    const endButton = el('button', {
      class: 'end-btn',
      type: 'button',
      'data-pid': String(item.pid),
      'data-name': item.name || '',
      text: 'End',
      title: `End ${item.name} (PID ${item.pid})`
    });
    row.append(endButton);
    procList.append(row);
  }
}

async function handleEndTask(endButton) {
  const pid = Number(endButton.dataset.pid);
  if (!Number.isInteger(pid)) return;

  if (settings.panel.confirmKill && endButton.dataset.armed !== '1') {
    endButton.dataset.armed = '1';
    endButton.classList.add('confirm');
    endButton.textContent = 'Sure?';
    clearTimeout(endButton._armTimer);
    endButton._armTimer = setTimeout(() => {
      endButton.dataset.armed = '0';
      endButton.classList.remove('confirm');
      endButton.textContent = 'End';
    }, 3200);
    return;
  }

  clearTimeout(endButton._armTimer);
  endButton.disabled = true;
  endButton.textContent = '\u2026';
  const result = await api.killProcess(pid);
  const name = endButton.dataset.name || 'Task';
  if (result && result.ok) {
    toast(`Ended ${name}`);
    const row = endButton.closest('.proc');
    if (row) row.style.opacity = '0.35';
    setTimeout(fetchProcesses, 350);
  } else {
    toast((result && result.error) || 'Could not end task', 'error');
    endButton.disabled = false;
    endButton.dataset.armed = '0';
    endButton.classList.remove('confirm');
    endButton.textContent = 'End';
  }
}

/* ------------------------------------------------------------------ */
/* Quick launch                                                        */
/* ------------------------------------------------------------------ */

function renderLaunch() {
  if (!settings) return;
  launchGrid.innerHTML = '';

  for (const entry of settings.quicklaunch) {
    const tile = el('button', {
      class: 'launch',
      type: 'button',
      title: entry.target ? `${entry.name}\n${entry.target}` : entry.name
    });

    const icon = icons[entry.id];
    if (icon) {
      tile.append(el('img', { src: icon, alt: '', draggable: 'false' }));
    } else {
      tile.append(
        el('span', {
          class: 'glyph',
          style: { '--c': entry.color || '#ff6b35' },
          text: entry.emoji || String(entry.name || 'A').charAt(0)
        })
      );
    }
    tile.append(el('span', { class: 'label', text: entry.name }));

    tile.addEventListener('click', async () => {
      const result = await api.runEntry(entry.id);
      if (!result || !result.ok) {
        toast((result && result.error) || `Could not open ${entry.name}`, 'error');
      }
    });

    launchGrid.append(tile);
  }

  const editTile = el('button', { class: 'launch edit', type: 'button', title: 'Edit quick launch' });
  editTile.append(el('span', { class: 'glyph', text: '+' }), el('span', { class: 'label', text: 'Edit' }));
  editTile.addEventListener('click', () => openSettingsTab('quicklaunch'));
  launchGrid.append(editTile);
}

async function refreshIcons() {
  try {
    icons = await api.getIcons();
    renderLaunch();
    if (activeTab === 'settings') {
      // Keep the editor untouched; icons are only used in the launch grid.
    }
  } catch {
    /* icons are optional */
  }
}

/* ------------------------------------------------------------------ */
/* Notes                                                               */
/* ------------------------------------------------------------------ */

function updateNotesCount() {
  const value = notesText.value;
  const words = value.trim() ? value.trim().split(/\s+/).length : 0;
  notesCount.textContent = `${words} word${words === 1 ? '' : 's'} \u00b7 ${value.length} chars`;
}

function setNotesStatus(text, revert = true) {
  notesStatus.textContent = text;
  clearTimeout(notesStatusTimer);
  if (revert) {
    notesStatusTimer = setTimeout(() => {
      notesStatus.textContent = 'Saved automatically';
    }, 1600);
  }
}

async function loadNotes() {
  try {
    const result = await api.getNotes();
    // Never clobber text the user managed to type before the file finished
    // loading (the scheduled save below will persist it instead).
    if (!notesDirty && !notesText.value) {
      notesText.value = (result && result.text) || '';
    }
  } catch {
    if (!notesDirty && !notesText.value) notesText.value = '';
  }
  notesLoaded = true;
  updateNotesCount();
  // If the user typed before the file finished loading, make sure it gets saved.
  if (notesDirty) scheduleNotesSave();
}

async function flushNotes() {
  if (!notesLoaded || !notesDirty) return;
  if (notesSaveTimer) {
    clearTimeout(notesSaveTimer);
    notesSaveTimer = null;
  }
  notesDirty = false;
  try {
    const result = await api.saveNotes(notesText.value);
    if (result && result.ok === false) throw new Error(result.error || 'save failed');
    setNotesStatus('Saved');
  } catch {
    notesDirty = true;
    setNotesStatus('Could not save', false);
  }
}

function scheduleNotesSave() {
  notesDirty = true;
  if (notesSaveTimer) clearTimeout(notesSaveTimer);
  setNotesStatus('Saving\u2026', false);
  notesSaveTimer = setTimeout(() => {
    notesSaveTimer = null;
    flushNotes();
  }, 350);
}

function wireNotes() {
  notesText.addEventListener('input', () => {
    updateNotesCount();
    scheduleNotesSave();
  });
  // Persist as soon as focus leaves the pad, so nothing is lost if the island
  // is hidden or the app is quit right after.
  notesText.addEventListener('blur', () => flushNotes());

  btnNotesCopy.addEventListener('click', () => {
    api.copyText(notesText.value);
    setNotesStatus('Copied to clipboard');
  });

  btnNotesClear.addEventListener('click', () => {
    if (btnNotesClear.dataset.armed !== '1') {
      btnNotesClear.dataset.armed = '1';
      btnNotesClear.textContent = 'Sure?';
      clearTimeout(notesClearTimer);
      notesClearTimer = setTimeout(() => {
        btnNotesClear.dataset.armed = '0';
        btnNotesClear.textContent = 'Clear';
      }, 2600);
      return;
    }
    clearTimeout(notesClearTimer);
    btnNotesClear.dataset.armed = '0';
    btnNotesClear.textContent = 'Clear';
    notesText.value = '';
    updateNotesCount();
    scheduleNotesSave();
    notesText.focus();
  });
}

/* ------------------------------------------------------------------ */
/* Settings UI                                                         */
/* ------------------------------------------------------------------ */

function settingsSection(title, id, ...children) {
  const section = el('div', { class: 'settings-section', id: id ? `settings-${id}` : null });
  section.append(el('h3', { text: title }));
  for (const child of children) if (child) section.append(child);
  return section;
}

function toggleField(label, checked, onChange, hint) {
  const input = el('input', { type: 'checkbox', checked });
  input.addEventListener('change', () => onChange(input.checked));
  const text = el(
    'div',
    { class: 'toggle-text' },
    el('span', { text: label }),
    hint ? el('span', { class: 'toggle-hint', text: hint }) : null
  );
  return el('div', { class: 'toggle' }, text, input);
}

function rangeField(label, value, min, max, step, onChange, format = (v) => v) {
  const output = el('output', { text: String(format(value)) });
  const input = el('input', { type: 'range', min, max, step, value });
  input.addEventListener('input', () => {
    const next = Number(input.value);
    output.textContent = String(format(next));
    onChange(next);
  });
  return el(
    'div',
    { class: 'field' },
    el('div', { class: 'field-top' }, el('span', { text: label }), output),
    input
  );
}

function selectField(label, value, options, onChange, hint) {
  const select = el('select');
  for (const option of options) {
    const node = el('option', { value: String(option.value), text: option.label });
    if (String(option.value) === String(value)) node.selected = true;
    select.append(node);
  }
  select.addEventListener('change', () => onChange(select.value));
  return el(
    'div',
    { class: 'field' },
    el('div', { class: 'field-top' }, el('span', { text: label })),
    select,
    hint ? el('div', { class: 'field-hint', text: hint }) : null
  );
}

function appearanceSection() {
  const colorInput = el('input', {
    type: 'color',
    value: settings.appearance.accent,
    title: 'Custom accent color'
  });
  colorInput.addEventListener('input', () => {
    settings.appearance.accent = colorInput.value;
    applyAppearance();
    updateAccentSelection();
  });
  colorInput.addEventListener('change', () => commit());

  const swatches = el('div', { class: 'swatches' });
  for (const color of ACCENT_PRESETS) {
    const swatch = el('button', {
      class: `swatch${settings.appearance.accent.toLowerCase() === color ? ' selected' : ''}`,
      type: 'button',
      title: color,
      'data-color': color
    });
    swatch.style.setProperty('--sw', color);
    swatch.addEventListener('click', () => {
      settings.appearance.accent = color;
      colorInput.value = color;
      applyAppearance();
      updateAccentSelection();
      commit();
    });
    swatches.append(swatch);
  }
  swatches.append(colorInput);

  const accentField = el(
    'div',
    { class: 'field' },
    el('div', { class: 'field-top' }, el('span', { text: 'Accent' }), el('span', { class: 'field-hint', text: 'presets or custom' })),
    swatches
  );

  return settingsSection(
    'Appearance',
    'appearance',
    accentField,
    rangeField(
      'Glass opacity',
      settings.appearance.opacity,
      0.35,
      1,
      0.01,
      (value) => {
        settings.appearance.opacity = value;
        applyAppearance();
        commit();
      },
      (value) => `${Math.round(value * 100)}%`
    ),
    rangeField(
      'Background blur',
      settings.appearance.blur,
      0,
      40,
      1,
      (value) => {
        settings.appearance.blur = value;
        applyAppearance();
        commit();
      },
      (value) => `${value}px`
    ),
    selectField(
      'Theme',
      settings.appearance.theme,
      [
        { value: 'dark', label: 'Dark glass' },
        { value: 'light', label: 'Light glass' },
        { value: 'auto', label: 'Follow Windows' }
      ],
      (value) => {
        settings.appearance.theme = value;
        applyAppearance();
        commit();
      }
    ),
    rangeField(
      'Corner radius',
      settings.appearance.radius,
      10,
      40,
      1,
      (value) => {
        settings.appearance.radius = value;
        applyAppearance();
        commit();
      },
      (value) => `${value}px`
    ),
    rangeField(
      'Interface scale',
      settings.appearance.scale,
      0.8,
      1.35,
      0.05,
      (value) => {
        settings.appearance.scale = value;
        applyAppearance();
        commit();
      },
      (value) => `${Math.round(value * 100)}%`
    ),
    toggleField('Accent glow', settings.appearance.glow, (value) => {
      settings.appearance.glow = value;
      applyAppearance();
      commit();
    }),
    toggleField('Border', settings.appearance.border, (value) => {
      settings.appearance.border = value;
      applyAppearance();
      commit();
    })
  );
}

function updateAccentSelection() {
  $$('.swatch', settingsBody).forEach((swatch) => {
    swatch.classList.toggle(
      'selected',
      (swatch.dataset.color || '').toLowerCase() === settings.appearance.accent.toLowerCase()
    );
  });
}

function behaviorSection() {
  const shortcutInput = el('input', {
    type: 'text',
    value: settings.behavior.shortcut,
    placeholder: 'Ctrl+Alt+I',
    spellcheck: 'false'
  });
  shortcutInput.addEventListener('change', () => {
    const value = shortcutInput.value.trim();
    if (!value) {
      shortcutInput.value = settings.behavior.shortcut;
      return;
    }
    settings.behavior.shortcut = value;
    commit();
  });

  return settingsSection(
    'Position & behavior',
    'behavior',
    selectField(
      'Screen position',
      settings.position.anchor,
      [
        { value: 'center', label: 'Screen center' },
        { value: 'top-center', label: 'Top center' },
        { value: 'top-left', label: 'Top left' },
        { value: 'top-right', label: 'Top right' },
        { value: 'taskbar-left', label: 'Taskbar — bottom left' },
        { value: 'taskbar-center', label: 'Taskbar — bottom center' },
        { value: 'taskbar-right', label: 'Taskbar — bottom right' },
        { value: 'free', label: 'Free (drag anywhere)' }
      ],
      (value) => {
        settings.position.anchor = value;
        commit();
      },
      'Anchors keep the island pinned to that spot. Dragging switches to free position.'
    ),
    rangeField(
      'Top offset',
      settings.position.offsetY,
      0,
      120,
      1,
      (value) => {
        settings.position.offsetY = value;
        commit();
      },
      (value) => `${value}px`
    ),
    toggleField('Start expanded', settings.behavior.startExpanded, (value) => {
      settings.behavior.startExpanded = value;
      commit();
    }, 'Applies on next launch'),
    toggleField('Always on top', settings.behavior.alwaysOnTop, (value) => {
      settings.behavior.alwaysOnTop = value;
      commit();
    }),
    toggleField('Lock position', settings.behavior.lockPosition, (value) => {
      settings.behavior.lockPosition = value;
      commit();
    }, 'Prevents accidental dragging'),
    toggleField('Battery saver', settings.behavior.batterySaver, (value) => {
      settings.behavior.batterySaver = value;
      commit();
    }, 'Slower refresh, no blur, fewer repaints'),
    toggleField('Show in taskbar', settings.behavior.showInTaskbar, (value) => {
      settings.behavior.showInTaskbar = value;
      commit();
    }),
    toggleField('Start with Windows', settings.behavior.startWithWindows, (value) => {
      settings.behavior.startWithWindows = value;
      commit();
    }),
    toggleField('Hover preview', settings.behavior.hoverPeek, (value) => {
      settings.behavior.hoverPeek = value;
      commit();
    }, 'Unfold when hovering the capsule'),
    el(
      'div',
      { class: 'field' },
      el('div', { class: 'field-top' }, el('span', { text: 'Global shortcut' })),
      shortcutInput,
      el('div', { class: 'field-hint', text: 'Shows or collapses the island.' })
    )
  );
}

function setMetricHidden(id, hidden) {
  const hiddenSet = new Set(settings.metrics.hidden);
  if (hidden) hiddenSet.add(id);
  else hiddenSet.delete(id);
  settings.metrics.hidden = Array.from(hiddenSet);
}

function moveMetric(index, delta) {
  const order = settings.metrics.order;
  const next = index + delta;
  if (next < 0 || next >= order.length) return;
  const [item] = order.splice(index, 1);
  order.splice(next, 0, item);
  renderSettings();
  renderPill();
  if (latestStats) updatePill(latestStats);
  commit();
}

function metricsSection() {
  const orderList = el('div', { class: 'metric-order' });
  settings.metrics.order.forEach((id, index) => {
    const enabled = !settings.metrics.hidden.includes(id);
    const row = el('div', { class: `order-row${enabled ? '' : ' off'}` });
    const check = el('input', { type: 'checkbox', checked: enabled, title: 'Show in capsule' });
    check.addEventListener('change', () => {
      setMetricHidden(id, !check.checked);
      row.classList.toggle('off', !check.checked);
      renderPill();
      if (latestStats) updatePill(latestStats);
      commit();
    });
    const up = button('\u2191', { className: 'mini-btn', onClick: () => moveMetric(index, -1) });
    up.disabled = index === 0;
    const down = button('\u2193', { className: 'mini-btn', onClick: () => moveMetric(index, 1) });
    down.disabled = index === settings.metrics.order.length - 1;
    row.append(check, el('span', { text: METRIC_LABELS[id] || id }), up, down);
    orderList.append(row);
  });

  return settingsSection(
    'Metrics',
    'metrics',
    el('div', { class: 'field-hint', text: 'Shown in the capsule, in this order.' }),
    orderList,
    selectField(
      'Refresh interval',
      settings.metrics.interval,
      [
        { value: 100, label: '0.1 seconds (10×/sec)' },
        { value: 250, label: '0.25 seconds (4×/sec)' },
        { value: 500, label: '0.5 seconds (2×/sec)' },
        { value: 1000, label: '1 second' },
        { value: 5000, label: '5 seconds' }
      ],
      (value) => {
        settings.metrics.interval = Number(value);
        commit();
      },
      'CPU & memory update at this rate. GPU and network sample once per second (2 s with Battery saver).'
    ),
    toggleField('GPU counters', settings.metrics.gpuEnabled, (value) => {
      settings.metrics.gpuEnabled = value;
      commit();
    }, 'Uses Windows performance counters'),
    selectField(
      'Network unit',
      settings.metrics.netUnit,
      [
        { value: 'Mbps', label: 'Megabits / second' },
        { value: 'MBps', label: 'Megabytes / second' }
      ],
      (value) => {
        settings.metrics.netUnit = value;
        commit();
        if (latestStats) updatePerformance(latestStats);
      }
    ),
    toggleField('Traffic chart', settings.metrics.sparkline, (value) => {
      settings.metrics.sparkline = value;
      commit();
      drawChart();
    })
  );
}

function panelSection() {
  const tabsWrap = el('div');
  for (const tab of TAB_DEFS) {
    tabsWrap.append(
      toggleField(`${tab.label} tab`, settings.panel.tabs[tab.id] !== false, (value) => {
        settings.panel.tabs[tab.id] = value;
        renderTabs();
        showPane();
        commit();
      })
    );
  }

  return settingsSection(
    'Panel',
    'panel',
    tabsWrap,
    rangeField(
      'Processes shown',
      settings.panel.processCount,
      3,
      15,
      1,
      (value) => {
        settings.panel.processCount = value;
        commit();
        fetchProcesses();
      },
      (value) => `${value} rows`
    ),
    selectField(
      'Process refresh',
      settings.panel.processRefresh,
      [
        { value: 1000, label: '1 second' },
        { value: 2000, label: '2 seconds' },
        { value: 3000, label: '3 seconds' },
        { value: 5000, label: '5 seconds' }
      ],
      (value) => {
        settings.panel.processRefresh = Number(value);
        commit();
        startProcessLoop();
      }
    ),
    toggleField('Confirm before ending tasks', settings.panel.confirmKill, (value) => {
      settings.panel.confirmKill = value;
      commit();
    }),
    toggleField('Show session totals', settings.panel.showTotals, (value) => {
      settings.panel.showTotals = value;
      commit();
      if (latestStats) updatePerformance(latestStats);
    })
  );
}

function basename(filePath) {
  const match = String(filePath).split(/[\\/]/).pop() || 'App';
  return match.replace(/\.(exe|lnk|bat|cmd|com)$/i, '');
}

function quickLaunchCard(entry, index) {
  const card = el('div', { class: 'ql-card' });

  const emoji = el('input', { type: 'text', class: 'ql-emoji', maxlength: '2', value: entry.emoji });
  emoji.title = 'Icon fallback (emoji or letter)';
  emoji.addEventListener('change', () => {
    entry.emoji = emoji.value.trim().slice(0, 2) || '\u25A3';
    emoji.value = entry.emoji;
    renderLaunch();
    commit();
  });

  const name = el('input', { type: 'text', value: entry.name, placeholder: 'Name' });
  name.addEventListener('change', () => {
    entry.name = name.value.trim() || 'App';
    name.value = entry.name;
    renderLaunch();
    commit();
  });

  const color = el('input', { type: 'color', value: entry.color, title: 'Tile accent color' });
  color.addEventListener('change', () => {
    entry.color = color.value;
    renderLaunch();
    commit();
  });

  const up = button('\u2191', {
    className: 'mini-btn',
    title: 'Move up',
    onClick: () => {
      if (index === 0) return;
      const list = settings.quicklaunch;
      [list[index - 1], list[index]] = [list[index], list[index - 1]];
      renderSettings();
      renderLaunch();
      commit();
    }
  });
  up.disabled = index === 0;

  const down = button('\u2193', {
    className: 'mini-btn',
    title: 'Move down',
    onClick: () => {
      if (index >= settings.quicklaunch.length - 1) return;
      const list = settings.quicklaunch;
      [list[index + 1], list[index]] = [list[index], list[index + 1]];
      renderSettings();
      renderLaunch();
      commit();
    }
  });
  down.disabled = index >= settings.quicklaunch.length - 1;

  const remove = button('\u00d7', {
    className: 'mini-btn',
    title: 'Remove entry',
    onClick: () => {
      settings.quicklaunch.splice(index, 1);
      renderSettings();
      renderLaunch();
      commit();
    }
  });

  const top = el('div', { class: 'ql-top' }, emoji, name, color, up, down, remove);

  const target = el('input', {
    type: 'text',
    value: entry.target,
    placeholder: 'C:\\Path\\app.exe  ·  https://…  ·  ms-settings:'
  });
  target.addEventListener('change', () => {
    entry.target = target.value.trim();
    refreshIcons();
    commit();
  });

  const browse = button('Browse', {
    className: 'btn',
    onClick: async () => {
      const file = await api.pickFile();
      if (!file) return;
      entry.target = file;
      if (!entry.name || entry.name === 'New app') entry.name = basename(file);
      refreshIcons();
      renderSettings();
      commit();
    }
  });

  const args = el('input', {
    type: 'text',
    value: entry.args || '',
    placeholder: 'Arguments (optional)'
  });
  args.addEventListener('change', () => {
    entry.args = args.value.trim();
    commit();
  });

  card.append(top, el('div', { class: 'ql-target' }, target, browse), args);
  return card;
}

function quickLaunchSection() {
  const editor = el('div', { class: 'ql-editor' });
  settings.quicklaunch.forEach((entry, index) => editor.append(quickLaunchCard(entry, index)));

  const add = button('+ Add an entry', {
    className: 'btn wide add-entry',
    onClick: () => {
      settings.quicklaunch.push({
        id: `launch-${Date.now().toString(36)}`,
        name: 'New app',
        target: '',
        args: '',
        emoji: '\u25A3',
        color: '#ff6b35'
      });
      renderSettings();
      renderLaunch();
      commit();
    }
  });
  editor.append(add);

  return settingsSection('Quick launch', 'quicklaunch', editor);
}

function dataSection() {
  const openFile = button('Open settings file', {
    className: 'btn',
    onClick: async () => {
      const result = await api.openSettingsFile();
      if (result && result.ok === false) toast(result.error || 'Could not open settings file', 'error');
    }
  });

  const reset = button('Reset to defaults', {
    className: 'btn danger',
    onClick: async () => {
      if (!resetArmed) {
        resetArmed = true;
        reset.textContent = 'Confirm reset';
        reset.classList.add('confirming');
        clearTimeout(resetTimer);
        resetTimer = setTimeout(() => {
          resetArmed = false;
          reset.textContent = 'Reset to defaults';
          reset.classList.remove('confirming');
        }, 3500);
        return;
      }
      resetArmed = false;
      clearTimeout(resetTimer);
      reset.textContent = 'Reset to defaults';
      reset.classList.remove('confirming');
      try {
        const next = await api.resetSettings();
        adoptSettings(next, true);
        refreshIcons();
        toast('Settings reset to defaults');
      } catch {
        toast('Could not reset settings', 'error');
      }
    }
  });

  return settingsSection(
    'Data',
    'data',
    el('div', { class: 'btn-row' }, openFile, reset),
    el('div', { class: 'settings-path', text: appInfo.settingsPath || '' })
  );
}

function renderSettings() {
  if (!settings) return;
  settingsBody.innerHTML = '';
  settingsBody.append(
    appearanceSection(),
    behaviorSection(),
    metricsSection(),
    panelSection(),
    quickLaunchSection(),
    dataSection()
  );
}

/* ------------------------------------------------------------------ */
/* Saving                                                              */
/* ------------------------------------------------------------------ */

function scheduleFlush() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 160);
}

async function flush() {
  saveTimer = null;
  if (saving) {
    scheduleFlush();
    return;
  }
  if (!dirty) return;
  dirty = false;
  saving = true;
  try {
    const saved = await api.saveSettings(settings);
    if (saved && saved.behavior && saved.behavior.shortcut !== settings.behavior.shortcut) {
      settings.behavior.shortcut = saved.behavior.shortcut;
      if (activeTab === 'settings') renderSettings();
    }
    const signature = JSON.stringify(settings.quicklaunch);
    if (signature !== lastLaunchSignature) {
      lastLaunchSignature = signature;
      refreshIcons();
    }
  } catch {
    toast('Could not save settings', 'error');
    dirty = true;
  } finally {
    saving = false;
    if (dirty) scheduleFlush();
  }
}

function commit({ render = false } = {}) {
  if (!settings) return;
  applyAppearance();
  renderPill();
  if (latestStats) updatePill(latestStats);
  renderTabs();
  showPane();
  updateFooter();
  if (render) renderSettings();
  dirty = true;
  scheduleFlush();
}

function adoptSettings(next, rerenderSettings = false) {
  settings = next;
  const signature = JSON.stringify(settings.quicklaunch);
  if (signature !== lastLaunchSignature) {
    lastLaunchSignature = signature;
    refreshIcons();
  }
  applyAppearance();
  renderPill();
  if (latestStats) {
    updatePill(latestStats);
    if (expanded) updatePerformance(latestStats);
  }
  renderTabs();
  showPane();
  updateProcSortUI();
  renderLaunch();
  updateFooter();
  if (rerenderSettings && activeTab === 'settings') renderSettings();
}

/* ------------------------------------------------------------------ */
/* Footer                                                              */
/* ------------------------------------------------------------------ */

function updateFooter() {
  const parts = [`v${appInfo.version}`];
  if (latestStats && latestStats.uptime) parts.push(`up ${formatUptime(latestStats.uptime)}`);
  const text = parts.join(' \u00b7 ');
  if (text === lastFooterText) return;
  lastFooterText = text;
  footerInfo.textContent = text;
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

function wirePill() {
  pill.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    if (event.target.closest('button')) return;
    drag = {
      x: event.screenX,
      y: event.screenY,
      moved: false,
      locked: Boolean(settings && settings.behavior.lockPosition)
    };
    pill.setPointerCapture(event.pointerId);
  });

  pill.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.screenX - drag.x;
    const dy = event.screenY - drag.y;
    if (drag.locked) {
      // Position is locked: keep tracking movement so a drag is not treated as a click.
      if (!drag.moved && Math.hypot(dx, dy) > 8) drag.moved = true;
      return;
    }
    if (!drag.moved && Math.hypot(dx, dy) > 8) {
      drag.moved = true;
      pill.classList.add('dragging');
      api.dragStart(drag.x, drag.y);
    }
    if (drag.moved) api.dragMove(event.screenX, event.screenY);
  });

  // A cancelled pointer (capture lost while dragging) must never count as a click.
  const endDrag = (event, cancelled = false) => {
    if (!drag) return;
    const { moved, locked } = drag;
    drag = null;
    pill.classList.remove('dragging');
    if (moved) {
      if (locked) return;
      suppressToggleUntil = Date.now() + 350;
      api.dragEnd();
    } else if (!cancelled && !event.target.closest('button')) {
      pillActivate();
    }
  };

  pill.addEventListener('pointerup', (event) => endDrag(event, false));
  pill.addEventListener('pointercancel', (event) => endDrag(event, true));

  $('#btnChevron').addEventListener('click', (event) => {
    event.stopPropagation();
    pillActivate();
  });

  islandEl.addEventListener('pointerenter', () => {
    // Re-entering cancels any pending auto-collapse.
    clearTimeout(peekCollapseTimer);
    if (!settings || !settings.behavior.hoverPeek || expanded) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      if (!expanded) setExpandedState(true, { peek: true });
    }, 420);
  });

  islandEl.addEventListener('pointerleave', () => {
    clearTimeout(hoverTimer);
    if (!expanded) return;
    // Collapse once the pointer has left the expanded island. A short delay
    // keeps a brief excursion (e.g. brushing the taskbar) from closing it.
    clearTimeout(peekCollapseTimer);
    peekCollapseTimer = setTimeout(() => {
      // Don't collapse while a native control (select / color picker) that
      // lives inside the island still owns focus.
      const active = document.activeElement;
      const nativePopup = active && islandEl.contains(active) && active.matches('select, input, textarea');
      if (!islandEl.matches(':hover') && expanded && !drag && !nativePopup) {
        setExpandedState(false);
      }
    }, 240);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && expanded) {
      setExpandedState(false);
    }
  });
}

function wireFooter() {
  $('#btnQuit').addEventListener('click', async () => {
    await flushNotes();
    if (dirty) await flush();
    api.quit();
  });
  $('#btnHide').addEventListener('click', async () => {
    await flushNotes();
    if (dirty) await flush();
    api.hide();
  });
  $('#btnOpenConfig').addEventListener('click', async () => {
    const result = await api.openSettingsFile();
    if (result && result.ok === false) toast(result.error || 'Could not open settings file', 'error');
  });
}

function wireProcessPane() {
  $('#procSort').addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    settings.panel.processSort = target.dataset.sort === 'mem' ? 'mem' : 'cpu';
    updateProcSortUI();
    commit();
    fetchProcesses();
    startProcessLoop();
  });

  procList.addEventListener('click', (event) => {
    const endButton = event.target.closest('.end-btn');
    if (endButton) handleEndTask(endButton);
  });
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

async function init() {
  try {
    [settings, appInfo] = await Promise.all([api.getSettings(), api.appInfo()]);
  } catch {
    document.body.textContent = 'Floating Island could not load its settings.';
    return;
  }

  applyAppearance();
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (settings.appearance.theme === 'auto') {
      resolveTheme();
      drawChart();
    }
  });

  lastLaunchSignature = JSON.stringify(settings.quicklaunch);

  renderPill();
  renderTabs();
  renderSettings();
  renderLaunch();
  updateFooter();
  updateProcSortUI();

  expanded = Boolean(settings.behavior.startExpanded);
  pinned = expanded;
  applyExpandedDom();

  wirePill();
  wireFooter();
  wireProcessPane();
  wireNotes();
  loadNotes();

  window.addEventListener('resize', () => requestAnimationFrame(drawChart));

  api.onStats(handleStats);
  api.onSettingsChanged((next) => adoptSettings(next, true));
  api.onExpanded(({ expanded: value }) => syncExpandedFromMain(value));
  api.onOpenSettings(() => openSettingsTab());
  api.onOpenNotes(() => openTab('notes'));
  api.onFlush(async () => {
    // The main process is quitting: persist everything, then tell it we're done.
    try {
      await flushNotes();
      if (dirty) await flush();
    } finally {
      api.flushDone();
    }
  });
  api.onToast(({ text, kind }) => toast(text, kind));

  refreshIcons();
  requestAnimationFrame(drawChart);
}

init();
