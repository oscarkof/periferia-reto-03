/**
 * El payload de la OC (PRD §7.4): se construye y se **valida con `zod`** antes de
 * salir del agente. Es el contrato con SAP, así que no se envía nada que no pase
 * el esquema.
 *
 * Dos decisiones que el PRD deja abiertas y aquí quedan fijadas:
 *
 *   · **La posición usa los valores de la solicitud** (cantidad, valor unitario,
 *     centro, subárea): es lo que se aprobó. La diferencia con la cotización no
 *     desaparece — viaja como excepción firmada (RC5) y en la trazabilidad.
 *   · **Las excepciones llevan a quien confirmó** (`confirmado_por`) y también lo
 *     que se derivó sin confirmar (RC7), con `confirmado_por: null`: auditar es
 *     saber qué se firmó y qué se completó solo.
 */
import { z } from "zod"
import { huellaEvidencia } from "./evidencia.ts"
import type { Derivaciones } from "./derivados.ts"
import type {
  ExcepcionPayload,
  OrdenCompra,
  Paquete,
  Proveedor,
  Reglas,
  Resultado,
  TrazaValor,
  Validacion,
} from "./tipos.ts"

/** Unidad de medida admitida por SAP en este contrato. */
const Unidades = z.enum(["UN", "H", "MES"])

export const EsquemaPosicion = z.object({
  numero: z.number().int().positive(),
  descripcion: z.string().min(1).max(40),
  cantidad: z.number().positive(),
  unidad: Unidades,
  precio_unitario: z.number().nonnegative(),
  centro_costo: z.string().min(1),
  subarea: z.string().min(1),
  indicador_iva: z.string().min(1),
})

export const EsquemaExcepcion = z.object({
  codigo: z.string().min(1),
  detalle: z.string().min(1),
  confirmado_por: z.string().nullable(),
})

export const EsquemaOrdenCompra = z.object({
  referencia: z.object({
    solicitud_id: z.string().min(1),
    correo_id: z.string().min(1),
    cotizacion_ref: z.string().min(1).nullable(),
  }),
  sociedad: z.string().min(1),
  organizacion_compras: z.string().min(1),
  proveedor: z.object({
    codigo_sap: z.string().min(1),
    nit: z.string().min(1),
    nombre: z.string().min(1),
  }),
  moneda: z.enum(["COP", "USD"]),
  condiciones_pago: z.string().min(1),
  aprobador: z.object({
    email: z.string().min(3),
    fecha_aprobacion: z.string().length(10),
    evidencia_sha256: z.string().length(64),
  }),
  posiciones: z.array(EsquemaPosicion).min(1),
  excepciones: z.array(EsquemaExcepcion),
})

/** Lo que necesita el constructor de payload, todo ya resuelto aguas arriba. */
export interface EntradaPayload {
  paquete: Paquete
  proveedor: Proveedor
  derivaciones: Derivaciones
  validacion: Validacion
  reglas: Reglas
  /** Correo de quien confirmó las excepciones en el chat (`null` si nadie). */
  confirmadoPor: string | null
}

/** Payload validado + la traza de dónde salió cada valor. */
export interface PayloadConstruido {
  orden: OrdenCompra
  trazabilidad: TrazaValor[]
}

/** Códigos de excepción que añade el constructor, además de los de las reglas. */
const EXCEPCION_TEXTO = "TEXTO_RECORTADO"

/** Recorta el texto breve al límite de SAP y dice si recortó. */
function recortarTexto(texto: string, limite: number): { texto: string; recortado: boolean } {
  const limpio = texto.replace(/\s+/g, " ").trim()
  if (limpio.length <= limite) return { texto: limpio, recortado: false }
  return { texto: limpio.slice(0, limite - 1).trimEnd() + "…", recortado: true }
}

/** De dónde salió cada valor del payload. Es lo que permite auditar una OC. */
function trazar(
  entrada: EntradaPayload,
  descripcion: string,
  recortado: boolean,
): TrazaValor[] {
  const { paquete, proveedor, derivaciones } = entrada
  const { solicitud, aprobacion, cotizacion } = paquete
  const origenMaestro = `maestro de proveedores (${proveedor.nombre})`
  const trazas: TrazaValor[] = [
    { campo: "referencia.solicitud_id", valor: solicitud.solicitud_id, origen: "solicitud.json" },
    { campo: "referencia.correo_id", valor: paquete.correo.id, origen: "correo.json" },
    {
      campo: "referencia.cotizacion_ref",
      valor: cotizacion?.referencia ?? "(sin cotización)",
      origen: "cotizacion.txt",
    },
    { campo: "proveedor.codigo_sap", valor: proveedor.codigo_sap, origen: "maestro de proveedores" },
    { campo: "moneda", valor: solicitud.moneda, origen: "solicitud.json" },
    { campo: "condiciones_pago", valor: derivaciones.condiciones_pago, origen: derivaciones.condicionDerivadaDelProveedor ? origenMaestro : "solicitud.json" },
    { campo: "posiciones[0].cantidad", valor: String(solicitud.cantidad), origen: "solicitud.json" },
    { campo: "posiciones[0].precio_unitario", valor: String(solicitud.valor_unitario), origen: "solicitud.json" },
    { campo: "posiciones[0].descripcion", valor: descripcion, origen: recortado ? "solicitud.json (recortada al límite de SAP)" : "solicitud.json" },
    { campo: "posiciones[0].centro_costo", valor: solicitud.centro_costo, origen: "solicitud.json" },
    { campo: "posiciones[0].subarea", valor: solicitud.subarea, origen: "solicitud.json" },
    { campo: "posiciones[0].unidad", valor: derivaciones.unidad, origen: "derivación del texto del contrato" },
    { campo: "posiciones[0].indicador_iva", valor: derivaciones.indicador_iva, origen: derivaciones.ivaDerivadoDelProveedor ? origenMaestro : "solicitud.json" },
    { campo: "aprobador.email", valor: aprobacion?.de ?? "(sin aprobación)", origen: "aprobacion.json" },
    { campo: "aprobador.fecha_aprobacion", valor: aprobacion?.fecha ?? "", origen: "aprobacion.json" },
    { campo: "aprobador.evidencia_sha256", valor: "huella del correo normalizado", origen: "out/evidencia/<caso>-aprobacion.txt" },
    { campo: "valor_total", valor: String(solicitud.valor_total), origen: "solicitud.json" },
  ]
  return trazas
}

