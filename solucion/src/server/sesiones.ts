/**
 * Rutas de sesiones (PRD §6.4).
 *
 *   · `GET /api/sessions` → qué conversaciones hay guardadas;
 *   · `GET /api/sessions/:id` → la conversación completa, con su historial de
 *     herramientas y si quedó algo esperando confirmación.
 *
 * Las dos son de **lectura**: devuelven lo que quedó en `out/sessions/`. Sirven
 * para que el front pueda reconstruir una conversación recargada (o abrir una de
 * ayer) sin volver a preguntarle nada al modelo.
 */
import type { FastifyInstance } from "fastify"
import { cargarSesion, idValido, listarSesiones } from "../agent/sesion.ts"

/** Registra las rutas de sesiones. */
export function registrarSesiones(app: FastifyInstance): void {
  app.get("/api/sessions", async () => {
    const listado = listarSesiones()
    return { ok: true, sesiones: listado.ok ? listado.data : [] }
  })

  app.get<{ Params: { id: string } }>("/api/sessions/:id", async (peticion, reply) => {
    const id = peticion.params.id
    if (!idValido(id)) return reply.code(400).send({ ok: false, error: "identificador de sesión inválido" })

    const sesion = cargarSesion(id)
    if (!sesion.ok) return reply.code(404).send({ ok: false, error: sesion.error })

    return { ok: true, sesion: sesion.data }
  })
}
