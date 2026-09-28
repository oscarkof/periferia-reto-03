/**
 * Contrato de herramienta del PRD §6.2 y las piezas comunes a las cinco `oc_*`.
 *
 * Cada herramienta es un objeto con tres miembros:
 *   · `description` — una frase precisa: es lo único que el modelo lee para
 *     decidir cuándo llamarla;
 *   · `args`        — esquemas `zod` con `.describe()` en cada campo;
 *   · `execute`     — recibe `(args, ctx)` y devuelve **siempre** un string JSON
 *     con `{ ok: true, data }` o `{ ok: false, error }`. **Nunca lanza.**
 *
 * El nombre que ve el modelo es `<archivo>_<export>`: de `src/tools/oc.ts` salen
 * `oc_leer_paquete`, `oc_validar`, `oc_construir_payload`, `oc_generar_evidencia`
 * y `oc_crear`. Los ayudantes que viven **aquí** no se registran.
 */
import type { z } from "zod"
import { crearEntorno, type Entorno } from "../core/entorno.ts"
import { registrar } from "../core/log.ts"
import type { Resultado } from "../core/tipos.ts"

/** Contexto que recibe toda herramienta (PRD §6.2). */
export interface ContextoHerramienta {
  /** Raíz del proyecto: las rutas se resuelven desde aquí, nunca en absoluto. */
  directory: string
  /** Identificador de la sesión de chat, para poder trazar el log. */
  sessionId: string
}

/** Herramienta tipada: `args` se valida con zod antes de ejecutar. */
export interface Herramienta<Esquema extends z.ZodTypeAny> {
  description: string
  args: Esquema
  execute(args: z.infer<Esquema>, ctx: ContextoHerramienta): Promise<string>
}

/** Vista genérica: es la que usa el ciclo en F3 para ejecutar cualquiera. */
export type HerramientaGenerica = Herramienta<z.ZodTypeAny>

/** Nombres visibles para el modelo (`<archivo>_<export>`), en un solo sitio. */
export const NOMBRES = {
  leerPaquete: "oc_leer_paquete",
  validar: "oc_validar",
  construirPayload: "oc_construir_payload",
  generarEvidencia: "oc_generar_evidencia",
  crear: "oc_crear",
} as const

/**
 * Nombre visible para el modelo, derivado de archivo y export. Devuelve un tipo
 * literal (`"oc_validar"`) para que el nombre no pueda escribirse mal al
 * registrar las herramientas.
 */
export function nombreHerramienta<Archivo extends string, Nombre extends string>(
  archivo: Archivo,
  nombreExport: Nombre,
): `${Archivo}_${Nombre}` {
  return `${archivo}_${nombreExport}`
}

/** Respuesta correcta serializada, tal como exige el contrato. */
export function exito<T>(data: T): string {
  return JSON.stringify({ ok: true, data })
}

/** Respuesta de error serializada, tal como exige el contrato. */
export function fallo(error: string): string {
  return JSON.stringify({ ok: false, error })
}

/** Convierte un `Resultado` del motor en la respuesta JSON del contrato. */
export function responder<T>(resultado: Resultado<T>): string {
  return resultado.ok ? exito(resultado.data) : fallo(resultado.error)
}

/**
 * El entorno de una ejecución, construido desde `ctx.directory` y con la sesión
 * del contexto: de ahí salen `out/`, los fixtures y los umbrales (PRD §8).
 */
export function entornoDe(ctx: ContextoHerramienta): Resultado<Entorno> {
  return crearEntorno(ctx.directory, { sesion: ctx.sessionId })
}

/**
 * Ejecuta la acción de una herramienta, la deja en `out/log.jsonl` (CA4) y
 * devuelve la respuesta del contrato.
 *
 * Centraliza las dos reglas que valen para las cinco:
 *   · **CA4** — toda llamada queda registrada, con su caso y su resumen;
 *   · **CA5** — un fallo vuelve como `{ ok: false, error }` en lenguaje humano,
 *     la sesión no muere y el error se ve.
 */
export async function conRegistro<T extends object>(
  nombre: string,
  ctx: ContextoHerramienta,
  caso: string | null,
  entorno: Entorno,
  accion: () => Promise<Resultado<T>> | Resultado<T>,
  resumir: (data: T) => string,
): Promise<string> {
  const resultado = await accion()
  registrar(entorno.escritor, {
    caso,
    herramienta: nombre,
    ok: resultado.ok,
    resumen: resultado.ok ? resumir(resultado.data) : resultado.error,
    sesion: ctx.sessionId,
  })
  return responder(resultado)
}

/**
 * Ejecuta una herramienta validando antes los argumentos con `zod` y devolviendo
 * el error al modelo si no cumplen. Es el punto de entrada que usa el ciclo en
 * F3; `demo.ts` llama a `execute` directamente, porque sus argumentos los
 * escribe el código y no el modelo.
 *
 * Un fallo de argumentos también se registra: así el error del modelo no es
 * invisible (CA4 · CA5).
 */
export async function ejecutarValidando<Esquema extends z.ZodTypeAny>(
  herramienta: Herramienta<Esquema>,
  nombre: string,
  argsBrutos: unknown,
  ctx: ContextoHerramienta,
): Promise<string> {
  const validado = herramienta.args.safeParse(argsBrutos)
  if (!validado.success) {
    const detalle = validado.error.issues
      .map((problema) => `${problema.path.join(".") || "args"}: ${problema.message}`)
      .join("; ")
    const error = `argumentos inválidos para ${nombre} → ${detalle}`
    const entorno = entornoDe(ctx)
    if (entorno.ok) {
      registrar(entorno.data.escritor, {
        caso: null,
        herramienta: nombre,
        ok: false,
        resumen: error,
        sesion: ctx.sessionId,
      })
    }
    return fallo(error)
  }

  try {
    return await herramienta.execute(validado.data, ctx)
  } catch (error) {
    // Contrato: `execute` no lanza, pero si algún día lo hace, el modelo recibe
    // un error legible en vez de una traza que tumbe el turno (CA5).
    const detalle = error instanceof Error ? error.message : String(error)
    return fallo(`${nombre} falló de forma inesperada: ${detalle}`)
  }
}

