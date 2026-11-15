'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('island', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
  openSettingsFile: () => ipcRenderer.invoke('settings:open-file'),
  pickFile: () => ipcRenderer.invoke('dialog:pick-file'),
  appInfo: () => ipcRenderer.invoke('app:info'),

  getNotes: () => ipcRenderer.invoke('notes:get'),
  saveNotes: (text) => ipcRenderer.invoke('notes:save', text),
  copyText: (text) => ipcRenderer.send('clipboard:write', text),
  flushDone: () => ipcRenderer.send('app:flush-done'),

  setExpanded: (value) => ipcRenderer.send('island:set-expanded', value),
  dragStart: (x, y) => ipcRenderer.send('window:drag-start', x, y),
  dragMove: (x, y) => ipcRenderer.send('window:drag-move', x, y),
  dragEnd: () => ipcRenderer.send('window:drag-end'),

  getProcesses: (options) => ipcRenderer.invoke('processes:get', options),
  killProcess: (pid) => ipcRenderer.invoke('process:kill', pid),
  runEntry: (id) => ipcRenderer.invoke('quicklaunch:run', id),
  getIcons: () => ipcRenderer.invoke('quicklaunch:icons'),

  quit: () => ipcRenderer.send('app:quit'),
  hide: () => ipcRenderer.send('app:hide'),

  onStats: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('stats:tick', listener);
    return () => ipcRenderer.removeListener('stats:tick', listener);
  },
  onSettingsChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('settings:changed', listener);
    return () => ipcRenderer.removeListener('settings:changed', listener);
  },
  onExpanded: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('island:state', listener);
    return () => ipcRenderer.removeListener('island:state', listener);
  },
  onOpenSettings: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('ui:open-settings', listener);
    return () => ipcRenderer.removeListener('ui:open-settings', listener);
  },
  onOpenNotes: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('ui:open-notes', listener);
    return () => ipcRenderer.removeListener('ui:open-notes', listener);
  },
  onFlush: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('ui:flush', listener);
    return () => ipcRenderer.removeListener('ui:flush', listener);
  },
  onToast: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('ui:toast', listener);
    return () => ipcRenderer.removeListener('ui:toast', listener);
  }
});
