/**
 * Contrato de las cinco herramientas `oc_*` (PRD §6.2): forma de la respuesta,
 * rutas confinadas, auditoría anti-alucinación (CA2) y las dos puertas de
 * `oc_crear` (bloqueos y confirmación humana, CA3).
 *
 * Cada prueba trabaja sobre un `OUT_DIR` temporal, así que el `out/` del
 * repositorio no se toca y las pruebas pueden correr en cualquier orden.
 */
import { after, test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { leerCsv } from "../src/core/csv.ts"
import { leerTexto } from "../src/core/io.ts"
import { EsquemaOrdenCompra } from "../src/core/payload.ts"
import { ejecutarValidando, nombreHerramienta, type ContextoHerramienta } from "../src/tools/contrato.ts"
import {
  HERRAMIENTAS,
  NOMBRES_VISIBLES,
  REGISTRO,
  construir_payload,
  crear,
  generar_evidencia,
  leer_paquete,
  validar,
  type DatosCreacion,
  type DatosEvidencia,
  type DatosPayload,
  type DatosValidacion,
} from "../src/tools/oc.ts"

/** `solucion/`: la raíz desde la que las herramientas resuelven todo. */
const RAIZ = path.resolve(import.meta.dirname, "..")
const FIXTURES = path.resolve(RAIZ, "..", "fixtures", "reto-03")
const temporales: string[] = []

/** Contexto con su propio `out/` temporal: aislamiento entre pruebas. */
function contextoFresco(): ContextoHerramienta {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reto03-tools-"))
  temporales.push(dir)
  process.env["OUT_DIR"] = dir
  return { directory: RAIZ, sessionId: "prueba" }
}

after(() => {
  delete process.env["OUT_DIR"]
  delete process.env["FIXTURES_DIR"]
  for (const dir of temporales) fs.rmSync(dir, { recursive: true, force: true })
})

/** Lee la respuesta de una herramienta y falla si no es `{ ok: true }`. */
function datos<T>(respuesta: string): T {
  const cuerpo = JSON.parse(respuesta) as { ok: boolean; data?: T; error?: string }
  assert.equal(cuerpo.ok, true, `la herramienta falló: ${cuerpo.error ?? "sin detalle"}`)
  return cuerpo.data as T
}

/** Lee la respuesta esperando un error y devuelve su mensaje. */
function errorDe(respuesta: string): string {
  const cuerpo = JSON.parse(respuesta) as { ok: boolean; error?: string }
  assert.equal(cuerpo.ok, false, `se esperaba un error y llegó: ${respuesta.slice(0, 140)}`)
  return cuerpo.error ?? ""
}

/** Filas de `out/control.csv` del entorno temporal (sin la cabecera). */
function filasControl(): string[][] {
  const out = process.env["OUT_DIR"] ?? ""
  const leido = leerTexto(path.join(out, "control.csv"))
  if (!leido.ok) return []
  const csv = leerCsv(leido.data)
  return csv === null ? [] : csv.filas
}

/** ¿Existe el índice del simulador? (si no, no se creó ninguna OC). */
function hayIndice(): boolean {
  return fs.existsSync(path.join(process.env["OUT_DIR"] ?? "", "sap", "indice.json"))
}

// ── El registro y el contrato de forma ───────────────────────────────────────

test('las cinco herramientas se registran con su nombre visible', () => {
  assert.deepEqual(
    [...NOMBRES_VISIBLES],
    [
      "oc_leer_paquete",
      "oc_validar",
      "oc_construir_payload",
      "oc_generar_evidencia",
      "oc_crear",
    ],
  )
  assert.equal(REGISTRO.length, 5)
  assert.equal(nombreHerramienta("oc", "crear"), "oc_crear")
  assert.equal(Object.keys(HERRAMIENTAS).length, 5)
})

test('cada respuesta es un JSON con ok y data, o con ok y error', async () => {
  const ctx = contextoFresco()

  for (const respuesta of [
    await leer_paquete.execute({ caso: "sol-001" }, ctx),
    await validar.execute({ caso: "sol-001" }, ctx),
    await construir_payload.execute({ caso: "sol-001" }, ctx),
    await generar_evidencia.execute({ caso: "sol-001" }, ctx),
    await crear.execute({ caso: "sol-001", confirmado: true }, ctx),
    await leer_paquete.execute({ caso: "sol-999" }, ctx),
  ]) {
    const cuerpo = JSON.parse(respuesta) as { ok?: unknown }
    assert.equal(typeof cuerpo.ok, "boolean")
  }

  const errores = [
    await leer_paquete.execute({ caso: "sol-999" }, ctx),
    await construir_payload.execute({ caso: "sol-002" }, ctx),
  ]
  for (const respuesta of errores) {
    const cuerpo = JSON.parse(respuesta) as { ok: boolean; error?: string }
    assert.equal(cuerpo.ok, false)
    assert.ok((cuerpo.error ?? "").length > 10, "el error tiene que ser legible")
  }
})

test('un caso con un nombre raro se rechaza sin lanzar y con lenguaje humano', async () => {
  const ctx = contextoFresco()

  for (const caso of ["../etc", "sol-01", "sol-001/../..", "sol-999", ""]) {
    const respuesta = await leer_paquete.execute({ caso }, ctx)
    const mensaje = errorDe(respuesta)
    assert.ok(
      /caso inválido|no existe el caso|está vacío/.test(mensaje),
      `mensaje inesperado para "${caso}": ${mensaje}`,
    )
  }

  // Y ninguna variante puede salirse del directorio de solicitudes.
  const fuera = await leer_paquete.execute({ caso: "../../etc" }, ctx)
  assert.equal(JSON.parse(fuera).ok, false)
})

test('el contrato valida los argumentos antes de ejecutar y no lanza', async () => {
  const ctx = contextoFresco()
  const respuesta = await ejecutarValidando(crear, "oc_crear", { caso: 42 }, ctx)
  const mensaje = errorDe(respuesta)
  assert.match(mensaje, /argumentos inválidos para oc_crear/)
})

// ── Leer, validar y construir el payload ─────────────────────────────────────

test('oc_leer_paquete devuelve el paquete normalizado del fixture', async () => {
  const ctx = contextoFresco()
  const paquete = datos<{ caso: string; solicitud: { solicitud_id: string }; faltantes: string[] }>(
    await leer_paquete.execute({ caso: "sol-001" }, ctx),
  )
  assert.equal(paquete.caso, "sol-001")
  assert.equal(paquete.solicitud.solicitud_id, "SOL-2026-001")
  assert.deepEqual(paquete.faltantes, [])
})

test('oc_validar dice si es apta y si hace falta una persona', async () => {
  const ctx = contextoFresco()

  const limpia = datos<DatosValidacion>(await validar.execute({ caso: "sol-001" }, ctx))
  assert.equal(limpia.apta, true)
  assert.equal(limpia.requiere_confirmacion, false)
  assert.deepEqual(limpia.bloqueos, [])

  const conConfirmacion = datos<DatosValidacion>(await validar.execute({ caso: "sol-004" }, ctx))
  assert.equal(conConfirmacion.apta, true)
  assert.equal(conConfirmacion.requiere_confirmacion, true)
  assert.deepEqual(
    conConfirmacion.confirmaciones.map((hallazgo) => hallazgo.codigo),
    ["RC5"],
  )
})

test('sol-003 devuelve RC2 y RC3 en el mismo pase', async () => {
  const ctx = contextoFresco()
  const veredicto = datos<DatosValidacion>(await validar.execute({ caso: "sol-003" }, ctx))
  assert.equal(veredicto.apta, false)
  assert.deepEqual(
    veredicto.bloqueos.map((hallazgo) => hallazgo.codigo).sort(),
    ["RC2", "RC3"],
  )
  assert.equal(veredicto.requiere_confirmacion, false)
})

test('la auditoría ignora un valor propuesto que no cuadra y se queda con el fixture (CA2)', async () => {
  const ctx = contextoFresco()
  const veredicto = datos<DatosValidacion>(
    await validar.execute({ caso: "sol-004", paquete: { solicitud: { valor_total: 1 } } }, ctx),
  )
  assert.equal(veredicto.avisos.length, 1)
  assert.match(veredicto.avisos[0] ?? "", /solicitud\.valor_total/)
  // El veredicto sigue siendo el del documento, no el que propuso el modelo.
  assert.deepEqual(
    veredicto.confirmaciones.map((hallazgo) => hallazgo.codigo),
    ["RC5"],
  )
})

test('oc_construir_payload cumple el contrato de SAP y deja la trazabilidad', async () => {
  const ctx = contextoFresco()
  const payload = datos<DatosPayload>(await construir_payload.execute({ caso: "sol-001" }, ctx))

  assert.equal(EsquemaOrdenCompra.safeParse(payload.orden).success, true)
  const posicion = payload.orden.posiciones[0]
  assert.ok(posicion !== undefined)
  // La posición lleva lo que se aprobó (la solicitud).
  assert.equal(posicion.precio_unitario, 95_000)
  assert.equal(posicion.centro_costo, "CC-1010")
  assert.equal(payload.orden.proveedor.codigo_sap, "100234")
  assert.deepEqual(payload.avisos, [])
  assert.ok(payload.trazabilidad.length >= 15)
  assert.ok(
    payload.trazabilidad.some(
      (traza) => traza.campo === "posiciones[0].cantidad" && traza.origen === "solicitud.json",
    ),
  )
})

test('con bloqueos no se construye el payload', async () => {
  const ctx = contextoFresco()
  const mensaje = errorDe(await construir_payload.execute({ caso: "sol-002" }, ctx))
  assert.match(mensaje, /RC1/)
})

test('los derivados que proponga el modelo se auditan y gana el motor (CA2)', async () => {
  const ctx = contextoFresco()
  const payload = datos<DatosPayload>(
    await construir_payload.execute(
      { caso: "sol-006", derivados: { indicador_iva: "C0", condiciones_pago: "Z999" } },
      ctx,
    ),
  )

  assert.equal(payload.orden.posiciones[0]?.indicador_iva, "C1")
  assert.equal(payload.orden.condiciones_pago, "Z030")
  assert.equal(payload.avisos.length, 1)
  assert.match(payload.avisos[0] ?? "", /derivados/)
})

test('oc_generar_evidencia escribe el archivo y devuelve la huella que viaja en el payload', async () => {
  const ctx = contextoFresco()
  const evidencia = datos<DatosEvidencia>(await generar_evidencia.execute({ caso: "sol-004" }, ctx))

  assert.match(evidencia.sha256, /^[0-9a-f]{64}$/)
  assert.equal(fs.readFileSync(evidencia.ruta, "utf8").startsWith("EVIDENCIA DE APROBACIÓN"), true)
  assert.equal(evidencia.correo_de, "dgarcia@periferia-ficticia.com")

  // El orden no importa: el payload recalcula la misma huella (PRD §7.4).
  const payload = datos<DatosPayload>(await construir_payload.execute({ caso: "sol-004" }, ctx))
  assert.equal(payload.orden.aprobador.evidencia_sha256, evidencia.sha256)
})

test('sin correo de aprobación no hay evidencia que firmar (HU-4)', async () => {
  const ctx = contextoFresco()
  const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), "reto03-sin-aprobacion-"))
  temporales.push(fixtures)
  const caso = path.join(fixtures, "solicitudes", "sol-001")
  fs.mkdirSync(caso, { recursive: true })
  for (const pieza of ["correo.json", "solicitud.json"]) {
    fs.copyFileSync(path.join(FIXTURES, "solicitudes", "sol-001", pieza), path.join(caso, pieza))
  }

  process.env["FIXTURES_DIR"] = fixtures
  try {
    const mensaje = errorDe(await generar_evidencia.execute({ caso: "sol-001" }, ctx))
    assert.match(mensaje, /no trae correo de aprobación/)
  } finally {
    delete process.env["FIXTURES_DIR"]
  }
})

