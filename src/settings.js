'use strict';

const fs = require('fs');
const path = require('path');

const METRIC_IDS = ['cpu', 'gpu', 'ram', 'net'];
const THEMES = ['dark', 'light', 'auto'];
const ANCHORS = [
  'center',
  'top-center',
  'top-left',
  'top-right',
  'taskbar-left',
  'taskbar-center',
  'taskbar-right',
  'free'
];
const INTERVALS = [100, 250, 500, 1000, 5000];
const NET_UNITS = ['Mbps', 'MBps'];
const PROCESS_SORTS = ['cpu', 'mem'];

function defaultQuickLaunch() {
  return [
    { id: 'browser', name: 'Browser', target: 'https://www.google.com', args: '', emoji: '\u{1F310}', color: '#ff8a4c' },
    { id: 'files', name: 'Files', target: 'explorer.exe', args: '', emoji: '\u{1F4C1}', color: '#f5c451' },
    { id: 'terminal', name: 'Terminal', target: 'wt.exe', args: '', emoji: '\u25AE', color: '#7bd88f' },
    { id: 'settings', name: 'Settings', target: 'ms-settings:', args: '', emoji: '\u2699', color: '#8ab4f8' },
    { id: 'taskmgr', name: 'Task Manager', target: 'taskmgr.exe', args: '', emoji: '\u{1F4CA}', color: '#c792ea' },
    { id: 'notepad', name: 'Notepad', target: 'notepad.exe', args: '', emoji: '\u{1F4DD}', color: '#82d2f5' },
    { id: 'calc', name: 'Calculator', target: 'calc.exe', args: '', emoji: '\u{1F9EE}', color: '#ff7b9c' }
  ];
}

function defaults() {
  return {
    version: 1,
    appearance: {
      accent: '#ff6b35',
      opacity: 0.86,
      blur: 20,
      theme: 'dark',
      radius: 26,
      scale: 1,
      glow: true,
      border: true
    },
    position: {
      anchor: 'center',
      offsetY: 8,
      x: null,
      y: null
    },
    behavior: {
      startExpanded: false,
      alwaysOnTop: true,
      showInTaskbar: false,
      startWithWindows: false,
      shortcut: 'Ctrl+Alt+I',
      hoverPeek: false,
      lockPosition: false,
      batterySaver: false
    },
    metrics: {
      order: METRIC_IDS.slice(),
      hidden: [],
      interval: 100,
      gpuEnabled: true,
      netUnit: 'Mbps',
      sparkline: true
    },
    panel: {
      tabs: { performance: true, processes: true, quicklaunch: true, notes: true },
      processCount: 8,
      processRefresh: 2000,
      confirmKill: true,
      showTotals: true,
      processSort: 'cpu'
    },
    quicklaunch: defaultQuickLaunch(),
    window: { x: null, y: null }
  };
}

