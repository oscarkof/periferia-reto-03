/**
 * Auditoría de lo que propone el modelo (CA2 · PRD §6.3 y §8).
 *
 * El modelo **no puede afirmar un valor que no salga de una herramienta**, pero
 * los argumentos de `oc_validar`, `oc_construir_payload` y `oc_crear` aceptan un
 * paquete o un payload opcional. La regla que hace que eso sea seguro es esta:
 * lo que llega se **compara con lo que el motor leyó del documento** y, ante
 * cualquier discrepancia, **manda el fixture** y la diferencia viaja como aviso.
 *
 * No se rechaza en silencio ni se acepta a ciegas: se informa. Es la diferencia
 * entre un agente auditable y uno que «arregla» un monto para que cuadre.
 */
import type { Derivaciones } from "../core/derivados.ts"
import type { OrdenCompra, Paquete } from "../core/tipos.ts"

/** Rutas del paquete que se comparan cuando el modelo propone uno. */
const RUTAS_PAQUETE: readonly string[] = [
  "solicitud.solicitud_id",
  "solicitud.proveedor_nit",
  "solicitud.proveedor_nombre",
  "solicitud.descripcion",
  "solicitud.centro_costo",
  "solicitud.subarea",
  "solicitud.cantidad",
  "solicitud.valor_unitario",
  "solicitud.valor_total",
  "solicitud.moneda",
  "solicitud.indicador_iva",
  "solicitud.condiciones_pago",
  "solicitud.fecha_solicitud",
  "cotizacion.referencia",
  "cotizacion.total",
  "aprobacion.de",
  "aprobacion.fecha",
  "aprobacion.aprobado",
  "factura.numero",
  "factura.fecha",
  "factura.total",
]

/** Rutas del payload que se comparan cuando el modelo propone uno. */
const RUTAS_PAYLOAD: readonly string[] = [
  "referencia.solicitud_id",
  "referencia.correo_id",
  "referencia.cotizacion_ref",
  "sociedad",
  "organizacion_compras",
  "proveedor.codigo_sap",
  "proveedor.nit",
  "proveedor.nombre",
  "moneda",
  "condiciones_pago",
  "aprobador.email",
  "aprobador.fecha_aprobacion",
  "posiciones.0.cantidad",
  "posiciones.0.unidad",
  "posiciones.0.precio_unitario",
  "posiciones.0.centro_costo",
  "posiciones.0.subarea",
  "posiciones.0.indicador_iva",
]

/** Valor de una ruta con puntos (`posiciones.0.cantidad`) o `null`. */
function valorEn(objeto: unknown, ruta: string): unknown {
  let actual: unknown = objeto
  for (const parte of ruta.split(".")) {
    if (actual === null || actual === undefined || typeof actual !== "object") return null
    actual = (actual as Record<string, unknown>)[parte] ?? null
    if (actual === null) return null
  }
  return actual
}

/** Texto comparable de un valor, para detectar alteraciones. */
function comparable(valor: unknown): string {
  if (valor === null || valor === undefined) return ""
  if (Array.isArray(valor)) return valor.join(";")
  return String(valor)
}

/** Rutas en las que lo recibido difiere de lo autoritativo. */
function rutasAlteradas(recibido: unknown, autoritativo: unknown, rutas: readonly string[]): string[] {
  const alteradas: string[] = []
  for (const ruta of rutas) {
    const propuesto = valorEn(recibido, ruta)
    // Un campo que el modelo no envía no es una alteración: no afirma nada.
    if (propuesto === null) continue
    if (comparable(propuesto) !== comparable(valorEn(autoritativo, ruta))) alteradas.push(ruta)
  }
  return alteradas
}

/** Aviso común, para que el mensaje sea siempre el mismo. */
function aviso(alteradas: readonly string[], destino: string): string[] {
  if (alteradas.length === 0) return []
  return [
    `se ignoraron ${alteradas.length} valor(es) propuestos que no coinciden con el documento (${alteradas.join(", ")}): ${destino}`,
  ]
}

/**
 * Compara el paquete recibido del modelo con el que el motor lee del fixture.
 * Devuelve un aviso por cada campo alterado o inventado; lista vacía si no hay
 * nada que objetar.
 *
 * `recibido` es `unknown` a propósito: lo que manda el modelo es un subconjunto
 * de los campos auditables (los que no envía no se comparan), y aquí solo se
 * consultan las rutas de la lista.
 */
export function auditarPaquete(recibido: unknown, autoritativo: Paquete): string[] {
  return aviso(
    rutasAlteradas(recibido, autoritativo, RUTAS_PAQUETE),
    "los valores se releen del fixture antes de validar",
  )
}

/**
 * Compara el payload recibido del modelo con el que construye el motor. Se usa
 * en `oc_crear`, que es el punto irreversible: lo que se escribe en SAP es
 * siempre el payload del motor, y la diferencia queda como aviso.
 */
export function auditarPayload(recibido: unknown, autoritativo: OrdenCompra): string[] {
  const alteradas = rutasAlteradas(recibido, autoritativo, RUTAS_PAYLOAD)
  const propuestas = valorEn(recibido, "excepciones")
  const total = Array.isArray(propuestas) ? propuestas.length : null
  if (total !== null && total !== autoritativo.excepciones.length) {
    alteradas.push(`excepciones (${total} propuestas vs ${autoritativo.excepciones.length} del motor)`)
  }
  return aviso(alteradas, "se envía a SAP el payload que construyó el motor")
}

/** Rutas de las derivaciones que se comparan si el modelo propone unas. */
const RUTAS_DERIVADOS: readonly string[] = ["indicador_iva", "condiciones_pago", "unidad"]

/**
 * Compara las derivaciones propuestas (IVA, condiciones, unidad) con las que
 * calcula el motor. Derivar un valor que la solicitud no trae es exactamente
 * donde un modelo podría «inventar»: aquí se detecta.
 */
export function auditarDerivados(recibido: unknown, autoritativas: Derivaciones): string[] {
  return aviso(
    rutasAlteradas(recibido, autoritativas, RUTAS_DERIVADOS),
    "los derivados se recalculan con las reglas del motor (RC6 · RC7)",
  )
}
