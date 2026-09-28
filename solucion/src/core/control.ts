/**
 * Log de control para contabilidad y auditoría: `out/control.csv` (PRD §4 · §7.3).
 *
 * El PRD dice que contabilidad consume ese archivo, así que su forma es un
 * contrato: una fila por solicitud procesada, **con la marca de retroactiva**
 * (RC8) y con las excepciones que se firmaron. Se escribe con el CSV propio
 * (`csv.ts`), nunca a mano: un campo con comas mal escapado rompería el archivo
 * que lee otra área.
 */
import { construirCsv, escaparCampo } from "./csv.ts"
import type { Escritor } from "./escritor.ts"
import { existe } from "./io.ts"
import type { FilaControl, Resultado, Validacion } from "./tipos.ts"

/** Cabeceras del archivo, en orden. Cambiarlas es cambiar el contrato. */
export const CABECERAS_CONTROL = [
  "fecha_proceso",
  "caso",
  "solicitud_id",
  "numero_oc",
  "proveedor",
  "nit",
  "centro_costo",
  "subarea",
  "valor",
  "moneda",
  "aprobador",
  "retroactiva",
  "excepciones",
  "estado",
] as const

/** Estado con el que una fila queda registrada. */
export type EstadoControl = "creada" | "pendiente_confirmacion" | "bloqueada"

/** Datos necesarios para armar la fila de control. */
export interface EntradaControl {
  caso: string
  solicitudId: string
  numeroOc: string
  proveedor: string
  nit: string
  centroCosto: string
  subarea: string
  valor: number
  moneda: string
  aprobador: string
  validacion: Validacion
  estado: EstadoControl
  fechaProceso: string
}

/**
 * Códigos de las excepciones: lo confirmado y lo derivado que **rellenaba un
 * valor que faltaba** (IVA, condiciones de pago). La unidad de medida se deriva
 * siempre del texto, así que no es una excepción y no entra aquí.
 */
export function codigosDeExcepcion(validacion: Validacion): string {
  const codigos = [
    ...validacion.confirmaciones.map((h) => h.codigo),
    ...validacion.derivados.filter((d) => d.campo !== "unidad").map((d) => d.codigo),
  ]
  return [...new Set(codigos)].join("+")
}

/** Arma la fila del log de control a partir de lo que pasó. */
export function filaDeControl(entrada: EntradaControl): FilaControl {
  return {
    fecha_proceso: entrada.fechaProceso,
    caso: entrada.caso,
    solicitud_id: entrada.solicitudId,
    numero_oc: entrada.numeroOc,
    proveedor: entrada.proveedor,
    nit: entrada.nit,
    centro_costo: entrada.centroCosto,
    subarea: entrada.subarea,
    valor: entrada.valor,
    moneda: entrada.moneda,
    aprobador: entrada.aprobador,
    retroactiva: entrada.validacion.retroactiva ? "si" : "no",
    excepciones: codigosDeExcepcion(entrada.validacion),
    estado: entrada.estado,
  }
}

/** Los valores de una fila, en el orden de `CABECERAS_CONTROL`. */
export function valoresDeFila(fila: FilaControl): string[] {
  return [
    fila.fecha_proceso,
    fila.caso,
    fila.solicitud_id,
    fila.numero_oc,
    fila.proveedor,
    fila.nit,
    fila.centro_costo,
    fila.subarea,
    String(fila.valor),
    fila.moneda,
    fila.aprobador,
    fila.retroactiva,
    fila.excepciones,
    fila.estado,
  ]
}

/** Línea CSV de una fila (sin salto). */
export function lineaDeFila(fila: FilaControl): string {
  return valoresDeFila(fila).map(escaparCampo).join(",")
}

/**
 * Añade la fila a `out/control.csv`. La primera vez escribe la cabecera; como el
 * archivo se abre en modo anexado, cada ejecución suma su fila.
 */
export function registrarControl(escritor: Escritor, fila: FilaControl): Resultado<string> {
  const ruta = `${escritor.raiz}/control.csv`
  if (!existe(ruta)) {
    const escrito = escritor.escribir(
      construirCsv([...CABECERAS_CONTROL], [valoresDeFila(fila)]),
      "control.csv",
    )
    return escrito
  }
  return escritor.anexar(lineaDeFila(fila), "control.csv")
}
