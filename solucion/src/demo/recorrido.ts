/**
 * El recorrido de los seis casos **sin modelo** (PRD §6.6).
 *
 * Es la pieza que demuestra el motor en treinta segundos: llama a las
 * herramientas en el mismo orden en que las llamaría el agente —leer el paquete,
 * validar, construir el payload, generar la evidencia y crear— pero sin modelo,
 * sin claves y sin red.
 *
 * Y respeta la regla que da sentido a todo: un caso que necesita confirmación
 * **no se crea** en la primera pasada; solo se crea en la segunda, cuando llega
 * el `confirmado: true` que representa el «sí» de una persona (CA3). Además,
 * repetir el recorrido **no crea OC nuevas**: eso es la idempotencia.
 */
import {
  construir_payload,
  crear as toolCrear,
  generar_evidencia,
  leer_paquete,
  validar,
} from "../tools/oc.ts"
import type { ContextoHerramienta } from "../tools/contrato.ts"
import type { DatosCreacion, DatosEvidencia, DatosPayload, DatosValidacion } from "../tools/oc.ts"
import type { Paquete, Resultado } from "../core/tipos.ts"

/** Los seis casos del fixture, en el orden en que se recorren. */
export const CASOS: readonly string[] = [
  "sol-001",
  "sol-002",
  "sol-003",
  "sol-004",
  "sol-005",
  "sol-006",
]

/** Fecha de referencia por defecto: la del prompt de ejemplo del PRD §11. */
export const HOY_POR_DEFECTO = "2026-09-03"

/** Cómo terminó un caso dentro del recorrido. */
export type EstadoCaso =
  | "creada"
  | "idempotente"
  | "bloqueada"
  | "pendiente_confirmacion"
  | "error"

/** Lo que la demo cuenta de cada caso. */
export interface FilaRecorrido {
  caso: string
  solicitud_id: string
  apta: boolean
  bloqueos: string[]
  confirmaciones: string[]
  retroactiva: boolean
  estado: EstadoCaso
  numero_oc: string | null
  fecha: string | null
  excepciones: string[]
  /** Piezas que faltaban en el paquete (HU-1). */
  faltantes: string[]
  avisos: string[]
  ruta_evidencia: string | null
  ruta_orden: string | null
  /** La OC tal como quedaría, en una línea. */
  detalle: string | null
  /** Por qué no se creó (o por qué falló). */
  motivo: string | null
}

/** Totales del recorrido. */
export interface ConteoRecorrido {
  total: number
  creadas: number
  /** Casos que ya tenían OC: repetir el recorrido no crea nada nuevo. */
  idempotentes: number
  bloqueadas: number
  pendientes: number
  errores: number
}

/** Opciones del recorrido. */
export interface OpcionesRecorrido {
  /** Segunda pasada: confirma lo que quedó pendiente (CA3 · PRD §6.6). */
  confirmar: boolean
  /** Correo de quien confirma; queda firmado en las excepciones. */
  confirmadoPor: string
  /** Casos a recorrer; por defecto, los seis del fixture. */
  casos?: readonly string[]
}

/** Resultado completo del recorrido. */
export interface ResumenRecorrido {
  filas: FilaRecorrido[]
  conteo: ConteoRecorrido
}

/** Lee la respuesta de una herramienta (`{ ok, data | error }`). */
export function interpretar<T>(respuesta: string): Resultado<T> {
  try {
    const cuerpo = JSON.parse(respuesta) as { ok?: boolean; data?: T; error?: string }
    if (cuerpo.ok === true && cuerpo.data !== undefined) return { ok: true, data: cuerpo.data }
    return { ok: false, error: cuerpo.error ?? "respuesta sin datos" }
  } catch {
    return { ok: false, error: "la herramienta devolvió algo que no es JSON" }
  }
}

/** Fila vacía, para poder completarla paso a paso. */
function filaBase(caso: string): FilaRecorrido {
  return {
    caso,
    solicitud_id: "",
    apta: false,
    bloqueos: [],
    confirmaciones: [],
    retroactiva: false,
    estado: "error",
    numero_oc: null,
    fecha: null,
    excepciones: [],
    faltantes: [],
    avisos: [],
    ruta_evidencia: null,
    ruta_orden: null,
    detalle: null,
    motivo: null,
  }
}

/** Suma los estados del recorrido. */
function contar(filas: readonly FilaRecorrido[]): ConteoRecorrido {
  return {
    total: filas.length,
    creadas: filas.filter((f) => f.estado === "creada").length,
    idempotentes: filas.filter((f) => f.estado === "idempotente").length,
    bloqueadas: filas.filter((f) => f.estado === "bloqueada").length,
    pendientes: filas.filter((f) => f.estado === "pendiente_confirmacion").length,
    errores: filas.filter((f) => f.estado === "error").length,
  }
}

