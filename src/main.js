'use strict';

const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  screen,
  Tray,
  Menu,
  nativeImage,
  globalShortcut,
  dialog,
  clipboard
} = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');
const os = require('os');
const si = require('systeminformation');
const { SettingsStore } = require('./settings');

const BASE_WIDTH = 420;
const COLLAPSED_HEIGHT = 44;
const EXPANDED_HEIGHT = 648;
const TASKBAR_MARGIN = 8;
const MIN_VISIBLE = 90;

const ASSETS = path.join(__dirname, '..', 'assets');

let win = null;
let tray = null;
let store = null;
let isExpanded = false;
let isQuitting = false;
let dragOrigin = null;
let boundsAnimation = null;
let statsTimer = null;
let statsNextAt = 0;
let statsInterval = 0;
let watchTimer = null;
let monitorProc = null;
let monitorRestartTimer = null;
let desktopProc = null;
let desktopRestartTimer = null;
let desktopState = { fullscreen: false, taskbarHidden: false };
let hiddenByUser = false;
// Set when the user explicitly asks for the island (tray, shortcut, or a
// second launch). It overrides auto-hide so the island can be summoned even
// while a fullscreen app is up, and clears on the next desktop-state change.
let forceVisible = false;
let gpuState = { pct: null, vram: null };
let netState = { down: 0, up: 0, iface: '', name: '', type: '', speed: 0 };
let cpuSample = null;
let gpuName = 'GPU';
let gpuAvailable = null;
let processCache = null;
let notesPath = null;
const iconCache = new Map();

const PROTECTED_NAMES = new Set([
  'system',
  'system idle process',
  'system interrupts',
  'secure system',
  'registry',
  'smss.exe',
  'csrss.exe',
  'wininit.exe',
  'winlogon.exe',
  'services.exe',
  'lsass.exe',
  'dwm.exe',
  'fontdrvhost.exe',
  'memory compression'
]);

/* ------------------------------------------------------------------ */
/* Window sizing and placement                                        */
/* ------------------------------------------------------------------ */

function primaryWorkArea() {
  return screen.getPrimaryDisplay().workArea;
}

function primaryBounds() {
  return screen.getPrimaryDisplay().bounds;
}

function windowSizes(expanded) {
  const scale = store.data.appearance.scale;
  const area = primaryWorkArea();
  const w = Math.round(BASE_WIDTH * scale);
  const h = expanded
    ? Math.min(Math.round(EXPANDED_HEIGHT * scale), area.height - 16)
    : Math.round(COLLAPSED_HEIGHT * scale);
  return { w, h };
}

function anchorX(anchor, area, w) {
  if (anchor === 'top-left') return area.x + 16;
  if (anchor === 'top-right') return area.x + area.width - w - 16;
  return area.x + Math.round((area.width - w) / 2);
}

// Bottom-anchored position that lets the capsule rest on the Windows taskbar.
function taskbarAnchor(anchor, w, h) {
  const bounds = primaryBounds();
  const align = anchor === 'taskbar-left' ? 'left' : anchor === 'taskbar-right' ? 'right' : 'center';
  let x;
  if (align === 'left') x = bounds.x + TASKBAR_MARGIN;
  else if (align === 'right') x = bounds.x + bounds.width - w - TASKBAR_MARGIN;
  else x = bounds.x + Math.round((bounds.width - w) / 2);
  return {
    x,
    y: bounds.y + bounds.height - h - store.data.position.offsetY
  };
}

function anchoredPosition(anchor, w, h) {
  if (anchor === 'taskbar' || anchor.startsWith('taskbar-')) return taskbarAnchor(anchor, w, h);
  if (anchor === 'center') {
    // True centre of the primary display (both axes).
    const bounds = primaryBounds();
    return {
      x: bounds.x + Math.round((bounds.width - w) / 2),
      y: bounds.y + Math.round((bounds.height - h) / 2)
    };
  }
  const area = primaryWorkArea();
  return {
    x: anchorX(anchor, area, w),
    y: area.y + store.data.position.offsetY
  };
}

function clampPosition(x, y, w, h) {
  // Use full display bounds so a free-positioned island can sit on top of the taskbar.
  const area = primaryBounds();
  const minX = area.x - w + MIN_VISIBLE;
  const maxX = area.x + area.width - MIN_VISIBLE;
  const minY = area.y;
  const maxY = area.y + area.height - Math.min(h, 120);
  return {
    x: Math.round(Math.min(maxX, Math.max(minX, x))),
    y: Math.round(Math.min(maxY, Math.max(minY, y)))
  };
}

function initialBounds(expanded) {
  const { w, h } = windowSizes(expanded);
  const area = primaryWorkArea();
  const anchor = store.data.position.anchor;
  let x;
  let y;
  if (anchor === 'free' && Number.isFinite(store.data.window.x)) {
    ({ x, y } = clampPosition(store.data.window.x, store.data.window.y ?? area.y, w, h));
  } else {
    ({ x, y } = anchoredPosition(anchor, w, h));
  }
  return { x: Math.round(x), y: Math.round(y), width: w, height: h };
}

