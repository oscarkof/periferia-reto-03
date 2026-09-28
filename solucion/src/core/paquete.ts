/**
 * Lectura del paquete: correo, solicitud, cotización, aprobación y factura
 * (HU-1 · PRD §7.1 y §7.2).
 *
 * Dos reglas que vienen del PRD y que este módulo respeta al pie de la letra:
 *
 *   · **Un adjunto ausente es `null` con el nombre de lo que falta**, no una
 *     excepción (HU-1). Así el agente puede decir «falta la cotización» en vez
 *     de morir con una traza.
 *   · **Del fixture no se escribe nada**: todo es lectura. Lo que se copia o se
 *     genera vive en `out/`.
 *
 * El parseo de la cotización y de la factura es **tolerante**: los proveedores
 * redactan distinto; lo que no se reconoce no se inventa, queda en `null` y el
 * motor lo trata como un dato que falta (y en RC5 eso es una confirmación).
 */
import { z } from "zod"
import { leerJson, leerTexto, existe, esDirectorio } from "./io.ts"
import {
  extraerMoneda,
  normalizarFecha,
  parsearImporte,
  sumarDias,
} from "./normalizacion.ts"
import { dirSolicitudes, resolverDentro } from "./rutas.ts"
import type {
  Aprobacion,
  Correo,
  Cotizacion,
  Factura,
  ItemCotizacion,
  Paquete,
  Resultado,
  Solicitud,
} from "./tipos.ts"

/** Esquema del sobre del correo (`correo.json`). */
const EsquemaCorreo = z.object({
  id: z.string().min(1),
  de: z.string().min(1),
  para: z.string().min(1),
  asunto: z.string(),
  fecha: z.string().min(1),
  cuerpo: z.string(),
  adjuntos: z.array(z.string()),
})

/** Esquema de la solicitud. Los tres campos con `?` del PRD son opcionales. */
const EsquemaSolicitud = z.object({
  solicitud_id: z.string().min(1),
  solicitante: z.string().min(1),
  proveedor_nombre: z.string().min(1),
  proveedor_nit: z.string().min(1).optional(),
  descripcion: z.string().min(1),
  centro_costo: z.string().min(1),
  subarea: z.string().min(1),
  cantidad: z.number().positive(),
  valor_unitario: z.number().nonnegative(),
  valor_total: z.number().nonnegative(),
  moneda: z.string().min(1),
  indicador_iva: z.string().min(1).optional(),
  condiciones_pago: z.string().min(1).optional(),
  fecha_solicitud: z.string().min(1),
})

/** Esquema de la aprobación (`aprobacion.json`). */
const EsquemaAprobacion = z.object({
  de: z.string().min(1),
  fecha: z.string().min(1),
  asunto: z.string().optional(),
  cuerpo: z.string(),
})

/** Expresiones que **niegan** la aprobación aunque el cuerpo diga «aprobado». */
const NEGACIONES = [/no\s+aprobad/i, /desaprobad/i, /sin\s+aprobar/i, /rechazad/i, /no\s+autoriz/i]

/**
 * ¿El cuerpo del correo aprueba? Es un `true` explícito y conservador: ante
 * «no aprobado», «desaprobado» o «rechazado» devuelve `false` (RC2 es bloqueo).
 */
export function detectarAprobacion(cuerpo: string): boolean {
  if (NEGACIONES.some((patron) => patron.test(cuerpo))) return false
  return /aprobad/i.test(cuerpo)
}

/** Lee y valida el correo del caso. Sin correo no hay paquete. */
function leerCorreo(dir: string): Resultado<Correo> {
  const bruto = leerJson<unknown>(`${dir}/correo.json`)
  if (!bruto.ok) return { ok: false, error: `el caso no trae correo.json legible` }
  const validado = EsquemaCorreo.safeParse(bruto.data)
  if (!validado.success) return { ok: false, error: "correo.json no tiene el formato del PRD §7.1" }
  return { ok: true, data: validado.data }
}

