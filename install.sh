#!/usr/bin/env bash
#
# Floating Island - installer
#
# Installs the Floating Island system monitor. Works three ways:
#
#   1. From a local checkout (recommended):
#        ./install.sh
#
#   2. From the project root:
#        bash floating-island/install.sh
#
#   3. As a one-liner (no clone needed):
#        curl -fsSL https://raw.githubusercontent.com/USER/FunkyEh/main/floating-island/install.sh | bash
#
# It checks for Node.js, then runs `npm install` inside the app folder.
# On Windows it also drops a "Floating Island" shortcut on your desktop.
#
# Options:
#   --start           Launch the island once the install finishes.
#   --no-shortcut     Do not create a desktop shortcut on Windows.
#   --dir <path>      Where to download the project when not run from a checkout.
#   --ref <branch>    Git branch/tag to install (default: main).
#   -h, --help        Show this help.
#
# Environment overrides (handy when piping the script):
#   FLOATING_ISLAND_REPO      Git clone URL
#   FLOATING_ISLAND_ARCHIVE   Tarball URL (used when git is missing)
#   FLOATING_ISLAND_REF       Branch/tag name
#   FLOATING_ISLAND_DIR       Download destination
#   FLOATING_ISLAND_APP_DIR   Use this existing app folder, skip detection
#   FLOATING_ISLAND_START=1   Same as --start
#   FLOATING_ISLAND_SHORTCUT=0  Same as --no-shortcut
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration - replace USER/FunkyEh with your real repository.
# ---------------------------------------------------------------------------
REPO_URL="${FLOATING_ISLAND_REPO:-https://github.com/USER/FunkyEh.git}"
REPO_ARCHIVE="${FLOATING_ISLAND_ARCHIVE:-https://github.com/USER/FunkyEh/archive/refs/heads/main.tar.gz}"
REPO_REF="${FLOATING_ISLAND_REF:-main}"

APP_SUBDIR="floating-island"
DEFAULT_DIR="${HOME:-.}/.floating-island"

# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------
say()  { printf '  %s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }

is_windows() {
  case "$(uname -s 2>/dev/null || echo unknown)" in
    MINGW*|MSYS*|CYGWIN*) return 0 ;;
    *) return 1 ;;
  esac
}

# POSIX <-> Windows path conversion (no-ops when cygpath is unavailable).
to_posix_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -u "$1" 2>/dev/null || printf '%s' "$1"
  else
    printf '%s' "$1"
  fi
}

to_windows_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$1" 2>/dev/null || printf '%s' "$1"
  else
    printf '%s' "$1"
  fi
}

# ---------------------------------------------------------------------------
# Command line
# ---------------------------------------------------------------------------
DO_START="${FLOATING_ISLAND_START:-0}"
DO_SHORTCUT="${FLOATING_ISLAND_SHORTCUT:-1}"

while [ $# -gt 0 ]; do
  case "$1" in
    --start) DO_START=1 ;;
    --no-shortcut) DO_SHORTCUT=0 ;;
    --dir)   [ $# -ge 2 ] || die "--dir needs a path"; DEFAULT_DIR="$2"; shift ;;
    --ref)   [ $# -ge 2 ] || die "--ref needs a branch"; REPO_REF="$2"; shift ;;
    -h|--help)
      if [ -f "$0" ]; then
        awk 'NR==1{next} /^#/{sub(/^# ?/,""); print; next} {exit}' "$0"
      else
        printf 'Floating Island installer. See the comments at the top of install.sh.\n'
      fi
      exit 0
      ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
  shift
done

# ---------------------------------------------------------------------------
# 1. Node.js
# ---------------------------------------------------------------------------
ensure_node() {
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    return 0
  fi

  # Common Windows install locations, in case Node is not on the PATH yet.
  local dirs=()
  dirs+=("/c/Program Files/nodejs")
  dirs+=("/c/Program Files (x86)/nodejs")
  [ -n "${PROGRAMFILES:-}" ] && dirs+=("$(to_posix_path "$PROGRAMFILES")/nodejs")
  [ -n "${LOCALAPPDATA:-}" ] && dirs+=("$(to_posix_path "$LOCALAPPDATA")/Programs/nodejs")
  [ -n "${APPDATA:-}" ] && dirs+=("$(to_posix_path "$APPDATA")/nvm")
  [ -n "${NVM_HOME:-}" ] && dirs+=("$(to_posix_path "$NVM_HOME")")
  [ -n "${NVM_SYMLINK:-}" ] && dirs+=("$(to_posix_path "$NVM_SYMLINK")")

  local d
  for d in "${dirs[@]}"; do
    if [ -x "$d/node" ] || [ -x "$d/node.exe" ] || [ -x "$d/npm" ] || [ -x "$d/npm.cmd" ]; then
      case ":$PATH:" in
        *":$d:"*) ;;
        *) PATH="$d:$PATH"; export PATH ;;
      esac
    fi
    if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
      return 0
    fi
  done

  return 1
}

step "Checking for Node.js"
if ! ensure_node; then
  die "Node.js was not found.

Install the LTS build from https://nodejs.org/ (the default options are fine),
then open a new terminal and run this installer again."
fi
say "node $(node --version)  |  npm $(npm --version)"

# ---------------------------------------------------------------------------
# 2. Locate the app, or download it
# ---------------------------------------------------------------------------
SCRIPT_SOURCE="${BASH_SOURCE[0]:-}"
SCRIPT_DIR=""
if [ -n "$SCRIPT_SOURCE" ] && [ -f "$SCRIPT_SOURCE" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_SOURCE")" >/dev/null 2>&1 && pwd)"
fi