function animateBounds(target, duration = 210) {
  if (!win || win.isDestroyed()) return;
  if (boundsAnimation) {
    clearInterval(boundsAnimation);
    boundsAnimation = null;
  }
  const start = win.getBounds();
  if (
    start.x === target.x &&
    start.y === target.y &&
    start.width === target.width &&
    start.height === target.height
  ) {
    return;
  }
  const t0 = Date.now();
  boundsAnimation = setInterval(() => {
    if (!win || win.isDestroyed()) {
      clearInterval(boundsAnimation);
      boundsAnimation = null;
      return;
    }
    const p = Math.min(1, (Date.now() - t0) / duration);
    const e = 1 - Math.pow(1 - p, 3);
    win.setBounds({
      x: Math.round(start.x + (target.x - start.x) * e),
      y: Math.round(start.y + (target.y - start.y) * e),
      width: Math.round(start.width + (target.width - start.width) * e),
      height: Math.round(start.height + (target.height - start.height) * e)
    });
    if (p >= 1) {
      clearInterval(boundsAnimation);
      boundsAnimation = null;
    }
  }, 16);
}

function setExpanded(value, { duration = 210 } = {}) {
  const next = Boolean(value);
  const target = windowSizes(next);
  let { x, y } = win.getBounds();
  const anchor = store.data.position.anchor;

  if (anchor === 'free') {
    ({ x, y } = clampPosition(x, y, target.w, target.h));
  } else {
    ({ x, y } = anchoredPosition(anchor, target.w, target.h));
  }

  isExpanded = next;
  animateBounds({ x, y, width: target.w, height: target.h }, duration);
  win.webContents.send('island:state', { expanded: next });
  refreshTrayMenu();
}

function currentExpandedState() {
  return isExpanded;
}

/* ------------------------------------------------------------------ */
/* System monitor (GPU, VRAM and network via performance counters)     */
/* ------------------------------------------------------------------ */

function stopMonitor() {
  if (monitorRestartTimer) {
    clearTimeout(monitorRestartTimer);
    monitorRestartTimer = null;
  }
  if (monitorProc) {
    try {
      monitorProc.kill();
    } catch {
      /* ignore */
    }
    monitorProc = null;
  }
}

// GPU + network come from a PowerShell sampler. There is no visual benefit in
// polling it many times a second, so cap it: the CPU/RAM pill still refreshes
// at the chosen rate (that work happens in-process and is cheap), while the
// external process stays light. 1 s halves the sampler's CPU vs. 2 Hz.
// Battery saver doubles that floor to 2 s and the pill repaints are throttled
// in the renderer, which is where most of the remaining saving comes from.
function effectiveMonitorInterval(data) {
  const chosen = data ? Number(data.metrics.interval) || 1000 : 1000;
  const floor = data && data.behavior.batterySaver ? 2000 : 1000;
  return Math.max(floor, chosen);
}

function monitorInterval() {
  return effectiveMonitorInterval(store ? store.data : null);
}

// In-process CPU/RAM sampling normally honours the chosen interval exactly.
// Battery saver lifts the floor to 1 s so the collector (and the IPC that
// carries it) stops being the busiest part of an idle, collapsed island.
function effectiveStatsInterval(data) {
  const chosen = data ? Math.max(100, Number(data.metrics.interval) || 1000) : 1000;
  const floor = data && data.behavior.batterySaver ? 1000 : 100;
  return Math.max(floor, chosen);
}

function startMonitor() {
  stopMonitor();

  const script = path.join(__dirname, 'system-monitor.ps1');
  if (!fs.existsSync(script)) return;

  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script];
  if (!store.data.metrics.gpuEnabled) args.push('-NoGpu');
  args.push('-Interval', String(monitorInterval()));

  let proc = null;
  try {
    proc = spawn('powershell.exe', args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore']
    });
  } catch {
    monitorProc = null;
    scheduleMonitorRestart();
    return;
  }
  monitorProc = proc;

  let buffer = '';
  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;
      try {
        const parsed = JSON.parse(trimmed);
        gpuState = {
          pct: Number.isFinite(parsed.gpu) ? Math.round(parsed.gpu) : null,
          vram: Number.isFinite(parsed.vram) ? parsed.vram : null
        };
        if (gpuState.pct !== null) gpuAvailable = true;
        if (Number.isFinite(parsed.down) && Number.isFinite(parsed.up)) {
          netState = {
            down: Math.max(0, parsed.down),
            up: Math.max(0, parsed.up),
            iface: typeof parsed.iface === 'string' ? parsed.iface : '',
            name: typeof parsed.name === 'string' ? parsed.name : '',
            type: typeof parsed.type === 'string' ? parsed.type : '',
            speed: Number.isFinite(parsed.speed) ? Math.max(0, parsed.speed) : 0
          };
        }
      } catch {
        /* ignore malformed line */
      }
    }
  });

  proc.on('error', () => {
    if (monitorProc !== proc) return;
    monitorProc = null;
    scheduleMonitorRestart();
  });

  proc.on('exit', () => {
    if (monitorProc !== proc) return;
    monitorProc = null;
    scheduleMonitorRestart();
  });
}