/** Lee y valida la solicitud del caso. Sin solicitud no hay nada que validar. */
function leerSolicitud(dir: string): Resultado<Solicitud> {
  const bruto = leerJson<unknown>(`${dir}/solicitud.json`)
  if (!bruto.ok) return { ok: false, error: "el caso no trae solicitud.json legible" }
  const validado = EsquemaSolicitud.safeParse(bruto.data)
  if (!validado.success) {
    return { ok: false, error: "solicitud.json no tiene los campos del PRD §7.1" }
  }
  return { ok: true, data: validado.data }
}

/** Lee la aprobación del líder, si existe. `aprobado` sale del cuerpo. */
function leerAprobacion(dir: string): Aprobacion | null {
  const bruto = leerJson<unknown>(`${dir}/aprobacion.json`)
  if (!bruto.ok) return null
  const validado = EsquemaAprobacion.safeParse(bruto.data)
  if (!validado.success) return null
  const fecha = normalizarFecha(validado.data.fecha)
  if (!fecha.ok) return null
  return {
    de: validado.data.de,
    fecha: fecha.data,
    aprobado: detectarAprobacion(validado.data.cuerpo),
    texto: validado.data.cuerpo,
  }
}

/** Valor que sigue a una etiqueta (`Proveedor: …`) en cualquier línea del texto. */
export function campoDeLinea(texto: string, etiqueta: RegExp): string | null {
  for (const linea of texto.split("\n")) {
    const encontrado = etiqueta.exec(linea.trim())
    if (encontrado !== null) {
      const valor = encontrado[1]?.trim()
      if (valor !== undefined && valor !== "") return valor
    }
  }
  return null
}

/** ¿Esta línea es la del total? (No confundir con «base gravable» ni «IVA»). */
function esLineaTotal(linea: string): boolean {
  return /^\s*total\b/i.test(linea)
}

/** Total y moneda de un documento, leyendo la primera línea que empiece por «TOTAL». */
export function parsearTotal(texto: string): { total: number | null; moneda: string | null } {
  const linea = texto.split("\n").find((l) => esLineaTotal(l))
  if (linea === undefined) return { total: null, moneda: null }
  const moneda = extraerMoneda(linea)
  const trasDosPuntos = linea.includes(":") ? linea.slice(linea.indexOf(":") + 1) : linea
  return { total: parsearImporte(trasDosPuntos), moneda }
}

/** Líneas de ítem de una cotización: `1. Descripción | Cantidad: N | …`. */
export function parsearItems(texto: string): ItemCotizacion[] {
  const items: ItemCotizacion[] = []
  for (const linea of texto.split("\n")) {
    const limpia = linea.trim()
    if (!/^\d+\.\s/.test(limpia) || !limpia.includes("|")) continue

    const partes = limpia.split("|").map((parte) => parte.trim())
    const descripcion = (partes[0] ?? "").replace(/^\d+\.\s*/, "").trim()
    const cantidad = parsearImporte(/cantidad:\s*([\d.,]+)/i.exec(partes[1] ?? "")?.[1] ?? "")
    const precio = parsearImporte(
      /precio unitario[^:]*:\s*(?:[A-Z]{3}\s*)?([\d.,]+)/i.exec(partes[2] ?? "")?.[1] ?? "",
    )
    const subtotal = parsearImporte(
      /subtotal:\s*(?:[A-Z]{3}\s*)?([\d.,]+)/i.exec(partes[3] ?? "")?.[1] ?? "",
    )
    if (descripcion === "" || cantidad === null || precio === null) continue
    items.push({ descripcion, cantidad, precio_unitario: precio, subtotal: subtotal ?? 0 })
  }
  return items
}

/**
 * Interpreta `cotizacion.txt` (PRD §7.1). Tolerante a propósito: lo que no
 * reconoce queda vacío o `null` — y quien lo detecta es RC5 (confirmación), no
 * un valor inventado.
 */
