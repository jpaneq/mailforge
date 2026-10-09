import { contextBridge, ipcRenderer } from 'electron'

const call = (ch: string) => (...a: unknown[]) => ipcRenderer.invoke(ch, ...a)
const api = {
  accounts: { list: call('accounts:list'), presets: call('accounts:presets'), add: call('accounts:add'), remove: call('accounts:remove') },
  signatures: { list: call('signatures:list'), save: call('signatures:save'), delete: call('signatures:delete') },
  mail: { list: call('mail:list'), thread: call('mail:thread'), sync: call('mail:sync'), flag: call('mail:flag'), snooze: call('mail:snooze'), move: call('mail:move'), spam: call('mail:spam'), notSpam: call('mail:notspam'), counts: call('mail:counts'), get: call('mail:get'), attachments: call('mail:attachments'), saveAttachment: call('mail:saveAttachment') },
  send: { now: call('send:now'), schedule: call('send:schedule'), list: call('send:list'), cancel: call('send:cancel'), draft: call('send:draft'), draftDelete: call('send:draftDelete') },
  autodraft: { save: call('autodraft:save'), list: call('autodraft:list'), get: call('autodraft:get'), delete: call('autodraft:delete') },
  compose: { open: call('compose:open') },
  tracked: { list: call('tracked:list') },
  templates: { list: call('templates:list'), save: call('templates:save'), delete: call('templates:delete') },
  settings: { get: call('settings:get'), set: call('settings:set') }
}
contextBridge.exposeInMainWorld('api', api)
export type Api = typeof api
