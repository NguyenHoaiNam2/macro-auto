# Macro Auto (Smart Macro Studio)
> **Enterprise Desktop Visual RPA & Automation Engine for Windows**  
> *Built on Electron 44, React 19, TypeScript, Vite 8, Tailwind CSS v4, and Native Win32 C-APIs (Koffi & uiohook-napi).*

[![Platform](https://img.shields.io/badge/Platform-Windows%20x64-blue.svg)](https://microsoft.com/windows)
[![Electron](https://img.shields.io/badge/Electron-44.4.5-47848F.svg)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19.0.1-61DAFB.svg)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0.2-3178C6.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-green.svg)](LICENSE)

---

## 1. Executive Overview

**Macro Auto (Smart Macro Studio)** is a next-generation enterprise desktop Robotic Process Automation (RPA) engine designed specifically for Windows environments. Unlike traditional macro tools that rely on fragile, static coordinate playback (*Blind Coordinate Replay*) and arbitrary fixed sleep pauses (*Hardcoded Delays*), Macro Auto executes a complete paradigm shift toward **Intelligent Visual RPA**:

- 👁️ **See:** Captures and identifies target UI elements dynamically via visual screen anchors (**Visual Anchor**) at the exact point of user interaction.
- ⏳ **Wait:** Operates a non-blocking polling engine (**Smart Wait**) that adapts dynamically to variable network latency, slow database queries, and heavy enterprise ERP/CRM load (configurable timeout up to 5 minutes).
- 🛡️ **Watch:** Deploys a **Multi-Watchdog Interleaved Scanner** to intercept unexpected error dialogs, session timeouts (*"Session Expired"*, *"Conflict Detected"*), and modal interruptions before transmitting keystrokes, safeguarding enterprise data integrity.
- 🩹 **Heal:** Empowers operators with **On-the-fly Patching (`F8`)**, enabling instant recording and splicing of remediation steps right at the failure point without restarting workflows from scratch.
- 🔤 **Native Unicode & Vietnamese Typing:** Direct Windows API integration using `SendInput` with `KEYEVENTF_UNICODE`, bypassing virtual key mapping and delivering 100% reliable input for accented characters, symbols, and emoji.
- 📐 **Euclidean Spatial Disambiguation:** Eliminates false positives on monochromatic surfaces (such as dark borders or flat toolbars) by combining visual confidence with Euclidean distance weighting relative to original recorded coordinates.

---

## 2. The Ponytail Doctrine (Design Philosophy)

The codebase strictly adheres to the **"Lazy Senior Developer"** philosophy documented in `.github/ponytail.md`:

1. **Zero Native Build Hell (Strict "No OpenCV" Constraint):**
   - Heavy C++ wrappers such as `opencv4nodejs` or `robotjs` are strictly forbidden. This eliminates fragile `node-gyp` toolchains, C++ ABI mismatch crashes across Electron/V8 updates, and bundle bloat.
2. **Ultra-Fast Native Win32 Screen Capture via Koffi C-FFI:**
   - Leverages high-performance C-FFI to call Win32 GDI APIs directly (`user32.dll`, `gdi32.dll`): `GetDC`, `CreateCompatibleDC`, `CreateCompatibleBitmap`, `BitBlt`, `GetDIBits`.
   - Full-screen capture completes in **3ms – 8ms** with **< 1% CPU utilization** and zero external binary dependencies.
3. **Pure JavaScript / TypedArray SAD Template Matching:**
   - Two-phase template matching implemented on raw `Uint8Array` grayscale buffers (Phase 1: Coarse 2px step with early diff threshold pruning; Phase 2: Fine $\pm 2\text{px}$ neighborhood search). Pure mathematics, zero external image libraries.
4. **Minimalistic Footprint (Boring over Clever):**
   - Single JSON file persistence (`v1.1`), minimal abstraction layers, smallest working diffs, and root-cause fixes across all layers.

---

## 3. Core Features

### 3.1. Visual Anchor & Hard Coordinate Override
- During recording, every `mousedown` event automatically crops a $120 \times 40$ pixel image centered at the cursor, compresses it to Base64 PNG, and computes normalized relative click offsets (`relativeClickOffset: { xPercent, yPercent }`).
- Stores recorded coordinates (`origX`, `origY`) for spatial candidate disambiguation.
- **Hard Coordinate Override:** Preserves the exact recorded pixel coordinates. The visual match acts purely as a safety timing trigger (*Visual Timing Trigger*), eliminating cumulative estimation drift.

### 3.2. Smart Wait (Non-Blocking Dynamic Polling)
- During playback of steps with a `visualAnchor`, the engine polls the screen every `pollIntervalMs` (default: 500ms).
- When the element appears with matching confidence ($\ge 85\%$), the engine computes the real-time screen position and executes the click.
- If the element is not found within `timeoutMs` (default: 5 minutes), the engine transitions smoothly to `PAUSED_AWAITING_USER` for operator intervention.

### 3.3. Multi-Watchdog Interleaved Scanner
- **Single-Capture, Multi-Match Pattern:** Captures the virtual screen once per cycle and evaluates the raw pixel buffer against both the current step anchor and all active `WatchdogRule` templates.
- **Pre-Flight Keystroke Guard:** Before dispatching any keyboard action (`keypress`, `type_text`), the engine runs a rapid pre-flight screen check. If an unexpected modal or alert dialog is detected:
  - Keystrokes are completely withheld.
  - An audible alert sounds.
  - The engine enters `PAUSED_AWAITING_USER` with the specific watchdog rule name reported.

### 3.4. On-the-fly Patching (`F8`)
- When a workflow pauses due to a timeout or watchdog trigger, the operator manually clears the blocking modal or takes remedial action, then presses **`F8`**.
- The engine records the user's corrective steps and automatically splices them directly into the macro at `pausedStepIndex`, auto-saves to disk, and resumes execution seamlessly upon pressing **`F9`**.

### 3.5. Native Unicode & Vietnamese Typing
- Replaces legacy ANSI `VkKeyScanA` mappings that fail on Unicode and Vietnamese characters (`ă, â, đ, ê, ô, ơ, ư`).
- Employs a 40-byte Win32 `INPUT` union over `SendInput` with `KEYEVENTF_UNICODE` (`0x0004`), feeding UTF-16 code units directly into the `wScan` field (`wVk = 0`).
- Guarantees 100% accurate typing of multilingual text, diacritics, and emoji across all desktop applications without keyboard layout dependency.

### 3.6. Monochromatic False Positive Elimination (Euclidean Selection)
- When matching templates on uniform, low-entropy regions (such as black borders or solid application headers), the matcher avoids early breaking on the first zero-difference pixel.
- Collects all visually qualified candidates satisfying the confidence threshold and evaluates Euclidean spatial proximity:
  $$\text{dist} = \text{Math.hypot}(\text{matchX} - \text{origX}, \text{matchY} - \text{origY})$$
- Sorts candidates to select the region that is visually matched AND closest to the original recorded interaction coordinate, preventing erroneous jumps to screen corners `(0, 0)`.

### 3.7. Glassmorphism Mini HUD & Multitasking Playlist
- Compact 450px wide floating HUD designed with dark glassmorphism styling (`neutral-950/95`).
- Displays live execution status: state badge, step progress, real-time thumbnail preview of the active `VisualAnchor`, and countdown clock during Smart Wait.
- Features a standalone multi-tasking Playlist popup window for managing and executing sequential macro queues.

### 3.8. Zero-Bypass DevTools Lockdown
- Full security isolation: `contextIsolation: true`, `nodeIntegration: false`.
- Global lockdown intercepts developer shortcut vectors (`F12`, `Ctrl+Shift+I/C/J`) across all `WebContents` instances, preventing unauthorized runtime tampering.

---

## 4. Global Hotkeys Reference

| Hotkey | Active State | Triggered Action |
| :--- | :--- | :--- |
| **`F8`** | `IDLE` | **Start Recording:** Begins global input hooking for mouse, keyboard, and scroll. |
| **`F8`** | `RECORDING` | **Stop Recording:** Finalizes workflow, persists to file, and returns to `IDLE`. |
| **`F8`** | `PAUSED_AWAITING_USER` | **Start Patch Recording:** Captures remediation steps to fix workflow disruptions. |
| **`F8`** | `RECORDING_PATCH` | **Finish Patching:** Splices patch steps into workflow at pause index and saves file. |
| **`Shift + F8`** | `PAUSED_AWAITING_USER` | **Teach Watchdog:** Captures area under mouse cursor to create a new Watchdog Rule. |
| **`F3`** | Any | **Play / Loop Macro:** Executes workflow under selected loop mode (`Once`, `Infinite`, `Count`). |
| **`F9`** | `PLAYING` | **Emergency Pause:** Freezes execution immediately at current step index. |
| **`F9`** | `PAUSED_AWAITING_USER` | **Resume Execution:** Resumes playback from the paused or patched step. |

---

## 5. Project Directory Structure

```
smart-macro-studio/
├── .github/
│   ├── copilot-instructions.md     # Architectural constraints & coding standards
│   └── ponytail.md                 # The "Ponytail - Lazy Senior Dev" manifesto
├── electron/
│   ├── main.cjs                    # Main process: Lifecycle, Hotkeys, Secure IPC, DevTools lockdown
│   ├── native-automation.cjs       # Win32 core: GDI capture, Pure-JS SAD matcher, SendInput Unicode
│   └── preload.cjs                 # Secure IPC bridge (ContextBridge exposing window.macroAPI)
├── src/
│   ├── components/
│   │   ├── FloatingMiniMenu.tsx    # Compact 450px dark glassmorphism floating HUD
│   │   └── PlaylistWindow.tsx      # Multi-tasking standalone playlist popup window
│   ├── engine/
│   │   └── stateMachine.ts         # Finite state machine (IDLE, RECORDING, PLAYING, PATCHING...)
│   ├── types/
│   │   ├── electron.d.ts           # TypeScript definitions for macroAPI IPC bridge
│   │   └── macro.ts                # TypeScript schema v1.1 for MacroFile, MacroStep, VisualAnchor
│   ├── App.tsx                     # Main renderer coordinator: Smart Wait & Watchdog loops
│   ├── index.css                   # Tailwind CSS v4 definitions & glassmorphism theme
│   └── main.tsx                    # React application entry point
├── scripts/
│   ├── check-watchdogs.cjs         # Standalone test runner for Watchdog detection
│   ├── check-webui-fixes.cjs       # Standalone test runner for Visual Anchor & Euclidean Matcher
│   ├── dev-desktop.cjs             # Integrated dev runner (Vite + Electron live reload)
│   └── launch-desktop.cjs          # Launcher running Electron against dist output
├── index.html                      # Vite HTML entry point
├── package.json                    # Dependencies, prepackage auto-versioning & NSIS builder config
├── tsconfig.json                   # TypeScript compiler configuration
└── vite.config.ts                  # Vite build and asset pipeline configuration
```

---

## 6. Macro JSON Schema Specification (v1.1)

Macro workflows are persisted as self-contained, human-readable `.json` files:

```json
{
  "version": "1.1",
  "name": "ERP_Data_Entry_Workflow",
  "createdAt": "2026-10-05T08:00:00.000Z",
  "updatedAt": "2026-10-05T08:15:00.000Z",
  "metadata": {
    "totalSteps": 12,
    "durationMs": 45000,
    "targetApplication": "ERP Web Portal",
    "osPlatform": "win32",
    "watchdogs": [
      {
        "id": "wd-session-expired",
        "name": "Session Expired Modal",
        "enabled": true,
        "visualAnchor": {
          "templateBase64": "iVBORw0KGgoAAAANSUhEUgAAAHgAAAAoCAY...",
          "width": 120,
          "height": 40,
          "confidenceThreshold": 0.85
        },
        "action": "PAUSE_AND_AWAIT_USER"
      }
    ]
  },
  "steps": [
    {
      "id": "step-1",
      "stepNumber": 1,
      "type": "click",
      "timestamp": 1728115200000,
      "description": "Click Login Button",
      "delayBefore": 300,
      "delayAfterMs": 450,
      "fallbackCoords": { "x": 640, "y": 480 },
      "visualAnchor": {
        "templateBase64": "iVBORw0KGgoAAAANSUhEUgAAAHgAAAAoCAY...",
        "width": 120,
        "height": 40,
        "origX": 580,
        "origY": 460,
        "relativeClickOffset": { "xPercent": 0.5, "yPercent": 0.5 },
        "confidenceThreshold": 0.85,
        "timeoutMs": 300000,
        "pollIntervalMs": 500
      }
    },
    {
      "id": "step-2",
      "stepNumber": 2,
      "type": "type_text",
      "timestamp": 1728115201000,
      "description": "Enter Employee Name",
      "delayAfterMs": 450,
      "fallbackCoords": { "x": 0, "y": 0 },
      "keyData": {
        "text": "Nguyen Van Dat - Engineering"
      }
    }
  ]
}
```

---

## 7. Getting Started & Development

### 7.1. Prerequisites
- **Operating System:** Windows 10 or Windows 11 (64-bit).
- **Runtime:** Node.js $\ge$ 18.0.0 (LTS recommended).
- **Package Manager:** npm (bundled with Node.js).

### 7.2. Installation
```powershell
# Navigate to project repository
cd "smart-macro-studio---electron-&-react-automation-engine"

# Install dependencies
npm install
```

### 7.3. Running in Development Mode
Starts the Vite dev server on port 3000 and launches the Electron desktop window with live reload:
```powershell
npm run dev
```

### 7.4. Quality Assurance & Test Verification
```powershell
# 1. Static TypeScript analysis (Zero errors)
npm run lint

# 2. Verify Watchdog detection and self-match sanity
node scripts/check-watchdogs.cjs

# 3. Verify Visual Anchor roundtrip, Euclidean matcher & fallback guards
node scripts/check-webui-fixes.cjs
```

---

## 8. Packaging & Distribution (NSIS Setup Installer)

The project includes **Automated Version Bumping** and an **NSIS Setup Wizard**:

```powershell
# Compile frontend and package Windows installer
npm run package
```

### Build Pipeline:
1. **Pre-hook Execution (`prepackage`):** Automatically increments the patch version in `package.json` (e.g., `0.0.4` $\rightarrow$ `0.0.5`) via `npm version patch --no-git-tag-version`.
2. **Frontend Compilation:** Bundles React and assets into `dist/` via Vite.
3. **NSIS Installer Generation (`electron-builder`):**
   - Produces an interactive Setup installer in `release/`.
   - Allows users to select custom installation directories (`allowToChangeInstallationDirectory: true`).
   - Creates a desktop shortcut automatically (`createDesktopShortcut: true`).
   - Completely resolves C++ Fail Fast Exceptions caused by executing raw unpackaged binaries without proper application context.

---

## 9. License

Distributed under the [Apache License 2.0](LICENSE). Free for commercial and enterprise automation deployment.
