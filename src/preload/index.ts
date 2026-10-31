import { contextBridge, ipcRenderer } from 'electron';
import type { CompanionBridge, CompanionEvent } from '../shared/contracts.js';

const bridge: CompanionBridge = {
  bootstrap: () => ipcRenderer.invoke('companion:bootstrap'),
  testConnection: () => ipcRenderer.invoke('companion:test'),
  sessions: () => ipcRenderer.invoke('companion:sessions'),
  createSession: () => ipcRenderer.invoke('companion:create-session'),
  saveSettings: (settings) => ipcRenderer.invoke('companion:settings', settings),
  storeCredential: (provider, value) => ipcRenderer.invoke('companion:credential', provider, value),
  chooseModel: () => ipcRenderer.invoke('companion:model'),
  previewCharacter: (preset) => ipcRenderer.invoke('companion:preview', preset),
  send: (text, selectionId) => ipcRenderer.invoke('companion:send', text, selectionId),
  cancel: (requestId) => ipcRenderer.invoke('companion:cancel', requestId),
  reconcile: (requestId) => ipcRenderer.invoke('companion:reconcile', requestId),
  approve: (id, decision, requestId) =>
    ipcRenderer.invoke('companion:approve', id, decision, requestId),
  openChat: () => ipcRenderer.invoke('companion:chat'),
  openSettings: () => ipcRenderer.invoke('companion:open-settings'),
  openOverlayMenu: () => ipcRenderer.invoke('companion:overlay-menu'),
  displays: () => ipcRenderer.invoke('companion:displays'),
  moveToDisplay: (id) => ipcRenderer.invoke('companion:display', id),
  move: (dx, dy) => ipcRenderer.invoke('companion:move', dx, dy),
  resizeOverlay: (deltaY, screenX, screenY) =>
    ipcRenderer.invoke('companion:resize', deltaY, screenX, screenY),
  setDragging: (active) => ipcRenderer.send('companion:drag', active),
  hitTest: (hit) => ipcRenderer.send('companion:hit', hit),
  setInputRegion: (region) => ipcRenderer.send('companion:input-region', region),
  onEvent(listener) {
    const callback = (_: unknown, event: CompanionEvent) => listener(event);
    ipcRenderer.on('companion:event', callback);
    return () => ipcRenderer.removeListener('companion:event', callback);
  },
};
contextBridge.exposeInMainWorld('companion', bridge);
