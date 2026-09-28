/**
 * Evidencia de aprobación (HU-4 · PRD §7.4).
 *
 * El payload lleva `aprobador.evidencia_sha256`: la huella del **texto
 * normalizado** del correo de aprobación. Ese diseño resuelve dos cosas a la vez:
 *
 *   · **independencia del orden** — `oc_generar_evidencia` escribe el fichero y
 *     `oc_construir_payload` recalcula la huella con **la misma función**, así
 *     que el payload sale igual si el modelo llama primero a una o a otra;
 *   · **valor probatorio** — auditoría puede comprobar que el fichero que quedó
 *     en `out/evidencia/` es exactamente el que se firmó en la orden.
 *
 * El P0 escribe texto (`.txt`); el PDF es P1 y no cambia nada de esto.
 */
import { createHash } from "node:crypto"
import type { Escritor } from "./escritor.ts"
import type { Aprobacion, Evidencia, Resultado } from "./tipos.ts"

/** Texto canónico de la evidencia: lo que se firma y lo que se guarda. */
export function textoEvidencia(aprobacion: Aprobacion): string {
  const cuerpo = aprobacion.texto.replace(/\r\n/g, "\n").trim()
  return [
    "EVIDENCIA DE APROBACIÓN",
    `De: ${aprobacion.de.trim()}`,
    `Fecha: ${aprobacion.fecha}`,
    `Aprobado: ${aprobacion.aprobado ? "sí" : "no"}`,
    "",
    cuerpo,
    "",
  ].join("\n")
}

/** Huella SHA-256 (hexadecimal) del texto canónico de la evidencia. */
export function huellaEvidencia(aprobacion: Aprobacion): string {
  return createHash("sha256").update(textoEvidencia(aprobacion), "utf8").digest("hex")
}

/** Nombre del archivo de evidencia de un caso: `sol-004-aprobacion.txt`. */
export function nombreEvidencia(caso: string): string {
  return `${caso}-aprobacion.txt`
}

/**
 * Escribe la evidencia en `out/evidencia/<caso>-aprobacion.txt` y devuelve su
 * ruta y su huella.
 */
export function generarEvidencia(
  escritor: Escritor,
  caso: string,
  aprobacion: Aprobacion,
): Resultado<Evidencia> {
  const escrito = escritor.escribir(
    textoEvidencia(aprobacion),
    "evidencia",
    nombreEvidencia(caso),
  )
  if (!escrito.ok) return escrito
  return { ok: true, data: { ruta: escrito.data, sha256: huellaEvidencia(aprobacion) } }
}
