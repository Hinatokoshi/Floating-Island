# Floating Island

A customizable, always-on-top system monitor for Windows. A compact, borderless capsule sits in
the taskbar (bottom-left by default) showing CPU, GPU, RAM and network activity. Click it to
unfold a glass panel with live performance graphs, a mini task manager and quick-launch tiles.

Everything is customizable from the in-app **Settings** tab or by editing `settings.json`.

## Requirements

- Windows 10/11
- Node.js (already installed on this machine at `C:\Program Files\nodejs`)

## Run

```powershell
cd floating-island
$env:Path = "$env:ProgramFiles\nodejs;$env:Path"
npm install
npm start
```

`npm install` downloads Electron (~100 MB) once.

For everyday use, double-click **`Floating Island.vbs`** (or the **Floating Island** shortcut in the
Start Menu or on the desktop). It starts the app silently with no console window.

## Controls

| Action | How |
| --- | --- |
| Expand | Click the capsule (or the chevron) |
| Collapse | Click again, or move the pointer off the panel |
| Move the island | Drag the capsule; it switches to free position |
| Pin it in place | Settings → Position & behavior → **Lock position** |
| Show / hide | Tray icon, or `Ctrl+Alt+I` |
| Quit | Tray menu, or the power button in the panel footer |

The island expands when you click it and collapses automatically once the pointer leaves the
expanded panel, so it never lingers over your work. While a fullscreen app is running, or while
the Windows taskbar is hidden (including auto-hide), the island hides itself and returns when you
are back on the desktop.

If you activate **Start with Windows**, the app launches at login.

## Settings

Open the **Settings** tab (gear icon) in the expanded panel:

- **Appearance** — accent color, glass opacity, blur, theme (dark/light/auto), corner radius, UI scale, glow and border.
- **Position & behavior** — anchor the island to the top-left / top-center / top-right, the
  taskbar (bottom-left / bottom-center / bottom-right), or free position. Also launch expanded or
  collapsed, always on top, taskbar visibility, start with Windows, global shortcut, hover preview,
  and **Lock position** to prevent accidental dragging. The collapsed capsule is borderless and
  sized to fit inside the taskbar; dragging never expands it.
- **Metrics** — show/hide and reorder CPU, GPU, RAM and network in the capsule; refresh interval
  (0.1, 0.25, 0.5, 1 or 5 seconds; default **0.1 seconds / 10× per second**); GPU counters on/off;
  Mbps or MB/s; sparklines.
- **Panel** — which tabs appear, number of processes, process refresh rate, confirm before ending a task, session totals.
- **Quick launch** — add, edit, reorder and remove entries. Targets can be an `.exe`, a folder, a URL or a Windows URI such as `ms-settings:`. Icons are pulled from the executable; emoji is used as a fallback.

Settings are stored in `%APPDATA%\Floating Island\settings.json` and hot-reload: edit the file
and the island updates without a restart. Use **Open settings file** in the panel to jump to it,
and **Reset to defaults** to start over.

## Notes

- GPU usage comes from Windows performance counters (`GPU Engine`). It closely matches Task
  Manager but is not vendor-specific. The Windows counters themselves refresh about once per
  second, so GPU/VRAM figures can look steadier than CPU, RAM and network at the 0.1 s interval.
  Newly active GPU engines are discovered within a couple of seconds. If counters are unavailable,
  GPU shows `--`.
- The 10×/second refresh is handled by a single background PowerShell monitor for GPU, VRAM and
  network, plus direct OS sampling for CPU and RAM. It costs roughly 0.5–1% of total CPU on a
  modern multi-core machine.
- A second, lightweight background watcher reports when a fullscreen app is in front or when the
  taskbar is hidden, so the island can step out of the way automatically.
- The network card mirrors Task Manager: large Receive/Send readouts, an auto-scaled 60-second
  area graph for both directions, and the active adapter with its link speed.
- The task manager lists the top processes with CPU and memory figures from Windows performance
  counters (matching Task Manager closely) and can end them with `taskkill`. System-critical
  processes are refused.
- Everything runs locally; no data leaves the machine.
