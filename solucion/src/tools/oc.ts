/**
 * Las cinco herramientas `oc_*` (PRD §6.2).
 *
 * Son **la única superficie que el modelo puede llamar** y la única fuente de
 * valores: aquí no se decide nada de negocio, se delega en el motor determinista
 * y se traduce el resultado a `{ ok, data | error }`. Tres reglas que no se
 * rompen en ninguna:
 *
 *   1. **Nunca lanzan** y devuelven siempre un string JSON.
 *   2. **Ninguna recibe rutas**: reciben el nombre del caso (`sol-004`) y las
 *      rutas las resuelve el motor, confinadas a `fixtures/` (lectura) y `out/`
 *      (escritura). El id lo propone el modelo, así que se valida antes de tocar
 *      el disco.
 *   3. **`oc_crear` exige `confirmado`**: sin un «sí» que venga de una persona no
 *      se escribe en SAP, y tampoco se escribe la fila de control. Es la única
 *      acción irreversible del reto (CA3).
 *
 * La sexta del PRD (`oc_leer_excel`, P1) queda **declarada y no implementada**:
 * los fixtures entregan la solicitud ya normalizada en JSON y añadir un lector de
 * `.xlsx` sería una dependencia nueva para un requisito opcional.
 */
import path from "node:path"
import { z } from "zod"
import { cargarMaestros } from "../core/maestros.ts"
import { leerPaquete } from "../core/paquete.ts"
import { contextoDe, validar as validarMotor } from "../core/controles.ts"
import { construirPayload, EsquemaOrdenCompra } from "../core/payload.ts"
import { generarEvidencia } from "../core/evidencia.ts"
import { filaDeControl, registrarControl, type EstadoControl } from "../core/control.ts"
import { leerCsv } from "../core/csv.ts"
import { leerJson, leerTexto } from "../core/io.ts"
import { validarIdCaso } from "../core/rutas.ts"
import { ErrorSap } from "../sap/adapter.ts"
import { crearSapSimulado } from "../sap/mock.ts"
import { auditarDerivados, auditarPaquete, auditarPayload } from "./auditoria.ts"
import { NOMBRES, conRegistro, entornoDe, fallo, nombreHerramienta, type ContextoHerramienta, type HerramientaGenerica } from "./contrato.ts"
import type { Derivaciones } from "../core/derivados.ts"
import type { Entorno } from "../core/entorno.ts"
import type { PayloadConstruido } from "../core/payload.ts"
import type { Hallazgo, Maestros, Paquete, Proveedor, Resultado, Validacion } from "../core/tipos.ts"

// ── Esquemas que ve el modelo ────────────────────────────────────────────────

/** Nombre del caso tal como lo escribe el modelo. */
const CasoDescrito = z
  .string()
  .describe('Nombre de la carpeta del caso en fixtures/reto-03/solicitudes/ (por ejemplo "sol-004"); nunca una ruta')

/** Campos de la solicitud que se auditan si el modelo los propone. */
const EsquemaSolicitudPropuesta = z.object({
  solicitud_id: z.string().optional().describe("Identificador de la solicitud (SOL-2026-004)"),
  proveedor_nit: z.string().optional().describe("NIT del proveedor tal como está en la solicitud"),
  proveedor_nombre: z.string().optional(),
  descripcion: z.string().optional(),
  centro_costo: z.string().optional(),
  subarea: z.string().optional(),
  cantidad: z.number().optional(),
  valor_unitario: z.number().optional(),
  valor_total: z.number().optional(),
  moneda: z.string().optional(),
  indicador_iva: z.string().optional(),
  condiciones_pago: z.string().optional(),
  fecha_solicitud: z.string().optional(),
})

