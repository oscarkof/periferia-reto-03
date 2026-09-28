/**
 * Los cuatro maestros del PRD §7.1, cargados y consultables.
 *
 * Se validan con `zod` **al cargar**: un maestro malformado se convierte en un
 * error legible (`el archivo proveedores.json no tiene el formato esperado`) en
 * vez de en un `undefined` que reviente tres capas más abajo, en el payload.
 *
 * Las búsquedas normalizan: el NIT se compara por clave (con o sin dígito de
 * verificación) y el nombre sin forma societaria ni acentos, porque RC1 admite
 * resolver «por NIT; si no hay NIT, por nombre normalizado».
 */
import { z } from "zod"
import { leerJson } from "./io.ts"
import { claveNit, quitarFormaSocietaria } from "./normalizacion.ts"
import { rutaMaestroArchivo } from "./rutas.ts"
import type {
  Aprobador,
  CentroCosto,
  CondicionPago,
  IndicadorIva,
  Maestros,
  Proveedor,
  Resultado,
} from "./tipos.ts"

const EsquemaProveedor = z.object({
  codigo_sap: z.string().min(1),
  nit: z.string().min(1),
  nombre: z.string().min(1),
  condiciones_pago_default: z.string().min(1),
  indicador_iva_default: z.string().min(1),
  activo: z.boolean(),
})

const EsquemaAprobador = z.object({
  email: z.string().min(3),
  nombre: z.string().min(1),
  tope: z.number().nonnegative(),
})

const EsquemaCentro = z.object({
  centro_costo: z.string().min(1),
  nombre: z.string().min(1),
  subareas: z.array(z.string().min(1)).min(1),
  aprobadores: z.array(EsquemaAprobador).min(1),
})

const EsquemaIndicadorIva = z.object({
  codigo: z.string().min(1),
  descripcion: z.string().min(1),
  tasa: z.number().min(0),
})

const EsquemaCondicionPago = z.object({
  codigo: z.string().min(1),
  descripcion: z.string().min(1),
  dias: z.number().int().nonnegative(),
})

/** Carga uno de los cuatro maestros con su esquema y un error legible. */
function cargar<T>(nombre: string, esquema: z.ZodType<T>): Resultado<T[]> {
  const leido = leerJson<unknown>(rutaMaestroArchivo(nombre))
  if (!leido.ok) return leido
  const validado = z.array(esquema).safeParse(leido.data)
  if (!validado.success) {
    return {
      ok: false,
      error: `el archivo ${nombre}.json no tiene el formato esperado del maestro`,
    }
  }
  return { ok: true, data: validado.data }
}

/** Carga los cuatro maestros de `maestros/`. */
export function cargarMaestros(): Resultado<Maestros> {
  const proveedores = cargar("proveedores", EsquemaProveedor)
  if (!proveedores.ok) return proveedores
  const centros = cargar("centros-costo", EsquemaCentro)
  if (!centros.ok) return centros
  const indicadoresIva = cargar("indicadores-iva", EsquemaIndicadorIva)
  if (!indicadoresIva.ok) return indicadoresIva
  const condicionesPago = cargar("condiciones-pago", EsquemaCondicionPago)
  if (!condicionesPago.ok) return condicionesPago

  return {
    ok: true,
    data: {
      proveedores: proveedores.data,
      centros: centros.data,
      indicadoresIva: indicadoresIva.data,
      condicionesPago: condicionesPago.data,
    },
  }
}

/** Proveedor por NIT (comparando por clave, con o sin dígito de verificación). */
export function proveedorPorNit(maestros: Maestros, nit: string): Proveedor | null {
  const buscado = claveNit(nit)
  if (buscado === "") return null
  return maestros.proveedores.find((p) => claveNit(p.nit) === buscado) ?? null
}

/** Proveedor por nombre normalizado, sin forma societaria ni acentos. */
export function proveedorPorNombre(maestros: Maestros, nombre: string): Proveedor | null {
  const buscado = quitarFormaSocietaria(nombre)
  if (buscado === "") return null
  return maestros.proveedores.find((p) => quitarFormaSocietaria(p.nombre) === buscado) ?? null
}

/**
 * Resolución del proveedor tal como la pide RC1: primero por NIT y, si la
 * solicitud no trae NIT, por nombre normalizado.
 */
export function resolverProveedor(
  maestros: Maestros,
  datos: { nit?: string | undefined; nombre: string },
): Proveedor | null {
  const nit = datos.nit?.trim()
  if (nit !== undefined && nit !== "") {
    const porNit = proveedorPorNit(maestros, nit)
    if (porNit !== null) return porNit
    return null
  }
  return proveedorPorNombre(maestros, datos.nombre)
}

/** Centro de costo por código (`CC-1010`). */
export function centroDe(maestros: Maestros, centroCosto: string): CentroCosto | null {
  const buscado = centroCosto.trim().toUpperCase()
  return maestros.centros.find((c) => c.centro_costo.toUpperCase() === buscado) ?? null
}

/** Aprobador de un centro por correo (comparación sin distinguir mayúsculas). */
export function aprobadorDe(centro: CentroCosto, email: string): Aprobador | null {
  const buscado = email.trim().toLowerCase()
  return centro.aprobadores.find((a) => a.email.toLowerCase() === buscado) ?? null
}

/** ¿La subárea pertenece al centro de costo? (RC4). */
export function apruebaSubarea(centro: CentroCosto, subarea: string): boolean {
  const buscada = subarea.trim().toLowerCase()
  return centro.subareas.some((s) => s.toLowerCase() === buscada)
}

/** Condición de pago por código (`Z030`). */
export function condicionDe(maestros: Maestros, codigo: string): CondicionPago | null {
  const buscado = codigo.trim().toUpperCase()
  return maestros.condicionesPago.find((c) => c.codigo.toUpperCase() === buscado) ?? null
}

/** Indicador de IVA por código (`C1`). */
export function indicadorDe(maestros: Maestros, codigo: string): IndicadorIva | null {
  const buscado = codigo.trim().toUpperCase()
  return maestros.indicadoresIva.find((i) => i.codigo.toUpperCase() === buscado) ?? null
}
