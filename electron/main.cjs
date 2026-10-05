const { app, BrowserWindow, dialog, globalShortcut, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const { performStep, captureSnippet, findTemplateOnScreen, checkWatchdogs } = require('./native-automation.cjs');

const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:3000';
let mainWindow = null;
let inputHookStarted = false;
let uiohook = null;
let lastMousePos = null;
let isTearingDown = false;

function teardownHooksAndWindows() {
  if (isTearingDown) return;
  isTearingDown = true;

  try {
    globalShortcut.unregisterAll();
  } catch (err) {
    console.warn('[macro] Failed to unregister global shortcuts:', err.message);
  }

  if (overlayHideTimer) {
    clearTimeout(overlayHideTimer);
    overlayHideTimer = null;
  }
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    try {
      overlayWindow.destroy();
    } catch {}
    overlayWindow = null;
  }

  if (uiohook && inputHookStarted) {
    try {
      inputHookStarted = false;
      uiohook.removeAllListeners();
      uiohook.stop();
    } catch (error) {
      console.warn('[macro] Failed to stop uiohook-napi cleanly:', error.message);
    }
  }
}

// Anchor capture shape for recorded clicks: web controls are wide and short.
const ANCHOR_CAPTURE_WIDTH = 120;
const ANCHOR_CAPTURE_HEIGHT = 40;

try {
  ({ uIOhook: uiohook } = require('uiohook-napi'));
} catch (error) {
  console.warn('[macro] uiohook-napi is unavailable; global input recording is disabled.', error.message);
}

function createWindow() {
  const window = new BrowserWindow({
    width: 500,
    height: 320,
    minWidth: 500,
    minHeight: 320,
    resizable: false,
    autoHideMenuBar: true,
    backgroundColor: '#0a0a0a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = window;
  mainWindow.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: {
      autoHideMenuBar: true,
      resizable: true,
    },
  }));

  window.on('close', () => {
    teardownHooksAndWindows();
  });

  window.on('closed', () => {
    mainWindow = null;
  });

  window.once('ready-to-show', () => window.show());

  if (process.env.VITE_DEV_SERVER_URL) {
    window.loadURL(devServerUrl);
  } else {
    window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

// Debug overlay: one reusable click-through window flashing the captured (red) or
// matched (green) anchor rect. Both flash sites live in this process — no IPC.
let overlayWindow = null;
let overlayHideTimer = null;
let overlayHtml = null;

function flashAnchor(x, y, width, height, color) {
  if (isTearingDown) return;
  try {
    const bounds = { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      overlayWindow = new BrowserWindow({
        ...bounds,
        show: false,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        focusable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        hasShadow: false,
      });
      overlayWindow.setIgnoreMouseEvents(true);
      overlayWindow.on('closed', () => {
        overlayWindow = null;
        overlayHtml = null;
      });
    }
    overlayWindow.setBounds(bounds);

    const html = `<html><body style="margin:0;background:transparent"><div style="box-sizing:border-box;width:100%;height:100%;border:3px solid ${color}"></div></body></html>`;
    const url = `data:text/html,${encodeURIComponent(html)}`;
    if (url !== overlayHtml) {
      overlayHtml = url;
      void overlayWindow.loadURL(url); // color changes only; geometry uses setBounds
    }
    overlayWindow.showInactive();

    // Single pending timer: rapid flashes restart it instead of stacking.
    if (overlayHideTimer) clearTimeout(overlayHideTimer);
    overlayHideTimer = setTimeout(() => {
      if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
    }, 400);
  } catch (error) {
    console.warn('[macro] Anchor overlay flash failed:', error.message);
  }
}

ipcMain.handle('automation:perform-step', async (_event, step) => {
  await performStep(step);
  return { success: true };
});
ipcMain.handle('automation:find-anchor', async (_event, visualAnchor) => {
  const result = findTemplateOnScreen(visualAnchor);
  if (result.found) {
    // Green flash: where the matcher actually looked (absolute virtual-screen coords).
    flashAnchor(
      result.matchX,
      result.matchY,
      visualAnchor?.width || ANCHOR_CAPTURE_WIDTH,
      visualAnchor?.height || ANCHOR_CAPTURE_HEIGHT,
      '#22c55e'
    );
  }
  return result;
});
ipcMain.handle('automation:check-watchdogs', async (_event, watchdogs) => {
  return checkWatchdogs(watchdogs);
});



// Diagnostic: write each step's visual anchor as a physical PNG next to the macro JSON
// so we can see exactly what the recorder captured. Failures never block saving.
function dumpAnchorImages(filePath, data) {
  try {
    const dir = path.dirname(filePath);
    const name = path.basename(filePath, path.extname(filePath));
    (data?.steps || []).forEach((step, index) => {
      const base64 = step.visualAnchor?.templateBase64;
      if (!base64) return;
      const pngPath = path.join(dir, `${name}_Step_${index + 1}.png`);
      fsSync.writeFileSync(pngPath, Buffer.from(base64, 'base64'));
    });
  } catch (error) {
    console.warn('[macro] Anchor image dump failed:', error.message);
  }
}

// Trust boundary: renderer-supplied paths must be absolute .json macro files.
function assertMacroPath(filePath) {
  if (!path.isAbsolute(filePath) || !filePath.toLowerCase().endsWith('.json')) {
    throw new Error('Invalid macro path');
  }
}

ipcMain.handle('dialog-save-as', async (_event, macroData) => {
  try {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Macro Project',
      defaultPath: 'macro-project.json',
      filters: [{ name: 'Macro JSON', extensions: ['json'] }],
    });

    if (canceled || !filePath) return null;

    const serializedMacro = JSON.stringify(macroData, null, 2);
    await fs.writeFile(filePath, serializedMacro, 'utf8');
    dumpAnchorImages(filePath, macroData);
    return filePath;
  } catch (error) {
    console.error('[macro] Failed to save macro project:', error);
    throw error;
  }
});

