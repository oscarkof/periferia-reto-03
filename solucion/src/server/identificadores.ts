/**
 * Identificador de sesión para quien no manda uno (PRD §6.4).
 *
 * El PRD deja el identificador en manos del cliente; este es el que se genera
 * cuando el front abre una conversación nueva. Se acota a caracteres seguros
 * porque termina siendo nombre de archivo en `out/sessions/`.
 */
import { randomUUID } from "node:crypto"

/** Identificador nuevo: corto, sin caracteres raros y ordenable por tiempo. */
export function nuevoId(): string {
  return `s-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
}
