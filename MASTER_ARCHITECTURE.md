# MASTER ARCHITECTURAL BLUEPRINT & ROADMAP: ENTERPRISE SMART RPA ENGINE

---

## 1. EXECUTIVE SUMMARY & THE PROBLEM STATEMENT

### 1.1 The Context
Standard desktop automation macros operate on fixed coordinate replay (`(x, y)` static points) and hardcoded delays (`delayAfterMs = 500`). In real-world enterprise environments, workflows frequently span multiple disparate software ecosystems: enterprise web portals (ERP/CRM), legacy desktop thick-clients (SAP GUI, Java Swing), and desktop productivity tools (Microsoft Excel, PDF readers).

A typical mission-critical workflow looks like:
$$\text{Alt+Tab to Excel} \longrightarrow \text{Arrow Key Navigation} \longrightarrow \text{Ctrl+C} \longrightarrow \text{Alt+Tab to Web} \longrightarrow \text{Wait for Modal} \longrightarrow \text{Ctrl+V} \longrightarrow \text{Submit}$$

### 1.2 Why Blind Coordinate Automation Fails in Enterprise
1. **Unpredictable Asynchronous Latency (2 seconds to 5 minutes):** Enterprise networks and legacy backends produce non-deterministic latency. If a database query or page load hangs for 45 seconds instead of the expected 2 seconds, a fixed-delay macro clicks into empty space or fires keystrokes into the ether, breaking downstream execution.
2. **Dynamic & Responsive Layout Shifts:** UI updates, differing DPI scaling, dynamic banner heights, or localized fonts shift interface elements by dozens of pixels. A static `(x, y)` coordinate click hits the wrong component or misses entirely.
3. **Unexpected Modals, Alerts, & Interruptions:** During blind keystroke playback (such as bulk data insertion or grid navigation), the system might suddenly throw a validation dialog, a *"Session Expired"* notification, an *"Unsaved Changes"* alert, or a *"Conflict Detected"* prompt. Blindly continuing keyboard input over an unexpected modal causes severe data corruption, unauthorized field overrides, or silent macro failure.

### 1.3 The Pivot: True Visual RPA
The engine must transition from blind coordinate playback to an intelligent visual agent that:
- **Sees:** Recognizes target controls visually using dynamic screen anchors.
- **Waits:** Intelligently pauses execution until the required element appears on screen, eliminating hardcoded timeouts.
- **Watches:** Continuously checks for unexpected interruption modals before sending any destructive action.
- **Heals:** Allows human-in-the-loop on-the-fly patching when an unresolvable anomaly occurs.

---

## 2. CORE TECH STACK & ARCHITECTURAL CONSTRAINTS

### 2.1 Core Technologies
- **UI Shell & Renderer:** React 19, TypeScript, Tailwind CSS v4, Lucide React, Vite 8.
- **Desktop Runtime & IPC:** Electron 44, Context Isolation enabled (`contextIsolation: true`, `nodeIntegration: false`), secure IPC channels via `electron/preload.cjs`.
- **Global Input Interception:** `uiohook-napi` (N-API native global input hooks for OS-level keyboard/mouse events).
- **Native OS Execution & FFI:** `koffi` (high-performance C-FFI for Node.js) interfacing with Win32 `user32.dll` and `gdi32.dll`.

### 2.2 Golden Rules & Engineering Principles
Following the project's **Lazy Senior Dev** philosophy (`.github/copilot-instructions.md`):
1. **Zero Native Build Hell (Strict "No OpenCV" Constraint):** 
   Heavy native wrappers like `opencv4nodejs` or `robotjs` are strictly forbidden. They introduce fragile `node-gyp` toolchains, C++ ABI mismatch crashes with Electron's V8 version, and massive bundle bloat.
2. **Native Win32 Screen Capture via GDI32:**
   Instead of pulling in third-party capture utilities, the engine leverages `koffi` to invoke Win32 GDI calls directly:
   - `GetDC(NULL)` / `CreateCompatibleDC` / `CreateCompatibleBitmap` / `BitBlt` / `GetDIBits`
   - Yields lightning-fast full-screen captures in ~3ms to 8ms with zero external dependencies and sub-1% CPU consumption.
3. **Pure JS/Wasm Pixel Matching:**
   Template matching is implemented via highly optimized pure JavaScript/TypedArray algorithms (Normalized Cross-Correlation or Sum of Absolute Differences over downsampled / grayscale pixel buffers). It is fast, deterministic, and 100% portable across Windows environments.
4. **Fewest Files & Minimal Code:**
   No premature abstractions, no redundant libraries, and no boilerplate classes unless explicitly architected.

---

## 3. THE RPA ENGINE ARCHITECTURE (THE SOLUTION)