function scheduleMonitorRestart() {
  if (!store || isQuitting) return;
  if (monitorRestartTimer) return;
  monitorRestartTimer = setTimeout(() => {
    monitorRestartTimer = null;
    if (!isQuitting) startMonitor();
  }, 5000);
}

/* ------------------------------------------------------------------ */
/* Desktop state (hide the island on fullscreen / hidden taskbar)      */
/* ------------------------------------------------------------------ */

function stopDesktopWatcher() {
  if (desktopRestartTimer) {
    clearTimeout(desktopRestartTimer);
    desktopRestartTimer = null;
  }
  if (desktopProc) {
    try {
      desktopProc.kill();
    } catch {
      /* ignore */
    }
    desktopProc = null;
  }
}

function startDesktopWatcher() {
  stopDesktopWatcher();

  const script = path.join(__dirname, 'desktop-state.ps1');
  if (!fs.existsSync(script)) return;

  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    script,
    '-Interval',
    String(store && store.data.behavior.batterySaver ? 1200 : 800)
  ];

  let proc = null;
  try {
    proc = spawn('powershell.exe', args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore']
    });
  } catch {
    desktopProc = null;
    scheduleDesktopRestart();
    return;
  }
  desktopProc = proc;

  let buffer = '';
  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;
      try {
        const parsed = JSON.parse(trimmed);
        const next = {
          fullscreen: Boolean(parsed.fullscreen),
          taskbarHidden: Boolean(parsed.taskbarHidden)
        };
        if (next.fullscreen !== desktopState.fullscreen || next.taskbarHidden !== desktopState.taskbarHidden) {
          desktopState = next;
          // A fresh desktop-state change re-arms auto-hide: an explicit "show"
          // only lasts until the next transition.
          forceVisible = false;
          applyVisibility();
        }
      } catch {
        /* ignore malformed line */
      }
    }
  });

  proc.on('error', () => {
    if (desktopProc !== proc) return;
    desktopProc = null;
    scheduleDesktopRestart();
  });

  proc.on('exit', () => {
    if (desktopProc !== proc) return;
    desktopProc = null;
    scheduleDesktopRestart();
  });
}

function scheduleDesktopRestart() {
  if (!store || isQuitting) return;
  if (desktopRestartTimer) return;
  desktopRestartTimer = setTimeout(() => {
    desktopRestartTimer = null;
    if (!isQuitting) startDesktopWatcher();
  }, 5000);
}

// The island stays hidden while a fullscreen app is up, while the taskbar is
// hidden, or after the user explicitly hid it. An explicit "show" wins until
// the desktop state next changes.
function shouldAutoHide() {
  return !forceVisible && (desktopState.fullscreen || desktopState.taskbarHidden);
}

function applyVisibility() {
  if (!win || win.isDestroyed()) return;
  if (hiddenByUser || shouldAutoHide()) {
    if (win.isVisible()) win.hide();
    // Nothing is on screen, so stop sampling GPU/network until we come back.
    stopMonitor();
  } else {
    if (!win.isVisible()) win.show();
    if (!monitorProc) startMonitor();
  }
  refreshTrayMenu();
}

async function loadGpuName() {
  try {
    const graphics = await si.graphics();
    const controllers = graphics.controllers || [];
    const best = controllers.find((c) => Number(c.vram) > 0) || controllers[0];
    if (best) gpuName = best.model || best.vendor || 'GPU';
  } catch {
    /* keep default */
  }
}

/* ------------------------------------------------------------------ */
/* System stats                                                        */
/* ------------------------------------------------------------------ */

function round(value, digits = 0) {
  const factor = Math.pow(10, digits);
  return Math.round((Number(value) || 0) * factor) / factor;
}

// CPU load is sampled directly from the OS tick counters so it can run faster
// than systeminformation's 200 ms internal throttle.
function sampleCpu() {
  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;
  const ticks = [];
  for (const cpu of cpus) {
    const t = cpu.times;
    const tick = t.user + t.nice + t.sys + t.irq + t.idle;
    totalIdle += t.idle;
    totalTick += tick;
    ticks.push({ idle: t.idle, tick });
  }

  const prev = cpuSample;
  cpuSample = { totalIdle, totalTick, ticks };
  if (!prev || prev.ticks.length !== ticks.length) {
    return { cpu: null, cores: [] };
  }

  const totalDelta = totalTick - prev.totalTick;
  const idleDelta = totalIdle - prev.totalIdle;
  const cpu = totalDelta > 0 ? Math.round(100 * (1 - idleDelta / totalDelta)) : null;

  const cores = ticks.map((tick, index) => {
    const before = prev.ticks[index];
    const delta = tick.tick - before.tick;
    const idle = tick.idle - before.idle;
    if (delta <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round(100 * (1 - idle / delta))));
  });

  return { cpu: cpu === null ? null : Math.max(0, Math.min(100, cpu)), cores };
}

