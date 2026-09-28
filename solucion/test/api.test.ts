/**
 * La API del chat (PRD §6.4).
 *
 * Se prueba con `inject()`: sin abrir puerto y sin modelo (`LLM_PROVIDER=mock`), de
 * modo que lo que se fija aquí es el **contrato HTTP**: el stream SSE, la respuesta
 * JSON, los códigos de error, las sesiones recuperables y que el «sí» de la
 * confirmación viaja en el segundo POST de la misma sesión.
 */
import { after, test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { FastifyInstance } from "fastify"
import { crearAdaptador } from "../src/llm/fabrica.ts"
import { guionReactivo } from "../src/llm/mock.ts"
import { crearAplicacion } from "../src/server/aplicacion.ts"
import { NOMBRES_VISIBLES } from "../src/tools/oc.ts"

const RAIZ = path.resolve(import.meta.dirname, "..")
const USUARIO = "ana.analista@periferia-ficticia.com"
const temporales: string[] = []
const aplicaciones: FastifyInstance[] = []

/** Aplicación nueva con su propio `out/`, ya lista para recibir peticiones. */
async function appFresca(): Promise<FastifyInstance> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reto03-api-"))
  temporales.push(dir)
  process.env["OUT_DIR"] = dir
  process.env["LLM_PROVIDER"] = "mock"

  const adaptador = crearAdaptador({ proveedor: "mock", guionMock: guionReactivo() })
  if (!adaptador.ok) throw new Error(`no se pudo construir el adaptador simulado: ${adaptador.error}`)

  const app = await crearAplicacion({
    directorio: RAIZ,
    adaptador: adaptador.data,
    usuario: USUARIO,
    silencioso: true,
  })
  if (!app.ok) throw new Error(`no se pudo construir la aplicación: ${app.error}`)

  aplicaciones.push(app.data)
  await app.data.ready()
  return app.data
}

after(async () => {
  for (const app of aplicaciones) await app.close()
  delete process.env["OUT_DIR"]
  delete process.env["LLM_PROVIDER"]
  for (const dir of temporales) fs.rmSync(dir, { recursive: true, force: true })
})

/** Un turno por la API, en modo JSON. */
async function conversar(app: FastifyInstance, sessionId: string, message: string) {
  const respuesta = await app.inject({
    method: "POST",
    url: "/api/chat?json=1",
    payload: { sessionId, message },
  })
  return respuesta
}

test('sin `json=1` la respuesta es un stream SSE con cada evento (CA4)', async () => {
  const app = await appFresca()
  const respuesta = await app.inject({
    method: "POST",
    url: "/api/chat",
    payload: { sessionId: "api-2", message: "procesa sol-001" },
  })

  assert.equal(respuesta.statusCode, 200)
  assert.match(respuesta.headers["content-type"] ?? "", /text\/event-stream/)
  assert.match(respuesta.body, /"tipo":"inicio"/)
  assert.match(respuesta.body, /"tipo":"llamada"/)
  assert.match(respuesta.body, /"tipo":"resultado"/)
  assert.match(respuesta.body, /"tipo":"fin"/)
  assert.match(respuesta.body, /data: \[DONE\]/)
})

test('el «sí» de la confirmación viaja en el segundo POST y crea la OC (CA3)', async () => {
  const app = await appFresca()

  const primero = await conversar(app, "api-3", "procesa sol-004")
  assert.equal(primero.statusCode, 200)
  const pausa = primero.json() as { needsConfirmation: boolean; reply: string }
  assert.equal(pausa.needsConfirmation, true)
  assert.match(pausa.reply, /RC5/)

  const segundo = await conversar(app, "api-3", "sí, confirmo")
  const cuerpo = segundo.json() as { needsConfirmation: boolean; reply: string }
  assert.equal(cuerpo.needsConfirmation, false)
  assert.match(cuerpo.reply, /4500000001/)
})