export function leerCotizacion(texto: string): Cotizacion {
  const referencia = campoDeLinea(texto, /^COTIZACI[ÓO]N\s+(.+)$/i) ?? ""
  const fechaCruda = campoDeLinea(texto, /^fecha[^:]*:\s*(.+)$/i)
  const fechaValidada = fechaCruda === null ? null : normalizarFecha(fechaCruda)
  const fecha = fechaValidada !== null && fechaValidada.ok ? fechaValidada.data : ""
  const proveedor = campoDeLinea(texto, /^proveedor[^:]*:\s*(.+)$/i) ?? ""
  const nit = campoDeLinea(texto, /^nit[^:]*:\s*(.+)$/i)
  const { total, moneda } = parsearTotal(texto)
  const validez = /validez[^:]*:\s*(\d+)\s*d[ií]as?/i.exec(texto)
  const dias = validez?.[1] !== undefined ? Number(validez[1]) : null
  const validezHasta = dias !== null && fecha !== "" ? sumarDias(fecha, dias) : null

  return {
    referencia,
    fecha,
    proveedor,
    nit,
    moneda: moneda ?? "",
    total: total ?? 0,
    validez_hasta: validezHasta,
    items: parsearItems(texto),
    texto,
  }
}

/** Interpreta `factura.txt` (solo existe en el caso retroactivo). */
export function leerFactura(texto: string): Resultado<Factura> {
  const numero = campoDeLinea(texto, /No\.?\s*([A-Z0-9][A-Z0-9-]*)/i)
  const fechaCruda = campoDeLinea(texto, /fecha[^:]*:\s*(.+)$/i)
  const fecha = fechaCruda !== null ? normalizarFecha(fechaCruda) : { ok: false as const, error: "" }
  const { total } = parsearTotal(texto)

  if (numero === null || !fecha.ok || total === null) {
    return { ok: false, error: "la factura no tiene número, fecha o total legibles" }
  }
  return { ok: true, data: { numero, fecha: fecha.data, total } }
}

/**
 * Lee el paquete completo de un caso (HU-1). Los adjuntos opcionales que falten
 * se devuelven como `null` **y** se nombran en `faltantes`; el correo y la
 * solicitud son imprescindibles: sin ellos no hay nada que registrar y se
 * devuelve un error legible en vez de un paquete a medias.
 */
export function leerPaquete(caso: string, raizSolicitudes = ""): Resultado<Paquete> {
  const raiz = raizSolicitudes.trim() !== "" ? raizSolicitudes : dirSolicitudes()
  const dir = resolverDentro(raiz, caso)
  if (!dir.ok) return dir
  if (!esDirectorio(dir.data)) {
    return { ok: false, error: `no existe el caso ${caso} en el fixture (se espera ${raiz}/${caso})` }
  }

  const correo = leerCorreo(dir.data)
  if (!correo.ok) return correo
  const solicitud = leerSolicitud(dir.data)
  if (!solicitud.ok) return solicitud

  const faltantes: string[] = []

  const textoCotizacion = leerTexto(`${dir.data}/cotizacion.txt`)
  const cotizacion = textoCotizacion.ok ? leerCotizacion(textoCotizacion.data) : null
  if (cotizacion === null) {
    faltantes.push("la cotización del proveedor (cotizacion.txt)")
  } else if (cotizacion.total === 0) {
    faltantes.push("el total de la cotización (no se pudo leer)")
  }

  const aprobacion = leerAprobacion(dir.data)
  if (aprobacion === null) faltantes.push("el correo de aprobación del líder (aprobacion.json)")

  let factura: Factura | null = null
  const rutaFactura = `${dir.data}/factura.txt`
  if (existe(rutaFactura)) {
    const textoFactura = leerTexto(rutaFactura)
    if (textoFactura.ok) {
      const leida = leerFactura(textoFactura.data)
      if (leida.ok) factura = leida.data
      else faltantes.push("los datos de la factura (número, fecha o total)")
    }
  }

  return {
    ok: true,
    data: {
      caso,
      correo: correo.data,
      solicitud: solicitud.data,
      cotizacion,
      aprobacion,
      factura,
      faltantes,
    },
  }
}