// ── Las dos puertas de `oc_crear` (CA3) ──────────────────────────────────────

test('con bloqueos no se crea nada y la fila de control queda bloqueada', async () => {
  const ctx = contextoFresco()
  const mensaje = errorDe(await crear.execute({ caso: "sol-002", confirmado: true }, ctx))

  assert.match(mensaje, /el motor la bloqueó \(RC1\)/)
  assert.equal(hayIndice(), false, "no debe existir el índice del simulador")
  const filas = filasControl()
  assert.equal(filas.length, 1)
  assert.equal(filas[0]?.[3], "", "sin número de OC")
  assert.equal(filas[0]?.[13], "bloqueada")
})

test('sin confirmación no se escribe en SAP ni en el log de control', async () => {
  const ctx = contextoFresco()
  const mensaje = errorDe(await crear.execute({ caso: "sol-004" }, ctx))

  assert.match(mensaje, /faltan confirmaciones humanas/)
  assert.match(mensaje, /RC5/)
  assert.equal(hayIndice(), false)
  assert.deepEqual(filasControl(), [])
})

test('con confirmación se crea la OC y la excepción queda firmada', async () => {
  const ctx = contextoFresco()
  const creada = datos<DatosCreacion>(
    await crear.execute(
      { caso: "sol-004", confirmado: true, confirmado_por: "jefa@periferia-ficticia.com" },
      ctx,
    ),
  )

  assert.equal(creada.numero_oc, "4500000001")
  assert.equal(creada.idempotente, false)
  assert.ok(creada.excepciones.includes("RC5"))
  assert.equal(fs.existsSync(creada.ruta_orden), true)

  const guardada = JSON.parse(fs.readFileSync(creada.ruta_orden, "utf8")) as {
    orden: { excepciones: { codigo: string; confirmado_por: string | null }[] }
  }
  const firmada = guardada.orden.excepciones.find((excepcion) => excepcion.codigo === "RC5")
  assert.equal(firmada?.confirmado_por, "jefa@periferia-ficticia.com")

  const filas = filasControl()
  assert.equal(filas.length, 1)
  assert.equal(filas[0]?.[3], "4500000001")
  assert.equal(filas[0]?.[13], "creada")
})