test('GET /api/sessions/:id devuelve el historial completo de la conversación', async () => {
  const app = await appFresca()
  await conversar(app, "api-4", "procesa sol-001")

  const respuesta = await app.inject({ method: "GET", url: "/api/sessions/api-4" })
  assert.equal(respuesta.statusCode, 200)
  const cuerpo = respuesta.json() as {
    ok: boolean
    sesion: { id: string; usuario: string; mensajes: { rol: string }[] }
  }
  assert.equal(cuerpo.ok, true)
  assert.equal(cuerpo.sesion.id, "api-4")
  assert.equal(cuerpo.sesion.usuario, USUARIO)
  assert.equal(cuerpo.sesion.mensajes.filter((mensaje) => mensaje.rol === "tool").length, 5)

  const listado = await app.inject({ method: "GET", url: "/api/sessions" })
  const lista = listado.json() as { ok: boolean; sesiones: string[] }
  assert.equal(lista.ok, true)
  assert.equal(lista.sesiones.includes("api-4"), true)
})

test('la API responde errores claros sin romperse (CA5)', async () => {
  const app = await appFresca()

  const sinMensaje = await app.inject({ method: "POST", url: "/api/chat?json=1", payload: { sessionId: "api-5" } })
  assert.equal(sinMensaje.statusCode, 400)
  assert.match(String((sinMensaje.json() as { error?: string }).error ?? ""), /mensaje/)

  const idInvalido = await conversar(app, "../etc", "procesa sol-001")
  assert.equal(idInvalido.statusCode, 400)

  const noExiste = await app.inject({ method: "GET", url: "/api/sessions/no-existe" })
  assert.equal(noExiste.statusCode, 404)

  // Y después de los errores, la aplicación sigue sirviendo.
  const despues = await conversar(app, "api-6", "procesa sol-001")
  assert.equal(despues.statusCode, 200)
})

test('GET / responde HTML mientras el front no está en el repositorio', async () => {
  const app = await appFresca()
  const respuesta = await app.inject({ method: "GET", url: "/" })

  assert.equal(respuesta.statusCode, 200)
  assert.match(respuesta.headers["content-type"] ?? "", /text\/html/)
  // Mientras no exista `web/`, la página explica dónde está la API; cuando F4 traiga
  // el front, seguirá siendo HTML y el mismo 200.
  assert.match(respuesta.body, /html/i)
})

test('GET /api/health dice el proveedor, las herramientas y los topes', async () => {
  const app = await appFresca()
  const respuesta = await app.inject({ method: "GET", url: "/api/health" })

  assert.equal(respuesta.statusCode, 200)
  const cuerpo = respuesta.json() as Record<string, unknown>
  assert.equal(cuerpo["ok"], true)
  assert.equal(cuerpo["proveedor"], "mock")
  assert.deepEqual(cuerpo["herramientas"], [...NOMBRES_VISIBLES])
  assert.equal(cuerpo["maxIteraciones"], 25)
  assert.equal(cuerpo["maxTokensSesion"], 200_000)
  // Nada de claves ni rutas del servidor en la respuesta pública.
  assert.equal(JSON.stringify(cuerpo).includes("sk-"), false)
  assert.equal(JSON.stringify(cuerpo).includes(os.tmpdir()), false)
})

test('POST /api/chat?json=1 devuelve la respuesta, las llamadas y los eventos', async () => {
  const app = await appFresca()
  const respuesta = await conversar(app, "api-1", "procesa sol-001")

  assert.equal(respuesta.statusCode, 200)
  const cuerpo = respuesta.json() as {
    ok: boolean
    sessionId: string
    reply: string
    needsConfirmation: boolean
    toolCalls: { nombre: string }[]
    eventos: { tipo: string }[]
  }
  assert.equal(cuerpo.ok, true)
  assert.equal(cuerpo.sessionId, "api-1")
  assert.match(cuerpo.reply, /4500000001/)
  assert.equal(cuerpo.needsConfirmation, false)
  assert.deepEqual(
    cuerpo.toolCalls.map((llamada) => llamada.nombre),
    ["oc_leer_paquete", "oc_validar", "oc_construir_payload", "oc_generar_evidencia", "oc_crear"],
  )
  assert.equal(cuerpo.eventos[cuerpo.eventos.length - 1]?.tipo, "fin")
})