/** Paquete propuesto por el modelo: opcional y **auditado** contra el fixture. */
const EsquemaPaquetePropuesto = z
  .object({
    solicitud: EsquemaSolicitudPropuesta.optional(),
    cotizacion: z
      .object({ referencia: z.string().optional(), total: z.number().optional() })
      .optional()
      .describe("Cotización tal como la leyó el modelo; el motor usa la del fixture"),
    aprobacion: z
      .object({
        de: z.string().optional(),
        fecha: z.string().optional(),
        aprobado: z.boolean().optional(),
      })
      .optional(),
    factura: z
      .object({
        numero: z.string().optional(),
        fecha: z.string().optional(),
        total: z.number().optional(),
      })
      .optional(),
  })
  .describe("Opcional: si se envía, se compara con el fixture y gana el fixture (CA2)")

/** Derivaciones propuestas por el modelo: también se auditan. */
const EsquemaDerivadosPropuestos = z
  .object({
    indicador_iva: z.string().optional().describe("Código de IVA que el modelo cree correcto"),
    condiciones_pago: z.string().optional(),
    unidad: z.enum(["UN", "H", "MES"]).optional(),
  })
  .describe("Opcional: el motor recalcula los derivados con RC6 y RC7 (CA2)")

const EsquemaConfirmadoPor = z
  .string()
  .optional()
  .describe("Correo de la persona que confirmó; queda firmado en las excepciones del payload")

// ── Ayudantes internos ───────────────────────────────────────────────────────

/** Todo lo que necesitan las herramientas que trabajan sobre un caso. */
interface Trabajo {
  entorno: Entorno
  paquete: Paquete
  validacion: Validacion
  maestros: Maestros
  derivaciones: Derivaciones
  proveedor: Proveedor | null
  /** Discrepancias detectadas entre lo que propuso el modelo y el documento. */
  avisos: string[]
}

/**
 * Carga lo que necesitan `oc_validar`, `oc_construir_payload` y `oc_crear`: el
 * paquete del fixture, los maestros del entorno, el veredicto de RC1–RC10 y las
 * derivaciones. Si el modelo propuso un paquete se audita, y **gana el fixture**.
 *
 * El nombre del caso se valida **antes** de tocar el disco: el id lo propone el
 * modelo, así que se exige el formato `sol-00N` (defensa en profundidad).
 */
function preparar(entorno: Entorno, caso: string, propuesto?: unknown): Resultado<Trabajo> {
  const id = validarIdCaso(caso)
  if (!id.ok) return id

  const paquete = leerPaquete(id.data, entorno.solicitudes)
  if (!paquete.ok) return paquete

  const maestros = cargarMaestros(entorno.maestros)
  if (!maestros.ok) return maestros

  const avisos = propuesto === undefined ? [] : auditarPaquete(propuesto, paquete.data)
  const validacion = validarMotor(maestros.data, paquete.data, entorno.reglas)
  const contexto = contextoDe(maestros.data, paquete.data, entorno.reglas)

  return {
    ok: true,
    data: {
      entorno,
      paquete: paquete.data,
      validacion,
      maestros: maestros.data,
      derivaciones: contexto.derivaciones,
      proveedor: contexto.proveedor,
      avisos,
    },
  }
}

/** Códigos de los hallazgos, para mensajes y resúmenes. */
function codigos(hallazgos: readonly Hallazgo[]): string {
  return hallazgos.map((h) => h.codigo).join(", ")
}

/**
 * Detalles de los hallazgos en una línea. Se quita el punto final de cada uno
 * para que el mensaje no salga con «S.A.S..» cuando el detalle ya termina en
 * punto.
 */
function detallesDe(hallazgos: readonly Hallazgo[]): string {
  return hallazgos.map((hallazgo) => `${hallazgo.codigo}: ${hallazgo.detalle.replace(/\.$/, "")}`).join(" | ")
}

/**
 * ¿Ya hay una fila de esta solicitud en el log de control?
 *
 * El archivo es «una fila por solicitud procesada», no una por intento: repetir
 * el recorrido (o volver a intentar un caso bloqueado) no puede duplicar el
 * histórico que lee contabilidad.
 */
