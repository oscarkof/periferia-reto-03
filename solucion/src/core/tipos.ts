/**
 * Tipos compartidos del reto 03 (PRD §6.2 · §7.1 · §7.2 · §7.4).
 *
 * Un solo vocabulario para todas las capas: los fixtures que entrega Periferia,
 * los maestros, el resultado de la validación, el payload que espera SAP y lo
 * que se escribe en `out/`. El compilador vigila el contrato; el motor
 * determinista es el único que los produce.
 */

/** Resultado de toda operación del motor: nunca se lanza, siempre se devuelve. */
export type Resultado<T> = { ok: true; data: T } | { ok: false; error: string }

// ── Fixtures (PRD §7.1) ──────────────────────────────────────────────────────

/** `correo.json`: el sobre del paquete que llega al buzón de compras. */
export interface Correo {
  id: string
  de: string
  para: string
  asunto: string
  fecha: string
  cuerpo: string
  adjuntos: string[]
}

/** `solicitud.json`: el Excel de solicitud ya normalizado. */
export interface Solicitud {
  solicitud_id: string
  solicitante: string
  proveedor_nombre: string
  /** Puede faltar (`sol-006`): entonces RC1 resuelve por nombre normalizado. */
  proveedor_nit?: string | undefined
  descripcion: string
  centro_costo: string
  subarea: string
  cantidad: number
  valor_unitario: number
  valor_total: number
  moneda: string
  /** Puede faltar (`sol-006`): RC6 lo deriva del proveedor y pide confirmación. */
  indicador_iva?: string | undefined
  /** Puede faltar (`sol-006`): RC7 lo deriva del proveedor y solo informa. */
  condiciones_pago?: string | undefined
  fecha_solicitud: string
}

/** Línea de la cotización del proveedor. */
export interface ItemCotizacion {
  descripcion: string
  cantidad: number
  precio_unitario: number
  subtotal: number
}

/** `cotizacion.txt` ya interpretado (PRD §7.2). */
export interface Cotizacion {
  referencia: string
  fecha: string
  proveedor: string
  nit: string | null
  moneda: string
  total: number
  validez_hasta: string | null
  items: ItemCotizacion[]
  texto: string
}

/** `aprobacion.json`: el correo del líder. `aprobado` sale del cuerpo. */
export interface Aprobacion {
  de: string
  fecha: string
  aprobado: boolean
  texto: string
}

/** `factura.txt`: solo existe en el caso retroactivo (`sol-005`). */
export interface Factura {
  numero: string
  fecha: string
  total: number
}

/** Paquete normalizado (PRD §7.2). Un adjunto ausente es `null` + `faltantes`. */
export interface Paquete {
  caso: string
  correo: Correo
  solicitud: Solicitud
  cotizacion: Cotizacion | null
  aprobacion: Aprobacion | null
  factura: Factura | null
  /** Nombres de las piezas que faltaron, en lenguaje humano (HU-1). */
  faltantes: string[]
}

// ── Maestros (PRD §7.1) ──────────────────────────────────────────────────────

export interface Proveedor {
  codigo_sap: string
  nit: string
  nombre: string
  condiciones_pago_default: string
  indicador_iva_default: string
  activo: boolean
}

export interface Aprobador {
  email: string
  nombre: string
  tope: number
}

export interface CentroCosto {
  centro_costo: string
  nombre: string
  subareas: string[]
  aprobadores: Aprobador[]
}

export interface IndicadorIva {
  codigo: string
  descripcion: string
  tasa: number
}

export interface CondicionPago {
  codigo: string
  descripcion: string
  dias: number
}

export interface Maestros {
  proveedores: Proveedor[]
  centros: CentroCosto[]
  indicadoresIva: IndicadorIva[]
  condicionesPago: CondicionPago[]
}

// ── Validación RC1–RC10 (PRD §6.2 · §7.3) ───────────────────────────────────

/** Un bloqueo impide crear la OC; una confirmación exige un «sí» humano. */
export type TipoHallazgo = "bloqueo" | "confirmacion"

export interface Hallazgo {
  /** Código de la regla: `RC1`…`RC10`. */
  codigo: string
  tipo: TipoHallazgo
  /** Qué pasó, en lenguaje humano y con los valores concretos. */
  detalle: string
  /** Qué puede hacer la persona para resolverlo (RC1–RC4 lo traen). */
  accion_sugerida?: string
}

/** Valor que no venía en la solicitud y se completó con una regla explícita. */
export interface Derivado {
  codigo: string
  campo: string
  valor: string
  origen: string
  detalle: string
}

export interface Validacion {
  caso: string
  /** `false` si hay al menos un bloqueo: no se genera payload ni OC. */
  apta: boolean
  bloqueos: Hallazgo[]
  confirmaciones: Hallazgo[]
  derivados: Derivado[]
  /** RC8: hay factura anterior a la solicitud. */
  retroactiva: boolean
}

// ── Payload de la OC (PRD §7.4) ──────────────────────────────────────────────

export type UnidadMedida = "UN" | "H" | "MES"

export interface Posicion {
  numero: number
  descripcion: string
  cantidad: number
  unidad: UnidadMedida
  precio_unitario: number
  centro_costo: string
  subarea: string
  indicador_iva: string
}

export interface ExcepcionPayload {
  codigo: string
  detalle: string
  confirmado_por: string | null
}

export interface OrdenCompra {
  referencia: {
    solicitud_id: string
    correo_id: string
    cotizacion_ref: string | null
  }
  sociedad: string
  organizacion_compras: string
  proveedor: { codigo_sap: string; nit: string; nombre: string }
  moneda: string
  condiciones_pago: string
  aprobador: { email: string; fecha_aprobacion: string; evidencia_sha256: string }
  posiciones: Posicion[]
  excepciones: ExcepcionPayload[]
}

/** Trazabilidad de un valor del payload: de dónde salió, para poder auditarlo. */
export interface TrazaValor {
  campo: string
  valor: string
  origen: string
}

// ── Salidas en `out/` ────────────────────────────────────────────────────────

export interface FilaControl {
  fecha_proceso: string
  caso: string
  solicitud_id: string
  numero_oc: string
  proveedor: string
  nit: string
  centro_costo: string
  subarea: string
  valor: number
  moneda: string
  aprobador: string
  retroactiva: string
  excepciones: string
  estado: string
}

export interface Evidencia {
  ruta: string
  sha256: string
}

/** Umbrales y constantes del motor, todas con su variable de entorno. */
export interface Reglas {
  /** RC5: diferencia máxima cotización ↔ solicitud, en porcentaje. */
  toleranciaRc5Pct: number
  /** RC10: tolerancia de cantidad × valor_unitario, en unidades monetarias. */
  toleranciaRc10Abs: number
  /** Unidad de la posición cuando el texto no habla de horas. */
  unidadDefault: UnidadMedida
  /** Límite del texto breve de la posición en SAP. */
  maxTextoPosicion: number
  sociedad: string
  organizacionCompras: string
}