/** Línea legible de la posición que tendría la OC, sin calcular nada nuevo. */
function detalleDe(payload: DatosPayload): string {
  const { orden } = payload
  const posicion = orden.posiciones[0]
  const importe =
    posicion === undefined ? "" : ` · ${posicion.cantidad} × ${posicion.precio_unitario} ${orden.moneda}`
  const excepciones =
    orden.excepciones.length > 0
      ? ` · excepciones: ${orden.excepciones.map((e) => e.codigo).join("+")}`
      : " · sin excepciones"
  return `${orden.proveedor.nombre}${importe} · ${orden.condiciones_pago} · centro ${posicion?.centro_costo ?? "?"}${excepciones}`
}

/**
 * Recorre los casos llamando a las herramientas, en el mismo orden en que las
 * llamaría el agente: `leer_paquete` → `validar` → `generar_evidencia` →
 * `construir_payload` → `crear`.
 *
 * Con `confirmar: false` los casos que necesitan confirmación terminan en
 * `pendiente_confirmacion` y **no se crea nada**; con `confirmar: true` se crean,
 * que es lo que demuestra que la escritura depende de una persona (CA3).
 *
 * A `crear` se le llama siempre, incluso con bloqueos, para que deje constancia
 * en `out/control.csv`: un caso bloqueado también se audita.
 */
export async function recorrer(
  ctx: ContextoHerramienta,
  opciones: OpcionesRecorrido,
): Promise<ResumenRecorrido> {
  const filas: FilaRecorrido[] = []

  for (const caso of opciones.casos ?? CASOS) {
    const fila = filaBase(caso)

    const leido = interpretar<Paquete>(await leer_paquete.execute({ caso }, ctx))
    if (!leido.ok) {
      fila.motivo = leido.error
      filas.push(fila)
      continue
    }
    fila.solicitud_id = leido.data.solicitud.solicitud_id
    fila.faltantes = leido.data.faltantes

    const evaluado = interpretar<DatosValidacion>(await validar.execute({ caso }, ctx))
    if (!evaluado.ok) {
      fila.motivo = evaluado.error
      filas.push(fila)
      continue
    }
    fila.apta = evaluado.data.apta
    fila.bloqueos = evaluado.data.bloqueos.map((hallazgo) => hallazgo.codigo)
    fila.confirmaciones = evaluado.data.confirmaciones.map((hallazgo) => hallazgo.codigo)
    fila.retroactiva = evaluado.data.retroactiva
    fila.avisos = [...evaluado.data.avisos]

    // ¿Esta pasada va a crear? Solo si el caso es apto y, cuando exige
    // confirmación, si quien recorre ya dijo que sí.
    const vaACrear = fila.apta && (opciones.confirmar || fila.confirmaciones.length === 0)

    // La evidencia se escribe justo antes de crear: es lo que se va a firmar.
    if (vaACrear) {
      const evidencia = interpretar<DatosEvidencia>(await generar_evidencia.execute({ caso }, ctx))
      if (evidencia.ok) fila.ruta_evidencia = evidencia.data.ruta
      else fila.avisos.push(`no se pudo generar la evidencia: ${evidencia.error}`)
    }

    if (fila.apta) {
      const payload = interpretar<DatosPayload>(
        await construir_payload.execute({ caso, confirmado_por: opciones.confirmadoPor }, ctx),
      )
      if (payload.ok) {
        fila.detalle = detalleDe(payload.data)
        fila.excepciones = payload.data.orden.excepciones.map((excepcion) => excepcion.codigo)
        fila.avisos.push(...payload.data.avisos)
      } else {
        fila.motivo = payload.error
      }
    }

    const creado = interpretar<DatosCreacion>(
      await toolCrear.execute(
        { caso, confirmado: opciones.confirmar, confirmado_por: opciones.confirmadoPor },
        ctx,
      ),
    )

    if (creado.ok) {
      fila.estado = creado.data.idempotente ? "idempotente" : "creada"
      fila.numero_oc = creado.data.numero_oc
      fila.fecha = creado.data.fecha
      fila.ruta_orden = creado.data.ruta_orden
      if (creado.data.excepciones.length > 0) fila.excepciones = creado.data.excepciones
      fila.avisos.push(...creado.data.avisos)
    } else {
      fila.motivo = creado.error
      if (fila.bloqueos.length > 0) fila.estado = "bloqueada"
      else if (fila.confirmaciones.length > 0 && !opciones.confirmar) {
        fila.estado = "pendiente_confirmacion"
      } else {
        fila.estado = "error"
      }
    }

    filas.push(fila)
  }

  return { filas, conteo: contar(filas) }
}

