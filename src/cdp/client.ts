import { CDPConnectionError, CDPDomainError } from './errors'

type Debuggee = chrome.debugger.Debuggee

const PROTOCOL_VERSION = '1.3'

export class CDPClient {
  private attached = false
  private readonly debuggee: Debuggee

  constructor(debuggee: Debuggee) {
    this.debuggee = debuggee
  }

  async attach() {
    if (this.attached) return
    try {
      await chrome.debugger.attach(this.debuggee, PROTOCOL_VERSION)
      this.attached = true
    } catch (error) {
      throw new CDPConnectionError(String(error))
    }
  }

  async detach() {
    if (!this.attached) return
    try {
      await chrome.debugger.detach(this.debuggee)
    } finally {
      this.attached = false
    }
  }

  async send<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    try {
      return (await chrome.debugger.sendCommand(this.debuggee, method, params)) as T
    } catch (error) {
      const domain = method.split('.')[0] || 'CDP'
      throw new CDPDomainError(domain, String(error))
    }
  }
}

export const createCDPClientForTab = (tabId: number) => new CDPClient({ tabId })
