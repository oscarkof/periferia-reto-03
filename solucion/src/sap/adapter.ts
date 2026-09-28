/**
 * Interfaz del adaptador SAP (PRD §7.4). **Es la que manda el PRD**: cambiarla
 * sería cambiar el contrato que se evalúa, así que se copia tal cual.
 *
 * Nota sobre errores, porque conviven dos reglas del PRD que parecen chocar:
 * el PRD §8 pide errores tipados `{ ok: false, error }` y este contrato devuelve
 * valores (`null` cuando no hay nada). Se respeta así:
 *
 *   · `consultarProveedor` y `buscarOrdenPorReferencia` **no** fallan: devuelven
 *     `null` cuando no encuentran nada.
 *   · `crearOrden` **sí** puede fallar y, como su firma no admite un resultado
 *     de error, lanza un `ErrorSap` con un mensaje humano. La herramienta
 *     `oc_crear` lo captura y lo convierte en `{ ok: false, error }`, así que la
 *     regla «ninguna herramienta lanza» se mantiene donde se evalúa (CA5).
 */
import type { OrdenCompra } from "../core/tipos.ts"

/** Error del sistema de destino, con mensaje pensado para leerse en el chat. */
export class ErrorSap extends Error {
  override readonly name = "ErrorSap"
}

/** Lo que el agente necesita del sistema de registro (SAP o su simulador). */
export interface SapAdapter {
  /** Proveedor por NIT, o `null` si no existe. */
  consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null>
  /** Crea la orden y devuelve su número y fecha. Puede lanzar `ErrorSap`. */
  crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }>
  /** OC ya creada para esa solicitud, o `null` (es la idempotencia). */
  buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string } | null>
}
