import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MacroStateMachine, HotkeyEvent } from './engine/stateMachine';
import { MacroFile, MacroState, MacroStep, WatchdogRule } from './types/macro';
import { FloatingMiniMenu, PlaylistItem } from './components/FloatingMiniMenu';
import { PlaylistWindow } from './components/PlaylistWindow';

type LoopMode = 'none' | 'infinite' | 'count';
type LoopConfig = { mode: LoopMode; count: number };

/** Mouse-driven step types — these must resolve visually before they may execute.
 *  ('scroll' is deliberately absent: wheel targets are position-tolerant, and wheel
 *  events never capture an anchor, so requiring one would break scroll recording.) */
const MOUSE_STEP_TYPES: ReadonlySet<MacroStep['type']> = new Set(['move', 'click', 'double_click', 'right_click']);

const PLAYLIST_STORAGE_KEY = 'smart-macro-playlist-paths';

const formatClock = (totalSeconds: number) => {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

/**
 * Electron does not implement window.prompt() (electron/electron#472), so this micro-prompt
 * covers the one place we need text input.
 * `ponytail:` no focus trap or a11y roles beyond focus+select; upgrade to a real modal
 * component if a second flow ever needs text input.
 */
function promptForText(message: string, defaultValue: string): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-[100] flex items-center justify-center bg-black/60';
    const box = document.createElement('div');
    box.className = 'rounded-xl border border-neutral-700 bg-neutral-900 p-4 text-neutral-100 shadow-2xl';
    const label = document.createElement('div');
    label.className = 'mb-2 text-xs text-neutral-300';
    label.textContent = message;
    const input = document.createElement('input');
    input.className = 'w-64 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs text-white outline-none focus:border-cyan-500';
    input.value = defaultValue;
    const row = document.createElement('div');
    row.className = 'mt-3 flex justify-end gap-2';
    const cancelButton = document.createElement('button');
    cancelButton.className = 'rounded-md border border-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-800';
    cancelButton.textContent = 'Cancel';
    const confirmButton = document.createElement('button');
    confirmButton.className = 'rounded-md bg-cyan-600 px-3 py-1 text-xs font-semibold text-white hover:bg-cyan-500';
    confirmButton.textContent = 'Add Watchdog';

    const close = (value: string | null) => {
      overlay.remove();
      resolve(value);
    };
    cancelButton.addEventListener('click', () => close(null));
    confirmButton.addEventListener('click', () => close(input.value.trim() || null));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') close(input.value.trim() || null);
      if (event.key === 'Escape') close(null);
    });

    row.append(cancelButton, confirmButton);
    box.append(label, input, row);
    overlay.append(box);
    document.body.append(overlay);
    input.focus();
    input.select();
  });
}

// One shared context: a fresh AudioContext per beep hits the browser's hardware
// limit (~6) and permanently silences feedback. Oscillators/gains stay per-beep.
let beepContext: AudioContext | null = null;

function playBeep(frequency: number, type: OscillatorType, duration: number) {
  try {
    beepContext ??= new window.AudioContext();
    const audioContext = beepContext;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const now = audioContext.currentTime;

    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + duration);
    void audioContext.resume().catch(() => undefined);
  } catch {
    // Audio feedback is optional and must not interrupt recording.
  }
}

