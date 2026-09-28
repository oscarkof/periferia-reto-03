/**
 * Adaptador para cualquier API **compatible con OpenAI** (PRD §6.1).
 *
 * Es el plan B del reto: si el modelo local no rinde, se cambia `LLM_PROVIDER` y
 * el ciclo no se toca. Funciona con `api.openai.com` y con cualquier servidor
 * compatible (`OPENAI_BASE_URL`: Azure, vLLM, LM Studio…).
 *
 * La clave **solo** se lee aquí, de una variable de entorno del backend, y nunca
 * se registra ni se devuelve por la API (PRD §6.1 y §8). Si falta, el adaptador no
 * se construye y el error explica qué hacer.
 */
import {
  errorDeTransporte,
  normalizarArgumentos,
  senalConTiempo,
  type AdaptadorLlm,
  type DefinicionHerramienta,
  type Mensaje,
  type OpcionesEnvio,
  type RespuestaLlm,
} from "./adapter.ts"
import type { Resultado } from "../core/tipos.ts"

/** URL por defecto de la API compatible con OpenAI. */
export const URL_OPENAI = "https://api.openai.com/v1"

/** Modelo por defecto: el más económico que hace *tool calling* bien. */
export const MODELO_OPENAI = "gpt-4o-mini"

/** Timeout por defecto de una llamada al proveedor. */
const TIMEOUT_DEFECTO_MS = 60_000

/** Respuesta cruda de `/chat/completions`. */
interface RespuestaOpenAi {
  choices?: {
    message?: {
      content?: string | null
      tool_calls?: { id?: string; function?: { name?: string; arguments?: unknown } }[]
    }
  }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  error?: { message?: string }
}

export interface OpcionesOpenAi {
  apiKey?: string
  base?: string
  modelo?: string
  timeoutMs?: number
}

/** Traduce un mensaje interno al formato de OpenAI. */
function aMensajeOpenAi(mensaje: Mensaje): Record<string, unknown> {
  if (mensaje.rol === "assistant" && mensaje.llamadas !== undefined && mensaje.llamadas.length > 0) {
    return {
      role: "assistant",
      content: mensaje.contenido === "" ? null : mensaje.contenido,
      tool_calls: mensaje.llamadas.map((llamada) => ({
        id: llamada.id,
        type: "function",
        // Esta API sí exige los argumentos como string JSON.
        function: { name: llamada.nombre, arguments: JSON.stringify(llamada.argumentos) },
      })),
    }
  }
  if (mensaje.rol === "tool") {
    return { role: "tool", tool_call_id: mensaje.idLlamada ?? "", content: mensaje.contenido }
  }
  return { role: mensaje.rol, content: mensaje.contenido }
}

/** Traduce una herramienta interna al formato de OpenAI. */
function aHerramientaOpenAi(herramienta: DefinicionHerramienta): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: herramienta.nombre,
      description: herramienta.description,
      parameters: herramienta.parametros,
    },
  }
}

/**
 * Crea el adaptador compatible con OpenAI. Devuelve error legible —no lanza— si
 * falta la clave, para que el servidor arranque diciendo qué configurar.
 */
export function crearAdaptadorOpenAi(opciones: OpcionesOpenAi = {}): Resultado<AdaptadorLlm> {
  const apiKey = (opciones.apiKey ?? process.env["OPENAI_API_KEY"] ?? "").trim()
  if (apiKey === "") {
    return {
      ok: false,
      error:
        "falta OPENAI_API_KEY: el proveedor openai la necesita. Configúrala en .env o usa LLM_PROVIDER=ollama (local, sin claves).",
    }
  }

  const base = (opciones.base ?? process.env["OPENAI_BASE_URL"] ?? URL_OPENAI).replace(/\/+$/, "")
  const modelo = opciones.modelo ?? process.env["OPENAI_MODEL"] ?? MODELO_OPENAI
  const timeoutDefecto = opciones.timeoutMs ?? Number(process.env["LLM_TIMEOUT_MS"] ?? TIMEOUT_DEFECTO_MS)

  return {
    ok: true,
    data: {
      proveedor: "openai",
      modelo,

      async enviar(
        mensajes: Mensaje[],
        herramientas: DefinicionHerramienta[],
        ajustes: OpcionesEnvio = {},
      ): Promise<Resultado<RespuestaLlm>> {
        const { signal, cancelar } = senalConTiempo(ajustes.timeoutMs ?? timeoutDefecto)
        try {
          const respuesta = await fetch(`${base}/chat/completions`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
            signal,
            body: JSON.stringify({
              model: modelo,
              messages: mensajes.map(aMensajeOpenAi),
              ...(herramientas.length > 0
                ? { tools: herramientas.map(aHerramientaOpenAi), tool_choice: "auto" }
                : {}),
              temperature: ajustes.temperatura ?? 0,
            }),
          })

          if (!respuesta.ok) {
            const detalle = await respuesta.text()
            return {
              ok: false,
              error: `el proveedor openai respondió ${respuesta.status}: ${detalle.slice(0, 200)}`,
            }
          }

          const cuerpo = (await respuesta.json()) as RespuestaOpenAi
          const mensaje = cuerpo.choices?.[0]?.message
          const llamadas = (mensaje?.tool_calls ?? [])
            .map((llamada, indice) => ({
              id: llamada.id ?? `llamada-${indice + 1}`,
              nombre: llamada.function?.name ?? "",
              argumentos: normalizarArgumentos(llamada.function?.arguments),
            }))
            .filter((llamada) => llamada.nombre !== "")

          const texto = mensaje?.content?.trim() ?? ""
          return {
            ok: true,
            data: {
              texto: texto === "" ? null : texto,
              llamadas,
              uso: {
                entrada: cuerpo.usage?.prompt_tokens ?? 0,
                salida: cuerpo.usage?.completion_tokens ?? 0,
              },
            },
          }
        } catch (error) {
          return { ok: false, error: errorDeTransporte("openai", error) }
        } finally {
          cancelar()
        }
      },
    },
  }
}