function sampleMemory() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = Math.max(0, total - free);
  return {
    used,
    total,
    pct: total ? Math.round((used / total) * 100) : null
  };
}

function collectStats() {
  const load = sampleCpu();
  const mem = sampleMemory();

  return {
    t: Date.now(),
    cpu: load.cpu,
    cores: load.cores,
    ram: mem,
    gpu: {
      pct: store.data.metrics.gpuEnabled ? gpuState.pct : null,
      vram: store.data.metrics.gpuEnabled ? gpuState.vram : null,
      name: gpuName,
      available: gpuAvailable
    },
    net: {
      down: netState.down,
      up: netState.up,
      iface: netState.iface,
      name: netState.name,
      type: netState.type,
      speed: netState.speed
    },
    uptime: os.uptime()
  };
}

function scheduleStats() {
  if (statsTimer) clearTimeout(statsTimer);
  const interval = effectiveStatsInterval(store ? store.data : null);
  const now = Date.now();

  // Schedule against an absolute target so the loop stays at a true 10 Hz
  // instead of accumulating the callback's own execution time.
  if (statsInterval !== interval || !statsNextAt || statsNextAt < now - interval) {
    statsNextAt = now;
  }
  statsInterval = interval;
  statsNextAt += interval;

  statsTimer = setTimeout(() => {
    if (win && !win.isDestroyed() && win.isVisible() && !win.isMinimized()) {
      try {
        const stats = collectStats();
        if (win && !win.isDestroyed()) win.webContents.send('stats:tick', stats);
      } catch {
        /* keep the loop alive */
      }
    }
    scheduleStats();
  }, Math.max(0, statsNextAt - Date.now()));
}

/* ------------------------------------------------------------------ */
/* Processes                                                           */
/* ------------------------------------------------------------------ */

const PROCESS_SCRIPT = [
  '$ErrorActionPreference = "Stop"',
  '$cores = [Environment]::ProcessorCount',
  '$rows = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -ErrorAction Stop |',
  '  Where-Object { $_.Name -ne "_Total" -and $_.Name -ne "Idle" -and $_.IDProcess -gt 4 }',
  '$topCpu = @($rows | Sort-Object PercentProcessorTime -Descending | Select-Object -First 60)',
  '$topMem = @($rows | Sort-Object WorkingSetPrivate -Descending | Select-Object -First 60)',
  '$merged = @($topCpu + $topMem | Sort-Object IDProcess -Unique)',
  '$list = @($merged | ForEach-Object {',
  '  [ordered]@{',
  '    pid = [int]$_.IDProcess',
  '    name = ($_.Name -replace "#\\d+$", "")',
  '    cpu = [math]::Round(([double]$_.PercentProcessorTime / $cores), 1)',
  '    mem = [int64]$_.WorkingSetPrivate',
  '  }',
  '})',
  '[ordered]@{ total = $rows.Count; list = $list } | ConvertTo-Json -Compress -Depth 4'
].join('\n');

function runPowerShell(script, timeout = 10000) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error((stderr || error.message || 'PowerShell failed').trim().split('\n')[0]));
          return;
        }
        resolve(String(stdout || '').replace(/^\uFEFF/, '').trim());
      }
    );
  });
}

function normalizeProcessName(name) {
  const value = String(name || 'Unknown').trim() || 'Unknown';
  if (/\.exe$/i.test(value) || /\s/.test(value)) return value;
  return `${value}.exe`;
}

async function fetchProcessesPowerShell() {
  const raw = await runPowerShell(PROCESS_SCRIPT);
  if (!raw) throw new Error('No process data');
  const parsed = JSON.parse(raw);
  const list = Array.isArray(parsed.list) ? parsed.list : [];
  const at = Date.now();
  return {
    at,
    total: Number(parsed.total) || list.length,
    list: list
      .filter((p) => Number(p.pid) > 4)
      .map((p) => ({
        pid: Number(p.pid),
        name: normalizeProcessName(p.name),
        cpu: round(p.cpu, 1),
        mem: Number(p.mem) || 0,
        memPct: null,
        path: ''
      }))
  };
}

async function getProcesses(sort, count) {
  const now = Date.now();
  if (!processCache || now - processCache.at > 850) {
    try {
      processCache = await fetchProcessesPowerShell();
    } catch {
      // Fall back to systeminformation if the perf counters are unavailable.
      try {
        const data = await si.processes();
        processCache = {
          at: now,
          total: data.all,
          list: (data.list || [])
            .filter((p) => p.pid > 4)
            .map((p) => ({
              pid: p.pid,
              name: p.name || 'Unknown',
              cpu: round(p.cpu, 1),
              mem: (Number(p.memRss) || 0) * 1024,
              memPct: round(p.mem, 1),
              path: p.path || ''
            }))
        };
      } catch {
        if (!processCache) throw new Error('Could not read process list');
      }
    }
  }

  const list = processCache.list
    .slice()
    .sort((a, b) => (sort === 'mem' ? b.mem - a.mem : b.cpu - a.cpu))
    .slice(0, Math.max(1, count));

  return { list, total: processCache.total, at: processCache.at };
}

