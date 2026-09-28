/**
 * Resolución de rutas y confinamiento (PRD §6.2 · §8).
 *
 * Regla de oro: las herramientas resuelven SIEMPRE rutas relativas a una raíz,
 * nunca absolutas, y todo camino dinámico se valida antes de tocar el disco —
 * el nombre del caso (`sol-004`) lo propone el modelo, así que hay que impedir
 * `../` antes de leer nada (defensa en profundidad).
 *
 * Reparto de datos:
 *   · lectura  → `fixtures/reto-03/`  (solicitudes y maestros; jamás se escriben)
 *   · escritura → `out/`              (evidencia, sap/, control.csv, log, sesiones)
 */
import fs from "node:fs"
import path from "node:path"
import type { Resultado } from "./tipos.ts"

/** Caso admitido: `sol-001`, `sol-002`… (formato de los fixtures). */
const CASO_VALIDO = /^sol-\d{3}$/

/** Carpeta de la aplicación (`solucion/`). */
export function dirAplicacion(): string {
  // src/core/rutas.ts -> sube dos niveles.
  return path.resolve(import.meta.dirname, "..", "..")
}

/**
 * Raíz del proyecto: se sube desde `solucion/` buscando el `package.json`.
 * Si no aparece, se devuelve `dirAplicacion()`.
 */
export function dirProyecto(): string {
  let actual = dirAplicacion()
  for (let i = 0; i < 6; i += 1) {
    if (fs.existsSync(path.join(actual, "package.json"))) return actual
    const padre = path.dirname(actual)
    if (padre === actual) break
    actual = padre
  }
  return dirAplicacion()
}

/**
 * Carpeta de fixtures: por defecto `../fixtures/reto-03` respecto a `solucion/`
 * (los datos entregados se usan en su sitio, sin copiarlos).
 * `FIXTURES_DIR` permite apuntar a otra ubicación sin tocar código.
 */
export function dirFixtures(): string {
  const override = process.env["FIXTURES_DIR"]
  if (override !== undefined && override.trim() !== "") return path.resolve(override)
  return path.resolve(dirProyecto(), "..", "fixtures", "reto-03")
}

/** Casos entregados: `fixtures/reto-03/solicitudes/`. */
export function dirSolicitudes(): string {
  return path.join(dirFixtures(), "solicitudes")
}

/** Maestros entregados: `fixtures/reto-03/maestros/`. */
export function dirMaestros(): string {
  return path.join(dirFixtures(), "maestros")
}

/** Ruta de uno de los cuatro maestros entregados. */
export function rutaMaestroArchivo(nombre: string): string {
  return path.join(dirMaestros(), `${nombre}.json`)
}

/** Carpeta de salida: `out/` dentro de la aplicación (`OUT_DIR` la mueve). */
export function dirOut(): string {
  const override = process.env["OUT_DIR"]
  if (override !== undefined && override.trim() !== "") return path.resolve(override)
  return path.join(dirProyecto(), "out")
}

/** Evidencia de aprobación: `out/evidencia/` (HU-4). */
export function dirEvidencia(): string {
  return path.join(dirOut(), "evidencia")
}

/** El «SAP simulado»: `out/sap/` (`SAP_RAIZ` lo mueve, PRD §7.4). */
export function dirSap(): string {
  const override = process.env["SAP_RAIZ"]
  if (override !== undefined && override.trim() !== "") return path.resolve(override)
  return path.join(dirOut(), "sap")
}

/** Índice de referencias del simulador: `out/sap/indice.json` (idempotencia). */
export function rutaIndiceSap(): string {
  return path.join(dirSap(), "indice.json")
}

/** Una OC creada por el simulador: `out/sap/ordenes/<numero>.json`. */
export function rutaOrdenSap(numero: string): string {
  return path.join(dirSap(), "ordenes", `${numero}.json`)
}

/** Log de control para contabilidad/auditoría: `out/control.csv` (PRD §4). */
export function rutaControlCsv(): string {
  return path.join(dirOut(), "control.csv")
}

/** Traza de herramientas: `out/log.jsonl` (CA4). */
export function rutaLog(): string {
  return path.join(dirOut(), "log.jsonl")
}

/** Sesiones del chat: `out/sessions/` (CA3). */
export function dirSesiones(): string {
  return path.join(dirOut(), "sessions")
}

/** Valida el nombre del caso recibido en los argumentos de una herramienta. */
export function validarIdCaso(id: string): Resultado<string> {
  const limpio = id.trim()
  if (limpio === "") return { ok: false, error: "el nombre del caso está vacío" }
  if (!CASO_VALIDO.test(limpio)) {
    return {
      ok: false,
      error: `caso inválido "${id}": se espera el formato sol-001, como la carpeta del fixture`,
    }
  }
  return { ok: true, data: limpio }
}

/**
 * Une `partes` a `base` y verifica que el resultado NO se salga de `base`.
 * Es la única forma admitida de construir rutas dinámicas.
 */
export function resolverDentro(base: string, ...partes: string[]): Resultado<string> {
  const raiz = path.resolve(base)
  const destino = path.resolve(raiz, ...partes)
  if (destino !== raiz && !destino.startsWith(raiz + path.sep)) {
    return { ok: false, error: `ruta fuera del directorio permitido: ${partes.join("/")}` }
  }
  return { ok: true, data: destino }
}

/** Carpeta de un caso del fixture, validada y confinada a `solicitudes/`. */
export function dirCaso(id: string): Resultado<string> {
  const caso = validarIdCaso(id)
  if (!caso.ok) return caso
  return resolverDentro(dirSolicitudes(), caso.data)
}
