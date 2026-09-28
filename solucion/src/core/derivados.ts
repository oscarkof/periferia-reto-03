/**
 * Derivaciones: RC6 (indicador de IVA) y RC7 (condiciones de pago), más la
 * unidad de medida de la posición.
 *
 * La regla de oro es la misma que en todo el motor: **un valor derivado no se
 * inventa, se deduce de un maestro y se declara**. Por eso toda derivación sale
 * de aquí con su `origen` y con el detalle que el humano va a leer, y RC6 pide
 * confirmación mientras RC7 solo informa (PRD §7.3).
 */
import { normalizarTexto } from "./normalizacion.ts"
import type {
  Cotizacion,
  Derivado,
  Proveedor,
  Reglas,
  Solicitud,
  UnidadMedida,
} from "./tipos.ts"

/** Resultado de derivar: los valores que faltaban y con qué quedaron. */
export interface Derivaciones {
  indicador_iva: string
  condiciones_pago: string
  unidad: UnidadMedida
  /** RC6: el IVA no venía en la solicitud y hay que confirmarlo. */
  ivaDerivadoDelProveedor: boolean
  /** RC7: las condiciones no venían y se completaron del proveedor. */
  condicionDerivadaDelProveedor: boolean
  derivados: Derivado[]
}

/** Palabras que delatan una unidad de medida por horas (bolsas, servicios). */
const SEÑALES_HORAS = /\b(horas?|bolsa de horas|por hora|hora de)\b/i

/**
 * Unidad de la posición. El fixture no la trae (el payload del PRD §7.4 sí la
 * exige), así que se deriva del texto: `H` cuando se habla de horas y si no la
 * unidad por defecto. La derivación se informa para que no sea invisible.
 */
export function derivarUnidad(
  solicitud: Solicitud,
  cotizacion: Cotizacion | null,
  reglas: Reglas,
): { valor: UnidadMedida; motivo: string } {
  const textos = [solicitud.descripcion, cotizacion?.texto ?? ""].join(" ")
  if (SEÑALES_HORAS.test(textos)) {
    return {
      valor: "H",
      motivo: "el objeto habla de horas, así que la posición va en H (horas)",
    }
  }
  return { valor: reglas.unidadDefault, motivo: "unidad por defecto del contrato (UN)" }
}

/**
 * Completa lo que la solicitud no traía, siempre con el proveedor del maestro
 * como fuente y dejando constancia de qué se derivó.
 */
export function derivar(
  proveedor: Proveedor,
  solicitud: Solicitud,
  cotizacion: Cotizacion | null,
  reglas: Reglas,
): Derivaciones {
  const derivados: Derivado[] = []

  const ivaDeLaSolicitud = solicitud.indicador_iva?.trim()
  const ivaDerivado = ivaDeLaSolicitud === undefined || ivaDeLaSolicitud === ""
  const indicadorIva = ivaDerivado ? proveedor.indicador_iva_default : ivaDeLaSolicitud
  if (ivaDerivado) {
    derivados.push({
      codigo: "RC6",
      campo: "indicador_iva",
      valor: indicadorIva,
      origen: `maestro de proveedores (${proveedor.nombre})`,
      detalle: `la solicitud no informa el indicador de IVA; se toma el del proveedor (${indicadorIva})`,
    })
  }

  const condicionDeLaSolicitud = solicitud.condiciones_pago?.trim()
  const condicionDerivada = condicionDeLaSolicitud === undefined || condicionDeLaSolicitud === ""
  const condicionesPago = condicionDerivada ? proveedor.condiciones_pago_default : condicionDeLaSolicitud
  if (condicionDerivada) {
    derivados.push({
      codigo: "RC7",
      campo: "condiciones_pago",
      valor: condicionesPago,
      origen: `maestro de proveedores (${proveedor.nombre})`,
      detalle: `la solicitud no informa condiciones de pago; se toman las del proveedor (${condicionesPago})`,
    })
  }

  const unidad = derivarUnidad(solicitud, cotizacion, reglas)
  derivados.push({
    codigo: "RC7",
    campo: "unidad",
    valor: unidad.valor,
    origen: "derivación del texto del contrato",
    detalle: unidad.motivo,
  })

  return {
    indicador_iva: indicadorIva,
    condiciones_pago: condicionesPago,
    unidad: unidad.valor,
    ivaDerivadoDelProveedor: ivaDerivado,
    condicionDerivadaDelProveedor: condicionDerivada,
    derivados,
  }
}

/** ¿El texto del objeto es de horas? (lo usa la traza del payload). */
export function esDeHoras(texto: string): boolean {
  return SEÑALES_HORAS.test(normalizarTexto(texto))
}
