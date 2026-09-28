/**
 * El ciclo del agente: CA1–CA5 (PRD §6.3).
 *
 * Todo corre con el proveedor **`mock`**: un guion determinista, sin red y sin
 * modelo, que lee el historial y decide el siguiente paso igual que lo haría el
 * agente real. Así lo que se prueba aquí es el **ciclo** —topes, confirmación
 * humana, auditoría, errores del proveedor— y no el humor de un modelo.
 *
 * El `out/` de cada prueba es temporal: el del repositorio no se toca.
 */
import { after, test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { esConfirmacionExplicita, esRechazo } from "../src/agent/confirmacion.ts"
import type { EventoTurno } from "../src/agent/eventos.ts"
import { ejecutarTurno, type OpcionesTurno } from "../src/agent/loop.ts"
import { AVISO_SIN_CONFIRMACION } from "../src/agent/paso.ts"
import { cargarContextoAgente } from "../src/agent/prompt.ts"
import { cargarSesion, crearSesion, type Sesion } from "../src/agent/sesion.ts"
import {
  CONFIRMADO_POR,
  crearAdaptadorMock,
  guionAlucinado,
  guionInfinito,
  guionReactivo,
  responderTexto,
  type GuionMock,
} from "../src/llm/mock.ts"
import { NOMBRES_VISIBLES } from "../src/tools/oc.ts"

const RAIZ = path.resolve(import.meta.dirname, "..")
/** Correo de la persona que está en el chat: es lo que debe quedar firmado (CA3). */
const USUARIO = "ana.analista@periferia-ficticia.com"
const temporales: string[] = []

/** `out/` propio por prueba y sesión de trabajo, como la abre el servidor. */
function entornoFresco(): Sesion {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reto03-bucle-"))
  temporales.push(dir)
  process.env["OUT_DIR"] = dir
  return crearSesion("prueba", USUARIO)
}

after(() => {
  delete process.env["OUT_DIR"]
  for (const dir of temporales) fs.rmSync(dir, { recursive: true, force: true })
})

/** Carpeta de salida de la prueba en curso. */
function dirOut(): string {
  return process.env["OUT_DIR"] ?? ""
}

/** Lee un JSON de `out/`, o `null` si no está. */
function leerJson(relativa: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dirOut(), relativa), "utf8")) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * La OC que quedó en el simulador de SAP.
 *
 * El archivo de `out/sap/ordenes/<numero>.json` envuelve el payload: el simulador
 * guarda `{ numero_oc, fecha_creacion, orden }`, así que aquí se devuelve el
 * `orden` de dentro, que es el contrato del PRD §7.4.
 */
function leerOrden(numero: string): Record<string, unknown> | null {
  const documento = leerJson(path.join("sap", "ordenes", `${numero}.json`))
  const orden = documento?.["orden"]
  return typeof orden === "object" && orden !== null ? (orden as Record<string, unknown>) : null
}

/** Contexto del agente, cargado del proyecto (nada embebido en la prueba). */
function contextoAgente(): { prompt: string; conocimiento: string } {
  const cargado = cargarContextoAgente(RAIZ)
  assert.ok(cargado.ok, cargado.ok ? "" : cargado.error)
  return cargado.data
}

/** Un turno, con los eventos recogidos para poder afirmar sobre ellos. */
async function turno(
  sesion: Sesion,
  mensaje: string,
  adaptador: ReturnType<typeof crearAdaptadorMock>,
  extra: Partial<Pick<OpcionesTurno, "maxIteraciones" | "maxTokensSesion">> = {},
): Promise<{ resultado: Awaited<ReturnType<typeof ejecutarTurno>>; eventos: EventoTurno[] }> {
  const eventos: EventoTurno[] = []
  const resultado = await ejecutarTurno({
    directorio: RAIZ,
    sesion,
    mensajeUsuario: mensaje,
    adaptador,
    ...contextoAgente(),
    emitir: (evento) => eventos.push(evento),
    ...extra,
  })
  return { resultado, eventos }
}