function yaEnControl(entorno: Entorno, solicitudId: string): boolean {
  const leido = leerTexto(entorno.control)
  if (!leido.ok) return false
  const csv = leerCsv(leido.data)
  if (csv === null) return false
  const columna = csv.cabeceras.indexOf("solicitud_id")
  if (columna < 0) return false
  return csv.filas.some((fila) => fila[columna] === solicitudId)
}

/**
 * Escribe la fila de `out/control.csv` de un caso **resuelto**.
 *
 * Solo hay fila cuando el caso se cierra: `creada` (la OC existe) o `bloqueada`
 * (el motor no la deja pasar). Un caso pendiente de confirmación no deja fila
 * porque todavía no pasó nada, y un caso que ya tiene la suya tampoco: así el
 * archivo queda con una fila por solicitud y no con una por intento.
 */
function filaControl(
  entorno: Entorno,
  paquete: Paquete,
  validacion: Validacion,
  numeroOc: string,
  estado: EstadoControl,
): Resultado<string> {
  const { solicitud } = paquete
  if (yaEnControl(entorno, solicitud.solicitud_id)) {
    return { ok: true, data: entorno.control }
  }
  return registrarControl(
    entorno.escritor,
    filaDeControl({
      caso: paquete.caso,
      solicitudId: solicitud.solicitud_id,
      numeroOc,
      proveedor: solicitud.proveedor_nombre,
      nit: solicitud.proveedor_nit ?? "",
      centroCosto: solicitud.centro_costo,
      subarea: solicitud.subarea,
      valor: solicitud.valor_total,
      moneda: solicitud.moneda,
      aprobador: paquete.aprobacion?.de ?? "",
      validacion,
      estado,
      fechaProceso: entorno.hoy,
    }),
  )
}

/** Dónde quedó guardada una OC en el simulador. */
function rutaOrden(entorno: Entorno, numeroOc: string): string {
  return path.join(entorno.sap, "ordenes", `${numeroOc}.json`)
}

/**
 * Fecha de creación que guardó el simulador. Se lee del archivo para poder
 * repetir la respuesta de `oc_crear` en el camino idempotente sin crear nada.
 */
function fechaDeOrden(entorno: Entorno, numeroOc: string): string {
  const leido = leerJson<{ fecha_creacion?: string }>(rutaOrden(entorno, numeroOc))
  return leido.ok && typeof leido.data.fecha_creacion === "string" ? leido.data.fecha_creacion : ""
}

// ── 1 · oc_leer_paquete (HU-1) ───────────────────────────────────────────────

/** Resumen de un paquete, para el log y para la tarjeta del chat. */
function resumenPaquete(paquete: Paquete): string {
  const { solicitud } = paquete
  const faltantes = paquete.faltantes.length > 0 ? ` · faltan ${paquete.faltantes.length} pieza(s)` : ""
  return `${solicitud.solicitud_id} · ${solicitud.proveedor_nombre} · ${solicitud.valor_total} ${solicitud.moneda}${faltantes}`
}

/**
 * Lee el paquete del caso. Un adjunto ausente **no** es un error: viene como
 * `null` y se nombra en `faltantes` (HU-1), que es lo que permite contestar «a
 * este caso le falta el correo de aprobación» en vez de caerse.
 */
export const leer_paquete = {
  description:
    "Lee el paquete de un caso del fixture (correo, solicitud, cotización, aprobación y factura si existe) y devuelve el paquete normalizado; lo que falte viene como null y se nombra en faltantes.",
  args: z.object({ caso: CasoDescrito }),
  async execute({ caso }: { caso: string }, ctx: ContextoHerramienta): Promise<string> {
    const entorno = entornoDe(ctx)
    if (!entorno.ok) return fallo(entorno.error)
    return conRegistro(
      NOMBRES.leerPaquete,
      ctx,
      caso,
      entorno.data,
      () => {
        const id = validarIdCaso(caso)
        if (!id.ok) return id
        return leerPaquete(id.data, entorno.data.solicitudes)
      },
      resumenPaquete,
    )
  },
}

// ── 2 · oc_validar (RC1–RC10) ────────────────────────────────────────────────