test('crear dos veces no duplica la OC ni la fila de control', async () => {
  const ctx = contextoFresco()
  const primera = datos<DatosCreacion>(await crear.execute({ caso: "sol-004", confirmado: true }, ctx))
  const segunda = datos<DatosCreacion>(await crear.execute({ caso: "sol-004", confirmado: true }, ctx))

  assert.equal(segunda.idempotente, true)
  assert.equal(segunda.numero_oc, primera.numero_oc)
  assert.equal(segunda.fecha, primera.fecha)
  assert.equal(filasControl().length, 1)
})

test('el payload que proponga el modelo no viaja a SAP (CA2)', async () => {
  const ctx = contextoFresco()
  const delMotor = datos<DatosPayload>(await construir_payload.execute({ caso: "sol-001" }, ctx))
  const manipulado = {
    ...delMotor.orden,
    posiciones: [
      {
        numero: 10,
        descripcion: "lo que el modelo prefiera",
        cantidad: 1,
        unidad: "UN" as const,
        precio_unitario: 1,
        centro_costo: "CC-1010",
        subarea: "Infraestructura",
        indicador_iva: "C1",
      },
    ],
  }

  const creada = datos<DatosCreacion>(
    await crear.execute({ caso: "sol-001", confirmado: true, payload: manipulado }, ctx),
  )
  assert.ok(creada.avisos.some((aviso) => /posiciones\.0/.test(aviso)))

  const guardada = JSON.parse(fs.readFileSync(creada.ruta_orden, "utf8")) as {
    orden: { posiciones: { precio_unitario: number }[] }
  }
  assert.equal(guardada.orden.posiciones[0]?.precio_unitario, 95_000)
})