/** Nombres de las herramientas que el ciclo pidió, en orden. */
function nombresLlamados(eventos: readonly EventoTurno[]): string[] {
  return eventos.filter((evento) => evento.tipo === "llamada").map((evento) => evento.nombre)
}

/** Texto del turno, exigiendo que haya salido bien. */
function textoDe(resultado: Awaited<ReturnType<typeof ejecutarTurno>>): string {
  assert.equal(resultado.ok, true, resultado.ok ? "" : resultado.error)
  return resultado.ok ? resultado.data.texto : ""
}

// ── CA1 · el recorrido completo, sin intervención ────────────────────────────

test('un caso apto y sin excepciones llega a la OC en un solo turno (CA1)', async () => {
  const sesion = entornoFresco()
  const { resultado, eventos } = await turno(sesion, "procesa sol-001", crearAdaptadorMock({ guion: guionReactivo() }))

  assert.equal(resultado.ok, true)
  if (!resultado.ok) return
  assert.equal(resultado.data.needsConfirmation, false)
  assert.equal(resultado.data.llamadas, 5)
  assert.deepEqual(nombresLlamados(eventos), [
    "oc_leer_paquete",
    "oc_validar",
    "oc_construir_payload",
    "oc_generar_evidencia",
    "oc_crear",
  ])
  assert.match(resultado.data.texto, /4500000001/)
  // CA4: el turno quedó persistido y con la traza
  assert.equal(fs.existsSync(path.join(dirOut(), "log.jsonl")), true)
  assert.equal(fs.existsSync(path.join(dirOut(), "sap", "ordenes", "4500000001.json")), true)
  assert.equal(cargarSesion("prueba").ok, true)
})

test('el turno guarda el historial completo, incluidas las herramientas (CA4)', async () => {
  const sesion = entornoFresco()
  await turno(sesion, "procesa sol-001", crearAdaptadorMock({ guion: guionReactivo() }))

  const guardada = cargarSesion("prueba")
  assert.equal(guardada.ok, true)
  if (!guardada.ok) return

  const roles = guardada.data.mensajes.map((mensaje) => mensaje.rol)
  assert.equal(roles.filter((rol) => rol === "tool").length, 5)
  assert.equal(roles.includes("user"), true)
  assert.equal(guardada.data.usuario, USUARIO)
  // el resultado de `oc_crear` está en el historial, tal como lo vio el modelo
  assert.equal(
    guardada.data.mensajes.some((mensaje) => mensaje.rol === "tool" && /numero_oc/.test(mensaje.contenido)),
    true,
  )
})

test('el ciclo anuncia al modelo las cinco herramientas del contrato', async () => {
  const sesion = entornoFresco()
  let anunciadas: string[] = []
  let esquemas: Record<string, unknown>[] = []
  const capturador: GuionMock = (_mensajes, herramientas) => {
    anunciadas = herramientas.map((herramienta) => herramienta.nombre)
    esquemas = herramientas.map((herramienta) => herramienta.parametros)
    return responderTexto("listo")
  }

  await turno(sesion, "procesa sol-001", crearAdaptadorMock({ guion: capturador }))

  assert.deepEqual(anunciadas, [...NOMBRES_VISIBLES])
  for (const esquema of esquemas) {
    assert.equal(esquema["type"], "object")
    assert.equal(esquema["additionalProperties"], false)
  }
})

// ── CA3 · la confirmación humana ─────────────────────────────────────────────

test('un caso con excepciones se queda esperando el «sí» y no escribe nada (CA3)', async () => {
  const sesion = entornoFresco()
  const { resultado } = await turno(sesion, "procesa sol-004", crearAdaptadorMock({ guion: guionReactivo() }))

  assert.equal(resultado.ok, true)
  if (!resultado.ok) return
  assert.equal(resultado.data.needsConfirmation, true)
  assert.match(resultado.data.texto, /confirmaci[oó]n|confirmar/i)
  assert.equal(sesion.pendiente?.herramienta, "oc_crear")
  assert.equal(sesion.pendiente?.argumentos["caso"], "sol-004")
  assert.match(sesion.pendiente?.descripcion ?? "", /sol-004/)
  // nada escrito: ni orden, ni evidencia, ni control
  assert.equal(fs.existsSync(path.join(dirOut(), "sap")), false)
  assert.equal(fs.existsSync(path.join(dirOut(), "control.csv")), false)
})

