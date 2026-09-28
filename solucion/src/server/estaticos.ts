/**
 * Front y archivos servidos por HTTP (PRD §6.1 y §6.4).
 *
 * Dos responsabilidades:
 *
 *   · `raizFront` — la carpeta `web/` si está en el repositorio. El front es HTML,
 *     CSS y JavaScript sin build, así que el servidor lo sirve tal cual.
 *   · `leerDeOut` y `listarOut` — lo que el motor deja en `out/` (el log de
 *     control, la evidencia, las órdenes del simulador). Todo el acceso está
 *     **confinado a `out/`**: ni el caso ni el resto de la ruta pueden escapar del
 *     directorio de salida, aunque vengan de la URL.
 */
import fs from "node:fs"
import path from "node:path"
import { dirOut, resolverDentro } from "../core/rutas.ts"
import type { Resultado } from "../core/tipos.ts"

/** Ruta del front si existe, o `null` (la API funciona sin él). */
export function raizFront(directorio: string): string | null {
  const web = path.join(directorio, "web")
  return fs.existsSync(web) ? web : null
}

/** Tipos que el agente produce, con su content-type. */
const TIPOS: Record<string, string> = {
  ".md": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jsonl": "application/x-ndjson; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
}

/** Content-type por extensión, con un valor neutro por defecto. */
export function tipoDeContenido(ruta: string): string {
  return TIPOS[path.extname(ruta).toLowerCase()] ?? "application/octet-stream"
}

/** Contenido de un archivo de `out/`, ya confinado. */
export interface ArchivoServido {
  contenido: Buffer
  tipo: string
  nombre: string
}

/**
 * Lee un archivo de `out/` a partir de sus segmentos de ruta.
 *
 * La base es la misma que la del resto del motor (`dirOut`): respeta `OUT_DIR`, así
 * que servir archivos y escribirlos apuntan siempre al mismo sitio.
 */
export function leerDeOut(partes: string[]): Resultado<ArchivoServido> {
  if (partes.length === 0) return { ok: false, error: "no se indicó ningún archivo" }

  const ruta = resolverDentro(dirOut(), ...partes)
  if (!ruta.ok) return { ok: false, error: "ruta no permitida: solo se sirven archivos de out/" }

  try {
    const estadistica = fs.statSync(ruta.data)
    if (!estadistica.isFile()) return { ok: false, error: "la ruta no es un archivo" }
    if (estadistica.size > 25 * 1024 * 1024) return { ok: false, error: "el archivo supera el tamaño permitido" }

    return {
      ok: true,
      data: {
        contenido: fs.readFileSync(ruta.data),
        tipo: tipoDeContenido(ruta.data),
        nombre: path.basename(ruta.data),
      },
    }
  } catch {
    return { ok: false, error: `no existe el archivo ${partes.join("/")} en out/` }
  }
}

/** Un archivo de `out/`, tal como lo lista el panel lateral del chat. */
export interface ArchivoListado {
  /** Ruta relativa a `out/`, la que se pide a `/api/files/…`. */
  ruta: string
  nombre: string
  bytes: number
  modificado: string
}

/** Tope de archivos listados: `out/` es del motor, no un vertedero. */
const MAX_ARCHIVOS = 200

/**
 * Lista los archivos de `out/` por orden alfabético.
 * Se saltan los ocultos (`.gitkeep`) y se acota el recorrido, para que la lista
 * del front no crezca sin control si alguien deja cosas ahí.
 */
export function listarOut(): Resultado<ArchivoListado[]> {
  const raiz = dirOut()
  const encontrados: ArchivoListado[] = []

  const recorrer = (carpeta: string, prefijo: string): void => {
    let entradas: fs.Dirent[]
    try {
      entradas = fs.readdirSync(carpeta, { withFileTypes: true })
    } catch {
      return
    }

    for (const entrada of entradas.sort((a, b) => a.name.localeCompare(b.name))) {
      if (encontrados.length >= MAX_ARCHIVOS) return
      if (entrada.name.startsWith(".")) continue

      const absoluta = path.join(carpeta, entrada.name)
      const relativa = prefijo === "" ? entrada.name : `${prefijo}/${entrada.name}`

      if (entrada.isDirectory()) {
        recorrer(absoluta, relativa)
        continue
      }

      try {
        const estadistica = fs.statSync(absoluta)
        encontrados.push({
          ruta: relativa,
          nombre: entrada.name,
          bytes: estadistica.size,
          modificado: estadistica.mtime.toISOString(),
        })
      } catch {
        // Un archivo que desaparece entre `readdir` y `stat` no es un error.
      }
    }
  }

  recorrer(raiz, "")
  return { ok: true, data: encontrados }
}

