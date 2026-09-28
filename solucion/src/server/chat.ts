/**
 * Ruta de conversación (PRD §6.4).
 *
 * `POST /api/chat` con `{ sessionId?, message }`:
 *   · por defecto responde con un **stream SSE** de eventos, para que el front
 *     muestre cada llamada a herramienta mientras ocurre (CA4);
 *   · con `?json=1` devuelve una sola respuesta JSON, que es lo que usan las
 *     pruebas, `curl` y cualquier integración sin streaming.
 *
 * Aquí no hay lógica de negocio: el turno lo ejecuta `src/agent/loop.ts`, y este
 * archivo solo traduce HTTP ↔ eventos y registra lo que pasó en la terminal.
 */
import type { FastifyInstance, FastifyReply } from "fastify"
import type { EventoTurno } from "../agent/eventos.ts"
import { ejecutarTurno } from "../agent/loop.ts"
import { idValido, type Sesion } from "../agent/sesion.ts"
import type { AdaptadorLlm } from "../llm/adapter.ts"
import { nuevoId } from "./identificadores.ts"
import { obtenerSesion, type MemoriaSesiones } from "./memoria.ts"

/** Cuerpo esperado por la ruta. */
interface CuerpoChat {
  sessionId?: unknown
  message?: unknown
}

/** Dependencias de la ruta de chat. */
export interface OpcionesChat {
  directorio: string
  adaptador: AdaptadorLlm
  prompt: string
  conocimiento: string
  memoria: MemoriaSesiones
  /** Correo de quien confirma en el chat: lo impone el ciclo al firmar (CA3). */
  usuario: string
  /** Silencia los registros de la terminal (pruebas). */
  silencioso?: boolean
}

/** Cabeceras del stream SSE. */
function cabecerasSse(): Record<string, string> {
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "access-control-allow-origin": "*",
    "x-accel-buffering": "no",
  }
}

/** Escribe un evento como mensaje SSE. */
function escribirEvento(
  canal: FastifyReply["raw"],
  evento: EventoTurno | { tipo: "inicio"; sessionId: string },
): void {
  canal.write(`data: ${JSON.stringify(evento)}\n\n`)
}

/** Hora local, para que el registro se lea junto al resto de la terminal. */
function hora(): string {
  return new Date().toTimeString().slice(0, 8)
}

/** Registra `POST /api/chat`. */
export function registrarChat(app: FastifyInstance, opciones: OpcionesChat): void {
  const { directorio, adaptador, prompt, conocimiento, memoria, usuario } = opciones
  const registrar = (linea: string): void => {
    if (opciones.silencioso !== true) console.log(linea)
  }

  app.post<{ Body: CuerpoChat; Querystring: { json?: string } }>("/api/chat", async (peticion, reply) => {
    const cuerpo = peticion.body ?? {}
    const mensaje = typeof cuerpo.message === "string" ? cuerpo.message.trim() : ""
    if (mensaje === "") return reply.code(400).send({ ok: false, error: "falta el mensaje del usuario" })

    const solicitado = typeof cuerpo.sessionId === "string" ? cuerpo.sessionId.trim() : ""
    const id = solicitado === "" ? nuevoId() : solicitado
    if (!idValido(id)) return reply.code(400).send({ ok: false, error: "identificador de sesión inválido" })

    const sesion: Sesion = obtenerSesion(id, memoria, usuario)
    const eventos: EventoTurno[] = []
    const comunes = { directorio, sesion, mensajeUsuario: mensaje, adaptador, prompt, conocimiento }

    // Registro en la terminal: sin esto no hay forma de saber si la petición llegó,
    // cuánto tardó y si el front se quedó esperando.
    const inicio = Date.now()
    const segundos = (): string => `${((Date.now() - inicio) / 1000).toFixed(1)} s`
    registrar(`[${hora()}] POST /api/chat · sesión ${id} · ${JSON.stringify(mensaje.slice(0, 80))}`)

    if (peticion.query.json === "1") {
      const resultado = await ejecutarTurno({ ...comunes, emitir: (evento) => eventos.push(evento) })
      if (!resultado.ok) {
        registrar(`[${hora()}] POST /api/chat · sesión ${id} · error en ${segundos()}: ${resultado.error}`)
        return reply.code(502).send({ ok: false, error: resultado.error, sessionId: id })
      }
      registrar(
        `[${hora()}] POST /api/chat · sesión ${id} · fin en ${segundos()} · ` +
          `${eventos.filter((evento) => evento.tipo === "llamada").length} llamadas · ` +
          `needsConfirmation=${resultado.data.needsConfirmation}`,
      )
      return {
        ok: true,
        sessionId: id,
        reply: resultado.data.texto,
        needsConfirmation: resultado.data.needsConfirmation,
        toolCalls: eventos.filter((evento) => evento.tipo === "llamada"),
        eventos,
      }
    }

    // Streaming: se toma el control de la respuesta.
    reply.hijack()
    const canal = reply.raw
    canal.writeHead(200, cabecerasSse())
    escribirEvento(canal, { tipo: "inicio", sessionId: id })

    const resultado = await ejecutarTurno({
      ...comunes,
      emitir: (evento) => {
        eventos.push(evento)
        escribirEvento(canal, evento)
      },
    })

    if (!resultado.ok) {
      registrar(`[${hora()}] POST /api/chat · sesión ${id} · error en ${segundos()}: ${resultado.error}`)
      escribirEvento(canal, { tipo: "error", texto: resultado.error })
    }
    canal.write("data: [DONE]\n\n")
    canal.end()

    registrar(
      `[${hora()}] POST /api/chat · sesión ${id} · stream cerrado en ${segundos()} · ` +
        `${eventos.filter((evento) => evento.tipo === "llamada").length} llamadas`,
    )
  })
}