test('el «sí» del turno siguiente crea la OC y firma con el correo de la persona (CA3)', async () => {
  const sesion = entornoFresco()
  const adaptador = crearAdaptadorMock({ guion: guionReactivo() })
  await turno(sesion, "procesa sol-004", adaptador)
  const { resultado, eventos } = await turno(sesion, "sí, confirmo", adaptador)

  const texto = textoDe(resultado)
  assert.match(texto, /4500000001/)
  assert.equal(sesion.pendiente, null)
  assert.equal(eventos.some((evento) => evento.tipo === "fin" && evento.needsConfirmation === false), true)

  // La firma de la excepción es la de la sesión, **no** la que mandó el guion del
  // modelo (que propone `compras@periferia-ficticia.com`): eso es CA3. sol-004 trae
  // dos excepciones a propósito: RC5 (confirmada, que es la que se firma) y RC7
  // (informativa, sin confirmar).
  const orden = leerOrden("4500000001")
  assert.ok(orden !== null, "no quedó la orden en out/sap/ordenes")
  const excepciones = orden?.["excepciones"] as { codigo?: string; confirmado_por?: string | null }[] | undefined
  assert.ok((excepciones?.length ?? 0) >= 1, "la orden quedó sin excepciones")

  const porRc5 = excepciones?.find((excepcion) => excepcion.codigo?.startsWith("RC5") === true)
  assert.ok(porRc5 !== undefined, "la excepción de RC5 no quedó en el payload")
  assert.equal(porRc5?.confirmado_por, USUARIO)
  assert.notEqual(porRc5?.confirmado_por, CONFIRMADO_POR)
})

// ── CA2 · la auditoría del payload ───────────────────────────────────────────

test('los valores que inventa el modelo no llegan a SAP y quedan como aviso (CA2)', async () => {
  const sesion = entornoFresco()
  const { resultado, eventos } = await turno(
    sesion,
    "procesa sol-001",
    crearAdaptadorMock({ guion: guionAlucinado() }),
  )

  assert.equal(resultado.ok, true)
  if (!resultado.ok) return
  // CA3: el modelo intentó firmar él mismo la confirmación y el ciclo lo frenó.
  assert.equal(eventos.some((evento) => evento.tipo === "aviso" && evento.texto === AVISO_SIN_CONFIRMACION), true)

  // CA2: el motor releyó el fixture y dejó constancia de la diferencia. El tercer
  // resultado del turno es el de `oc_construir_payload`, que es donde se audita el
  // paquete propuesto.
  const guardada = leerJson(path.join("sessions", "prueba.json"))
  assert.ok(guardada !== null, "no quedó la sesión guardada")
  const herramientas = ((guardada?.["mensajes"] ?? []) as { rol?: string; contenido?: string }[]).filter(
    (mensaje) => mensaje.rol === "tool",
  )
  const construido = herramientas[2]
  assert.ok(construido !== undefined, "no quedó el resultado de oc_construir_payload")
  const respuesta = JSON.parse(construido?.contenido ?? "{}") as { data?: { avisos?: string[] } }
  assert.equal((respuesta.data?.avisos?.length ?? 0) > 0, true)

  // Y el valor de la solicitud es el que va a SAP, no el que se inventó el modelo.
  const orden = leerOrden("4500000001")
  assert.ok(orden !== null, "no quedó la orden en out/sap/ordenes")
  const posiciones = orden?.["posiciones"] as { precio_unitario?: number; descripcion?: string }[] | undefined
  assert.equal(posiciones?.length, 1)
  assert.notEqual(posiciones?.[0]?.precio_unitario, 1)
  assert.notEqual(posiciones?.[0]?.precio_unitario, undefined)
})

