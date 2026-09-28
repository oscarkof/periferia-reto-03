/**
 * Memoria de sesiones (PRD §6.1 · «sesiones en memoria o archivo»).
 *
 * Hay **dos** niveles, y los dos hacen falta:
 *
 *   · un `Map` en memoria para el ciclo rápido de un turno (evita leer el disco en
 *     cada mensaje);
 *   · la copia en `out/sessions/<id>.json` que escribe el ciclo, que es la que
 *     sobrevive a un reinicio y la que devuelve `GET /api/sessions/:id`.
 *
 * Si el `Map` no tiene la sesión pero el archivo sí (el proceso se reinició), se
 * recupera del disco: el historial no se pierde.
 */
import { cargarSesion, crearSesion, type Sesion } from "../agent/sesion.ts"

/** Caché de sesiones vivas del proceso. */
export type MemoriaSesiones = Map<string, Sesion>

/** Crea una memoria vacía. */
export function crearMemoria(): MemoriaSesiones {
  return new Map<string, Sesion>()
}

/**
 * Devuelve la sesión pedida, creándola si no existe.
 * `usuario` es el correo de quien está en el chat (lo fija el servidor): es el que
 * queda firmado cuando confirma (CA3).
 */
export function obtenerSesion(id: string, memoria: MemoriaSesiones, usuario: string): Sesion {
  const enMemoria = memoria.get(id)
  if (enMemoria !== undefined) return enMemoria

  const delDisco = cargarSesion(id)
  if (delDisco.ok) {
    memoria.set(id, delDisco.data)
    return delDisco.data
  }

  const nueva = crearSesion(id, usuario)
  memoria.set(id, nueva)
  return nueva
}