/** Lo que devuelve `oc_validar`: el veredicto + si hace falta un humano. */
export type DatosValidacion = Validacion & {
  /** `true` si alguna confirmación (RC5 · RC6 · RC8 · RC9) exige un «sí». */
  requiere_confirmacion: boolean
  /** Discrepancias entre lo que propuso el modelo y el documento (CA2). */
  avisos: string[]
}

/** Resumen del veredicto, para el log y para la tarjeta del chat. */
function resumenValidacion(validacion: DatosValidacion): string {
  const retroactiva = validacion.retroactiva ? " · retroactiva" : ""
  if (!validacion.apta) return `bloqueada por ${codigos(validacion.bloqueos)}`
  if (validacion.confirmaciones.length > 0) {
    return `apta, requiere confirmar ${codigos(validacion.confirmaciones)}${retroactiva}`
  }
  return `apta, sin excepciones${retroactiva}`
}

/**
 * Aplica todas las reglas al caso. Devuelve **todas** las razones, no la primera:
 * `sol-003` acumula RC2 y RC3 a propósito, para que quien lo revise arregle de
 * una vez el correo de aprobación y el tope que se pasó.
 */
export const validar = {
  description:
    "Aplica las reglas RC1–RC10 al caso y devuelve si es apta, los bloqueos que lo impiden, las confirmaciones que necesita una persona, los derivados y si es retroactiva.",
  args: z.object({
    caso: CasoDescrito,
    paquete: EsquemaPaquetePropuesto.optional(),
  }),
  async execute(
    { caso, paquete }: { caso: string; paquete?: unknown },
    ctx: ContextoHerramienta,
  ): Promise<string> {
    const entorno = entornoDe(ctx)
    if (!entorno.ok) return fallo(entorno.error)
    return conRegistro<DatosValidacion>(
      NOMBRES.validar,
      ctx,
      caso,
      entorno.data,
      () => {
        const preparado = preparar(entorno.data, caso, paquete)
        if (!preparado.ok) return preparado
        const { validacion, avisos } = preparado.data
        return {
          ok: true,
          data: {
            ...validacion,
            requiere_confirmacion: validacion.confirmaciones.length > 0,
            avisos,
          },
        }
      },
      resumenValidacion,
    )
  },
}

// ── 3 · oc_construir_payload (PRD §7.4) ──────────────────────────────────────

/** Lo que devuelve `oc_construir_payload`: la OC validada + de dónde salió cada valor. */
export type DatosPayload = PayloadConstruido & {
  /** Discrepancias entre lo que propuso el modelo y lo que calcula el motor (CA2). */
  avisos: string[]
}

/** Resumen del payload, para el log y para la tarjeta del chat. */
function resumenPayload(datos: DatosPayload): string {
  const { orden } = datos
  const avisos = datos.avisos.length > 0 ? ` · ${datos.avisos.length} aviso(s)` : ""
  return `OC de ${orden.referencia.solicitud_id} · ${orden.posiciones.length} posición(es) · ${orden.excepciones.length} excepción(es)${avisos}`
}

/**
 * Construye el payload con el motor y lo devuelve ya validado con `zod`.
 *
 * La posición lleva los valores **de la solicitud** (lo que se aprobó) y la
 * diferencia con la cotización viaja como excepción firmada: aquí no se «arregla»
 * ningún monto para que cuadre (PRD §10). Con bloqueos sin resolver no se
 * construye nada, y con confirmaciones pendientes el payload sale marcado para
 * que se vea qué falta firmar.
 */
