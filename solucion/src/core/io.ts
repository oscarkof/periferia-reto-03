/**
 * Lectura de disco con errores tipados (PRD §8 · HU-6).
 *
 * Ninguna función lanza: todas devuelven `Resultado<T>` con mensajes legibles y
 * sin traza cruda, para que el agente pueda contarlos en el chat y seguir vivo.
 */
import fs from "node:fs"
import type { Resultado } from "./tipos.ts"

/** ¿Existe la ruta (archivo o carpeta)? */
export function existe(ruta: string): boolean {
  return fs.existsSync(ruta)
}

/** ¿Es una carpeta? */
export function esDirectorio(ruta: string): boolean {
  try {
    return fs.statSync(ruta).isDirectory()
  } catch {
    return false
  }
}

/** Lista ordenada de entradas de una carpeta, o error legible. */
export function listarDirectorio(ruta: string): Resultado<string[]> {
  try {
    return { ok: true, data: fs.readdirSync(ruta).sort() }
  } catch {
    return { ok: false, error: `no se pudo listar la carpeta ${ruta}` }
  }
}

/** Lee un archivo de texto, o error legible. */
export function leerTexto(ruta: string): Resultado<string> {
  try {
    return { ok: true, data: fs.readFileSync(ruta, "utf8") }
  } catch {
    return { ok: false, error: `no se pudo leer el archivo ${ruta}` }
  }
}

/** Lee y parsea un JSON, distinguiendo «no existe» de «está corrupto». */
export function leerJson<T>(ruta: string): Resultado<T> {
  let crudo: string
  try {
    crudo = fs.readFileSync(ruta, "utf8")
  } catch {
    return { ok: false, error: `no se pudo leer el archivo ${ruta}` }
  }
  try {
    return { ok: true, data: JSON.parse(crudo) as T }
  } catch {
    return { ok: false, error: `el archivo ${ruta} no es un JSON válido` }
  }
}

/** ¿El valor es un objeto con claves (ni `null` ni un arreglo)? */
export function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
}

/** ¿El valor es una cadena con contenido (no vacía ni solo espacios)? */
export function esTextoConContenido(valor: unknown): valor is string {
  return typeof valor === "string" && valor.trim() !== ""
}
