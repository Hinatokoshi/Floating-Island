# ---------------------------------------------------------------------------
# Floating Island - desktop state watcher
#
# Emits one JSON object whenever the desktop state changes:
#   { fullscreen: <bool>, taskbarHidden: <bool> }
#
# fullscreen    - a fullscreen / presentation-mode app is in the foreground
#                 (SHQueryUserNotificationState reports BUSY / D3D_FULL_SCREEN /
#                  PRESENTATION_MODE), or the foreground window covers the
#                  whole primary monitor.
# taskbarHidden - the shell taskbar is not available: explorer is not running
#                 or the tray window is hidden. A taskbar that is merely set to
#                 auto-hide still counts as present, so it does not hide the
#                 island (the island can sit above the collapsed taskbar).
#
# The island hides itself while either flag is true.
# ---------------------------------------------------------------------------

param([int]$Interval = 400)

$ErrorActionPreference = 'SilentlyContinue'

$typeDefinition = @'
using System;
using System.Runtime.InteropServices;

namespace Island {
public static class DesktopState {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

  [StructLayout(LayoutKind.Sequential)]
  public struct APPBARDATA {
    public int cbSize;
    public IntPtr hWnd;
    public uint uCallbackMessage;
    public uint uEdge;
    public RECT rc;
    public IntPtr lParam;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct MONITORINFO {
    public int cbSize;
    public RECT rcMonitor;
    public RECT rcWork;
    public uint dwFlags;
  }

  [DllImport("shell32.dll")]
  public static extern int SHQueryUserNotificationState(out int state);

  [DllImport("shell32.dll", SetLastError = true)]
  public static extern IntPtr SHAppBarMessage(uint dwMessage, ref APPBARDATA pData);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

  [DllImport("user32.dll")]
  public static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);

  [DllImport("user32.dll")]
  public static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

  // ABM_GETSTATE returns ABS_AUTOHIDE (1) | ABS_ALWAYSONTOP (2).
  public static int AppBarState() {
    APPBARDATA data = new APPBARDATA();
    data.cbSize = Marshal.SizeOf(typeof(APPBARDATA));
    return (int)SHAppBarMessage(0x00000004, ref data);
  }

  // The state is returned through an out-parameter (the return value is an HRESULT).
  public static int UserNotificationState() {
    int state = 5;
    SHQueryUserNotificationState(out state);
    return state;
  }

  // True when the foreground window covers its entire monitor.
  public static bool ForegroundIsFullscreen() {
    IntPtr hwnd = GetForegroundWindow();
    if (hwnd == IntPtr.Zero) return false;
    RECT rect;
    if (!GetWindowRect(hwnd, out rect)) return false;
    if (rect.Right - rect.Left <= 0 || rect.Bottom - rect.Top <= 0) return false;

    IntPtr monitor = MonitorFromWindow(hwnd, 0x00000002 /* MONITOR_DEFAULTTONEAREST */);
    if (monitor == IntPtr.Zero) return false;
    MONITORINFO info = new MONITORINFO();
    info.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
    if (!GetMonitorInfo(monitor, ref info)) return false;

    return rect.Left <= info.rcMonitor.Left &&
           rect.Top <= info.rcMonitor.Top &&
           rect.Right >= info.rcMonitor.Right &&
           rect.Bottom >= info.rcMonitor.Bottom;
  }
}
}
'@

Add-Type -TypeDefinition $typeDefinition -Language CSharp

function Get-DesktopState {
  $quns = 5
  try { $quns = [Island.DesktopState]::UserNotificationState() } catch { $quns = 5 }
  # 2 = BUSY (fullscreen app / presentation), 3 = D3D fullscreen, 4 = presentation mode.
  $fullscreen = ($quns -eq 2) -or ($quns -eq 3) -or ($quns -eq 4)
  if (-not $fullscreen) {
    try { $fullscreen = [Island.DesktopState]::ForegroundIsFullscreen() } catch { }
  }

  $taskbarHidden = $false
  try {
    $tray = [Island.DesktopState]::FindWindow('Shell_TrayWnd', $null)
    if ($tray -eq [IntPtr]::Zero) {
      $taskbarHidden = $true
    } elseif (-not [Island.DesktopState]::IsWindowVisible($tray)) {
      $taskbarHidden = $true
    }
  } catch {
    $taskbarHidden = $false
  }

  return [ordered]@{
    fullscreen    = [bool]$fullscreen
    taskbarHidden = [bool]$taskbarHidden
  }
}

$last = ''

while ($true) {
  $payload = Get-DesktopState
  $json = $payload | ConvertTo-Json -Compress
  if ($json -ne $last) {
    $last = $json
    [Console]::Out.WriteLine($json)
    [Console]::Out.Flush()
  }
  Start-Sleep -Milliseconds $Interval
}
