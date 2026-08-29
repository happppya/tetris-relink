import type { ClientMessage, ServerMessage } from '../../shared/protocol.ts'

const DEFAULT_URL = 'ws://localhost:8787'

// treat an unset OR empty VITE_SERVER_URL as "use the localhost dev default" —
// CI builds pass an empty string when no repository variable is configured, and
// `'' ?? default` would otherwise keep the empty string and break WebSocket()
const rawServerUrl = import.meta.env.VITE_SERVER_URL as string | undefined

export const serverUrl = (): string => (rawServerUrl && rawServerUrl.trim().length > 0 ? rawServerUrl : DEFAULT_URL)

type Handler = (msg: ServerMessage) => void

export class NetConnection {
  private ws: WebSocket | null = null
  private handlers = new Set<Handler>()
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private closedByUser = false
  latency = 0

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  connect(url: string = serverUrl()): Promise<void> {
    if (this.connected) return Promise.resolve()
    return new Promise((resolve, reject) => {
      this.closedByUser = false
      const ws = new WebSocket(url)
      this.ws = ws
      ws.onopen = () => {
        this.startHeartbeat()
        resolve()
      }
      ws.onmessage = (ev) => {
        let msg: ServerMessage
        try {
          msg = JSON.parse(String(ev.data)) as ServerMessage
        } catch {
          return
        }
        if (msg.type === 'pong') this.latency = Math.max(0, performance.now() - msg.t)
        for (const h of this.handlers) h(msg)
      }
      ws.onclose = () => {
        this.stopHeartbeat()
        if (this.ws === ws) this.ws = null
        if (!this.closedByUser) {
          for (const h of this.handlers) h({ type: 'error', code: 'connection_lost', message: 'connection lost' })
        }
      }
      ws.onerror = () => {
        reject(new Error('could not connect to server'))
      }
    })
  }

  send(msg: ClientMessage): void {
    if (this.connected) this.ws!.send(JSON.stringify(msg))
  }

  onMessage(handler: Handler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  close(): void {
    this.closedByUser = true
    this.stopHeartbeat()
    this.ws?.close()
    this.ws = null
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.pingTimer = setInterval(() => this.send({ type: 'ping', t: performance.now() }), 2000)
  }

  private stopHeartbeat(): void {
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = null
  }
}

export const net = new NetConnection()