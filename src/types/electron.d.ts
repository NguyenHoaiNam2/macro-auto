/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export {};

declare module 'electron' {
  export interface BrowserWindow {
    setAlwaysOnTop(flag: boolean, level?: string): void;
    setVisibleOnAllWorkspaces(flag: boolean): void;
    loadURL(url: string): Promise<void>;
    loadFile(path: string): Promise<void>;
    on(event: string, listener: (...args: any[]) => void): this;
    webContents: {
      send(channel: string, ...args: any[]): void;
    };
  }

  export const BrowserWindow: {
    new (options?: any): BrowserWindow;
  };
  export const app: any;
  export const globalShortcut: any;
  export const ipcMain: any;
  export const ipcRenderer: any;
  export const dialog: any;
  export const contextBridge: any;
}

declare module 'uiohook-napi' {
  export interface UiohookMouseEvent {
    x: number;
    y: number;
    button?: number;
    clicks?: number;
    type?: string;
  }

  export interface UiohookKeyboardEvent {
    keycode: number;
    altKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
  }

  export const uIOhook: {
    on(event: 'click', handler: (e: UiohookMouseEvent) => void): void;
    on(event: 'keydown', handler: (e: UiohookKeyboardEvent) => void): void;
    on(event: string, handler: (e: any) => void): void;
    start(): void;
    stop(): void;
  };

  export const UiohookKey: Record<string, number>;
}

declare global {
  interface Window {
    macroAPI?: {
      performStep: (step: import('./macro').MacroStep) => Promise<{ success: boolean }>;
      findTemplateOnScreen: (visualAnchor: import('./macro').VisualAnchor) => Promise<{
        found: boolean;
        matchX: number;
        matchY: number;
        confidence: number;
      }>;
      checkWatchdogs: (watchdogs: import('./macro').WatchdogRule[]) => Promise<{
        triggered: boolean;
        watchdogName?: string;
      }>;


      saveMacroAs: (data: import('./macro').MacroFile) => Promise<string | null>;
      openMacroFile: () => Promise<{ filePath: string; data: import('./macro').MacroFile } | null>;
      openMacroAt: (filePath: string) => Promise<{ filePath: string; data: import('./macro').MacroFile } | null>;
      quickSaveMacro: (filePath: string, data: import('./macro').MacroFile) => Promise<{ success: boolean }>;
      onMacroRecordEvent: (callback: (event: {
        type: 'keydown' | 'mousedown' | 'wheel';
        keycode?: number;
        ctrlKey?: boolean;
        shiftKey?: boolean;
        altKey?: boolean;
        metaKey?: boolean;
        x?: number;
        y?: number;
        button?: number;
        clicks?: number;
        anchor?: {
          pngBase64: string;
          width: number;
          height: number;
          origX?: number;
          origY?: number;
          xPercent: number;
          yPercent: number;
        };
        rotation?: number;
        direction?: number;
      }) => void) => () => void;
      onHotkeyToggleRecord: (callback: () => void) => () => void;
      onHotkeyPlayMacro: (callback: () => void) => () => void;
      onHotkeyResumeMacro: (callback: () => void) => () => void;
      onHotkeyCaptureWatchdog: (callback: (event: { templateBase64?: string }) => void) => () => void;
    };
  }
}
