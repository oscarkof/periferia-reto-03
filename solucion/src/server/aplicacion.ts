/**
 * Aplicación HTTP (PRD §6.1 · §6.4).
 *
 * Se construye como una **función**: el servidor de verdad (`src/server.ts`) la
 * levanta con `listen()`, y las pruebas la usan con `inject()` sin abrir un
 * puerto. Así lo que se prueba es exactamente lo que se sirve.
 *
 * Aquí no hay lógica de negocio: el prompt y el conocimiento se leen de disco una
 * vez, y cada ruta delega en `src/agent/` o en `src/llm/`.
 */
import Fastify, { type FastifyInstance } from "fastify"
import { cargarContextoAgente } from "../agent/prompt.ts"
import { MAX_ITERACIONES, MAX_TOKENS_SESION } from "../agent/loop.ts"
import type { Resultado } from "../core/tipos.ts"
import type { AdaptadorLlm } from "../llm/adapter.ts"
import { describirProveedor } from "../llm/fabrica.ts"
import { NOMBRES_VISIBLES } from "../tools/oc.ts"
import { registrarChat } from "./chat.ts"
import { montarFront } from "./estaticos.ts"
import { crearMemoria } from "./memoria.ts"
import { registrarSesiones } from "./sesiones.ts"

/** Todo lo que necesita la aplicación para arrancar. */
export interface OpcionesApp {
  /** Raíz del proyecto: de aquí salen `agent/`, `src/knowledge/`, `fixtures/` y `out/`. */
  directorio: string
  adaptador: AdaptadorLlm
  /** Correo de quien confirma en el chat (USUARIO_ANALISTA). */
  usuario: string
  /** Silencia los registros de la terminal (pruebas). */
  silencioso?: boolean
}

/** Crea la aplicación con sus rutas y el front montado. */
export async function crearAplicacion(opciones: OpcionesApp): Promise<Resultado<FastifyInstance>> {
  const contexto = cargarContextoAgente(opciones.directorio)
  if (!contexto.ok) return contexto

  const app = Fastify({ logger: false })
  const proveedor = describirProveedor(opciones.adaptador)

  // Diagnóstico: qué proveedor, qué herramientas y qué topes están en juego. Sin
  // claves, sin rutas y sin nada del contenido de las conversaciones.
  app.get("/api/health", async () => ({
    ok: true,
    fase: "F3",
    proveedor: proveedor.proveedor,
    modelo: proveedor.modelo,
    usuario: opciones.usuario,
    herramientas: [...NOMBRES_VISIBLES],
    maxIteraciones: MAX_ITERACIONES,
    maxTokensSesion: MAX_TOKENS_SESION,
  }))

  registrarChat(app, {
    directorio: opciones.directorio,
    adaptador: opciones.adaptador,
    prompt: contexto.data.prompt,
    conocimiento: contexto.data.conocimiento,
    memoria: crearMemoria(),
    usuario: opciones.usuario,
    ...(opciones.silencioso === undefined ? {} : { silencioso: opciones.silencioso }),
  })
  registrarSesiones(app)
  await montarFront(app, opciones.directorio)

  return { ok: true, data: app }
}