export default function App() {
  const stateMachine = useMemo(() => new MacroStateMachine(), []);
  const [macroState, setMacroState] = useState<MacroState>(stateMachine.getState());
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [recordedSteps, setRecordedSteps] = useState<MacroStep[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
  const playlistHydratedRef = React.useRef(false);
  const [isPlaylistWindowOpen, setIsPlaylistWindowOpen] = useState(false);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [watchdogs, setWatchdogs] = useState<WatchdogRule[]>([]);
  const watchdogsRef = React.useRef(watchdogs);
  const [playbackStatus, setPlaybackStatus] = useState<string | null>(null);

  const [previousMacroState, setPreviousMacroState] = useState<MacroState>(stateMachine.getState());
  const [loopConfig, setLoopConfig] = useState<LoopConfig>({ mode: 'none', count: 1 });
  const [currentLoop, setCurrentLoop] = useState(0);
  const loopConfigRef = React.useRef(loopConfig);
  const currentLoopRef = React.useRef(currentLoop);

  const closePlaylistWindow = useCallback(() => setIsPlaylistWindowOpen(false), []);

  const setLoopNumber = useCallback((loopNumber: number) => {
    currentLoopRef.current = loopNumber;
    setCurrentLoop(loopNumber);
  }, []);

  // JSON-bloat guard: consecutive wheel ticks within 150ms coalesce into ONE
  // summed 'scroll' step, so fast web scrolling can't flood the macro file.
  const pendingWheelRef = React.useRef<{
    rotation: number;
    horizontal: boolean;
    x: number;
    y: number;
    timer: ReturnType<typeof setTimeout> | null;
  } | null>(null);

  // Human pacing: wall-clock gap since the previous recorded action feeds delayBefore.
  const lastActionTimeRef = React.useRef<number | null>(null);

  const flushWheelStep = useCallback(() => {
    const pending = pendingWheelRef.current;
    if (!pending) return;
    if (pending.timer) clearTimeout(pending.timer);
    pendingWheelRef.current = null;
    const delayBefore = lastActionTimeRef.current === null ? 0 : Math.min(Date.now() - lastActionTimeRef.current, 10000);
    lastActionTimeRef.current = Date.now();
    stateMachine.addRecordedStep({
      id: `step-${Date.now()}`,
      type: 'scroll',
      timestamp: Date.now(),
      fallbackCoords: { x: pending.x, y: pending.y },
      wheelData: { rotation: pending.rotation, horizontal: pending.horizontal || undefined },
      delayBefore,
      delayAfterMs: 120,
      description: `Scroll ${pending.horizontal ? 'horizontal' : pending.rotation > 0 ? 'down' : 'up'} ${Math.abs(pending.rotation)}x at (${pending.x}, ${pending.y})`,
    });
  }, [stateMachine]);

  const handleRecordHotkey = useCallback(() => {
    const state = stateMachine.getState();
    const startsRecording = state === 'IDLE' || state === 'PAUSED_AWAITING_USER';
    if (startsRecording) lastActionTimeRef.current = Date.now();
    playBeep(startsRecording ? 800 : 400, 'sine', 0.15);
    stateMachine.handleHotkey('F8');
  }, [stateMachine]);

  const handlePlayHotkey = useCallback(() => {
    if (stateMachine.getState() !== 'PLAYING') setLoopNumber(1);
    stateMachine.handleHotkey('F3');
  }, [setLoopNumber, stateMachine]);

  const handleLoopModeToggle = useCallback(() => {
    setLoopConfig((current) => {
      const nextMode: LoopMode = current.mode === 'none'
        ? 'infinite'
        : current.mode === 'infinite'
        ? 'count'
        : 'none';
      const next = { ...current, mode: nextMode };
      loopConfigRef.current = next;
      return next;
    });
  }, []);

  const handleLoopCountChange = useCallback((count: number) => {
    const next = { ...loopConfigRef.current, count: Math.max(1, count || 1) };
    loopConfigRef.current = next;
    setLoopConfig(next);
  }, []);

  useEffect(() => {
    return stateMachine.subscribe((context) => {
      setMacroState(context.state);
      setActiveStepIndex(context.activeStepIndex);
      setRecordedSteps(context.recordedSteps);
      setLastError(context.lastError);
    });
  }, [stateMachine]);

  // Smart-wait status only applies while playback is running.
  useEffect(() => {
    if (macroState !== 'PLAYING') setPlaybackStatus(null);
  }, [macroState]);

  const buildMacroFile = useCallback((steps: MacroStep[]): MacroFile => {
    const now = new Date().toISOString();
    return {
      version: '1.1',
      name: `Macro_${now.slice(0, 10)}`,
      createdAt: now,
      updatedAt: now,
      metadata: {
        totalSteps: steps.length,
        durationMs: steps.reduce((total, step) => total + step.delayAfterMs, 0),
        targetApplication: 'Desktop Workspace',
        osPlatform: 'win32',
        watchdogs: watchdogsRef.current,
      },
      steps,
    };
  }, []);

  // Rehydrate the playlist from stored file paths on startup. Declared before the persist
  // effect below so the storage read always wins over the first write; the hydrated guard
  // keeps writes blocked until hydration finishes (StrictMode-safe).
  useEffect(() => {
    const api = window.macroAPI;
    let paths: string[] = [];
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(PLAYLIST_STORAGE_KEY) || '[]');
      if (Array.isArray(parsed)) paths = parsed.filter((entry): entry is string => typeof entry === 'string');
    } catch {
      paths = [];
    }

    if (paths.length === 0) {
      playlistHydratedRef.current = true;
      return;
    }
    if (!api) return; // No file API (plain browser): keep stored paths untouched.

    let stale = false;
    void (async () => {
      const items: PlaylistItem[] = [];
      const keptPaths: string[] = [];
      for (const filePath of paths) {
        const result = await api.openMacroAt(filePath);
        if (!result) continue;
        items.push({ ...result.data, id: `${result.data.name}-${result.data.updatedAt}`, filePath: result.filePath });
        keptPaths.push(result.filePath);
      }
      if (stale) return;
      if (items.length > 0) setPlaylist(items);
      if (keptPaths.length !== paths.length) {
        localStorage.setItem(PLAYLIST_STORAGE_KEY, JSON.stringify(keptPaths));
      }
      playlistHydratedRef.current = true;
    })();

    return () => {
      stale = true;
    };
  }, []);

  // Persist the playlist file paths whenever the playlist changes (once hydration is done).
  useEffect(() => {
    if (!playlistHydratedRef.current) return;
    localStorage.setItem(PLAYLIST_STORAGE_KEY, JSON.stringify(playlist.map((item) => item.filePath)));
  }, [playlist]);

  useEffect(() => {
    if (previousMacroState === 'RECORDING_PATCH' && macroState === 'PAUSED_AWAITING_USER' && activeFilePath) {
      const api = window.macroAPI;
      if (api) {
        void api.quickSaveMacro(activeFilePath, buildMacroFile(recordedSteps)).catch((error) => {
          console.error('[macro] Failed to quick-save patched macro:', error);
        });
      }
    }

    if (previousMacroState !== macroState) setPreviousMacroState(macroState);
  }, [activeFilePath, buildMacroFile, macroState, previousMacroState, recordedSteps]);

  useEffect(() => {
    const api = window.macroAPI;
    if (!api) return;

    const unsubscribe = api.onMacroRecordEvent((event) => {
      if (event.type === 'wheel') {
        const recording = stateMachine.getState();
        if (
          (recording !== 'RECORDING' && recording !== 'RECORDING_PATCH') ||
          typeof event.rotation !== 'number' ||
          typeof event.x !== 'number' ||
          typeof event.y !== 'number'
        ) {
          return;
        }

        const horizontal = event.direction === 4;
        let next = pendingWheelRef.current;
        if (next && next.horizontal === horizontal) {
          next.rotation += event.rotation;
          next.x = event.x;
          next.y = event.y;
        } else {
          next = { rotation: event.rotation, horizontal, x: event.x, y: event.y, timer: null };
          pendingWheelRef.current = next;
        }
        if (next.timer) clearTimeout(next.timer);
        next.timer = setTimeout(flushWheelStep, 150);
        return;
      }

      // Order guard: a pending wheel burst must land before any non-wheel step.
      flushWheelStep();

      if (event.type === 'keydown' && [61, 66, 67].includes(event.keycode || -1)) {
        return;
      }

      if (event.type === 'keydown') {
        const delayBefore = lastActionTimeRef.current === null ? 0 : Math.min(Date.now() - lastActionTimeRef.current, 10000);
        lastActionTimeRef.current = Date.now();
        stateMachine.addRecordedStep({
          id: `step-${Date.now()}`,
          type: 'keypress',
          timestamp: Date.now(),
          fallbackCoords: { x: 0, y: 0 },
          keyData: {
            key: `VK_${event.keycode}`,
            code: `VK_${event.keycode}`,
            modifiers: {
              ctrl: event.ctrlKey,
              shift: event.shiftKey,
              alt: event.altKey,
              meta: event.metaKey,
            },
          },
          delayBefore,
          delayAfterMs: 120,
          description: `Key VK_${event.keycode}`,
        });
        return;
      }

      if (event.type !== 'mousedown' || typeof event.x !== 'number' || typeof event.y !== 'number') return;
      const type = event.button === 3 ? 'right_click' : event.clicks === 2 ? 'double_click' : 'click';
      const delayBefore = lastActionTimeRef.current === null ? 0 : Math.min(Date.now() - lastActionTimeRef.current, 10000);
      lastActionTimeRef.current = Date.now();
      stateMachine.addRecordedStep({
        id: `step-${Date.now()}`,
        type,
        timestamp: Date.now(),
        fallbackCoords: { x: event.x, y: event.y },
        visualAnchor: event.anchor
          ? {
              templateBase64: event.anchor.pngBase64,
              width: event.anchor.width,
              height: event.anchor.height,
              origX: event.anchor.origX,
              origY: event.anchor.origY,
              relativeClickOffset: { xPercent: event.anchor.xPercent, yPercent: event.anchor.yPercent },
              confidenceThreshold: 0.85,
              timeoutMs: 300000,
              pollIntervalMs: 500,
            }
          : undefined,
        delayBefore,
        delayAfterMs: 450,
        description: `${type === 'right_click' ? 'Right click' : type === 'double_click' ? 'Double click' : 'Click'} at (${event.x}, ${event.y})`,
      });
    });

    return unsubscribe;
  }, [flushWheelStep, stateMachine]);

  useEffect(() => {
    const api = window.macroAPI;
    if (!api) return;

    const unsubscribeRecord = api.onHotkeyToggleRecord(handleRecordHotkey);
    const unsubscribePlay = api.onHotkeyPlayMacro(handlePlayHotkey);
    const unsubscribeResume = api.onHotkeyResumeMacro(() => stateMachine.handleHotkey('F9'));
    const unsubscribeCaptureWatchdog = api.onHotkeyCaptureWatchdog(async (event) => {
      // Shift+F8: the blocking modal is under the cursor right now — capture first, then name it.
      if (!event.templateBase64 || stateMachine.getState() !== 'PAUSED_AWAITING_USER') return;

      const name = await promptForText(
        'Name this watchdog (pauses playback while the modal is on screen):',
        `Modal ${watchdogsRef.current.length + 1}`
      );
      if (!name) return;

      const nextWatchdogs: WatchdogRule[] = [
        ...watchdogsRef.current,
        {
          id: `watchdog-${Date.now()}`,
          name,
          enabled: true,
          visualAnchor: {
            templateBase64: event.templateBase64,
            width: 60,
            height: 60,
            confidenceThreshold: 0.8,
          },
          action: 'PAUSE_AND_AWAIT_USER',
        },
      ];
      watchdogsRef.current = nextWatchdogs;
      setWatchdogs(nextWatchdogs);

      // Persist right away when a file is open so the rule survives a restart.
      if (activeFilePath) {
        void api
          .quickSaveMacro(activeFilePath, buildMacroFile(stateMachine.getContext().recordedSteps))
          .catch((error) => console.error('[macro] Failed to save captured watchdog:', error));
      }
    });
    return () => {
      unsubscribeRecord();
      unsubscribePlay();
      unsubscribeResume();
      unsubscribeCaptureWatchdog();
    };
  }, [activeFilePath, buildMacroFile, handlePlayHotkey, handleRecordHotkey, stateMachine]);

  useEffect(() => {
    if (macroState !== 'PLAYING') return;

    let cancelled = false;

    const playSteps = async () => {
      let firstCycle = true;
      let loopNumber = currentLoopRef.current || 1;

      while (!cancelled) {
        if (stateMachine.getState() !== 'PLAYING') return;

        const playbackContext = stateMachine.getContext();
        const startIndex = firstCycle ? playbackContext.activeStepIndex : 0;

        for (let index = startIndex; index < playbackContext.recordedSteps.length; index += 1) {
          if (cancelled || stateMachine.getState() !== 'PLAYING') return;

          stateMachine.setActiveStepIndex(index);

          if (!window.macroAPI) {
            stateMachine.reset();
            return;
          }

          try {
            const currentStep = playbackContext.recordedSteps[index];
            let executableStep = currentStep;

            // Blind coordinate playback is disabled: mouse steps must resolve visually first.
            if (MOUSE_STEP_TYPES.has(currentStep.type) && !currentStep.visualAnchor?.templateBase64) {
              throw new Error(
                `BlindStepBlocked: Step ${index + 1} (${currentStep.type}) has no visual anchor to verify the click target. Re-record it [F8 patch] before playing.`
              );
            }

            if (currentStep.visualAnchor?.templateBase64) {
              const anchor = currentStep.visualAnchor;
              const pollInterval = anchor.pollIntervalMs || 500;
              const timeout = anchor.timeoutMs || 300000;
              const startTime = Date.now();
              let matched = false;

              while (Date.now() - startTime < timeout) {
                if (cancelled || stateMachine.getState() !== 'PLAYING') return;

                const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
                setPlaybackStatus(
                  `Searching element... (${formatClock(elapsedSec)} / ${formatClock(Math.floor(timeout / 1000))})`
                );

                const result = await window.macroAPI.findTemplateOnScreen({
                  ...anchor,
                  origX: anchor.origX ?? (currentStep.fallbackCoords ? currentStep.fallbackCoords.x - anchor.width * (anchor.relativeClickOffset?.xPercent ?? 0.5) : undefined),
                  origY: anchor.origY ?? (currentStep.fallbackCoords ? currentStep.fallbackCoords.y - anchor.height * (anchor.relativeClickOffset?.yPercent ?? 0.5) : undefined),
                });
                if (result.found && result.matchX >= 0 && result.matchY >= 0) {
                  const clickX = Math.round(result.matchX + anchor.width * (anchor.relativeClickOffset?.xPercent ?? 0.5));
                  const clickY = Math.round(result.matchY + anchor.height * (anchor.relativeClickOffset?.yPercent ?? 0.5));
                  // Hard override: the match is only a visual timing trigger — strike the
                  // EXACT recorded pixel; estimation drift (clickX/clickY) is discarded.
                  executableStep = {
                    ...currentStep,
                    fallbackCoords: {
                      x: currentStep.fallbackCoords?.x ?? clickX,
                      y: currentStep.fallbackCoords?.y ?? clickY,
                    },
                  };
                  matched = true;
                  break;
                }

                await new Promise((resolve) => setTimeout(resolve, pollInterval));
              }

              if (!matched) {
                if (cancelled || stateMachine.getState() !== 'PLAYING') return;
                throw new Error(`ElementNotFoundError: Visual element for step ${index + 1} did not appear within ${Math.round(timeout / 1000)}s.`);
              }

              // Hardcoded 500ms settle after a match — upstream of the Ghost guard below.
              setPlaybackStatus('Settling...');
              await new Promise((resolve) => setTimeout(resolve, 500));
              setPlaybackStatus(null);
            }

            // Global watchdog: scan for blocking modals before blind keyboard input.
            // ponytail: checked once per keyboard step (not a background polling thread);
            // upgrade path is a renderer setInterval watchdog loop if mid-step detection is needed.
            const activeWatchdogs = watchdogsRef.current;
            if (
              activeWatchdogs.length > 0 &&
              (executableStep.type === 'keypress' || executableStep.type === 'type_text')
            ) {
              const watchdogResult = await window.macroAPI.checkWatchdogs(activeWatchdogs);
              if (cancelled || stateMachine.getState() !== 'PLAYING') return;

              if (watchdogResult.triggered) {
                stateMachine.pauseForPatch(
                  index,
                  `Watchdog Interrupt: "${watchdogResult.watchdogName || 'Unknown Modal'}" appeared before step ${index + 1}. Close it, then press F9 to resume.`
                );
                return;
              }
            }

            // Last cancellation boundary: F9 / file-load may have landed while Smart Wait awaited IPC.
            if (cancelled || stateMachine.getState() !== 'PLAYING') return;
            await window.macroAPI.performStep(executableStep);
          } catch (error) {
            // Late IPC rejection after F9 / file load must not revive a cancelled loop.
            if (cancelled || stateMachine.getState() !== 'PLAYING') return;
            stateMachine.pauseForPatch(
              index,
              error instanceof Error ? error.message : 'Macro playback failed. Patch this step and press F9 to resume.'
            );
            return;
          }

          // Yield to Node/Electron so global F9 IPC can pause between native steps.
          await new Promise((resolve) => setTimeout(resolve, 1));
        }

        const activeLoopConfig = loopConfigRef.current;
        const shouldRepeat = activeLoopConfig.mode === 'infinite'
          || (activeLoopConfig.mode === 'count' && loopNumber < activeLoopConfig.count);

        if (!shouldRepeat) {
          stateMachine.playbackCompleted();
          return;
        }

        loopNumber += 1;
        setLoopNumber(loopNumber);
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Stop cleanly if the user paused, patched, or stopped the macro during the gap.
        if (cancelled || stateMachine.getState() !== 'PLAYING') return;
        stateMachine.setActiveStepIndex(0);
        firstCycle = false;
      }
    };

    void playSteps();
    return () => {
      cancelled = true;
    };
  }, [macroState, setLoopNumber, stateMachine]);

  const handleOpenMacroFile = async () => {
    const api = window.macroAPI;
    if (!api) return;

    try {
      const result = await api.openMacroFile();
      if (!result) return;

      const { filePath, data } = result;
      stateMachine.loadSteps(data.steps || []);
      const loadedWatchdogs = data.metadata?.watchdogs || [];
      setWatchdogs(loadedWatchdogs);
      watchdogsRef.current = loadedWatchdogs;
      setActiveFilePath(filePath);
      addToPlaylist(data, filePath);
    } catch (error) {
      console.error('[macro] Failed to open macro project:', error);
    }
  };

  const addToPlaylist = (file: MacroFile, filePath: string) => {
    setPlaylist((current) => {
      const id = `${file.name}-${file.updatedAt}`;
      const item = { ...file, id, filePath };
      const existing = current.findIndex((entry) => entry.id === id);

      if (existing === -1) return [...current, item];

      const updated = [...current];
      updated[existing] = item;
      return updated;
    });
  };

  const handleSelectPlaylistItem = (item: PlaylistItem) => {
    stateMachine.loadSteps(item.steps);
    const itemWatchdogs = item.metadata?.watchdogs || [];
    setWatchdogs(itemWatchdogs);
    watchdogsRef.current = itemWatchdogs;
    setActiveFilePath(item.filePath || null);
  };

  const handleRemovePlaylistItem = (id: string) => {
    setPlaylist((current) => current.filter((item) => item.id !== id));
  };

  const handleSaveMacroFile = async () => {
    const context = stateMachine.getContext();
    if (context.recordedSteps.length === 0) {
      alert('Cannot save an empty macro. Record actions [F8] first.');
      return;
    }

    const macroFile = buildMacroFile(context.recordedSteps);
    const api = window.macroAPI;
    if (!api) return;

    try {
      if (activeFilePath) {
        await api.quickSaveMacro(activeFilePath, macroFile);
        return;
      }

      const filePath = await api.saveMacroAs(macroFile);
      if (filePath) setActiveFilePath(filePath);
    } catch (error) {
      console.error('[macro] Failed to save macro project:', error);
      alert('Could not save the macro file.');
    }
  };

  return (
    <div className="flex h-fit w-full flex-col bg-neutral-950 text-neutral-100">
      <FloatingMiniMenu
        state={macroState}
        activeStepIndex={activeStepIndex}
        totalSteps={recordedSteps.length}
        onTriggerHotkey={(key: HotkeyEvent) => {
          if (key === 'F8') handleRecordHotkey();
          else if (key === 'F3') handlePlayHotkey();
          else stateMachine.handleHotkey(key);
        }}
        onOpenMacroFile={handleOpenMacroFile}
        onSaveMacroFile={handleSaveMacroFile}
        onOpenPlaylist={() => setIsPlaylistWindowOpen(true)}
        loopConfig={loopConfig}
        currentLoop={currentLoop}
        onToggleLoop={handleLoopModeToggle}
        onLoopCountChange={handleLoopCountChange}
        activeFilePath={activeFilePath}
        activeStep={recordedSteps[activeStepIndex]}
        lastError={lastError}
        playbackStatus={playbackStatus}
      />
      <PlaylistWindow
        isOpen={isPlaylistWindowOpen}
        playlist={playlist}
        onClose={closePlaylistWindow}
        onSelect={handleSelectPlaylistItem}
        onRemove={handleRemovePlaylistItem}
      />
    </div>
  );
}