function killProcess(pid) {
  return new Promise((resolve) => {
    const numeric = Number(pid);
    if (!Number.isInteger(numeric) || numeric <= 4) {
      resolve({ ok: false, error: 'Protected process' });
      return;
    }
    if (numeric === process.pid) {
      resolve({ ok: false, error: 'That is the island itself' });
      return;
    }
    const cached = processCache && processCache.list.find((p) => p.pid === numeric);
    if (cached) {
      const lower = cached.name.toLowerCase();
      const bare = lower.replace(/\.exe$/, '');
      if (PROTECTED_NAMES.has(lower) || PROTECTED_NAMES.has(bare)) {
        resolve({ ok: false, error: 'System-critical process' });
        return;
      }
    }
    execFile(
      'taskkill',
      ['/PID', String(numeric), '/F', '/T'],
      { windowsHide: true, timeout: 8000 },
      (error, stdout, stderr) => {
        processCache = null;
        if (error) {
          resolve({ ok: false, error: (stderr || error.message || 'Failed').trim().split('\n')[0] });
        } else {
          resolve({ ok: true });
        }
      }
    );
  });
}

/* ------------------------------------------------------------------ */
/* Quick launch                                                        */
/* ------------------------------------------------------------------ */

function splitArgs(value) {
  if (!value || typeof value !== 'string') return [];
  const parts = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = pattern.exec(value)) !== null) {
    parts.push(match[1] ?? match[2] ?? match[3]);
  }
  return parts;
}