function isObj(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function num(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function bool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function str(value, fallback, max = 200) {
  if (typeof value !== 'string') return fallback;
  return value.slice(0, max);
}

function accent(value, fallback) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function sanitizeQuickLaunch(input) {
  const list = Array.isArray(input) ? input.slice(0, 24) : defaultQuickLaunch();
  const used = new Set();
  return list.map((raw, index) => {
    const entry = isObj(raw) ? raw : {};
    let id = str(entry.id, '', 40).replace(/[^a-z0-9-_]/gi, '');
    if (!id || used.has(id)) id = `launch-${index + 1}`;
    while (used.has(id)) id = `${id}-x`;
    used.add(id);
    return {
      id,
      name: str(entry.name, 'App', 32) || 'App',
      target: str(entry.target, '', 800),
      args: str(entry.args, '', 400),
      emoji: str(entry.emoji, '\u25A3', 8) || '\u25A3',
      color: accent(entry.color, '#ff6b35')
    };
  });
}

function sanitize(input) {
  const d = defaults();
  const raw = isObj(input) ? input : {};

  const appearance = isObj(raw.appearance) ? raw.appearance : {};
  const position = isObj(raw.position) ? raw.position : {};
  const behavior = isObj(raw.behavior) ? raw.behavior : {};
  const metrics = isObj(raw.metrics) ? raw.metrics : {};
  const panel = isObj(raw.panel) ? raw.panel : {};
  const tabs = isObj(panel.tabs) ? panel.tabs : {};
  const windowState = isObj(raw.window) ? raw.window : {};

  const ordered = Array.isArray(metrics.order)
    ? metrics.order.filter((id) => METRIC_IDS.includes(id))
    : [];
  const order = [];
  for (const id of ordered) if (!order.includes(id)) order.push(id);
  for (const id of METRIC_IDS) if (!order.includes(id)) order.push(id);

  const hidden = Array.isArray(metrics.hidden)
    ? metrics.hidden.filter((id) => METRIC_IDS.includes(id))
    : [];

  return {
    version: 1,
    appearance: {
      accent: accent(appearance.accent, d.appearance.accent),
      opacity: num(appearance.opacity, d.appearance.opacity, 0.35, 1),
      blur: num(appearance.blur, d.appearance.blur, 0, 40),
      theme: pick(appearance.theme, THEMES, d.appearance.theme),
      radius: num(appearance.radius, d.appearance.radius, 10, 40),
      scale: num(appearance.scale, d.appearance.scale, 0.8, 1.35),
      glow: bool(appearance.glow, d.appearance.glow),
      border: bool(appearance.border, d.appearance.border)
    },
    position: {
      anchor: pick(position.anchor === 'taskbar' ? 'taskbar-center' : position.anchor, ANCHORS, d.position.anchor),
      offsetY: num(position.offsetY, d.position.offsetY, 0, 200),
      x: Number.isFinite(position.x) ? Math.round(position.x) : null,
      y: Number.isFinite(position.y) ? Math.round(position.y) : null
    },
    behavior: {
      startExpanded: bool(behavior.startExpanded, d.behavior.startExpanded),
      alwaysOnTop: bool(behavior.alwaysOnTop, d.behavior.alwaysOnTop),
      showInTaskbar: bool(behavior.showInTaskbar, d.behavior.showInTaskbar),
      startWithWindows: bool(behavior.startWithWindows, d.behavior.startWithWindows),
      shortcut: str(behavior.shortcut, d.behavior.shortcut, 40) || d.behavior.shortcut,
      hoverPeek: bool(behavior.hoverPeek, d.behavior.hoverPeek),
      lockPosition: bool(behavior.lockPosition, d.behavior.lockPosition),
      batterySaver: bool(behavior.batterySaver, d.behavior.batterySaver)
    },
    metrics: {
      order,
      hidden,
      interval: pick(Number(metrics.interval), INTERVALS, d.metrics.interval),
      gpuEnabled: bool(metrics.gpuEnabled, d.metrics.gpuEnabled),
      netUnit: pick(metrics.netUnit, NET_UNITS, d.metrics.netUnit),
      sparkline: bool(metrics.sparkline, d.metrics.sparkline)
    },
    panel: {
      tabs: {
        performance: bool(tabs.performance, true),
        processes: bool(tabs.processes, true),
        quicklaunch: bool(tabs.quicklaunch, true),
        notes: bool(tabs.notes, true)
      },
      processCount: num(panel.processCount, d.panel.processCount, 3, 15),
      processRefresh: num(panel.processRefresh, d.panel.processRefresh, 1000, 5000),
      confirmKill: bool(panel.confirmKill, d.panel.confirmKill),
      showTotals: bool(panel.showTotals, d.panel.showTotals),
      processSort: pick(panel.processSort, PROCESS_SORTS, d.panel.processSort)
    },
    quicklaunch: sanitizeQuickLaunch(raw.quicklaunch),
    window: {
      x: Number.isFinite(windowState.x) ? Math.round(windowState.x) : null,
      y: Number.isFinite(windowState.y) ? Math.round(windowState.y) : null
    }
  };
}

class SettingsStore {
  constructor(file) {
    this.file = file;
    this.data = defaults();
    this.lastSaveAt = 0;
    this.load();
  }

  // Read + sanitize a specific file. Returns null when it is missing or
  // cannot be parsed. Never writes to disk.
  readFile(file) {
    try {
      return sanitize(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch {
      return null;
    }
  }

  read() {
    return this.readFile(this.file);
  }

  // Atomic write of the in-memory data (temp file + rename). Does not touch
  // the backup, so it is safe to call while recovering.
  write() {
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
    this.lastSaveAt = Date.now();
  }

  load() {
    const data = this.read();
    if (data) {
      this.data = data;
      return this.data;
    }

    if (fs.existsSync(this.file)) {
      // The live file exists but is unreadable. Preserve it for inspection and
      // recover the last known-good backup so settings are never silently
      // lost. Only if there is no usable backup do we fall back to defaults.
      const backup = this.readFile(`${this.file}.bak`);
      if (backup) {
        try {
          fs.copyFileSync(this.file, `${this.file}.corrupt`);
        } catch {
          /* keep going even if the copy fails */
        }
        this.data = backup;
        try {
          this.write();
        } catch {
          /* running from the recovered data is enough */
        }
        return this.data;
      }
    }

    // First run (or nothing recoverable): start from defaults. Only create the
    // file when it genuinely does not exist, so a damaged file is left alone.
    this.data = defaults();
    if (!fs.existsSync(this.file)) this.save(this.data);
    return this.data;
  }

  save(input) {
    this.data = sanitize(input);
    // Keep the previous good copy so settings can be recovered if anything
    // ever goes wrong with the live file.
    try {
      if (fs.existsSync(this.file)) fs.copyFileSync(this.file, `${this.file}.bak`);
    } catch {
      /* the backup is best-effort */
    }
    this.write();
    return this.data;
  }

  reset() {
    this.data = defaults();
    return this.save(this.data);
  }
}

module.exports = {
  SettingsStore,
  defaults,
  sanitize,
  METRIC_IDS,
  INTERVALS
};