export const construir_payload = {
  description:
    "Construye el payload de la OC del caso (PRD §7.4) validado con zod y devuelve además la trazabilidad de cada valor: de dónde salió (fixture, maestro o derivación). No construye nada si hay bloqueos.",
  args: z.object({
    caso: CasoDescrito,
    paquete: EsquemaPaquetePropuesto.optional(),
    derivados: EsquemaDerivadosPropuestos.optional(),
    confirmado_por: EsquemaConfirmadoPor,
  }),
  async execute(
    {
      caso,
      paquete,
      derivados,
      confirmado_por,
    }: { caso: string; paquete?: unknown; derivados?: unknown; confirmado_por?: string | undefined },
    ctx: ContextoHerramienta,
  ): Promise<string> {
    const entorno = entornoDe(ctx)
    if (!entorno.ok) return fallo(entorno.error)
    return conRegistro<DatosPayload>(
      NOMBRES.construirPayload,
      ctx,
      caso,
      entorno.data,
      () => {
        const preparado = preparar(entorno.data, caso, paquete)
        if (!preparado.ok) return preparado
        const trabajo = preparado.data

        if (trabajo.proveedor === null) {
          return {
            ok: false,
            error: `no se puede construir el payload de ${caso}: el proveedor no está en el maestro de proveedores (RC1)`,
          }
        }

        const avisos = [
          ...trabajo.avisos,
          ...(derivados === undefined ? [] : auditarDerivados(derivados, trabajo.derivaciones)),
        ]

        const construido = construirPayload({
          paquete: trabajo.paquete,
          proveedor: trabajo.proveedor,
          derivaciones: trabajo.derivaciones,
          validacion: trabajo.validacion,
          reglas: trabajo.entorno.reglas,
          confirmadoPor: confirmado_por ?? null,
        })
        if (!construido.ok) return construido
        return { ok: true, data: { ...construido.data, avisos } }
      },
      resumenPayload,
    )
  },
}

// ── 4 · oc_generar_evidencia (HU-4) ──────────────────────────────────────────

/** Lo que devuelve `oc_generar_evidencia`: dónde quedó la evidencia y su huella. */
export interface DatosEvidencia {
  /** Ruta del archivo dentro de `out/evidencia/`. */
  ruta: string
  /** Huella SHA-256 del texto normalizado: la que viaja en el payload. */
  sha256: string
  /** Quién aprobó, para que el chat lo pueda decir sin abrir el archivo. */
  correo_de: string
}

/**
 * Escribe la evidencia de aprobación y devuelve su huella.
 *
 * La huella se calcula sobre el **texto normalizado**, y `oc_construir_payload`
 * la recalcula con la misma función: el payload sale igual si el modelo llama
 * primero a una herramienta o a la otra, y auditoría puede verificar el archivo
 * contra la orden (HU-4).
 */
export const generar_evidencia = {
  description:
    "Escribe la evidencia de aprobación del caso en out/evidencia/ (el texto normalizado del correo del líder) y devuelve su ruta y su huella sha256, que es la que viaja en el payload.",
  args: z.object({ caso: CasoDescrito }),
  async execute({ caso }: { caso: string }, ctx: ContextoHerramienta): Promise<string> {
    const entorno = entornoDe(ctx)
    if (!entorno.ok) return fallo(entorno.error)
    return conRegistro<DatosEvidencia>(
      NOMBRES.generarEvidencia,
      ctx,
      caso,
      entorno.data,
      () => {
        const id = validarIdCaso(caso)
        if (!id.ok) return id
        const paquete = leerPaquete(id.data, entorno.data.solicitudes)
        if (!paquete.ok) return paquete
        const { aprobacion } = paquete.data
        if (aprobacion === null) {
          return {
            ok: false,
            error: `el caso ${caso} no trae correo de aprobación (aprobacion.json): sin aprobación no hay evidencia que firmar (HU-4)`,
          }
        }
        const escrita = generarEvidencia(entorno.data.escritor, caso, aprobacion)
        if (!escrita.ok) return escrita
        return { ok: true, data: { ...escrita.data, correo_de: aprobacion.de } }
      },
      (datos) => `aprobación de ${datos.correo_de} · huella ${datos.sha256.slice(0, 12)}…`,
    )
  },
}

// ── 5 · oc_crear (HU-5) ──────────────────────────────────────────────────────

