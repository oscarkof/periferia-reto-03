/**
 * Carga del comportamiento y del conocimiento del agente.
 *
 * El PRD §6.5 exige que el prompt viva en un Markdown aparte (`agent/prompt.md`) y
 * que el conocimiento del proceso esté en `src/knowledge/`. Aquí se leen los dos y
 * se componen; **no** se editan desde el código, así que cambiar una regla de
 * negocio o el trato del agente no toca el servidor.
 */
import fs from "node:fs"
import path from "node:path"
import { resolverDentro } from "../core/rutas.ts"
import type { Resultado } from "../core/tipos.ts"

/** Rutas, relativas a la raíz del proyecto, de las dos piezas de contexto. */
export const RUTA_PROMPT = path.join("agent", "prompt.md")
export const RUTA_CONOCIMIENTO = path.join("src", "knowledge", "ordenes-compra.md")

/** Comportamiento y conocimiento, ya compuestos para el mensaje de sistema. */
export interface ContextoAgente {
  prompt: string
  conocimiento: string
}

/** Lee un Markdown del proyecto, con error legible si falta o está vacío. */
function leerMarkdown(directorio: string, relativa: string, que: string): Resultado<string> {
  const ruta = resolverDentro(directorio, relativa)
  if (!ruta.ok) return ruta

  try {
    const contenido = fs.readFileSync(ruta.data, "utf8").trim()
    if (contenido === "") {
      return { ok: false, error: `el archivo de ${que} está vacío: ${relativa}` }
    }
    return { ok: true, data: contenido }
  } catch {
    return { ok: false, error: `no se encontró el archivo de ${que} en ${relativa}` }
  }
}

/** Carga `agent/prompt.md` y `src/knowledge/ordenes-compra.md`. */
export function cargarContextoAgente(directorio: string): Resultado<ContextoAgente> {
  const prompt = leerMarkdown(directorio, RUTA_PROMPT, "comportamiento")
  if (!prompt.ok) return prompt

  const conocimiento = leerMarkdown(directorio, RUTA_CONOCIMIENTO, "conocimiento")
  if (!conocimiento.ok) return conocimiento

  return { ok: true, data: { prompt: prompt.data, conocimiento: conocimiento.data } }
}
