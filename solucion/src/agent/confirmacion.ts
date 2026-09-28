/**
 * Confirmación humana (PRD §6.3 · CA3).
 *
 * La regla es dura: una OC solo se crea si la persona lo confirmó **en el turno
 * inmediatamente anterior**, y la detección vive en código —no en el prompt— para
 * que el modelo no pueda saltársela escribiendo «el usuario ya confirmó».
 *
 * Es deliberadamente conservadora: ante la duda, **no** hay confirmación.
 */
import { normalizarTexto } from "../core/normalizacion.ts"

/** Respuestas que cuentan como confirmación explícita. */
const AFIRMATIVAS: readonly string[] = [
  "si",
  "ok",
  "okay",
  "dale",
  "confirmo",
  "confirmado",
  "confirmada",
  "confirma",
  "confirmo la orden",
  "adelante",
  "procede",
  "hazlo",
  "de acuerdo",
  "correcto",
  "crea",
  "creala",
  "crea la orden",
  "yes",
]

/**
 * Palabras que **desactivan** la confirmación: si aparecen, la persona está
 * pidiendo tiempo, corrigiendo o negando, aunque empiece con «sí».
 *
 * «para» está a propósito: es más seguro no crear una OC porque alguien escribió
 * «sí, para el centro CC-1010» que crearla porque se leyó un «sí» suelto. El coste
 * de equivocarse en esa dirección es una pregunta más; en la otra, una orden
 * creada sin autorización.
 */
const PALABRAS_DE_FRENO: readonly string[] = [
  "no",
  "todavia",
  "aun",
  "antes",
  "espera",
  "esperate",
  "cancela",
  "cancelar",
  "detente",
  "mejor",
  "para",
  "revisa",
  "faltan",
  "falta",
]

/**
 * Normaliza la respuesta del usuario para compararla: minúsculas, sin acentos y
 * sin puntuación (`normalizarTexto` ya hace las dos primeras).
 */
export function normalizarRespuesta(texto: string): string {
  return normalizarTexto(texto)
    .replace(/[.,;:!¡?¿"'()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** ¿La persona negó o pidió esperar? */
export function esNegacion(texto: string): boolean {
  const limpio = normalizarRespuesta(texto)
  if (limpio === "") return false
  return limpio.split(" ").some((palabra) => PALABRAS_DE_FRENO.includes(palabra))
}

/**
 * ¿El mensaje es una confirmación explícita para continuar?
 * Devuelve `false` si aparece cualquier palabra de freno.
 */
export function esConfirmacionExplicita(texto: string): boolean {
  const limpio = normalizarRespuesta(texto)
  if (limpio === "") return false

  const alguna = AFIRMATIVAS.some((frase) => limpio === frase || limpio.startsWith(`${frase} `))
  if (!alguna) return false

  return !esNegacion(texto)
}

/** ¿La respuesta es un «no» claro a la acción pendiente? */
export function esRechazo(texto: string): boolean {
  const limpio = normalizarRespuesta(texto)
  if (limpio === "") return false
  if (["no", "no gracias", "cancela", "cancelar", "detente"].includes(limpio)) return true
  return limpio.startsWith("no ") && esNegacion(texto)
}