find_local_app() {
  local candidates=()
  [ -n "${FLOATING_ISLAND_APP_DIR:-}" ] && candidates+=("$FLOATING_ISLAND_APP_DIR")
  [ -n "$SCRIPT_DIR" ] && candidates+=("$SCRIPT_DIR" "$SCRIPT_DIR/$APP_SUBDIR")
  candidates+=("$PWD/$APP_SUBDIR" "$PWD")

  local dir
  for dir in "${candidates[@]}"; do
    if [ -f "$dir/package.json" ] && grep -q '"floating-island"' "$dir/package.json" 2>/dev/null; then
      printf '%s\n' "$dir"
      return 0
    fi
  done
  return 1
}

download_app() {
  local dest="$1"
  rm -rf "$dest"
  mkdir -p "$dest"

  if command -v git >/dev/null 2>&1; then
    # Try the requested branch, then "master" when the default "main" is absent,
    # so the installer also works against repos that still use master.
    local refs=("$REPO_REF")
    if [ "$REPO_REF" = "main" ]; then refs+=("master"); fi
    local ref
    for ref in "${refs[@]}"; do
      say "git clone --depth 1 --branch $ref $REPO_URL"
      if git clone --depth 1 --branch "$ref" "$REPO_URL" "$dest" 2>/dev/null; then
        return 0
      fi
      rm -rf "$dest"
      mkdir -p "$dest"
    done
    die "could not clone $REPO_URL (tried branch: ${refs[*]})"
  fi

  if command -v curl >/dev/null 2>&1 && command -v tar >/dev/null 2>&1; then
    local tmp
    tmp="$(mktemp -d)"
    say "Downloading $REPO_ARCHIVE"
    curl -fsSL "$REPO_ARCHIVE" | tar -xz -C "$tmp"
    local inner
    inner="$(find "$tmp" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
    [ -n "$inner" ] || die "the downloaded archive was empty"
    mv "$inner" "$dest"
    rm -rf "$tmp"
    return 0
  fi

  die "need git, or curl and tar, to download the project"
}

if APP_DIR="$(find_local_app)"; then
  step "Found an existing checkout"
  say "$APP_DIR"
else
  step "Downloading Floating Island"
  REPO_DIR="${FLOATING_ISLAND_DIR:-$DEFAULT_DIR}"
  download_app "$REPO_DIR"
  if [ -f "$REPO_DIR/$APP_SUBDIR/package.json" ]; then
    APP_DIR="$REPO_DIR/$APP_SUBDIR"
  elif [ -f "$REPO_DIR/package.json" ]; then
    APP_DIR="$REPO_DIR"
  else
    die "could not find package.json in the downloaded project"
  fi
  say "Installed to $APP_DIR"
fi

# ---------------------------------------------------------------------------
# 3. Dependencies
# ---------------------------------------------------------------------------
step "Installing dependencies"
say "The first run downloads Electron (~100 MB)."
( cd "$APP_DIR" && npm install --no-audit --no-fund )

# ---------------------------------------------------------------------------
# 4. Windows desktop shortcut (best effort)
# ---------------------------------------------------------------------------
create_windows_shortcut() {
  local app="$1"
  is_windows || return 0
  command -v powershell >/dev/null 2>&1 || return 0

  local vbs="$app/Floating Island.vbs"
  [ -f "$vbs" ] || return 0

  local icon="$app/assets/icon.ico"
  [ -f "$icon" ] || icon="$app/node_modules/electron/dist/electron.exe"

  FI_VBS="$(to_windows_path "$vbs")" \
  FI_DIR="$(to_windows_path "$app")" \
  FI_ICON="$(to_windows_path "$icon")" \
  powershell -NoProfile -ExecutionPolicy Bypass -Command - >/dev/null 2>&1 <<'PS' || return 0
$ws = New-Object -ComObject WScript.Shell
$lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Floating Island.lnk'
$s = $ws.CreateShortcut($lnk)
$s.TargetPath = 'wscript.exe'
$s.Arguments = '"' + $env:FI_VBS + '"'
$s.WorkingDirectory = $env:FI_DIR
$s.IconLocation = $env:FI_ICON
$s.Description = 'Floating Island system monitor'
$s.Save()
PS
  say "Created a desktop shortcut."
}

step "Finishing up"
if [ "$DO_SHORTCUT" = "1" ]; then
  create_windows_shortcut "$APP_DIR"
else
  say "Skipping the desktop shortcut (--no-shortcut)."
fi

# ---------------------------------------------------------------------------
# 5. Done (optionally launch)
# ---------------------------------------------------------------------------
launch_app() {
  local app="$1"
  if is_windows && [ -f "$app/Floating Island.vbs" ]; then
    ( cd "$app" && MSYS_NO_PATHCONV=1 cmd.exe /c start "" wscript.exe "Floating Island.vbs" ) >/dev/null 2>&1 || true
    return 0
  fi
  ( cd "$app" && npm start ) >/dev/null 2>&1 &
}

if [ "$DO_START" = "1" ]; then
  step "Starting Floating Island"
  launch_app "$APP_DIR"
  say "It may take a few seconds to appear."
fi

printf '\n'
say "Done. Floating Island is ready in:"
say "  $APP_DIR"
printf '\n'
say "To run it later:"
if is_windows; then
  say "  double-click \"Floating Island.vbs\" (or the desktop shortcut)"
else
  say "  cd \"$APP_DIR\" && npm start"
fi
if [ "$DO_START" != "1" ]; then
  say ""
  say "Tip: re-run with --start to launch it now."
fi