/** Lo que devuelve `oc_crear` cuando la OC existe: creada ahora o ya estaba. */
export interface DatosCreacion {
  numero_oc: string
  fecha: string
  /** `true` si la OC ya existía para esa solicitud y no se escribió nada nuevo. */
  idempotente: boolean
  /** Dónde quedó guardada en el simulador (`out/sap/ordenes/<numero>.json`). */
  ruta_orden: string
  /** Códigos de las excepciones que viajan firmadas en el payload. */
  excepciones: string[]
  /** Discrepancias entre lo que propuso el modelo y lo que calculó el motor (CA2). */
  avisos: string[]
}

/** Construye el payload con el motor y lo escribe en el SAP simulado. */
async function crearEnSap(
  entorno: Entorno,
  paquete: Paquete,
  validacion: Validacion,
  derivaciones: Derivaciones,
  proveedor: Proveedor,
  confirmadoPor: string | null,
  payloadPropuesto: unknown,
): Promise<Resultado<DatosCreacion>> {
  const { solicitud } = paquete

  const construido = construirPayload({
    paquete,
    proveedor,
    derivaciones,
    validacion,
    reglas: entorno.reglas,
    confirmadoPor,
  })
  if (!construido.ok) return construido
  const { orden } = construido.data

  const avisos = payloadPropuesto === undefined ? [] : auditarPayload(payloadPropuesto, orden)
  const sap = crearSapSimulado({
    raiz: entorno.sap,
    proveedores: path.join(entorno.maestros, "proveedores.json"),
  })

  // Idempotencia: si esa solicitud ya tiene OC se devuelve la misma y no se
  // escribe ni en SAP ni en el log de control. Es lo que permite repetir la demo.
  const existente = await sap.buscarOrdenPorReferencia(solicitud.solicitud_id)
  if (existente !== null) {
    return {
      ok: true,
      data: {
        numero_oc: existente.numero_oc,
        fecha: fechaDeOrden(entorno, existente.numero_oc),
        idempotente: true,
        ruta_orden: rutaOrden(entorno, existente.numero_oc),
        excepciones: orden.excepciones.map((excepcion) => excepcion.codigo),
        avisos,
      },
    }
  }

  let creada: { numero_oc: string; fecha: string }
  try {
    creada = await sap.crearOrden(orden)
  } catch (error) {
    const detalle = error instanceof ErrorSap ? error.message : String(error)
    return { ok: false, error: `SAP no creó la orden de ${solicitud.solicitud_id}: ${detalle}` }
  }

  const fila = filaControl(entorno, paquete, validacion, creada.numero_oc, "creada")
  if (!fila.ok) avisos.push(`no se pudo escribir la fila en out/control.csv: ${fila.error}`)

  return {
    ok: true,
    data: {
      numero_oc: creada.numero_oc,
      fecha: creada.fecha,
      idempotente: false,
      ruta_orden: rutaOrden(entorno, creada.numero_oc),
      excepciones: orden.excepciones.map((excepcion) => excepcion.codigo),
      avisos,
    },
  }
}

/**
 * Crea la OC. Es la única acción irreversible del reto, así que tiene dos
 * puertas antes de escribir:
 *
 *   1. **Los bloqueos ganan**: si RC1–RC4 o RC10 no están en verde no se llega
 *      aquí; se deja la fila de control como `bloqueada` y se explica el motivo
 *      con la acción sugerida.
 *   2. **`confirmado`**: si el caso necesita confirmación (RC5 · RC6 · RC8 · RC9)
 *      y no llega un `true`, no se crea nada —ni en SAP ni en `out/control.csv`—
 *      y el turno termina pidiendo el «sí» que exige CA3. El `true` lo pone una
 *      persona en el chat; el ciclo lo sobrescribe en F3 para que el modelo no
 *      pueda concedérselo solo.
 *
 * El payload que se envía es **el del motor**: si el modelo propuso uno, se
 * audita y la diferencia queda como aviso en vez de viajar a SAP (CA2).
 */
