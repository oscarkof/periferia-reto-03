/**
 * El entorno de una ejecución: dónde están los datos, dónde se escribe y con qué
 * umbrales trabaja el motor.
 *
 * El contrato de herramientas del PRD §6.2 pasa `ctx.directory` (la raíz del
 * proyecto) en cada llamada, así que el entorno se construye **desde ahí**: el
 * escritor queda confinado a `<raíz>/out` y los datos se leen de
 * `<raíz>/../fixtures/reto-03`. Nada absoluto, nada fuera de sitio.
 *
 * Las pruebas y `demo.ts` también lo usan: montar un entorno sobre una carpeta
 * temporal es la forma de trabajar sin tocar el `out/` del repositorio.
 */
import path from "node:path"
import { crearEscritor, type Escritor } from "./escritor.ts"
import { validarFecha, formatearFecha } from "./normalizacion.ts"
import type { Reglas, Resultado, UnidadMedida } from "./tipos.ts"

/** Sobrescrituras pensadas para pruebas (fixtures y `out` temporales). */
export interface OpcionesEntorno {
  fixtures?: string
  out?: string
  hoy?: string
  sesion?: string
  reglas?: Partial<Reglas>
}

/** Todo lo que una herramienta necesita saber para trabajar. */
export interface Entorno {
  /** Raíz del proyecto (`ctx.directory`). */
  raiz: string
  escritor: Escritor
  /** `fixtures/reto-03/solicitudes/`. */
  solicitudes: string
  /** `fixtures/reto-03/maestros/`. */
  maestros: string
  evidencia: string
  sap: string
  indiceSap: string
  control: string
  log: string
  sesiones: string
  /** Fecha de referencia `YYYY-MM-DD` (proceso, no del documento). */
  hoy: string
  sesion: string
  reglas: Reglas
}

/** Fecha del sistema en UTC (`YYYY-MM-DD`), sin sorpresas de zona horaria. */
export function fechaDelSistema(ahora: Date = new Date()): string {
  const formateada = formatearFecha({
    dia: ahora.getUTCDate(),
    mes: ahora.getUTCMonth() + 1,
    anio: ahora.getUTCFullYear(),
  })
  return formateada ?? "1970-01-01"
}

/** Número de una variable de entorno, con valor por defecto y sin negativos. */
function numeroDeEnv(nombre: string, porDefecto: number): number {
  const crudo = process.env[nombre]
  if (crudo === undefined || crudo.trim() === "") return porDefecto
  const valor = Number(crudo.replace(",", "."))
  return Number.isFinite(valor) && valor >= 0 ? valor : porDefecto
}

/** Texto de una variable de entorno, con valor por defecto. */
function textoDeEnv(nombre: string, porDefecto: string): string {
  const crudo = process.env[nombre]
  return crudo === undefined || crudo.trim() === "" ? porDefecto : crudo.trim()
}

/** Unidad de medida de una variable de entorno, validada contra el contrato. */
function unidadDeEnv(nombre: string, porDefecto: UnidadMedida): UnidadMedida {
  const crudo = textoDeEnv(nombre, porDefecto).toUpperCase()
  return crudo === "UN" || crudo === "H" || crudo === "MES" ? crudo : porDefecto
}

/** Umbrales y constantes del motor, leídos del entorno con su valor por defecto. */
export function reglasDelEntorno(): Reglas {
  return {
    toleranciaRc5Pct: numeroDeEnv("TOLERANCIA_RC5_PCT", 2),
    toleranciaRc10Abs: numeroDeEnv("TOLERANCIA_RC10_ABS", 1),
    unidadDefault: unidadDeEnv("UNIDAD_DEFAULT", "UN"),
    maxTextoPosicion: numeroDeEnv("MAX_TEXTO_POSICION", 40),
    sociedad: textoDeEnv("SAP_SOCIEDAD", "1000"),
    organizacionCompras: textoDeEnv("SAP_ORG_COMPRAS", "1000"),
  }
}

/**
 * Construye el entorno. `FECHA_EJECUCION` fija la fecha de referencia para que
 * las reglas que comparan fechas (RC8 y RC9) den el mismo resultado en la demo y
 * en las pruebas (PRD §8 · Determinismo); la opción explícita gana.
 */
export function crearEntorno(raiz: string, opciones: OpcionesEntorno = {}): Resultado<Entorno> {
  const fixturesEnv = process.env["FIXTURES_DIR"]
  const outEnv = process.env["OUT_DIR"]
  const fixtures =
    opciones.fixtures ??
    (fixturesEnv !== undefined && fixturesEnv.trim() !== ""
      ? path.resolve(fixturesEnv)
      : path.resolve(raiz, "..", "fixtures", "reto-03"))
  const out =
    opciones.out ??
    (outEnv !== undefined && outEnv.trim() !== "" ? path.resolve(outEnv) : path.join(raiz, "out"))

  const hoyCrudo = opciones.hoy ?? process.env["FECHA_EJECUCION"] ?? fechaDelSistema()
  const hoy = validarFecha(hoyCrudo, "FECHA_EJECUCION")
  if (!hoy.ok) return hoy

  const sap = path.join(out, "sap")
  return {
    ok: true,
    data: {
      raiz,
      escritor: crearEscritor(out),
      solicitudes: path.join(fixtures, "solicitudes"),
      maestros: path.join(fixtures, "maestros"),
      evidencia: path.join(out, "evidencia"),
      sap,
      indiceSap: path.join(sap, "indice.json"),
      control: path.join(out, "control.csv"),
      log: path.join(out, "log.jsonl"),
      sesiones: path.join(out, "sessions"),
      hoy: hoy.data,
      sesion: opciones.sesion ?? "demo",
      reglas: { ...reglasDelEntorno(), ...opciones.reglas },
    },
  }
}
