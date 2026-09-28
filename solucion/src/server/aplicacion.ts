/**
 * Aplicación HTTP (PRD §6.1 · §6.4).
 *
 * Se construye como una **función**: el servidor de verdad (`src/server.ts`) la
 * levanta con `listen()`, y las pruebas la usan con `inject()` sin abrir un
 * puerto. Así lo que se prueba es exactamente lo que se sirve.
 *
 * Rutas:
 *   · `GET  /`               el front de `web/` (sin build), si está en el repo;
 *   · `POST /api/chat`        el turno (SSE, o `?json=1` para una respuesta única);
 *   · `GET  /api/sessions/…`  las conversaciones guardadas;
 *   · `GET  /api/files`       lo que hay en `out/`;
 *   · `GET  /api/files/<ruta>` un archivo de `out/`, confinado a esa carpeta;
 *   · `GET  /api/health`      proveedor, herramientas, topes y casos del fixture.
 *
 * Aquí no hay lógica de negocio: el prompt y el conocimiento se leen de disco una
 * vez, y cada ruta delega en `src/agent/`, `src/llm/` o `src/core/`.
 */
import Fastify, { type FastifyInstance } from "fastify"
import fastifyStatic from "@fastify/static"
import fs from "node:fs"
import { cargarContextoAgente } from "../agent/prompt.ts"
import { MAX_ITERACIONES, MAX_TOKENS_SESION } from "../agent/loop.ts"
import { dirSolicitudes, validarIdCaso } from "../core/rutas.ts"
import type { Resultado } from "../core/tipos.ts"
import type { AdaptadorLlm } from "../llm/adapter.ts"
import { describirProveedor } from "../llm/fabrica.ts"
import { NOMBRES_VISIBLES } from "../tools/oc.ts"
import { registrarChat } from "./chat.ts"
import { leerDeOut, listarOut, raizFront } from "./estaticos.ts"
import { crearMemoria } from "./memoria.ts"
import { registrarSesiones } from "./sesiones.ts"

/** Todo lo que necesita la aplicación para arrancar. */
export interface OpcionesApp {
  /** Raíz del proyecto: de aquí salen `agent/`, `src/knowledge/`, `web/`, `fixtures/` y `out/`. */
  directorio: string
  adaptador: AdaptadorLlm
  /** Correo de quien confirma en el chat (USUARIO_ANALISTA). */
  usuario: string
  /** Silencia los registros de la terminal (pruebas). */
  silencioso?: boolean
}

/** Carpetas de caso que hay en el fixture, en orden. */
function casosDelFixture(): string[] {
  try {
    return fs
      .readdirSync(dirSolicitudes(), { withFileTypes: true })
      .filter((entrada) => entrada.isDirectory() && validarIdCaso(entrada.name).ok)
      .map((entrada) => entrada.name)
      .sort()
  } catch {
    return []
  }
}

/** Crea la aplicación con sus rutas y el front montado. */
export async function crearAplicacion(opciones: OpcionesApp): Promise<Resultado<FastifyInstance>> {
  const contexto = cargarContextoAgente(opciones.directorio)
  if (!contexto.ok) return contexto

  const app = Fastify({ logger: false })
  const proveedor = describirProveedor(opciones.adaptador)

  // El front de desarrollo puede servirse desde otro puerto; esto lo permite sin
  // tocar la configuración de nadie.
  app.addHook("onSend", async (_peticion, reply) => {
    reply.header("access-control-allow-origin", "*")
    reply.header("access-control-allow-headers", "content-type")
  })

  // El front se sirve solo si existe: la API funciona sin él (PRD §6.1).
  const raizWeb = raizFront(opciones.directorio)
  if (raizWeb !== null) {
    await app.register(fastifyStatic, { root: raizWeb, prefix: "/" })
  }

  // Diagnóstico: qué proveedor, qué herramientas, qué topes y qué casos hay. Sin
  // claves, sin rutas del servidor y sin nada del contenido de las conversaciones.
  app.get("/api/health", async () => ({
    ok: true,
    fase: "F4",
    proveedor: proveedor.proveedor,
    modelo: proveedor.modelo,
    usuario: opciones.usuario,
    herramientas: [...NOMBRES_VISIBLES],
    casos: casosDelFixture(),
    maxIteraciones: MAX_ITERACIONES,
    maxTokensSesion: MAX_TOKENS_SESION,
  }))

  app.get("/api/files", async () => {
    const listado = listarOut()
    return { ok: true, archivos: listado.ok ? listado.data : [] }
  })

  app.get<{ Params: { "*": string } }>("/api/files/*", async (peticion, reply) => {
    const partes = (peticion.params["*"] ?? "").split("/").filter((parte) => parte !== "")
    const archivo = leerDeOut(partes)
    if (!archivo.ok) return reply.code(404).send({ ok: false, error: archivo.error })

    return reply
      .header("content-type", archivo.data.tipo)
      .header("content-disposition", `inline; filename="${archivo.data.nombre}"`)
      .send(archivo.data.contenido)
  })

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

  return { ok: true, data: app }
}

