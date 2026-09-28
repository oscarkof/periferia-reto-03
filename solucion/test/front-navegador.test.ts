/**
 * El front del chat, ejecutado de verdad (PRD §6.1 · CA3 · CA4).
 *
 * Se pueden probar el HTML, el CSS y el parser SSE por separado y, aun así, que
 * llegue a la pantalla un botón que no hace nada con la suite entera en verde. Aquí
 * `web/app.js` se carga en un contexto con DOM falso (`test-utils/front.ts`) y su
 * `fetch` va contra el backend real con `app.inject()`, así que lo que se recorre
 * es el camino completo: arranque, stream SSE troceado a propósito, tarjetas de
 * herramienta, confirmación humana por el botón, archivos y fallos.
 *
 * Cada prueba monta su servidor con el proveedor `mock` y su propio `OUT_DIR`
 * temporal: el `out/` del repositorio no se toca.
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
import { cargarFront, conClase, type Front, type Nodo } from "../test-utils/front.ts"

const RAIZ = path.resolve(import.meta.dirname, "..")
const USUARIO = "ana.analista@periferia-ficticia.com"
const apps: FastifyInstance[] = []
const temporales: string[] = []

after(async () => {
  for (const app of apps) await app.close()
  delete process.env["OUT_DIR"]
  for (const carpeta of temporales) fs.rmSync(carpeta, { recursive: true, force: true })
})

/** Servidor real con el guion determinista, sobre un `out/` temporal. */
async function montar(): Promise<FastifyInstance> {
  const salida = fs.mkdtempSync(path.join(os.tmpdir(), "reto03-front-"))
  temporales.push(salida)
  process.env["OUT_DIR"] = salida

  const adaptador = crearAdaptador({ proveedor: "mock", guionMock: guionReactivo() })
  if (!adaptador.ok) throw new Error(adaptador.error)

  const app = await crearAplicacion({
    directorio: RAIZ,
    adaptador: adaptador.data,
    usuario: USUARIO,
    silencioso: true,
  })
  if (!app.ok) throw new Error(app.error)

  apps.push(app.data)
  return app.data
}

/** El único nodo con esa clase, o falla diciendo cuántos hay. */
function soloUno(nodos: Nodo[], que: string): Nodo {
  assert.equal(nodos.length, 1, `se esperaba un solo ${que} y hay ${nodos.length}`)
  const nodo = nodos[0]
  if (nodo === undefined) throw new Error(`no se pintó ${que}`)
  return nodo
}

/** Cuerpo JSON de la última petición al chat. */
function cuerpoDelChat(front: Front): { sessionId?: string; message?: string } {
  const peticiones = front.peticiones.filter((peticion) => peticion.url === "/api/chat")
  const ultima = peticiones[peticiones.length - 1]
  assert.ok(ultima !== undefined, "el front no llegó a pedir un turno al backend")
  return JSON.parse(ultima.cuerpo) as { sessionId?: string; message?: string }
}

/* ── Arranque ─────────────────────────────────────────────────────────────── */

test("el front arranca contra el backend y pinta cabecera, sesión y casos", async () => {
  const front = await cargarFront(await montar())
  await front.listo()

  assert.match(front.nodo("#estado-servidor").textContent, /mock/)
  assert.equal(front.nodo("#dato-usuario").textContent, USUARIO)
  assert.notEqual(front.nodo("#dato-sesion").textContent, "")
  assert.ok(conClase(front.nodo("#sugerencias"), "sugerencia").length >= 3, "hay ejemplos para arrancar")

  // El fixture trae los seis casos y el panel los ofrece uno por uno.
  const casos = conClase(front.nodo("#casos"), "caso")
  assert.equal(casos.length, 6, `se esperaban 6 casos y hay ${casos.length}`)
  assert.match(casos[0]?.textContent ?? "", /sol-001/)

  assert.ok(
    front.consola.some((linea) => linea.includes("[front] cargado")),
    `la consola dice qué versión corre: ${front.consola.join(" | ")}`,
  )
})

