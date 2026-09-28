/**
 * Interfaz del proveedor de lenguaje (PRD §6.1).
 *
 * El PRD pide «una interfaz propia (`enviar(mensajes, herramientas) → respuesta`)
 * con una implementación para el proveedor que elijas. Cambiar de proveedor no
 * debe tocar el ciclo del agente». Por eso `src/agent/` **solo** conoce los tipos
 * de este archivo: ningún SDK ni formato de cable de un proveedor entra ahí.
 */
import { z } from "zod"
import type { Resultado } from "../core/tipos.ts"

/** Papel de un mensaje del historial. */
export type RolMensaje = "system" | "user" | "assistant" | "tool"

/** Herramienta que el modelo pidió ejecutar. */
export interface LlamadaHerramienta {
  /** Identificador de la llamada; los proveedores que no lo dan lo reciben sintetizado. */
  id: string
  nombre: string
  argumentos: Record<string, unknown>
}

/** Mensaje del historial en el formato interno, independiente del proveedor. */
export interface Mensaje {
  rol: RolMensaje
  contenido: string
  /** Solo en `assistant`: herramientas que solicitó. */
  llamadas?: LlamadaHerramienta[]
  /** Solo en `tool`: a qué llamada responde. */
  idLlamada?: string
}

/** Herramienta tal como se le presenta al modelo. */
export interface DefinicionHerramienta {
  nombre: string
  description: string
  /** JSON Schema de los argumentos, derivado del esquema `zod`. */
  parametros: Record<string, unknown>
}

/** Consumo de tokens de una llamada al modelo. */
export interface UsoTokens {
  entrada: number
  salida: number
}

/** Respuesta del modelo: texto, herramientas pedidas y consumo. */
export interface RespuestaLlm {
  texto: string | null
  llamadas: LlamadaHerramienta[]
  uso: UsoTokens
}

/** Ajustes de una llamada al proveedor. */
export interface OpcionesEnvio {
  timeoutMs?: number
  temperatura?: number
}

/** Adaptador de proveedor: la frontera que aísla el ciclo del agente. */
export interface AdaptadorLlm {
  readonly proveedor: string
  readonly modelo: string
  enviar(
    mensajes: Mensaje[],
    herramientas: DefinicionHerramienta[],
    opciones?: OpcionesEnvio,
  ): Promise<Resultado<RespuestaLlm>>
}

/**
 * JSON Schema de los argumentos de una herramienta a partir de su `zod`.
 * Se usa el modo por defecto (no `io: "input"`) porque conserva
 * `additionalProperties: false`, que evita que el modelo invente argumentos.
 */
export function parametrosDe(args: z.ZodTypeAny): Record<string, unknown> {
  return z.toJSONSchema(args) as Record<string, unknown>
}

/** Definición de herramienta lista para enviar al proveedor. */
export function definirHerramienta(
  nombre: string,
  description: string,
  args: z.ZodTypeAny,
): DefinicionHerramienta {
  return { nombre, description, parametros: parametrosDe(args) }
}

/**
 * Mensaje de sistema: comportamiento (`agent/prompt.md`) más conocimiento del
 * proceso (`src/knowledge/ordenes-compra.md`). Los dos archivos siguen separados
 * en disco y se juntan **solo aquí**, porque el modelo no puede leer ficheros.
 */
export function mensajeSistema(prompt: string, conocimiento: string): Mensaje {
  return {
    rol: "system",
    contenido: `${prompt.trim()}\n\n---\n\n# Conocimiento del proceso\n\n${conocimiento.trim()}`,
  }
}

/**
 * Normaliza los argumentos de una llamada.
 *
 * Hallazgo del smoke test del reto 02 que vale igual aquí: **Ollama devuelve
 * `arguments` como objeto ya parseado** mientras que otras APIs lo devuelven como
 * string JSON. El contrato interno exige un objeto, así que se aceptan las dos
 * formas.
 */
export function normalizarArgumentos(brutos: unknown): Record<string, unknown> {
  if (typeof brutos === "string") {
    try {
      const parseado: unknown = JSON.parse(brutos)
      if (typeof parseado === "object" && parseado !== null && !Array.isArray(parseado)) {
        return parseado as Record<string, unknown>
      }
      return {}
    } catch {
      return {}
    }
  }
  if (typeof brutos === "object" && brutos !== null && !Array.isArray(brutos)) {
    return brutos as Record<string, unknown>
  }
  return {}
}

/** Señal de aborto para acotar una llamada al proveedor. */
export function senalConTiempo(ms: number): { signal: AbortSignal; cancelar: () => void } {
  const controlador = new AbortController()
  const temporizador = setTimeout(() => controlador.abort(), ms)
  return { signal: controlador.signal, cancelar: () => clearTimeout(temporizador) }
}

/** Error legible para un fallo de transporte, sin exponer credenciales. */
export function errorDeTransporte(proveedor: string, error: unknown): string {
  const detalle = error instanceof Error ? error.message : String(error)
  if (/abort/i.test(detalle)) {
    return `el proveedor ${proveedor} no respondió a tiempo; se canceló la llamada`
  }
  return `no se pudo contactar el proveedor ${proveedor}: ${detalle}`
}
