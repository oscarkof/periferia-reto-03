/**
 * El recorrido completo de los seis casos (PRD §6.6).
 *
 * Lo que se fija aquí es el contrato con el PRD §11 y con CA3: qué se crea sin
 * intervención, qué se bloquea, qué espera a una persona y que **repetir el
 * recorrido no crea OC nuevas**. Todo sobre un `OUT_DIR` temporal.
 */
import { after, test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { leerCsv } from "../src/core/csv.ts"
import { leerTexto } from "../src/core/io.ts"
import { CASOS, recorrer, type FilaRecorrido } from "../src/demo/recorrido.ts"
import type { ContextoHerramienta } from "../src/tools/contrato.ts"

const RAIZ = path.resolve(import.meta.dirname, "..")
const CONFIRMADO_POR = "compras@periferia-ficticia.com"
const temporales: string[] = []

/** Contexto con su propio `out/` temporal. */
function contextoFresco(): ContextoHerramienta {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reto03-demo-"))
  temporales.push(dir)
  process.env["OUT_DIR"] = dir
  return { directory: RAIZ, sessionId: "prueba" }
}

after(() => {
  delete process.env["OUT_DIR"]
  for (const dir of temporales) fs.rmSync(dir, { recursive: true, force: true })
})

/** Recorre una vez con las opciones indicadas. */
function pasar(ctx: ContextoHerramienta, confirmar: boolean) {
  return recorrer(ctx, { confirmar, confirmadoPor: CONFIRMADO_POR })
}

/** La fila de un caso, con su estado. */
function estadoDe(filas: readonly FilaRecorrido[], caso: string): string {
  const fila = filas.find((candidata) => candidata.caso === caso)
  assert.ok(fila !== undefined, `no hay fila para ${caso}`)
  return fila.estado
}

/** Filas de `out/control.csv` del entorno temporal (sin la cabecera). */
function filasControl(): string[][] {
  const out = process.env["OUT_DIR"] ?? ""
  const leido = leerTexto(path.join(out, "control.csv"))
  if (!leido.ok) return []
  const csv = leerCsv(leido.data)
  return csv === null ? [] : csv.filas
}

test('la primera pasada crea solo lo que no necesita a nadie (PRD §11)', async () => {
  const ctx = contextoFresco()
  const primera = await pasar(ctx, false)

  assert.deepEqual([...CASOS], primera.filas.map((fila) => fila.caso))
  assert.equal(estadoDe(primera.filas, "sol-001"), "creada")
  assert.equal(estadoDe(primera.filas, "sol-002"), "bloqueada")
  assert.equal(estadoDe(primera.filas, "sol-003"), "bloqueada")
  assert.equal(estadoDe(primera.filas, "sol-004"), "pendiente_confirmacion")
  assert.equal(estadoDe(primera.filas, "sol-005"), "pendiente_confirmacion")
  assert.equal(estadoDe(primera.filas, "sol-006"), "pendiente_confirmacion")

  assert.equal(primera.conteo.creadas, 1)
  assert.equal(primera.conteo.bloqueadas, 2)
  assert.equal(primera.conteo.pendientes, 3)
  assert.equal(primera.conteo.errores, 0)

  // La OC de sol-001 y su evidencia existen; los bloqueados no dejan orden.
  const sol001 = primera.filas[0]
  assert.equal(fs.existsSync(sol001?.ruta_orden ?? ""), true)
  assert.equal(fs.existsSync(sol001?.ruta_evidencia ?? ""), true)
})

test('sol-003 acumula RC2 y RC3: todas las razones, no la primera', async () => {
  const ctx = contextoFresco()
  const primera = await pasar(ctx, false)
  const sol003 = primera.filas.find((fila) => fila.caso === "sol-003")

  assert.deepEqual(sol003?.bloqueos, ["RC2", "RC3"])
  assert.match(sol003?.motivo ?? "", /RC2/)
  assert.match(sol003?.motivo ?? "", /RC3/)
  assert.equal(sol003?.numero_oc, null)
})

test('la segunda pasada, con el «sí», crea los tres que esperaban confirmación', async () => {
  const ctx = contextoFresco()
  const primera = await pasar(ctx, false)
  const segunda = await pasar(ctx, true)

  assert.equal(estadoDe(segunda.filas, "sol-004"), "creada")
  assert.equal(estadoDe(segunda.filas, "sol-005"), "creada")
  assert.equal(estadoDe(segunda.filas, "sol-006"), "creada")
  // sol-001 ya existía: la segunda pasada no crea otra.
  assert.equal(estadoDe(segunda.filas, "sol-001"), "idempotente")
  assert.equal(segunda.conteo.creadas, 3)
  assert.equal(segunda.conteo.idempotentes, 1)
  assert.equal(segunda.conteo.bloqueadas, 2)
  assert.equal(segunda.conteo.pendientes, 0)
  assert.equal(segunda.conteo.errores, 0)

  // La numeración es correlativa desde 4500000001 (PRD §7.4).
  const numeros = segunda.filas.filter((fila) => fila.estado === "creada").map((fila) => fila.numero_oc)
  assert.deepEqual(numeros, ["4500000002", "4500000003", "4500000004"])
  assert.equal(primera.filas[0]?.numero_oc, "4500000001")
})

test('el log de control queda con una fila por solicitud, no por pasada', async () => {
  const ctx = contextoFresco()
  await pasar(ctx, false)
  await pasar(ctx, true)

  const filas = filasControl()
  assert.equal(filas.length, 6)
  assert.deepEqual(
    filas.map((fila) => fila[2]),
    ["SOL-2026-001", "SOL-2026-002", "SOL-2026-003", "SOL-2026-004", "SOL-2026-005", "SOL-2026-006"],
  )

  const sol005 = filas.find((fila) => fila[2] === "SOL-2026-005")
  assert.equal(sol005?.[11], "si", "sol-005 es la retroactiva (RC8)")
  const sol002 = filas.find((fila) => fila[2] === "SOL-2026-002")
  assert.equal(sol002?.[13], "bloqueada")
  assert.equal(sol002?.[3], "", "una bloqueada no tiene número de OC")
})

test('la confirmación queda firmada en la OC guardada', async () => {
  const ctx = contextoFresco()
  await pasar(ctx, true)

  const sol004 = path.join(process.env["OUT_DIR"] ?? "", "sap", "ordenes", "4500000002.json")
  assert.equal(fs.existsSync(sol004), true)
  const guardada = JSON.parse(fs.readFileSync(sol004, "utf8")) as {
    orden: { excepciones: { codigo: string; confirmado_por: string | null }[] }
  }
  const firmada = guardada.orden.excepciones.find((excepcion) => excepcion.codigo === "RC5")
  assert.equal(firmada?.confirmado_por, CONFIRMADO_POR)
})

test('dos recorridos limpios dan el mismo resultado (determinismo)', async () => {
  const a = await pasar(contextoFresco(), true)
  const b = await pasar(contextoFresco(), true)

  const comparable = (filas: readonly FilaRecorrido[]) =>
    filas.map((fila) => ({
      caso: fila.caso,
      estado: fila.estado,
      numero_oc: fila.numero_oc,
      fecha: fila.fecha,
      apta: fila.apta,
      bloqueos: fila.bloqueos,
      confirmaciones: fila.confirmaciones,
      retroactiva: fila.retroactiva,
      excepciones: fila.excepciones,
      faltantes: fila.faltantes,
      avisos: fila.avisos,
    }))

  assert.deepEqual(comparable(b.filas), comparable(a.filas))
  assert.deepEqual(b.conteo, a.conteo)
})