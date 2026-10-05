/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  Circle,
  Play,
  RotateCcw,
  Pause,
  Edit3,
  Upload,
  Download,
  ListMusic,
  Repeat,
  AlertCircle,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import { MacroState, MacroStep, MacroFile } from '../types/macro';

export type PlaylistItem = MacroFile & { id: string; filePath: string };

const getFileName = (filePath: string | null) => {
  if (!filePath) return null;
  return filePath.split(/[\\/]/).pop() || filePath;
};

interface FloatingMiniMenuProps {
  state: MacroState;
  activeStepIndex: number;
  totalSteps: number;
  onTriggerHotkey: (key: 'F8' | 'F3' | 'F9') => void;
  onOpenMacroFile: () => void;
  onSaveMacroFile: () => void;
  onOpenPlaylist: () => void;
  loopConfig: { mode: 'none' | 'infinite' | 'count'; count: number };
  currentLoop: number;
  onToggleLoop: () => void;
  onLoopCountChange: (count: number) => void;
  activeFilePath: string | null;
  activeStep?: MacroStep;
  lastError: string | null;
  playbackStatus?: string | null;
}

export const FloatingMiniMenu: React.FC<FloatingMiniMenuProps> = ({
  state,
  activeStepIndex,
  totalSteps,
  onTriggerHotkey,
  onOpenMacroFile,
  onSaveMacroFile,
  onOpenPlaylist,
  loopConfig,
  currentLoop,
  onToggleLoop,
  onLoopCountChange,
  activeFilePath,
  activeStep,
  lastError,
  playbackStatus,
}) => {
  const isWatchdogAlert = Boolean(lastError && lastError.includes('Watchdog Interrupt'));

  // State Badge Styling
  const getStateBadge = () => {
    switch (state) {
      case 'RECORDING':
        return (
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-500/20 text-red-400 border border-red-500/40 animate-pulse">
            <span className="w-2 h-2 rounded-full bg-red-500"></span>
            RECORDING [F8]
          </div>
        );
      case 'RECORDING_PATCH':
        return (
          <div className="flex items-center gap-1.5 rounded-full border border-cyan-500/40 bg-cyan-500/20 px-2.5 py-0.5 text-xs font-semibold text-cyan-300 animate-pulse">
            <span className="h-2 w-2 rounded-full bg-cyan-400"></span>
            PATCHING [F8]
          </div>
        );
      case 'PLAYING':
        if (playbackStatus) {
          return (
            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse">
              <span className="w-2 h-2 rounded-full bg-amber-400"></span>
              WAITING [F3]
            </div>
          );
        }
        return (
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
            PLAYING [F3]
          </div>
        );
      case 'PAUSED_AWAITING_USER':
        if (isWatchdogAlert) {
          return (
            <div className="flex items-center gap-1.5 rounded-full border border-red-500/60 bg-red-500/25 px-2.5 py-0.5 text-xs font-bold text-red-300 animate-pulse">
              <span className="h-2 w-2 rounded-full bg-red-500"></span>
              WATCHDOG HALT [F8/F9]
            </div>
          );
        }
        return (
          <div className="flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/20 px-2.5 py-0.5 text-xs font-semibold text-amber-300">
            <span className="h-2 w-2 rounded-full bg-amber-400"></span>
            PATCH READY [F8/F9]
          </div>
        );
      case 'IDLE':
      default:
        return (
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-neutral-800 text-neutral-300 border border-neutral-700">
            <span className="w-2 h-2 rounded-full bg-neutral-400"></span>
            IDLE
          </div>
        );
    }
  };

  return (
    <div
      id="floating-macro-menu"
      className="fixed inset-0 z-50 flex min-h-screen w-full select-none p-4"
    >
      {/* Floating HUD Widget Body */}
      <div className="flex h-fit w-[450px] max-w-full transition-all duration-300 flex-col rounded-2xl bg-neutral-950/95 backdrop-blur-xl border border-neutral-800/80 text-white p-3.5 shadow-[0_12px_40px_rgba(0,0,0,0.6)]">
        {/* Header Bar with Drag Handle & Status */}
        <div className="flex items-center justify-between pb-2.5 border-b border-neutral-800/60">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold tracking-wider uppercase text-neutral-200 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              Smart Macro HUD
            </span>
          </div>

          <div className="flex items-center gap-2">
            {getStateBadge()}
            <button
              type="button"
              onClick={onOpenPlaylist}
              tabIndex={-1}
              className="flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1 text-[11px] font-medium text-neutral-400 transition-colors hover:text-white"
            >
              <ListMusic className="h-3.5 w-3.5" />
              <span>Playlist</span>
            </button>
          </div>
        </div>

        <div
          className="my-2 max-w-full truncate border-b border-neutral-800/60 py-1.5 text-xs text-neutral-500"
          title={activeFilePath || 'Chưa lưu (New Macro)'}
        >
          {activeFilePath ? `Đang mở: ${getFileName(activeFilePath)}` : 'Chưa lưu (New Macro)'}
        </div>

        {/* Live Step Tracker & Information */}
        <div className="py-2.5 flex items-center justify-between text-xs text-neutral-300">
          <div className="flex items-center gap-2">
            <span className="text-neutral-400">Step:</span>
            <span className="font-mono px-2 py-0.5 rounded bg-neutral-900 border border-neutral-800 font-semibold text-cyan-300">
              {totalSteps > 0 ? `${activeStepIndex + 1}/${totalSteps}` : '0/0'}
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-neutral-400 text-[11px]">
            {activeStep ? (
              <span className="truncate max-w-[210px] text-neutral-300" title={activeStep.description}>
                {activeStep.description}
              </span>
            ) : totalSteps === 0 ? (
              <span>Load .json or press [F8]</span>
            ) : (
              <span>Ready for execution</span>
            )}
          </div>
        </div>

        {/* Error / Notification Banner — Watchdog interrupts get a prominent red alert */}
        {lastError && (
          <div
            className={`mb-2 px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-2 border ${
              isWatchdogAlert
                ? 'animate-pulse bg-red-950/70 border-red-500/60 text-red-200 shadow-[0_0_14px_rgba(239,68,68,0.35)]'
                : 'bg-red-950/40 border-red-800/40 text-red-300'
            }`}
          >
            <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
            <span className="min-w-0 break-words font-semibold">{lastError}</span>
          </div>
        )}

        {/* Active Step Visual Anchor Thumbnail (PLAYING / PAUSED) */}
        {(state === 'PLAYING' || state === 'PAUSED_AWAITING_USER') && activeStep?.visualAnchor?.templateBase64 && (
          <div className="mb-2 flex items-center gap-2 px-1">
            <img
              src={`data:image/png;base64,${activeStep.visualAnchor.templateBase64}`}
              alt="Active step visual anchor"
              className="h-9 w-9 shrink-0 rounded-md border border-cyan-500/40 bg-neutral-950 object-cover"
            />
            <span className="text-[10px] leading-tight text-cyan-400">
              Anchor {activeStep.visualAnchor.width}×{activeStep.visualAnchor.height}px
              <br />
              {Math.round(activeStep.visualAnchor.confidenceThreshold * 100)}% match threshold
            </span>
          </div>
        )}

        {/* Watchdog teach hint while paused */}
        {state === 'PAUSED_AWAITING_USER' && (
          <div className="mb-1.5 px-1 text-[10px] text-neutral-500">
            Teach a watchdog: hover the blocking modal, then press{' '}
            <span className="font-mono text-cyan-400">Shift+F8</span>
          </div>
        )}

        {/* Action Button Controls */}
        <div className="grid grid-cols-4 gap-2 pt-1">
          {/* Record Button [F8] */}
          <button
              onClick={() => onTriggerHotkey('F8')}
            tabIndex={-1}
            className={`flex flex-col items-center justify-center p-2 rounded-xl text-xs font-semibold transition-all border ${
              state === 'RECORDING'
                ? 'bg-red-600 text-white border-red-500 shadow-lg shadow-red-600/30'
                : state === 'RECORDING_PATCH'
                ? 'bg-cyan-600 text-white border-cyan-500 shadow-lg shadow-cyan-600/30'
                : 'bg-neutral-900 text-neutral-200 border-neutral-800 hover:bg-neutral-800 hover:border-neutral-700'
            }`}
          >
            {state === 'RECORDING' || state === 'RECORDING_PATCH' ? (
              <>
                <Circle className="w-4 h-4 fill-white mb-1" />
                <span>{state === 'RECORDING_PATCH' ? 'Finish Patch [F8]' : 'Stop [F8]'}</span>
              </>
            ) : state === 'PAUSED_AWAITING_USER' ? (
              <>
                <Edit3 className="w-4 h-4 mb-1" />
                <span>Patch [F8]</span>
              </>
            ) : (
              <>
                <Circle className="w-4 h-4 text-red-500 fill-red-500 mb-1" />
                <span>Record [F8]</span>
              </>
            )}
          </button>

          {/* Play / Restart Button [F3] */}
          <div className="flex min-w-0 flex-col gap-1">
            <button
              onClick={() => onTriggerHotkey('F3')}
              tabIndex={-1}
              disabled={state === 'RECORDING' || state === 'RECORDING_PATCH' || totalSteps === 0}
              className={`flex flex-col items-center justify-center p-2 rounded-xl text-xs font-semibold transition-all border ${
                state === 'PLAYING'
                  ? 'bg-emerald-600 text-white border-emerald-500 shadow-lg shadow-emerald-600/30'
                  : totalSteps === 0
                  ? 'bg-neutral-900/50 text-neutral-600 border-neutral-800 cursor-not-allowed'
                  : 'bg-neutral-900 text-neutral-200 border-neutral-800 hover:bg-neutral-800 hover:border-neutral-700'
              }`}
            >
              {state === 'PLAYING' ? (
                <>
                  <RotateCcw className="w-4 h-4 mb-1 animate-spin" />
                  <span>Restart [F3]</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 text-emerald-400 fill-emerald-400 mb-1" />
                  <span>Play [F3]</span>
                </>
              )}
            </button>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onToggleLoop}
                tabIndex={-1}
                title={`Loop: ${loopConfig.mode}`}
                className={`flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md border px-1.5 py-1 text-[10px] ${
                  loopConfig.mode === 'none'
                    ? 'border-neutral-800 bg-neutral-900 text-neutral-500'
                    : 'border-cyan-700 bg-cyan-950/60 text-cyan-300'
                }`}
              >
                <Repeat className="h-3 w-3" />
                <span>{loopConfig.mode === 'none' ? 'Once' : loopConfig.mode === 'infinite' ? '∞' : `${currentLoop}/${loopConfig.count}`}</span>
              </button>
              {loopConfig.mode === 'count' && (
                <input
                  type="number"
                  min="1"
                  value={loopConfig.count}
                  onChange={(event) => onLoopCountChange(Number(event.target.value))}
                  aria-label="Loop count"
                  className="w-10 rounded-md border border-neutral-800 bg-neutral-900 px-1 py-1 text-center text-[10px] text-neutral-200 outline-none focus:border-cyan-500"
                />
              )}
            </div>
          </div>

          {/* Pause / Resume Button [F9] */}
          <button
            onClick={() => onTriggerHotkey('F9')}
            tabIndex={-1}
            disabled={state !== 'PLAYING' && state !== 'PAUSED_AWAITING_USER'}
            className={`flex flex-col items-center justify-center p-2 rounded-xl text-xs font-semibold transition-all border ${
              state === 'PAUSED_AWAITING_USER'
                ? 'bg-amber-600 text-white border-amber-500 shadow-lg shadow-amber-600/30'
                : state === 'PLAYING'
                ? 'bg-neutral-900 text-amber-300 border-neutral-800 hover:bg-neutral-800'
                : 'bg-neutral-900/50 text-neutral-600 border-neutral-800 cursor-not-allowed'
            }`}
          >
            {state === 'PAUSED_AWAITING_USER' ? (
              <>
                <Play className="w-4 h-4 mb-1" />
                <span>Pause/Resume [F9]</span>
              </>
            ) : (
              <>
                <Pause className="w-4 h-4 mb-1" />
                <span>Pause/Resume [F9]</span>
              </>
            )}
          </button>

          {/* File Operations: Drop/Load & Export */}
          <div className="flex flex-col gap-1">
            <button
              onClick={onOpenMacroFile}
              tabIndex={-1}
              title="Open Macro Project (.json)"
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium bg-neutral-900 border border-neutral-800 text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors"
            >
              <Upload className="w-3 h-3 text-cyan-400" />
              <span>Load</span>
            </button>
            <button
              onClick={onSaveMacroFile}
              tabIndex={-1}
              disabled={totalSteps === 0}
              title="Save sequence to .json file"
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                totalSteps > 0
                  ? 'bg-neutral-900 border-neutral-800 text-neutral-300 hover:text-white hover:bg-neutral-800'
                  : 'bg-neutral-900/40 border-neutral-800/40 text-neutral-600 cursor-not-allowed'
              }`}
            >
              <Download className="w-3 h-3 text-emerald-400" />
              <span>Save</span>
            </button>
          </div>
        </div>

        {/* Status Hint */}
        <div className="mt-2 text-center text-[10px] text-neutral-500 border-t border-neutral-900 pt-1.5 flex items-center justify-center gap-1">
          {playbackStatus ? (
            <>
              <Sparkles className="h-3 w-3 text-amber-300" />
              <span className="text-amber-300">{playbackStatus}</span>
            </>
          ) : (
            <>
              <span>Projects are saved as</span>
              <span className="font-mono text-cyan-400">.json</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
