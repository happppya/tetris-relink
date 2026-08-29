import { createServer, type Server } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import type { ServerMessage } from '../shared/protocol.ts'

/**
 * A WebSocket proxy that drops server-to-client messages to simulate packet
 * loss. With `dropTypes` set, only those message types are dropped (each at
 * `lossRate`, decided by `rng`); otherwise every server message is dropped at
 * `lossRate`. Client-to-server traffic passes through untouched.
 */
export class LossyProxy {
  readonly server: Server
  private sockets = new Set<WebSocket>()
  private readonly lossRate: number
  private readonly rng: () => number
  private readonly dropTypes?: readonly string[]

  constructor(targetPort: number, lossRate: number, rng: () => number = Math.random, dropTypes?: readonly string[]) {
    this.lossRate = lossRate
    this.rng = rng
    this.dropTypes = dropTypes
    this.server = createServer()
    const wss = new WebSocketServer({ server: this.server })
    wss.on('connection', (clientWs) => {
      const upstream = new WebSocket(`ws://localhost:${targetPort}`)
      this.sockets.add(clientWs)
      // the upstream link is established asynchronously; buffer client messages
      // sent before it opens so the very first message (e.g. create_lobby) is
      // never silently dropped under load
      const pending: import('ws').RawData[] = []
      upstream.on('open', () => {
        while (pending.length) upstream.send(pending.shift()!)
      })
      clientWs.on('message', (data) => {
        if (upstream.readyState === WebSocket.OPEN) upstream.send(data)
        else pending.push(data)
      })
      upstream.on('message', (data) => {
        if (this.dropTypes) {
          let type: string | null = null
          try {
            type = (JSON.parse(data.toString()) as ServerMessage).type
          } catch {
            type = null
          }
          if (type && this.dropTypes.includes(type) && this.rng() < this.lossRate) return
        } else if (this.rng() < this.lossRate) {
          return
        }
        if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data)
      })
      clientWs.on('close', () => {
        this.sockets.delete(clientWs)
        upstream.close()
      })
      upstream.on('close', () => clientWs.close())
    })
  }

  listen(port: number): void {
    this.server.listen(port)
  }

  close(): void {
    for (const ws of this.sockets) ws.close()
    this.server.close()
  }
}