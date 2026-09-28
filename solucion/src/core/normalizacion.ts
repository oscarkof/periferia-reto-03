/**
 * Normalización: convierte lo que escriben las personas en datos comparables.
 *
 * Todo lo que el motor compara (NIT, nombre de proveedor, fechas, importes)
 * pasa por aquí. Es la capa que hace que `900.555.111-2` y `900555111` sean el
 * mismo proveedor, y que `2026-08-20T09:00:00-05:00` sea la fecha `2026-08-20`
 * sin depender de la zona horaria de la máquina (PRD §8 · Determinismo).
 */
import type { Resultado } from "./tipos.ts"

/** Minúsculas, sin acentos, sin espacios de más. */
export function normalizarTexto(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

/** Solo dígitos y sin ceros a la izquierda: `900.555.111-2` → `9005551112`. */
export function normalizarNit(valor: string): string {
  const digitos = valor.replace(/\D/g, "")
  return digitos.replace(/^0+/, "")
}

/**
 * Clave de comparación de un NIT. Si llegan 10 dígitos se asume NIT colombiano
 * con dígito de verificación y se conservan los 9 primeros, que es la forma en
 * la que está escrito el maestro de los fixtures (PRD §7.1).
 */
export function claveNit(valor: string): string {
  const limpio = normalizarNit(valor)
  return limpio.length === 10 ? limpio.slice(0, 9) : limpio
}

/** Quita la forma societaria: `TecnoSuministros S.A.S.` → `tecnosuministros`. */
export function quitarFormaSocietaria(valor: string): string {
  const base = normalizarTexto(valor).replace(/[.,]/g, "")
  return base
    .replace(/\b(s\s*a\s*s|sas|s\s*a\s*c|sac|s\s*a|sa|ltda|ltd|inc|corp|s\s*de\s*rl)\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/** Fecha ISO `YYYY-MM-DD` válida (existe en el calendario). */
export function validarFecha(valor: string, etiqueta = "fecha"): Resultado<string> {
  const limpio = valor.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(limpio)) {
    return { ok: false, error: `${etiqueta} inválida "${valor}": se espera el formato AAAA-MM-DD` }
  }
  const [anio, mes, dia] = limpio.split("-").map((parte) => Number(parte))
  if (anio === undefined || mes === undefined || dia === undefined) {
    return { ok: false, error: `${etiqueta} inválida "${valor}"` }
  }
  const fecha = new Date(Date.UTC(anio, mes - 1, dia))
  if (
    fecha.getUTCFullYear() !== anio ||
    fecha.getUTCMonth() !== mes - 1 ||
    fecha.getUTCDate() !== dia
  ) {
    return { ok: false, error: `${etiqueta} inválida "${valor}": esa fecha no existe` }
  }
  return { ok: true, data: limpio }
}

/** Compone `YYYY-MM-DD` desde sus partes (o `null` si no es una fecha real). */
export function formatearFecha(partes: { dia: number; mes: number; anio: number }): string | null {
  const texto = `${String(partes.anio).padStart(4, "0")}-${String(partes.mes).padStart(2, "0")}-${String(partes.dia).padStart(2, "0")}`
  const validada = validarFecha(texto)
  return validada.ok ? validada.data : null
}

/**
 * Acepta una fecha ISO completa (`2026-08-20T09:00:00-05:00`) o simple y
 * devuelve siempre `YYYY-MM-DD`. **No** convierte zonas: toma la fecha tal como
 * está escrita en el documento, que es lo que el correo y los fixtures dicen.
 */
export function normalizarFecha(valor: string): Resultado<string> {
  return validarFecha(valor.trim().slice(0, 10), "fecha")
}

/** ¿`a` es anterior a `b`? Comparación lexicográfica de fechas ISO. */
export function esAnterior(a: string, b: string): boolean {
  if (!validarFecha(a).ok || !validarFecha(b).ok) return false
  return a < b
}

/** Días entre dos fechas ISO (positivo si `hasta` es posterior). */
export function diasEntre(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T00:00:00Z`)
  const b = Date.parse(`${hasta}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.round((b - a) / 86_400_000)
}

/** Suma (o resta, con días negativos) días a una fecha ISO. */
export function sumarDias(fecha: string, dias: number): string {
  const base = Date.parse(`${fecha}T00:00:00Z`)
  if (Number.isNaN(base)) return fecha
  const destino = new Date(base + dias * 86_400_000)
  return (
    formatearFecha({
      dia: destino.getUTCDate(),
      mes: destino.getUTCMonth() + 1,
      anio: destino.getUTCFullYear(),
    }) ?? fecha
  )
}

/**
 * Interpreta un importe escrito por una persona o por un sistema.
 * Acepta `11.400.000`, `11,400,000.00`, `COP 11.400.000`, `95000`.
 * Cuando aparecen los dos separadores, **el último es el decimal**; cuando solo
 * hay uno seguido de tres dígitos, es separador de miles.
 */
export function parsearImporte(valor: string): number | null {
  const limpio = valor.replace(/[^\d.,]/g, "").trim()
  if (limpio === "") return null

  const ultimaComa = limpio.lastIndexOf(",")
  const ultimoPunto = limpio.lastIndexOf(".")
  let normalizado = limpio

  if (ultimaComa !== -1 && ultimoPunto !== -1) {
    const decimal = ultimaComa > ultimoPunto ? "," : "."
    const miles = decimal === "," ? "." : ","
    normalizado = limpio.split(miles).join("").replace(decimal, ".")
  } else if (ultimaComa !== -1 || ultimoPunto !== -1) {
    const separador = ultimaComa !== -1 ? "," : "."
    const posicion = ultimaComa !== -1 ? ultimaComa : ultimoPunto
    const decimales = limpio.length - posicion - 1
    normalizado = decimales === 3 ? limpio.split(separador).join("") : limpio.replace(separador, ".")
  }

  const numero = Number(normalizado)
  return Number.isFinite(numero) ? numero : null
}

/** Código de moneda de un texto (`COP 11.400.000` → `COP`). */
export function extraerMoneda(valor: string): string | null {
  const encontrada = /\b(COP|USD|EUR|PEN|MXN|CLP|ARS|BRL)\b/i.exec(valor)
  return encontrada?.[1]?.toUpperCase() ?? null
}

/** Diferencia porcentual absoluta entre dos importes, relativa a `base`. */
export function porcentajeDiferencia(valor: number, base: number): number {
  if (base === 0) return valor === 0 ? 0 : 100
  return Math.abs((valor - base) / base) * 100
}

/** Redondea a `decimales` posiciones (los importes de COP van sin decimales). */
export function redondear(valor: number, decimales = 0): number {
  const factor = 10 ** decimales
  return Math.round(valor * factor) / factor
}

