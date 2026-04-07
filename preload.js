const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vocalflow', {
  onGlobalHotkey: (callback) => {
    ipcRenderer.removeAllListeners('global-hotkey');
    ipcRenderer.on('global-hotkey', () => callback && callback());
  },
  getConfig: () => ipcRenderer.invoke('get-config'),
  pasteText: (text) => ipcRenderer.invoke('paste-text', text),
  transcribeAudio: (buffer) => ipcRenderer.invoke('transcribe-audio', buffer),
  processWithGroq: (text, options) => ipcRenderer.invoke('process-with-groq', text, options),
  fetchDeepgramBalance: () => ipcRenderer.invoke('fetch-deepgram-balance'),
  fetchGroqBalance: () => ipcRenderer.invoke('fetch-groq-balance'),
  chatWithGroq: (messages) => ipcRenderer.invoke('chat-with-groq', messages)
});
