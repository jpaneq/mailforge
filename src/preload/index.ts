import { contextBridge, ipcRenderer } from 'electron'

const call = (ch: string) => (...a: unknown[]) => ipcRenderer.invoke(ch, ...a)
const api = {
  accounts: { list: call('accounts:list'), presets: call('accounts:presets'), add: call('accounts:add'), remove: call('accounts:remove'), signature: call('accounts:signature') },
  mail: { list: call('mail:list'), thread: call('mail:thread'), sync: call('mail:sync'), flag: call('mail:flag'), snooze: call('mail:snooze'), move: call('mail:move') },
  send: { now: call('send:now'), schedule: call('send:schedule'), list: call('send:list'), cancel: call('send:cancel'), draft: call('send:draft'), draftDelete: call('send:draftDelete') },
  autodraft: { save: call('autodraft:save'), list: call('autodraft:list'), delete: call('autodraft:delete') },
  tracked: { list: call('tracked:list') },
  templates: { list: call('templates:list'), save: call('templates:save'), delete: call('templates:delete') },
  settings: { get: call('settings:get'), set: call('settings:set') }
}
contextBridge.exposeInMainWorld('api', api)
export type Api = typeof api