// ── CA1 · los topes ──────────────────────────────────────────────────────────

test('el tope de iteraciones corta el turno y responde con lo que hay (CA1)', async () => {
  const sesion = entornoFresco()
  const { resultado } = await turno(
    sesion,
    "procesa sol-001",
    crearAdaptadorMock({ guion: guionInfinito() }),
    { maxIteraciones: 3 },
  )

  assert.equal(resultado.ok, true)
  if (!resultado.ok) return
  assert.equal(resultado.data.iteraciones, 3)
  assert.equal(resultado.data.llamadas, 3)
  assert.match(resultado.data.texto, /tope de 3 iteraciones/)
})

test('el tope de tokens de la sesión corta el turno con un aviso claro (CA1)', async () => {
  const sesion = entornoFresco()
  const adaptador = crearAdaptadorMock({
    guion: guionReactivo(),
    usoPorIteracion: { entrada: 50_000, salida: 0 },
  })
  const { resultado } = await turno(sesion, "procesa sol-001", adaptador, { maxTokensSesion: 60_000 })

  assert.equal(resultado.ok, true)
  if (!resultado.ok) return
  assert.match(resultado.data.texto, /tope de tokens/)
  assert.equal(sesion.tokens > 60_000, true)
})

// ── CA5 · el proveedor se cae ────────────────────────────────────────────────

test('si el proveedor falla se cuenta en el chat y la sesión sigue viva (CA5)', async () => {
  const sesion = entornoFresco()
  const roto = crearAdaptadorMock({ guion: guionReactivo(), fallarCon: "el proveedor no responde" })
  const { resultado, eventos } = await turno(sesion, "procesa sol-001", roto)

  assert.equal(resultado.ok, false)
  assert.equal(
    eventos.some((evento) => evento.tipo === "error" && /No pude hablar con el modelo/.test(evento.texto)),
    true,
  )
  // La sesión no murió: el mensaje quedó en el historial y se puede seguir.
  assert.equal(sesion.turnos, 1)
  assert.equal(sesion.mensajes.some((mensaje) => mensaje.rol === "user"), true)

  const { resultado: despues } = await turno(sesion, "procesa sol-001", crearAdaptadorMock({ guion: guionReactivo() }))
  assert.match(textoDe(despues), /4500000001/)
})

// ── CA3 · el «no» de la persona ──────────────────────────────────────────────

test('un «no» descarta la acción pendiente y no crea nada (CA3)', async () => {
  const sesion = entornoFresco()
  const adaptador = crearAdaptadorMock({ guion: guionReactivo() })
  await turno(sesion, "procesa sol-004", adaptador)
  assert.notEqual(sesion.pendiente, null)

  const { resultado, eventos } = await turno(sesion, "no, espera", adaptador)
  assert.equal(resultado.ok, true)
  assert.equal(sesion.pendiente, null)
  assert.equal(eventos.some((evento) => evento.tipo === "aviso" && /se descartó la acción pendiente/.test(evento.texto)), true)
  assert.equal(fs.existsSync(path.join(dirOut(), "sap")), false)
})

test('la confirmación es explícita o no cuenta (CA3)', () => {
  assert.equal(esConfirmacionExplicita("sí, confirmo"), true)
  assert.equal(esConfirmacionExplicita("Confirmo la orden"), true)
  assert.equal(esConfirmacionExplicita("dale"), true)
  // Con palabra de freno, no hay confirmación: se prefiere preguntar de nuevo.
  assert.equal(esConfirmacionExplicita("sí, pero revisa el IVA"), false)
  assert.equal(esConfirmacionExplicita("sí, para el centro CC-1010"), false)
  assert.equal(esConfirmacionExplicita("cuánto cuesta"), false)
  assert.equal(esRechazo("no, espera"), true)
  assert.equal(esRechazo("no"), true)
  assert.equal(esRechazo("sí"), false)
})

