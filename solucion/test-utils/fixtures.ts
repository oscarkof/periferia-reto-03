/**
 * Utilidades de prueba sobre los fixtures reales.
 *
 * No son pruebas (por eso viven en `test-utils/` y no en `test/`): son el puente
 * entre los documentos que entregó Periferia y el motor determinista. Todas
 * escriben en una **carpeta temporal**, nunca en el `out/` del repositorio.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { crearEntorno, type Entorno } from "../src/core/entorno.ts"
import { cargarMaestros } from "../src/core/maestros.ts"
import { leerPaquete } from "../src/core/paquete.ts"
import type { Maestros, Paquete, Reglas } from "../src/core/tipos.ts"

/** `reto-03/fixtures/reto-03/`, resolviendo desde `solucion/test-utils/`. */
export const FIXTURES = path.resolve(import.meta.dirname, "..", "..", "fixtures", "reto-03")

/** `fixtures/reto-03/solicitudes/`. */
export const SOLICITUDES = path.join(FIXTURES, "solicitudes")

/** `fixtures/reto-03/maestros/proveedores.json`. */
export const PROVEEDORES = path.join(FIXTURES, "maestros", "proveedores.json")

/** Los seis casos que entrega Periferia. */
export const CASOS = ["sol-001", "sol-002", "sol-003", "sol-004", "sol-005", "sol-006"] as const

/** Fecha de referencia de las pruebas: la misma de la demo, para que no cambie nada. */
export const HOY = "2026-09-03"

/** Carpeta temporal por prueba. */
export function dirTemporal(prefijo: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefijo}-`))
}

/** Maestros del fixture, cargados con el mismo código que usa la app. */
export function maestrosDeFixture(): Maestros {
  const cargados = cargarMaestros()
  if (!cargados.ok) throw new Error(`no se pudieron cargar los maestros: ${cargados.error}`)
  return cargados.data
}

/** Paquete normalizado de un caso del fixture. */
export function paqueteDe(caso: string): Paquete {
  const leido = leerPaquete(caso, SOLICITUDES)
  if (!leido.ok) throw new Error(`no se pudo leer el caso ${caso}: ${leido.error}`)
  return leido.data
}

/** Los seis paquetes, en orden. */
export function paquetesDeFixture(): Paquete[] {
  return CASOS.map((caso) => paqueteDe(caso))
}

/**
 * Entorno con `out/` temporal y fecha fija. Es la forma de trabajar sin tocar el
 * `out/` del repositorio ni depender del reloj de la máquina.
 */
export function entornoTemporal(prefijo: string, reglas?: Partial<Reglas>): Entorno {
  const creado = crearEntorno(path.resolve(import.meta.dirname, ".."), {
    fixtures: FIXTURES,
    out: dirTemporal(prefijo),
    hoy: HOY,
    ...(reglas === undefined ? {} : { reglas }),
  })
  if (!creado.ok) throw new Error(`no se pudo crear el entorno: ${creado.error}`)
  return creado.data
}
