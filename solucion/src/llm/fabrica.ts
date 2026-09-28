/**
 * Construcción del adaptador de lenguaje según `LLM_PROVIDER` (PRD §6.1).
 *
 * Tres proveedores tras **una sola interfaz**: cambiar de proveedor no toca el
 * ciclo del agente ni una línea de `src/agent/`. La clave del modelo se lee aquí,
 * de una variable de entorno del backend, y nunca se registra ni se devuelve por
 * la API (PRD §6.1 y §8).
 */
import type { AdaptadorLlm } from "./adapter.ts"
import { crearAdaptadorMock, guionReactivo, type GuionMock } from "./mock.ts"
import { crearAdaptadorOllama } from "./ollama.ts"
import { crearAdaptadorOpenAi } from "./openai.ts"
import type { Resultado } from "../core/tipos.ts"

/** Proveedores soportados. */
export type ProveedorLlm = "ollama" | "openai" | "mock"

/** Lista de proveedores válidos, en el orden en que se documenta. */
export const PROVEEDORES: readonly ProveedorLlm[] = ["ollama", "openai", "mock"]

/** Proveedor por defecto: local, sin claves y sin coste. */
export const PROVEEDOR_DEFECTO: ProveedorLlm = "ollama"

/** ¿El texto es un proveedor válido? */
export function esProveedor(valor: string): valor is ProveedorLlm {
  return (PROVEEDORES as readonly string[]).includes(valor)
}

export interface OpcionesFabrica {
  /** Fuerza el proveedor en vez de leer `LLM_PROVIDER`. */
  proveedor?: string
  /** Guion del proveedor `mock`; por defecto, el reactivo. */
  guionMock?: GuionMock
  /** Fuerza un fallo del `mock` (pruebas de CA5). */
  fallarCon?: string
}

/**
 * Crea el adaptador configurado. Devuelve un error legible si el proveedor no se
 * reconoce o si falta la clave que ese proveedor necesita.
 */
export function crearAdaptador(opciones: OpcionesFabrica = {}): Resultado<AdaptadorLlm> {
  const solicitado = (opciones.proveedor ?? process.env["LLM_PROVIDER"] ?? PROVEEDOR_DEFECTO)
    .trim()
    .toLowerCase()

  if (!esProveedor(solicitado)) {
    return {
      ok: false,
      error: `LLM_PROVIDER desconocido: "${solicitado}". Usa uno de: ${PROVEEDORES.join(", ")}`,
    }
  }

  if (solicitado === "openai") return crearAdaptadorOpenAi()

  if (solicitado === "mock") {
    // El guion reactivo lee la conversación, así que la demo servida no se
    // desalinea por recargar la página ni por pulsar «confirmo» dos veces.
    return {
      ok: true,
      data: crearAdaptadorMock({
        guion: opciones.guionMock ?? guionReactivo(),
        ...(opciones.fallarCon === undefined ? {} : { fallarCon: opciones.fallarCon }),
      }),
    }
  }

  return { ok: true, data: crearAdaptadorOllama() }
}

/** Descripción pública del proveedor para `/api/health`: sin claves ni rutas. */
export function describirProveedor(adaptador: AdaptadorLlm): { proveedor: string; modelo: string } {
  return { proveedor: adaptador.proveedor, modelo: adaptador.modelo }
}