export const crear = {
  description:
    "Crea la OC en SAP desde el payload del motor. Exige confirmado: true cuando el caso necesita confirmación humana y no crea nada si hay bloqueos. Si ya existe una OC para esa solicitud, devuelve la misma con idempotente: true.",
  args: z.object({
    caso: CasoDescrito,
    payload: EsquemaOrdenCompra.optional().describe(
      "Opcional: si se envía se audita contra el payload del motor y gana el del motor (CA2)",
    ),
    confirmado: z
      .boolean()
      .optional()
      .describe("true solo si una persona lo confirmó en el chat; sin esto no se escribe en SAP (CA3)"),
    confirmado_por: EsquemaConfirmadoPor,
  }),
  async execute(
    {
      caso,
      payload,
      confirmado,
      confirmado_por,
    }: { caso: string; payload?: unknown; confirmado?: boolean | undefined; confirmado_por?: string | undefined },
    ctx: ContextoHerramienta,
  ): Promise<string> {
    const entorno = entornoDe(ctx)
    if (!entorno.ok) return fallo(entorno.error)
    return conRegistro<DatosCreacion>(
      NOMBRES.crear,
      ctx,
      caso,
      entorno.data,
      async () => {
        const preparado = preparar(entorno.data, caso)
        if (!preparado.ok) return preparado
        const trabajo = preparado.data
        const { paquete, validacion, derivaciones, proveedor } = trabajo

        if (!validacion.apta) {
          const fila = filaControl(entorno.data, paquete, validacion, "", "bloqueada")
          const nota = fila.ok ? "" : ` (además, no se pudo escribir out/control.csv: ${fila.error})`
          return {
            ok: false,
            error: `no se crea la OC de ${caso}: el motor la bloqueó (${codigos(validacion.bloqueos)}). ${detallesDe(validacion.bloqueos)}.${nota}`,
          }
        }

        if (validacion.confirmaciones.length > 0 && confirmado !== true) {
          return {
            ok: false,
            error: `faltan confirmaciones humanas para crear la OC de ${caso}: ${detallesDe(validacion.confirmaciones)}. Cuando la persona lo haya confirmado, vuelve a llamar con confirmado: true; no se ha escrito nada en SAP ni en out/control.csv (CA3).`,
          }
        }

        if (proveedor === null) {
          return {
            ok: false,
            error: `no se puede crear la OC de ${caso}: el proveedor no está en el maestro de proveedores (RC1)`,
          }
        }

        const resultado = await crearEnSap(
          entorno.data,
          paquete,
          validacion,
          derivaciones,
          proveedor,
          confirmado_por ?? null,
          payload,
        )
        if (resultado.ok && trabajo.avisos.length > 0) resultado.data.avisos.push(...trabajo.avisos)
        return resultado
      },
      (datos) => `${datos.idempotente ? "ya existía" : "creada"} · OC ${datos.numero_oc}`,
    )
  },
}

// ── Registro: lo que el modelo puede llamar (PRD §6.2) ───────────────────────

/**
 * Las cinco herramientas por su nombre de export. El nombre visible se deriva
 * con `nombreHerramienta("oc", clave)` (`oc_leer_paquete`, `oc_validar`…) y es el
 * que el ciclo publica al modelo en F3.
 *
 * `oc_leer_excel` (P1 opcional del PRD) **no está**: los fixtures entregan la
 * solicitud ya normalizada en JSON y añadir un lector de `.xlsx` sería una
 * dependencia nueva para un requisito opcional. Queda declarado en el README.
 */
export const HERRAMIENTAS = {
  leer_paquete,
  validar,
  construir_payload,
  generar_evidencia,
  crear,
} satisfies Record<string, HerramientaGenerica>

/** Vista uniforme para el ciclo: nombre visible + herramienta. */
export const REGISTRO: readonly { nombre: string; herramienta: HerramientaGenerica }[] = Object.entries(
  HERRAMIENTAS,
).map(([exportado, herramienta]) => ({
  nombre: nombreHerramienta("oc", exportado),
  herramienta,
}))

/** Nombres visibles para el modelo, en el orden en que se publican. */
export const NOMBRES_VISIBLES: readonly string[] = REGISTRO.map((entrada) => entrada.nombre)