```
+---------------------------------------------------------------------------------------+
|                               ELECTRON MAIN PROCESS                                   |
|                                                                                       |
|   +-------------------+    GDI BitBlt (~5ms)    +---------------------------------+   |
|   | Global Screen     | ----------------------> | Single-Frame Pixel Buffer       |   |
|   +-------------------+                         +---------------------------------+   |
|                                                              |                        |
|                                       +----------------------+--------------------+   |
|                                       |                                           |   |
|                                       v                                           v   |
|                         +---------------------------+               +-----------------+
|                         | Multi-Watchdog Scanner    |               | Step Target     |
|                         | (Checks for Error Modals) |               | Template Match  |
|                         +---------------------------+               +-----------------+
|                                       |                                           |   |
|                              Found?   |                                  Match?   |   |
|                                       v                                           v   |
|                           EMERGENCY PAUSE IPC                        CALCULATE REAL OFFSET    |
|                         (PAUSED_AWAITING_USER)                                    |   |
|                                                                                   v   |
|                                                                           SetCursorPos()      |
|                                                                           mouse_event()       |
+---------------------------------------------------------------------------------------+
```

### 3.1 Visual Anchors (The Recording "Eye")
When the user records an action (`mousedown` via `uiohook-napi`):
1. The Main Process captures a localized region (e.g., $120 \times 40$ pixels) centered at the cursor position `(x, y)`.
2. The pixel patch is encoded into an optimized Base64 PNG string (`templateBase64`).
3. The normalized relative click offset is recorded:
   $$\text{relativeClickOffset} = \{ \text{xPercent}: 0.5, \text{yPercent}: 0.5 \}$$
4. The resulting `VisualAnchor` is embedded directly into the recorded `MacroStep`.
5. Static coordinates are retained solely as an optional fallback (`fallbackCoords`). Playback never executes them blind: a mouse step without a visual anchor throws `BlindStepBlocked` and pauses the engine for user patching.

### 3.2 Smart Wait (Non-Blocking Dynamic Polling)
During playback, the engine never blindly clicks. When a step with a `visualAnchor` is executed:
1. **Immediate Inspection:** The engine captures the active screen and performs template matching. If the confidence score satisfies the threshold ($\text{confidence} \ge 0.85$), it calculates the true target coordinates and clicks immediately.
2. **Polling Loop:** If the target is absent (e.g., page loading, data fetching):
   - The loop sleeps for `pollIntervalMs` (default: 400ms – 500ms).
   - It yields execution back to the Node.js / Electron Event Loop.
   - It re-captures and re-scans the screen.
3. **Dynamic Coordinate Calculation:** If the window layout has shifted or scrolled, the matched bounding box yields the updated screen position:
   $$\text{TargetX} = \text{MatchX} + (\text{TemplateWidth} \times \text{relativeClickOffset.xPercent})$$
   $$\text{TargetY} = \text{MatchY} + (\text{TemplateHeight} \times \text{relativeClickOffset.yPercent})$$
4. **Graceful Timeout:** If the element fails to appear after `timeoutMs` (configurable up to 5 minutes for enterprise workflows), the engine emits an `ElementNotFoundError` and transitions to `PAUSED_AWAITING_USER`.

### 3.3 Interleaved Single-Frame Active Watchdog
To prevent cross-app data corruption caused by random alert dialogs:
1. **The "Single-Capture, Multi-Match" Pattern:**
   Full-screen image capture is performed **once** per polling tick. The resulting in-memory raw buffer is scanned against both:
   - Target A: The step's required visual anchor.
   - Target B..N: The registered project-level `WatchdogRule` templates.
2. **Pre-Flight Keystroke Guard:**
   Before executing any keyboard action (`keypress`, `type_text`, `Alt+Tab`, `Enter`):
   - A rapid pre-flight screen capture (~5ms) verifies the absence of all registered watchdog modals.
   - If an unexpected modal is recognized:
     - **Keystrokes are completely withheld.**
     - The engine triggers `PAUSED_AWAITING_USER` with `lastError = "Watchdog Interrupt: [Modal Name] detected"`.
     - An audible warning chime alerts the operator.

---

## 4. DATA STRUCTURES (JSON SCHEMA V1.1)

```typescript
export interface VisualAnchor {
  templateBase64: string;
  width: number;
  height: number;
  relativeClickOffset: {
    xPercent: number; // 0.0 to 1.0 (0.5 = center)
    yPercent: number;
  };
  confidenceThreshold: number; // Default: 0.85
  timeoutMs: number;          // Default: 300,000 (5 minutes)
  pollIntervalMs: number;     // Default: 500
}

export interface WatchdogRule {
  id: string;
  name: string;
  enabled: boolean;
  visualAnchor: {
    templateBase64: string;
    width: number;
    height: number;
    confidenceThreshold: number;
    searchRegion?: {
      xPercent: number;
      yPercent: number;
      widthPercent: number;
      heightPercent: number;
    };
  };
  action: 'PAUSE_AND_AWAIT_USER';
}

export interface MacroStep {
  id: string;
  stepNumber: number;
  type: 'click' | 'double_click' | 'right_click' | 'move' | 'keypress' | 'type_text' | 'delay';
  timestamp: number;
  description: string;
  delayAfterMs: number;
  
  /** Visual Anchor for Smart RPA */
  visualAnchor?: VisualAnchor;

  /** Legacy / Fallback Static Coordinates */
  fallbackCoords: {
    x: number;
    y: number;
  };

  keyData?: {
    key: string;
    code: string;
    modifiers?: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean };
    text?: string;
  };
}

export interface MacroFile {
  version: '1.1';
  name: string;
  createdAt: string;
  updatedAt: string;
  metadata: {
    totalSteps: number;
    durationMs: number;
    targetApplication?: string;
    osPlatform?: 'win32' | 'darwin' | 'linux' | 'web';
    watchdogs?: WatchdogRule[];
  };
  steps: MacroStep[];
}
```