ipcMain.handle('dialog-open', async () => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Open Macro Project',
      properties: ['openFile'],
      filters: [{ name: 'Macro JSON', extensions: ['json'] }],
    });

    if (canceled || !filePaths?.[0]) return null;

    const filePath = filePaths[0];
    const serializedMacro = await fs.readFile(filePath, 'utf8');
    return { filePath, data: JSON.parse(serializedMacro) };
  } catch (error) {
    console.error('[macro] Failed to open macro project:', error);
    return null;
  }
});

ipcMain.handle('quick-save', async (_event, { filePath, data }) => {
  try {
    if (!filePath) return { success: false };
    assertMacroPath(filePath);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    dumpAnchorImages(filePath, data);
    return { success: true };
  } catch (error) {
    console.error('[macro] Failed to quick-save macro project:', error);
    throw error;
  }
});

// Used by playlist rehydration: read a macro at a known path without a file dialog.
ipcMain.handle('open-macro-at-path', async (_event, filePath) => {
  try {
    assertMacroPath(filePath);
    const serializedMacro = await fs.readFile(filePath, 'utf8');
    return { filePath, data: JSON.parse(serializedMacro) };
  } catch (error) {
    console.warn(`[macro] Playlist file unavailable, dropping it: ${filePath}`, error.message);
    return null;
  }
});

/*
 * Legacy PowerShell recorder intentionally disabled.
 * Recording now uses uiohook-napi directly in the Electron main process.
 */

