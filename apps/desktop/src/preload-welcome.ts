import type { AccountView, SignInAttemptId } from '@deepseek-ai/dsh-deepseek-account/types'
import type { RecentAccount } from './kito-login.ts'
/** Localized welcome copy and write-only credential actions. */

import { contextBridge, ipcRenderer } from 'electron'
import { resolveDesktopLocale } from './locale.ts'
import { WELCOME_IPC, type WelcomeApi, type WelcomeNotice, type WelcomeSaveResult } from './welcome-api.ts'

const prefix = '--dsh-welcome-locale='
const locale = process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length)
if (locale === undefined) throw new Error('desktop welcome: missing window locale')
const api: WelcomeApi = {
  ...resolveDesktopLocale(locale),
  analytics: async (eventName, attributes) => {
    if (await api.analyticsEnabled()) await ipcRenderer.invoke(WELCOME_IPC.analytics, eventName, attributes)
  },
  analyticsEnabled: () => ipcRenderer.invoke(WELCOME_IPC.analyticsEnabled) as Promise<boolean>,
  takeNotice: () => ipcRenderer.invoke(WELCOME_IPC.takeNotice) as Promise<WelcomeNotice | undefined>,
  startSignIn: (hint?: string) => ipcRenderer.invoke(WELCOME_IPC.start, hint) as Promise<AccountView>,
  pushSignIn: (id: SignInAttemptId | undefined, hint: string) => ipcRenderer.invoke(WELCOME_IPC.push, id, hint) as Promise<AccountView>,
  resendSignIn: (id: SignInAttemptId) => ipcRenderer.invoke(WELCOME_IPC.resend, id) as Promise<AccountView>,
  openSignIn: (id?: SignInAttemptId) => ipcRenderer.invoke(WELCOME_IPC.openQr, id) as Promise<void>,
  recentAccounts: () => ipcRenderer.invoke(WELCOME_IPC.recent) as Promise<readonly RecentAccount[]>,
  forgetRecentAccount: (accountNo: string) => ipcRenderer.invoke(WELCOME_IPC.forgetRecent, accountNo) as Promise<readonly RecentAccount[]>,
  cancelSignIn: (id: SignInAttemptId) => ipcRenderer.invoke(WELCOME_IPC.cancel, id) as Promise<AccountView>,
  copySignInLink: (id: SignInAttemptId) => ipcRenderer.invoke(WELCOME_IPC.copyLink, id) as Promise<void>,
  onAccountState: (listener) => {
    const receive = (_event: Electron.IpcRendererEvent, state: AccountView): void =>{  listener(state) }
    ipcRenderer.on(WELCOME_IPC.state, receive)
    return () => { ipcRenderer.removeListener(WELCOME_IPC.state, receive) }
  },
  saveApiKey: (value: string) => ipcRenderer.invoke(WELCOME_IPC.saveApiKey, value) as Promise<WelcomeSaveResult>,
  skip: () => ipcRenderer.invoke(WELCOME_IPC.skip) as Promise<void>,
}
contextBridge.exposeInMainWorld('dshWelcome', api)
