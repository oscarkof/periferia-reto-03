/**
 * Escritura confinada a `out/` con reemplazo atómico.
 *
 * Todo lo que el motor escribe pasa por aquí: nunca hay un `fs.writeFileSync`
 * suelto por el código. Dos garantías que valen más de lo que cuestan:
 *
 *   · **confinamiento** — cada ruta relativa se resuelve contra `out/` y se
 *     valida; un nombre con `../` no sale de la carpeta.
 *   · **atomicidad** — se escribe en `<archivo>.tmp` y se renombra, así que un
 *     corte a mitad no deja el CSV ni el índice a medias (PRD §8 · Robustez).
 */
import fs from "node:fs"
import path from "node:path"
import { resolverDentro } from "./rutas.ts"
import type { Resultado } from "./tipos.ts"

/** Escritor confinado a una raíz (normalmente `out/`). */
export interface Escritor {
  /** Raíz del confinamiento. */
  raiz: string
  /** Crea (o reemplaza) un archivo de texto. Devuelve la ruta escrita. */
  escribir(contenido: string, ...relativa: string[]): Resultado<string>
  /** Añade una línea al final de un archivo, creándolo si no existe. */
  anexar(linea: string, ...relativa: string[]): Resultado<string>
  /** Borra un archivo si existe (no falla si ya no está). */
  borrar(...relativa: string[]): Resultado<string>
  /** Asegura que una carpeta existe y devuelve su ruta. */
  asegurarCarpeta(...relativa: string[]): Resultado<string>
}

/** Ruta absoluta de un destino relativo, validada contra la raíz. */
function destino(raiz: string, partes: string[]): Resultado<string> {
  return resolverDentro(raiz, ...partes)
}

/** Crea un escritor confinado a `raiz`. */
export function crearEscritor(raiz: string): Escritor {
  const absoluta = path.resolve(raiz)

  function asegurarCarpeta(...relativa: string[]): Resultado<string> {
    const ruta = destino(absoluta, relativa)
    if (!ruta.ok) return ruta
    try {
      fs.mkdirSync(ruta.data, { recursive: true })
      return { ok: true, data: ruta.data }
    } catch {
      return { ok: false, error: `no se pudo crear la carpeta ${relativa.join("/")}` }
    }
  }

  function escribir(contenido: string, ...relativa: string[]): Resultado<string> {
    const ruta = destino(absoluta, relativa)
    if (!ruta.ok) return ruta
    const carpeta = asegurarCarpeta(...relativa.slice(0, -1))
    if (!carpeta.ok) return carpeta
    const temporal = `${ruta.data}.tmp`
    try {
      fs.writeFileSync(temporal, contenido, "utf8")
      fs.renameSync(temporal, ruta.data)
      return { ok: true, data: ruta.data }
    } catch {
      try {
        fs.rmSync(temporal, { force: true })
      } catch {
        // Si el temporal tampoco se puede borrar, el error que importa es el de arriba.
      }
      return { ok: false, error: `no se pudo escribir ${relativa.join("/")}` }
    }
  }

  function anexar(linea: string, ...relativa: string[]): Resultado<string> {
    const ruta = destino(absoluta, relativa)
    if (!ruta.ok) return ruta
    const carpeta = asegurarCarpeta(...relativa.slice(0, -1))
    if (!carpeta.ok) return carpeta
    try {
      const salto = linea.endsWith("\n") ? "" : "\n"
      fs.appendFileSync(ruta.data, `${linea}${salto}`, "utf8")
      return { ok: true, data: ruta.data }
    } catch {
      return { ok: false, error: `no se pudo anexar a ${relativa.join("/")}` }
    }
  }

  function borrar(...relativa: string[]): Resultado<string> {
    const ruta = destino(absoluta, relativa)
    if (!ruta.ok) return ruta
    try {
      fs.rmSync(ruta.data, { force: true })
      return { ok: true, data: ruta.data }
    } catch {
      return { ok: false, error: `no se pudo borrar ${relativa.join("/")}` }
    }
  }

  return { raiz: absoluta, escribir, anexar, borrar, asegurarCarpeta }
}