/**
 * Construye y valida el payload. **No** se niega a construirlo por
 * confirmaciones pendientes: eso lo decide el ciclo (CA3) antes de llamar a
 * `oc_crear`. Lo que sí impide es un payload inválido o con bloqueos.
 */
export function construirPayload(entrada: EntradaPayload): Resultado<PayloadConstruido> {
  const { paquete, proveedor, derivaciones, validacion, reglas, confirmadoPor } = entrada
  const { solicitud, aprobacion, cotizacion, correo } = paquete

  if (validacion.bloqueos.length > 0) {
    const codigos = validacion.bloqueos.map((h) => h.codigo).join(", ")
    return {
      ok: false,
      error: `no se puede construir el payload: hay ${validacion.bloqueos.length} bloqueo(s) sin resolver (${codigos})`,
    }
  }
  if (aprobacion === null) {
    return { ok: false, error: "no se puede construir el payload sin el correo de aprobación del líder" }
  }

  const moneda = solicitud.moneda.trim().toUpperCase()
  if (moneda !== "COP" && moneda !== "USD") {
    return {
      ok: false,
      error: `la moneda "${solicitud.moneda}" no está en el contrato del payload (COP o USD)`,
    }
  }

  const { texto: descripcion, recortado } = recortarTexto(
    solicitud.descripcion,
    reglas.maxTextoPosicion,
  )

  const excepciones: ExcepcionPayload[] = [
    ...validacion.confirmaciones.map((h) => ({
      codigo: h.codigo,
      detalle: h.detalle,
      confirmado_por: confirmadoPor,
    })),
    // Solo las derivaciones que **rellenan un valor que faltaba** (IVA y
    // condiciones) son excepción. La unidad de medida se deriva siempre del
    // texto y viaja en la trazabilidad: meterla aquí ensuciaría el payload con
    // una excepción que no lo es.
    ...validacion.derivados
      .filter((d) => d.codigo === "RC7" && d.campo !== "unidad")
      .map((d) => ({ codigo: "RC7", detalle: d.detalle, confirmado_por: null })),
  ]
  if (recortado) {
    excepciones.push({
      codigo: EXCEPCION_TEXTO,
      detalle: `la descripción se recortó a ${reglas.maxTextoPosicion} caracteres (límite del texto breve de SAP)`,
      confirmado_por: null,
    })
  }

  const orden: OrdenCompra = {
    referencia: {
      solicitud_id: solicitud.solicitud_id,
      correo_id: correo.id,
      cotizacion_ref:
        cotizacion !== null && cotizacion.referencia !== "" ? cotizacion.referencia : null,
    },
    sociedad: reglas.sociedad,
    organizacion_compras: reglas.organizacionCompras,
    proveedor: { codigo_sap: proveedor.codigo_sap, nit: proveedor.nit, nombre: proveedor.nombre },
    moneda,
    condiciones_pago: derivaciones.condiciones_pago,
    aprobador: {
      email: aprobacion.de,
      fecha_aprobacion: aprobacion.fecha,
      evidencia_sha256: huellaEvidencia(aprobacion),
    },
    posiciones: [
      {
        numero: 10,
        descripcion,
        cantidad: solicitud.cantidad,
        unidad: derivaciones.unidad,
        precio_unitario: solicitud.valor_unitario,
        centro_costo: solicitud.centro_costo,
        subarea: solicitud.subarea,
        indicador_iva: derivaciones.indicador_iva,
      },
    ],
    excepciones,
  }

  const validado = EsquemaOrdenCompra.safeParse(orden)
  if (!validado.success) {
    const problema = validado.error.issues[0]
    const campo = problema?.path.join(".") ?? "?"
    return {
      ok: false,
      error: `el payload no cumple el contrato de SAP (${campo}: ${problema?.message ?? "inválido"})`,
    }
  }

  return {
    ok: true,
    data: { orden: validado.data as OrdenCompra, trazabilidad: trazar(entrada, descripcion, recortado) },
  }
}

