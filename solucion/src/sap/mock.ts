/**
 * SAP simulado (PRD §7.4): implementa `SapAdapter` escribiendo en `out/sap/`.
 *
 * Es el **sistema de registro** del reto, así que se comporta como tal:
 *
 *   · **números correlativos** desde `4500000001`, calculados a partir del mayor
 *     ya emitido — una ejecución limpia de la demo da siempre el mismo número;
 *   · **idempotencia** por referencia de solicitud: el índice
 *     `out/sap/indice.json` es lo que hace que crear dos veces lo mismo sea
 *     imposible, y es el mismo mecanismo que en SAP real resolvería
 *     `buscarOrdenPorReferencia`;
 *   · **nada de reglas de negocio**: si un payload llegó hasta aquí, el motor ya
 *     lo declaró apto. Un adaptador con RC1–RC10 duplicadas se desincroniza en la
 *     primera revisión de una regla.
 */
import { readFileSync } from "node:fs"
import { crearEscritor, type Escritor } from "../core/escritor.ts"
import { leerJson } from "../core/io.ts"
import { claveNit, formatearFecha } from "../core/normalizacion.ts"
import { EsquemaOrdenCompra } from "../core/payload.ts"
import type { OrdenCompra, Proveedor } from "../core/tipos.ts"
import { ErrorSap, type SapAdapter } from "./adapter.ts"

/** Primer número de OC del simulador. */
export const NUMERO_INICIAL = 4_500_000_001n

/** Opciones del simulador: dónde escribe y de dónde lee el maestro. */
export interface OpcionesSap {
  /** Raíz del simulador (`out/sap`). */
  raiz: string
  /** Ruta del `proveedores.json` entregado por Periferia. */
  proveedores: string
  /** Reloj inyectable, para que las pruebas sean deterministas. */
  ahora?: () => Date
}

/** Lo que el simulador añade a la interfaz, útil para inspeccionar en pruebas. */
export interface SapSimulado extends SapAdapter {
  /** Índice completo `solicitud_id → numero_oc`. */
  indice(): Record<string, string>
  /** La orden guardada, tal como quedaría en SAP. */
  orden(numero: string): OrdenCompra | null
}

/** Fecha `YYYY-MM-DD` de un reloj, en UTC. */
function fechaDe(ahora: Date): string {
  return (
    formatearFecha({
      dia: ahora.getUTCDate(),
      mes: ahora.getUTCMonth() + 1,
      anio: ahora.getUTCFullYear(),
    }) ?? "1970-01-01"
  )
}

/** Crea el simulador sobre un directorio (normalmente `out/sap`). */
export function crearSapSimulado(opciones: OpcionesSap): SapSimulado {
  const escritor: Escritor = crearEscritor(opciones.raiz)
  const reloj = opciones.ahora ?? (() => new Date())

  function leerIndice(): Record<string, string> {
    const leido = leerJson<Record<string, string>>(`${opciones.raiz}/indice.json`)
    return leido.ok && typeof leido.data === "object" && leido.data !== null ? leido.data : {}
  }

  function siguienteNumero(indice: Record<string, string>): string {
    let mayor = NUMERO_INICIAL - 1n
    for (const numero of Object.values(indice)) {
      try {
        const valor = BigInt(numero)
        if (valor > mayor) mayor = valor
      } catch {
        // Un número ilegible en el índice no debe romper la numeración.
      }
    }
    return String(mayor + 1n)
  }

  function proveedores(): Proveedor[] {
    const leido = leerJson<Proveedor[]>(opciones.proveedores)
    return leido.ok && Array.isArray(leido.data) ? leido.data : []
  }

  async function consultarProveedor(
    nit: string,
  ): Promise<{ codigo_sap: string; activo: boolean } | null> {
    const buscado = claveNit(nit)
    if (buscado === "") return null
    const encontrado = proveedores().find((p) => claveNit(p.nit) === buscado)
    if (encontrado === undefined) return null
    return { codigo_sap: encontrado.codigo_sap, activo: encontrado.activo }
  }

  async function buscarOrdenPorReferencia(
    solicitud_id: string,
  ): Promise<{ numero_oc: string } | null> {
    const numero = leerIndice()[solicitud_id]
    return numero === undefined ? null : { numero_oc: numero }
  }

  async function crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }> {
    const validado = EsquemaOrdenCompra.safeParse(orden)
    if (!validado.success) {
      const problema = validado.error.issues[0]
      throw new ErrorSap(
        `SAP rechazó la orden: el payload no cumple el contrato (${problema?.path.join(".") ?? "?"})`,
      )
    }

    const solicitud = orden.referencia.solicitud_id
    const indice = leerIndice()
    const yaExiste = indice[solicitud]
    if (yaExiste !== undefined) {
      throw new ErrorSap(
        `SAP ya tiene la orden ${yaExiste} para la solicitud ${solicitud}: no se crea otra`,
      )
    }

    const numero = siguienteNumero(indice)
    const fecha = fechaDe(reloj())
    const guardado = escritor.escribir(
      JSON.stringify({ numero_oc: numero, fecha_creacion: fecha, orden }, null, 2) + "\n",
      "ordenes",
      `${numero}.json`,
    )
    if (!guardado.ok) throw new ErrorSap(`no se pudo guardar la orden en el simulador: ${guardado.error}`)

    const actualizado = escritor.escribir(
      JSON.stringify({ ...indice, [solicitud]: numero }, null, 2) + "\n",
      "indice.json",
    )
    if (!actualizado.ok) {
      throw new ErrorSap(`no se pudo actualizar el índice del simulador: ${actualizado.error}`)
    }

    return { numero_oc: numero, fecha }
  }

  function orden(numero: string): OrdenCompra | null {
    try {
      const crudo = JSON.parse(
        readFileSync(`${opciones.raiz}/ordenes/${numero}.json`, "utf8"),
      ) as { orden?: OrdenCompra }
      return crudo.orden ?? null
    } catch {
      return null
    }
  }

  return { consultarProveedor, crearOrden, buscarOrdenPorReferencia, indice: leerIndice, orden }
}
