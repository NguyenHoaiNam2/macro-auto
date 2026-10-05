/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Visual Anchor captured around the cursor location during recording
 * for computer vision element matching during playback.
 */
export interface VisualAnchor {
  /** Base64 PNG image snippet captured at the interaction point */
  templateBase64: string;
  /** Width in pixels of the template snippet (e.g., 60) */
  width: number;
  /** Height in pixels of the template snippet (e.g., 60) */
  height: number;
  /** Original X coordinate recorded for spatial proximity / Euclidean matching */
  origX?: number;
  /** Original Y coordinate recorded for spatial proximity / Euclidean matching */
  origY?: number;
  /** Normalized click position within the template [0.0 - 1.0] (0.5 = center) */
  relativeClickOffset: {
    xPercent: number;
    yPercent: number;
  };
  /** Minimum similarity score required to accept a visual match (0.0 - 1.0) */
  confidenceThreshold: number;
  /** Maximum duration in ms to poll for the element before timing out */
  timeoutMs: number;
  /** Polling interval in ms between screen capture checks */
  pollIntervalMs: number;
}

/**
 * Watchdog rule for unexpected pop-ups, modals, and error banners.
 */
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

/**
 * Types of automatable user actions
 */
export type ActionType = 'click' | 'double_click' | 'right_click' | 'move' | 'keypress' | 'type_text' | 'delay' | 'scroll';

/**
 * A single discrete recorded macro step
 */
export interface MacroStep {
  id: string;
  stepNumber: number;
  type: ActionType;
  timestamp: number;
  /** Computer Vision Visual Anchor for Smart RPA element recognition */
  visualAnchor?: VisualAnchor;
  /** Static coordinates as fallback if visual recognition fails */
  fallbackCoords: {
    x: number;
    y: number;
  };
  /** Optional keyboard input details */
  keyData?: {
    key: string;
    code: string;
    modifiers?: {
      ctrl?: boolean;
      shift?: boolean;
      alt?: boolean;
      meta?: boolean;
    };
    text?: string;
  };
  /** Wheel scroll details for 'scroll' steps: whole notches (Windows record convention
   *  is vertical down = positive, up = negative; horizontal right = positive) */
  wheelData?: {
    rotation: number;
    horizontal?: boolean;
  };
  /** Human-recorded pause before this step executes, in ms (0–10000; absent in old files) */
  delayBefore?: number;
  /** Custom delay in ms before executing next step */
  delayAfterMs: number;
  /** Human-readable explanation of the step */
  description: string;
}

/**
 * Macro state machine states
 */
export type MacroState =
  | 'IDLE'                 // Ready to record or play
  | 'RECORDING'            // Capturing actions; press F8 to save
  | 'PLAYING'              // Executing steps; press F3 to restart, F9 to pause
  | 'RECORDING_PATCH'      // Capturing replacement steps after a playback error
  | 'PAUSED_AWAITING_USER'; // Playback failed or paused; waiting for an on-the-fly patch or resume

/**
 * Serializable Macro file schema (.json) - Version 1.1
 */
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