function startGlobalInputHook() {
  if (!uiohook || inputHookStarted || isTearingDown) return false;

  try {
    uiohook.on('keydown', (event) => {
      if (isTearingDown || !mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send('macro-record-event', {
        type: 'keydown',
        keycode: event.keycode,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
      });
    });

    uiohook.on('mousedown', (event) => {
      if (isTearingDown || !mainWindow || mainWindow.isDestroyed()) return;
      let anchor = null;
      try {
        // Record the anchor in a web-UI shape so the template fits the button/nav
        // row instead of clipping it to a square.
        anchor = captureSnippet(event.x, event.y, ANCHOR_CAPTURE_WIDTH, ANCHOR_CAPTURE_HEIGHT);
      } catch (captureErr) {
        console.warn('[macro] Failed to capture visual snippet at mousedown:', captureErr.message);
      }

      if (isTearingDown || !mainWindow || mainWindow.isDestroyed()) return;

      mainWindow.webContents.send('macro-record-event', {
        type: 'mousedown',
        x: event.x,
        y: event.y,
        button: event.button,
        clicks: event.clicks,
        anchor: anchor || undefined,
      });

      if (anchor && !isTearingDown) {
        // Red flash: reconstruct the clamped capture rect (srcX = clickX - xPercent * width).
        flashAnchor(
          event.x - anchor.xPercent * anchor.width,
          event.y - anchor.yPercent * anchor.height,
          anchor.width,
          anchor.height,
          '#ef4444'
        );
      }
    });

    // Tracks the cursor for Shift+F8 watchdog capture (the hotkey itself never moves the mouse).
    uiohook.on('mousemove', (event) => {
      if (isTearingDown) return;
      lastMousePos = { x: event.x, y: event.y };
    });

    // Scroll recording: raw ticks over the existing record channel; the renderer
    // coalesces bursts into single summed 'scroll' steps (the JSON-bloat guard).
    uiohook.on('wheel', (event) => {
      if (isTearingDown || !mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send('macro-record-event', {
        type: 'wheel',
        x: event.x,
        y: event.y,
        rotation: event.rotation,
        direction: event.direction,
      });
    });

    uiohook.start();
    inputHookStarted = true;
    return true;
  } catch (error) {
    console.error('[macro] Failed to start uiohook-napi:', error);
    try {
      uiohook.stop();
    } catch {
      // Native hook was never fully started; there is nothing else to release.
    }
    return false;
  }
}

function registerGlobalHotkeys() {
  const recordRegistered = globalShortcut.register('F8', () => {
    if (isTearingDown || !mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('hotkey-toggle-record');
  });
  const playRegistered = globalShortcut.register('F3', () => {
    if (isTearingDown || !mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('hotkey-play-macro');
  });
  const resumeRegistered = globalShortcut.register('F9', () => {
    if (isTearingDown || !mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('hotkey-resume-macro');
  });
  const captureWatchdogRegistered = globalShortcut.register('Shift+F8', () => {
    if (isTearingDown || !mainWindow || mainWindow.isDestroyed()) return;
    let templateBase64 = null;
    if (lastMousePos) {
      try {
        templateBase64 = captureSnippet(lastMousePos.x, lastMousePos.y, 60, 60).pngBase64;
      } catch (error) {
        console.warn('[macro] Failed to capture watchdog snippet:', error.message);
      }
    }
    mainWindow.webContents.send('hotkey-capture-watchdog', { templateBase64: templateBase64 || undefined });
  });

  if (!recordRegistered || !playRegistered || !resumeRegistered || !captureWatchdogRegistered) {
    console.warn('[macro] F8, Shift+F8, F3, or F9 could not be registered as a global shortcut.');
  }
}

// Security: global DevTools lockdown - F12 / Ctrl+Shift+I/C/J blocked on EVERY
// webContents (main window, playlist popup, overlay). Application menu kept so
// Ctrl+C/V accelerators still work in text inputs.
app.on('web-contents-created', (_event, contents) => {
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase();
    if (input.key === 'F12' || (input.control && input.shift && ['i', 'c', 'j'].includes(key))) {
      event.preventDefault();
    }
  });
  contents.on('devtools-opened', () => contents.closeDevTools());
});

app.whenReady().then(() => {
  createWindow();
  registerGlobalHotkeys();
  startGlobalInputHook();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  teardownHooksAndWindows();
});

app.on('will-quit', () => {
  teardownHooksAndWindows();
});

app.on('window-all-closed', () => {
  teardownHooksAndWindows();
  if (process.platform !== 'darwin') app.quit();
});
