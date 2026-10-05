const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('macroAPI', {
  performStep: (step) => ipcRenderer.invoke('automation:perform-step', step),
  findTemplateOnScreen: (visualAnchor) => ipcRenderer.invoke('automation:find-anchor', visualAnchor),
  checkWatchdogs: (watchdogs) => ipcRenderer.invoke('automation:check-watchdogs', watchdogs),


  saveMacroAs: (data) => ipcRenderer.invoke('dialog-save-as', data),
  openMacroFile: () => ipcRenderer.invoke('dialog-open'),
  openMacroAt: (filePath) => ipcRenderer.invoke('open-macro-at-path', filePath),
  quickSaveMacro: (filePath, data) => ipcRenderer.invoke('quick-save', { filePath, data }),
  onMacroRecordEvent: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('macro-record-event', handler);
    return () => ipcRenderer.removeListener('macro-record-event', handler);
  },
  onHotkeyToggleRecord: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('hotkey-toggle-record', handler);
    return () => ipcRenderer.removeListener('hotkey-toggle-record', handler);
  },
  onHotkeyPlayMacro: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('hotkey-play-macro', handler);
    return () => ipcRenderer.removeListener('hotkey-play-macro', handler);
  },
  onHotkeyResumeMacro: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('hotkey-resume-macro', handler);
    return () => ipcRenderer.removeListener('hotkey-resume-macro', handler);
  },
  onHotkeyCaptureWatchdog: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('hotkey-capture-watchdog', handler);
    return () => ipcRenderer.removeListener('hotkey-capture-watchdog', handler);
  },
});