---

## 5. STATE MACHINE & EVENT LOOP INTEGRITY

### 5.1 State Definitions
- `IDLE`: Machine ready.
- `RECORDING`: Intercepting inputs and snapping localized visual anchors.
- `PLAYING`: Executing steps using Smart Wait and Watchdog checks.
- `PAUSED`: Manual pause state.
- `PAUSED_AWAITING_USER`: Triggered automatically on visual timeout or watchdog detection. Execution freezes at `pausedStepIndex`.
- `RECORDING_PATCH`: Intercepting user fix-up steps to splice into the workflow at the pause point.
- `STEP_EDIT_RECORDING`: Modifying a specific step's visual anchor or parameters.

### 5.2 Hotkey Flow & On-the-Fly Patching
- **`F8` (Record / Patch Toggle):**
  - In `IDLE` $\rightarrow$ Enters `RECORDING`.
  - In `RECORDING` $\rightarrow$ Finalizes recording, returns to `IDLE`.
  - In `PAUSED_AWAITING_USER` $\rightarrow$ Enters `RECORDING_PATCH`.
  - In `RECORDING_PATCH` $\rightarrow$ Automatically splices the patch steps into `recordedSteps` at `pausedStepIndex`, auto-saves to disk via IPC, and returns to `PAUSED_AWAITING_USER`.
- **`F3` (Play / Loop):** Initiates execution with configured loop bounds (`Once`, `Infinite`, `Count`).
- **`F9` (Emergency Pause / Resume):**
  - In `PLAYING` $\rightarrow$ Immediate pause to `PAUSED_AWAITING_USER`.
  - In `PAUSED_AWAITING_USER` $\rightarrow$ Resumes execution from `pausedStepIndex`.

### 5.3 Event Loop Non-Blocking Guarantee
To ensure the application remains responsive to `F9` hotkeys, OS window events, and UI rendering:
1. **The 1ms Yield Rule:** Between every step and every polling cycle:
   ```typescript
   await new Promise((resolve) => setTimeout(resolve, 1));
   ```
2. **Cooperative Cancellation:** Every loop checks `if (cancelled || stateMachine.getState() !== 'PLAYING') return;` immediately after returning from any async sleep or native FFI call.
3. **Native Call Offloading:** High-frequency template matching runs asynchronously through Node promises or worker routines, keeping IPC communication clear.

---

## 6. STEP-BY-STEP IMPLEMENTATION ROADMAP

### Phase 1: Data Structures, Dead Code Cleanup, and The Recording "Eye"
- Clean up obsolete legacy comments and unused type definitions.
- Update `src/types/macro.ts` and `src/types/electron.d.ts` with the `VisualAnchor` and `WatchdogRule` schemas.
- Implement native screen capture in `electron/native-automation.cjs` using Win32 GDI calls via existing `koffi`.
- Wire `uiohook-napi` click events to automatically crop a $120 \times 40$ pixel bounding box at `(x, y)` and transmit the base64 anchor down through IPC.
- Ensure the recorded step in `App.tsx` contains the complete `visualAnchor` payload.

### Phase 2: Smart Wait Playback Engine (Visual Template Matcher)
- Implement an efficient, pure-JS template matching algorithm (Grayscale Sum of Absolute Differences or Normalized Cross-Correlation) in the Electron layer.
- Implement the `automation:find-anchor` IPC handler.
- Update `playSteps` in `App.tsx` to utilize the non-blocking polling loop (`Smart Wait`) for steps containing a `visualAnchor`.
- Calculate dynamic click offsets from the recognized bounding box.
- Implement the 5-minute timeout with automatic escalation to `PAUSED_AWAITING_USER`.

### Phase 3: Global Watchdog & Exception Handling
- Implement the "Single-Capture, Multi-Match" routine in `electron/native-automation.cjs`.
- Implement pre-flight checks for keyboard actions (`keypress`, `type_text`).
- Connect watchdog detections to trigger an immediate interrupt, shifting the state machine to `PAUSED_AWAITING_USER` and sounding an alarm chime.
- Enable `F8` on-the-fly patching to allow users to record dismissal steps for detected modals.

### Phase 4: UI/UX Upgrades & Playlist Persistence
- Update `FloatingMiniMenu.tsx` to render the thumbnail preview of the current step's `VisualAnchor`.
- Add a live status indicator showing Smart Wait countdowns (e.g., *"Searching element... (00:14 / 05:00)"*).
- Display a dedicated visual alert when a Watchdog halts execution.
- Maintain full project persistence (`v1.1` JSON format) across saving, loading, and playlist management.