function expandTarget(target) {
  if (typeof target !== 'string') return null;
  let value = target.trim().replace(/^"(.*)"$/, '$1');
  if (!value) return null;
  value = value.replace(/%([^%]+)%/g, (original, key) => process.env[key] ?? original);

  if (/^[a-z]+:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) return null;

  const candidates = [];
  if (path.isAbsolute(value)) {
    candidates.push(value);
  } else {
    const roots = [process.env.SystemRoot || 'C:\\Windows', path.dirname(process.env.SystemRoot || 'C:\\Windows')];
    for (const root of roots) {
      candidates.push(path.join(root, value));
      candidates.push(path.join(root, 'System32', value));
    }
    if (process.env.LOCALAPPDATA) {
      candidates.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', value));
    }
    if (process.env.ProgramFiles) {
      candidates.push(path.join(process.env.ProgramFiles, value));
    }
  }

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function isUri(target) {
  return /^(https?:|ms-[a-z0-9-]+:|shell:|mailto:|steam:)/i.test(target);
}

async function launchEntry(id) {
  const entry = store.data.quicklaunch.find((item) => item.id === id);
  if (!entry) return { ok: false, error: 'Quick-launch entry not found' };
  const target = (entry.target || '').trim();
  if (!target) return { ok: false, error: 'No target configured' };

  try {
    if (isUri(target)) {
      await shell.openExternal(target);
      return { ok: true };
    }

    const args = splitArgs(entry.args);
    const resolved = expandTarget(target);

    if (resolved) {
      const ext = path.extname(resolved).toLowerCase();
      if (['.exe', '.bat', '.cmd', '.lnk', '.com'].includes(ext)) {
        const child = spawn(resolved, args, { detached: true, stdio: 'ignore' });
        child.unref();
      } else {
        const message = await shell.openPath(resolved);
        if (message) return { ok: false, error: message };
      }
      return { ok: true };
    }

    const child = spawn(target, args, { detached: true, stdio: 'ignore', shell: true });
    child.unref();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function quickLaunchIcons() {
  const result = {};
  for (const entry of store.data.quicklaunch) {
    const target = (entry.target || '').trim();
    if (!target) continue;
    if (iconCache.has(target)) {
      result[entry.id] = iconCache.get(target);
      continue;
    }
    let data = null;
    const resolved = expandTarget(target);
    if (resolved) {
      try {
        const image = await app.getFileIcon(resolved, { size: 'normal' });
        if (image && !image.isEmpty()) data = image.toDataURL();
      } catch {
        data = null;
      }
    }
    iconCache.set(target, data);
    result[entry.id] = data;
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Tray, shortcuts, login item                                         */
/* ------------------------------------------------------------------ */

function trayImage() {
  const file = path.join(ASSETS, 'tray.png');
  if (fs.existsSync(file)) {
    const image = nativeImage.createFromPath(file);
    if (!image.isEmpty()) return image;
  }
  return nativeImage.createEmpty();
}

function refreshTrayMenu() {
  if (!tray) return;
  const visible = win && !win.isDestroyed() && win.isVisible();
  const menu = Menu.buildFromTemplate([
    {
      label: visible ? 'Hide island' : 'Show island',
      click: () => (visible ? hideWindow() : showWindow())
    },
    {
      label: isExpanded ? 'Collapse' : 'Expand',
      click: () => {
        showWindow();
        setExpanded(!isExpanded);
      }
    },
    {
      label: 'Reset position (screen center)',
      click: () => {
        store.data = store.save({
          ...store.data,
          position: { ...store.data.position, anchor: 'center' }
        });
        hiddenByUser = false;
        forceVisible = true;
        repositionForCurrentAnchor();
        applyVisibility();
        broadcastSettings();
      }
    },
    { type: 'separator' },
    {
      label: 'Always on top',
      type: 'checkbox',
      checked: store.data.behavior.alwaysOnTop,
      click: (item) => {
        store.data = store.save({ ...store.data, behavior: { ...store.data.behavior, alwaysOnTop: item.checked } });
        applyWindowSettings(true);
        broadcastSettings();
      }
    },
    {
      label: 'Battery saver',
      type: 'checkbox',
      checked: store.data.behavior.batterySaver,
      click: (item) => {
        const prev = store.data;
        store.data = store.save({ ...store.data, behavior: { ...store.data.behavior, batterySaver: item.checked } });
        applySettings(prev, store.data);
        broadcastSettings();
      }
    },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: store.data.behavior.startWithWindows,
      click: (item) => {
        store.data = store.save({ ...store.data, behavior: { ...store.data.behavior, startWithWindows: item.checked } });
        applyLoginItem();
        broadcastSettings();
      }
    },
    { type: 'separator' },
    {
      label: 'Notes\u2026',
      click: () => {
        showWindow();
        if (!isExpanded) setExpanded(true);
        win.webContents.send('ui:open-notes');
      }
    },
    {
      label: 'Settings\u2026',
      click: () => {
        showWindow();
        if (!isExpanded) setExpanded(true);
        win.webContents.send('ui:open-settings');
      }
    },
    {
      label: 'Quit',
      click: () => quitApp()
    }
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(isExpanded ? 'Floating Island \u2014 expanded' : 'Floating Island');
}

function createTray() {
  tray = new Tray(trayImage());
  tray.on('click', () => {
    if (!win) return;
    if (win.isVisible()) {
      hideWindow();
    } else {
      showWindow();
    }
  });
  refreshTrayMenu();
}

function registerShortcut() {
  globalShortcut.unregisterAll();
  const accelerator = store.data.behavior.shortcut || 'Ctrl+Alt+I';
  try {
    const ok = globalShortcut.register(accelerator, () => {
      if (!win) return;
      if (win.isVisible() && isExpanded) {
        setExpanded(false);
      } else if (win.isVisible() && !isExpanded) {
        setExpanded(true);
      } else {
        showWindow();
      }
    });
    return ok;
  } catch {
    return false;
  }
}

function applyLoginItem() {
  try {
    const enabled = store.data.behavior.startWithWindows;
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: process.execPath,
      args: app.isPackaged ? [] : [app.getAppPath()]
    });
  } catch {
    /* non-fatal */
  }
}

function applyWindowSettings(initial = false) {
  if (!win || win.isDestroyed()) return;
  const { alwaysOnTop, showInTaskbar } = store.data.behavior;
  win.setAlwaysOnTop(alwaysOnTop, 'screen-saver');
  if (process.platform === 'win32') win.setSkipTaskbar(!showInTaskbar);
  if (initial) {
    win.webContents.setZoomFactor(store.data.appearance.scale);
  }
}

function broadcastSettings() {
  if (win && !win.isDestroyed()) {
    win.webContents.send('settings:changed', store.data);
  }
  refreshTrayMenu();
}

function hideWindow() {
  if (!win || win.isDestroyed()) return;
  hiddenByUser = true;
  forceVisible = false;
  applyVisibility();
}

function showWindow() {
  if (!win || win.isDestroyed()) return;
  hiddenByUser = false;
  forceVisible = true;
  applyVisibility();
  if (win.isVisible()) {
    win.setAlwaysOnTop(store.data.behavior.alwaysOnTop, 'screen-saver');
  }
  refreshTrayMenu();
}

function quitApp() {
  if (isQuitting) return;
  const finish = () => {
    isQuitting = true;
    app.quit();
  };
  // Give the renderer a moment to persist unsaved notes/settings before the
  // process goes away. If it does not answer, quit anyway.
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ipcMain.removeListener('app:flush-done', done);
      finish();
    };
    const timer = setTimeout(done, 500);
    ipcMain.on('app:flush-done', done);
    win.webContents.send('ui:flush');
  } else {
    finish();
  }
}

/* ------------------------------------------------------------------ */
/* Apply settings delta                                                */
/* ------------------------------------------------------------------ */

function repositionForCurrentAnchor() {
  if (!win || win.isDestroyed()) return;
  const { w, h } = windowSizes(isExpanded);
  const area = primaryWorkArea();
  const anchor = store.data.position.anchor;
  let x;
  let y;
  if (anchor === 'free' && Number.isFinite(store.data.window.x)) {
    ({ x, y } = clampPosition(store.data.window.x, store.data.window.y ?? area.y, w, h));
  } else if (anchor === 'free') {
    ({ x, y } = clampPosition(win.getBounds().x, win.getBounds().y, w, h));
  } else {
    ({ x, y } = anchoredPosition(anchor, w, h));
  }
  animateBounds({ x, y, width: w, height: h }, 180);
}

async function applySettings(prev, next) {
  if (!win || win.isDestroyed()) return;

  if (!prev || prev.appearance.scale !== next.appearance.scale) {
    win.webContents.setZoomFactor(next.appearance.scale);
  }

  if (!prev || prev.behavior.alwaysOnTop !== next.behavior.alwaysOnTop) {
    win.setAlwaysOnTop(next.behavior.alwaysOnTop, 'screen-saver');
  }

  if (!prev || prev.behavior.showInTaskbar !== next.behavior.showInTaskbar) {
    if (process.platform === 'win32') win.setSkipTaskbar(!next.behavior.showInTaskbar);
  }

  if (!prev || prev.behavior.startWithWindows !== next.behavior.startWithWindows) {
    applyLoginItem();
  }

  if (!prev || prev.behavior.shortcut !== next.behavior.shortcut) {
    const ok = registerShortcut();
    if (!ok) {
      next.behavior.shortcut = prev ? prev.behavior.shortcut : store.data.behavior.shortcut;
      store.data = store.save(store.data);
      registerShortcut();
      win.webContents.send('ui:toast', { text: 'That shortcut is already in use', kind: 'error' });
    }
  }

  if (
    !prev ||
    prev.appearance.scale !== next.appearance.scale ||
    prev.position.anchor !== next.position.anchor
  ) {
    repositionForCurrentAnchor();
  }

  if (!prev || prev.metrics.gpuEnabled !== next.metrics.gpuEnabled) {
    gpuAvailable = null;
    gpuState = { pct: null, vram: null };
  }

  if (
    prev &&
    (prev.metrics.gpuEnabled !== next.metrics.gpuEnabled ||
      effectiveMonitorInterval(prev) !== effectiveMonitorInterval(next))
  ) {
    // The monitor emits at the chosen refresh rate, so restart it when the
    // effective rate (or GPU availability) changes.
    if (win.isVisible()) startMonitor();
    else stopMonitor();
  }

  if (prev && prev.behavior.batterySaver !== next.behavior.batterySaver) {
    // The desktop watcher polls less often in battery-saver mode.
    startDesktopWatcher();
  }

  if (
    !prev ||
    prev.metrics.interval !== next.metrics.interval ||
    prev.behavior.batterySaver !== next.behavior.batterySaver
  ) {
    scheduleStats();
  }

  refreshTrayMenu();
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */

function registerIpc() {
  ipcMain.handle('settings:get', () => store.data);

  ipcMain.handle('settings:save', async (_event, incoming) => {
    const prev = store.data;
    const next = store.save(incoming);
    await applySettings(prev, next);
    refreshTrayMenu();
    return next;
  });

  ipcMain.handle('settings:reset', async () => {
    const prev = store.data;
    const next = store.reset();
    await applySettings(prev, next);
    broadcastSettings();
    return next;
  });

  ipcMain.handle('settings:open-file', async () => {
    try {
      const result = await shell.openPath(store.file);
      if (result) {
        shell.showItemInFolder(store.file);
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('notes:get', async () => {
    try {
      return { text: fs.readFileSync(notesPath, 'utf8') };
    } catch {
      return { text: '' };
    }
  });

  ipcMain.handle('notes:save', async (_event, text) => {
    try {
      const value = typeof text === 'string' ? text : '';
      fs.mkdirSync(path.dirname(notesPath), { recursive: true });
      const tmp = `${notesPath}.tmp`;
      fs.writeFileSync(tmp, value, 'utf8');
      fs.renameSync(tmp, notesPath);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.on('clipboard:write', (_event, text) => {
    try {
      clipboard.writeText(typeof text === 'string' ? text : '');
    } catch {
      /* ignore */
    }
  });

  ipcMain.handle('dialog:pick-file', async () => {
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose a program to quick launch',
      properties: ['openFile'],
      filters: [
        { name: 'Programs', extensions: ['exe', 'bat', 'cmd', 'lnk', 'com'] },
        { name: 'All files', extensions: ['*'] }
      ]
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.on('island:set-expanded', (_event, value) => {
    setExpanded(value);
  });

  ipcMain.handle('processes:get', async (_event, options) => {
    const sort = options && options.sort === 'mem' ? 'mem' : 'cpu';
    const count = Math.max(3, Math.min(20, Number(options && options.count) || 8));
    try {
      return await getProcesses(sort, count);
    } catch (error) {
      return { list: [], total: 0, error: error.message };
    }
  });

  ipcMain.handle('process:kill', (_event, pid) => killProcess(pid));

  ipcMain.handle('quicklaunch:run', (_event, id) => launchEntry(id));

  ipcMain.handle('quicklaunch:icons', () => quickLaunchIcons());

  ipcMain.on('window:drag-start', (_event, x, y) => {
    if (!win || win.isDestroyed()) return;
    if (store.data.behavior.lockPosition) return;
    if (boundsAnimation) {
      clearInterval(boundsAnimation);
      boundsAnimation = null;
    }
    const [wx, wy] = win.getPosition();
    // Snap to the intended size so an interrupted animation can never resize the island mid-drag.
    const { w, h } = windowSizes(isExpanded);
    win.setBounds({ x: wx, y: wy, width: w, height: h });
    dragOrigin = { mouseX: Math.round(x), mouseY: Math.round(y), winX: wx, winY: wy };
  });

  ipcMain.on('window:drag-move', (_event, x, y) => {
    if (!win || win.isDestroyed() || !dragOrigin) return;
    const targetX = dragOrigin.winX + Math.round(x) - dragOrigin.mouseX;
    const targetY = dragOrigin.winY + Math.round(y) - dragOrigin.mouseY;
    const { w, h } = windowSizes(isExpanded);
    const clamped = clampPosition(targetX, targetY, w, h);
    win.setPosition(clamped.x, clamped.y);
  });

  ipcMain.on('window:drag-end', () => {
    if (!win || win.isDestroyed() || !dragOrigin) return;
    dragOrigin = null;
    const [x, y] = win.getPosition();
    const next = JSON.parse(JSON.stringify(store.data));
    next.position.anchor = 'free';
    next.window = { x, y };
    store.data = store.save(next);
    broadcastSettings();
  });

  ipcMain.on('app:quit', () => quitApp());

  ipcMain.on('app:hide', () => {
    hideWindow();
  });

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    settingsPath: store.file
  }));
}

/* ------------------------------------------------------------------ */
/* App lifecycle                                                       */
/* ------------------------------------------------------------------ */

function watchSettingsFile() {
  try {
    fs.watch(store.file, { persistent: false }, () => {
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => {
        if (Date.now() - store.lastSaveAt < 700) return;
        const prev = store.data;
        // Only apply a fully valid file. A partial write from an editor or
        // another process must never reset the running settings to defaults.
        const next = store.read();
        if (!next) return;
        store.data = next;
        applySettings(prev, next);
        broadcastSettings();
      }, 250);
    });
  } catch {
    /* watcher is optional */
  }
}

function createWindow() {
  const expanded = store.data.behavior.startExpanded;
  const bounds = initialBounds(expanded);
  isExpanded = expanded;

  win = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: !store.data.behavior.showInTaskbar,
    alwaysOnTop: store.data.behavior.alwaysOnTop,
    icon: path.join(ASSETS, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false
    }
  });

  win.setAlwaysOnTop(store.data.behavior.alwaysOnTop, 'screen-saver');
  win.loadFile(path.join(__dirname, 'index.html'));

  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomFactor(store.data.appearance.scale);
    win.webContents.send('island:state', { expanded: isExpanded });
  });

  win.once('ready-to-show', () => {
    applyVisibility();
    refreshTrayMenu();
  });

  win.on('show', refreshTrayMenu);
  win.on('hide', refreshTrayMenu);
  win.on('closed', () => {
    win = null;
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function boot() {
  store = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'));
  notesPath = path.join(app.getPath('userData'), 'notes.txt');
  registerIpc();
  createWindow();
  createTray();
  applyWindowSettings(true);
  applyLoginItem();
  registerShortcut();
  loadGpuName();
  startMonitor();
  startDesktopWatcher();
  scheduleStats();
  watchSettingsFile();

  screen.on('display-metrics-changed', () => {
    if (store.data.position.anchor !== 'free') repositionForCurrentAnchor();
  });
  screen.on('display-added', () => {
    if (store.data.position.anchor !== 'free') repositionForCurrentAnchor();
  });
  screen.on('display-removed', () => {
    if (store.data.position.anchor !== 'free') repositionForCurrentAnchor();
  });

  if (store.data.behavior.startWithWindows !== app.getLoginItemSettings().openAtLogin) {
    applyLoginItem();
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showWindow();
    if (win) win.focus();
  });

  app.whenReady().then(boot);

  app.on('window-all-closed', () => {
    /* keep running in the tray */
  });

  app.on('activate', () => {
    if (!win) createWindow();
    showWindow();
  });

  app.on('before-quit', () => {
    isQuitting = true;
    if (statsTimer) clearTimeout(statsTimer);
    stopMonitor();
    stopDesktopWatcher();
    globalShortcut.unregisterAll();
  });
}
