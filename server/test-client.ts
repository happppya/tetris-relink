import { WebSocket } from 'ws'
import type { ClientMessage, ServerMessage } from '../shared/protocol.ts'

export interface SimulatedClient {
  send(message: ClientMessage): void
  waitFor<T extends ServerMessage['type']>(type: T): Promise<Extract<ServerMessage, { type: T }>>
  close(): Promise<void>
}

export async function connectSimulatedClient(url: string, name: string): Promise<SimulatedClient> {
  const ws = new WebSocket(url)
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve())
    ws.once('error', reject)
  })

  const waiters = new Set<{
    type: ServerMessage['type']
    resolve: (message: ServerMessage) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  ws.on('message', (data) => {
    let message: ServerMessage
    try {
      message = JSON.parse(data.toString()) as ServerMessage
    } catch {
      return
    }
    for (const waiter of [...waiters]) {
      if (waiter.type !== message.type) continue
      clearTimeout(waiter.timer)
      waiters.delete(waiter)
      waiter.resolve(message)
    }
  })

  const client: SimulatedClient = {
    send: (message) => {
      if (ws.readyState !== WebSocket.OPEN) throw new Error('simulated client is not connected')
      ws.send(JSON.stringify(message))
    },
    waitFor: <T extends ServerMessage['type']>(type: T) =>
      new Promise<Extract<ServerMessage, { type: T }>>((resolve, reject) => {
        const waiter = {
          type,
          resolve: (message: ServerMessage) => resolve(message as Extract<ServerMessage, { type: T }>),
          reject,
          timer: setTimeout(() => {
            waiters.delete(waiter)
            reject(new Error(`timeout waiting for ${type}`))
          }, 2000),
        }
        waiters.add(waiter)
      }),
    close: () =>
      new Promise<void>((resolve) => {
        if (ws.readyState === WebSocket.CLOSED) return resolve()
        ws.once('close', () => resolve())
        ws.close()
      }),
  }
  client.send({ type: 'hello', name })
  return client
}