/* ── El turno completo, con cada llamada a la vista (CA4) ─────────────────── */

test("un caso apto se resuelve en pantalla con sus cinco tarjetas de herramienta (CA4)", async () => {
  const front = await cargarFront(await montar())
  await front.listo()

  await front.llamar("enviar", "procesa sol-001")

  const conversacion = front.nodo("#conversacion")
  assert.equal(conClase(conversacion, "turno").length, 2, "un turno de la persona y uno del agente")

  const tarjetas = conClase(conversacion, "llamada")
  assert.deepEqual(
    tarjetas.map((tarjeta) => tarjeta.dataset["herramienta"]),
    ["oc_leer_paquete", "oc_validar", "oc_construir_payload", "oc_generar_evidencia", "oc_crear"],
  )
  for (const tarjeta of tarjetas) {
    assert.match(tarjeta.textContent, /ok · /, `la tarjeta de ${tarjeta.dataset["herramienta"]} trae su resultado`)
    assert.match(tarjeta.textContent, /\{"caso"/, "y también los argumentos con los que se llamó")
  }
  assert.ok(tarjetas.every((tarjeta) => tarjeta.classList.contains("llamada--ok")), "ninguna herramienta falló")

  const agente = soloUno(conClase(conversacion, "turno--agente"), "turno del agente")
  assert.match(agente.textContent, /4500000001/, "el número de la OC queda en el chat")
  assert.equal(front.nodo("#pensando").hidden, true, "el indicador de trabajo se apaga")
  assert.equal(front.nodo("#confirmacion").hidden, true, "no había nada que confirmar")
  assert.equal(cuerpoDelChat(front).message, "procesa sol-001")
})

test("el panel ofrece lo generado en out/ y se descarga sin salir de out/ (PRD §6.4)", async () => {
  const front = await cargarFront(await montar())
  await front.listo()
  await front.llamar("enviar", "procesa sol-001")

  // El listado de `out/` se pide al terminar el turno, así que hay que darle su
  // momento antes de mirarlo (el front no bloquea la respuesta por pintarlo).
  await front.esperar(() => conClase(front.nodo("#archivos"), "archivo").length > 0)

  const enlaces = conClase(front.nodo("#archivos"), "archivo")
  const rutas = enlaces.map((enlace) => enlace.href)
  assert.ok(rutas.some((ruta) => ruta.endsWith("/api/files/control.csv")), `faltó control.csv: ${rutas.join(" | ")}`)
  assert.ok(
    rutas.some((ruta) => ruta.endsWith("/api/files/sap/ordenes/4500000001.json")),
    `faltó la orden del simulador: ${rutas.join(" | ")}`,
  )

  const app = apps[apps.length - 1]
  assert.ok(app !== undefined)

  const control = await app.inject({ method: "GET", url: "/api/files/control.csv" })
  assert.equal(control.statusCode, 200)
  assert.match(control.headers["content-type"] ?? "", /text\/csv/)

  // Un intento de salir de `out/` no sirve nada: la ruta está confinada.
  const escape = await app.inject({ method: "GET", url: "/api/files/%2e%2e%2fpackage.json" })
  assert.equal(escape.statusCode, 404)
})

/* ── La confirmación humana, por el botón (CA3) ───────────────────────────── */

test("un caso con excepciones resalta la confirmación y el botón manda el «sí» (CA3)", async () => {
  const front = await cargarFront(await montar())
  await front.listo()

  await front.llamar("enviar", "procesa sol-004")

  const conversacion = front.nodo("#conversacion")
  const agente = soloUno(conClase(conversacion, "turno--agente"), "turno del agente")
  assert.ok(agente.classList.contains("turno--confirmacion"), "el turno que pide confirmación queda resaltado")
  assert.equal(front.nodo("#confirmacion").hidden, false, "y la banda de confirmación está visible")
  assert.match(front.nodo("#confirmacion-detalle").textContent, /RC5/, "dice qué hay que confirmar y con qué valores")

  // El botón manda el «sí» explícito y el turno siguiente crea la orden.
  front.nodo("#boton-confirmar").disparar("click")
  await front.esperar(() => conClase(conversacion, "turno").length === 4 && front.nodo("#pensando").hidden === true)

  assert.equal(cuerpoDelChat(front).message, "sí, confirmo", "el botón manda una confirmación explícita")
  assert.equal(front.nodo("#confirmacion").hidden, true, "ya no queda nada pendiente")
  assert.match(front.nodo("#conversacion").textContent, /4500000001/)
})

/* ── El envío, que es donde el front se quedaba mudo ──────────────────────── */

test("un mensaje vacío avisa sin llamar al backend y el aviso se limpia al turno siguiente", async () => {
  const front = await cargarFront(await montar())
  await front.listo()

  await front.llamar("enviar", "   ")
  assert.match(front.nodo("#aviso").textContent, /Escribe un mensaje antes de enviar/)
  assert.equal(front.peticiones.filter((peticion) => peticion.url === "/api/chat").length, 0)

  await front.llamar("enviar", "procesa sol-001")
  assert.equal(front.nodo("#aviso").textContent, "", "el aviso anterior no se queda encima del turno nuevo")
  assert.equal(front.nodo("#aviso").hidden, true)
  assert.equal(conClase(front.nodo("#conversacion"), "turno").length, 2, "y el turno se pinta igual")
})

test("el clic en Enviar arranca el turno una sola vez, aunque no haya submit", async () => {
  const front = await cargarFront(await montar())
  await front.listo()

  front.nodo("#entrada").value = "procesa sol-002"
  front.documento.disparar("click", { preventDefault: () => {}, target: front.nodo("#boton-enviar") })

  await front.esperar(
    () => conClase(front.nodo("#conversacion"), "turno").length >= 2 && front.nodo("#pensando").hidden === true,
  )

  const deChat = front.peticiones.filter((peticion) => peticion.url === "/api/chat")
  assert.equal(deChat.length, 1, "un clic manda exactamente un mensaje")
  assert.equal(cuerpoDelChat(front).message, "procesa sol-002")
  assert.equal(typeof cuerpoDelChat(front).sessionId, "string")
  assert.ok(
    front.consola.some((linea) => linea.includes("[front] enviando")),
    `la consola avisa del envío: ${front.consola.join(" | ")}`,
  )
})

/* ── Fallos ───────────────────────────────────────────────────────────────── */

test("si el backend no responde, el fallo se ve en pantalla y el turno queda marcado", async () => {
  const front = await cargarFront(await montar())
  await front.listo()

  front.contexto.fetch = () => Promise.reject(new Error("sin conexión con el backend"))

  await front.llamar("enviar", "procesa sol-001")

  const agente = soloUno(conClase(front.nodo("#conversacion"), "turno--agente"), "turno del agente")
  assert.ok(agente.classList.contains("turno--error"), "el turno que falló queda marcado")
  assert.match(agente.textContent, /No pude completar el turno: sin conexión con el backend/)
  assert.match(front.nodo("#aviso").textContent, /No pude completar el turno: sin conexión con el backend/)
  assert.equal(front.nodo("#pensando").hidden, true, "el indicador se apaga aunque el turno falle")
})

/* ── Saber qué versión estás mirando ─────────────────────────────────────── */

test("la versión del pie, la de la consola y la del cache-busting son la misma", () => {
  const html = fs.readFileSync(path.join(RAIZ, "web", "index.html"), "utf8")
  const guion = fs.readFileSync(path.join(RAIZ, "web", "app.js"), "utf8")

  const version = /\?v=(\d+)/.exec(html)?.[1]
  assert.ok(version !== undefined, "el HTML debe cache-bustear el guion con `?v=`")
  assert.match(html, new RegExp(`interfaz v${version}`), "el pie debe decir la versión que se sirve")
  assert.match(guion, new RegExp(`cargado · v${version}`), "y la consola la misma")
})

