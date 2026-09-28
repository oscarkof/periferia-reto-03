/**
 * Ciclo del agente (PRD §6.1 · §6.3).
 *
 * Bucle: prompt → modelo → (llamadas a herramientas) → modelo → … → respuesta.
 *
 * Reglas del PRD que se cumplen **aquí** y no en el prompt:
 *
 *   · **CA1** — tope de iteraciones herramienta → modelo por turno (25 por
 *     defecto) y tope de tokens por sesión; al agotarlos el turno responde con lo
 *     que tiene, sin morir;
 *   · **CA2** — el modelo no puede afirmar un valor: los valores salen de las
 *     herramientas, y lo que proponga se audita (`paso.ts` · `tools/auditoria.ts`);
 *   · **CA3** — la confirmación humana la impone el ciclo a partir del mensaje del
 *     usuario y de la sesión, no el modelo;
 *   · **CA4** — toda llamada queda en el historial y en `out/log.jsonl`;
 *   · **CA5** — un error del proveedor se cuenta en el chat y la sesión sigue viva.
 */
import { definirHerramienta, mensajeSistema, type AdaptadorLlm } from "../llm/adapter.ts"
import type { Resultado } from "../core/tipos.ts"
import { REGISTRO } from "../tools/oc.ts"
import type { ContextoHerramienta, HerramientaGenerica } from "../tools/contrato.ts"
import { esConfirmacionExplicita, esRechazo } from "./confirmacion.ts"
import type { EventoTurno } from "./eventos.ts"
import { ejecutarLlamadas } from "./paso.ts"
import { guardarSesion, type Sesion } from "./sesion.ts"

/** Tope de iteraciones herramienta → modelo por turno (CA1). */
export const MAX_ITERACIONES = 25

/** Tope de tokens por sesión (PRD §8 · Costo). */
export const MAX_TOKENS_SESION = 200_000

/** Lee un tope numérico del entorno, o el valor por defecto si falta o no sirve. */
function tope(valor: string | undefined, porDefecto: number): number {
  const numero = Number(valor)
  return Number.isFinite(numero) && numero > 0 ? numero : porDefecto
}

/** Herramienta del registro, con su nombre visible para el modelo. */
export interface EntradaHerramienta {
  nombre: string
  herramienta: HerramientaGenerica
}

/** Todo lo que necesita un turno. */
export interface OpcionesTurno {
  /** Raíz del proyecto: de aquí salen las rutas de `out/`. */
  directorio: string
  sesion: Sesion
  mensajeUsuario: string
  adaptador: AdaptadorLlm
  prompt: string
  conocimiento: string
  herramientas?: readonly EntradaHerramienta[]
  maxIteraciones?: number
  maxTokensSesion?: number
  emitir?: (evento: EventoTurno) => void
  ahora?: () => Date
}

/** Resultado de un turno completo. */
export interface ResultadoTurno {
  texto: string
  needsConfirmation: boolean
  llamadas: number
  iteraciones: number
  sesion: Sesion
}

/** Ejecuta un turno de conversación completo. */
export async function ejecutarTurno(opciones: OpcionesTurno): Promise<Resultado<ResultadoTurno>> {
  const {
    directorio,
    sesion,
    mensajeUsuario,
    adaptador,
    prompt,
    conocimiento,
    herramientas = REGISTRO,
    maxIteraciones = tope(process.env["MAX_ITERACIONES"], MAX_ITERACIONES),
    maxTokensSesion = tope(process.env["MAX_TOKENS_SESION"], MAX_TOKENS_SESION),
    emitir = () => {},
    ahora = () => new Date(),
  } = opciones

  // 1 · ¿El usuario confirmó o rechazó algo en este turno?
  const confirma = esConfirmacionExplicita(mensajeUsuario)
  const pendientePrevio = sesion.pendiente
  if (pendientePrevio !== null && esRechazo(mensajeUsuario)) {
    sesion.pendiente = null
    emitir({ tipo: "aviso", texto: `se descartó la acción pendiente: ${pendientePrevio.descripcion}` })
  }

  // 2 · Contexto del turno
  sesion.mensajes.push({ rol: "user", contenido: mensajeUsuario })
  sesion.turnos += 1
  const sistema = mensajeSistema(prompt, conocimiento)
  const contexto: ContextoHerramienta = { directory: directorio, sessionId: sesion.id }
  const indice = new Map<string, HerramientaGenerica>(
    herramientas.map((entrada) => [entrada.nombre, entrada.herramienta]),
  )
  const definiciones = herramientas.map((entrada) =>
    definirHerramienta(entrada.nombre, entrada.herramienta.description, entrada.herramienta.args),
  )
  const nombres = herramientas.map((entrada) => entrada.nombre)

  let iteraciones = 0
  let totalLlamadas = 0

  const cerrar = (texto: string): Resultado<ResultadoTurno> => {
    guardarSesion(sesion, ahora())
    const needsConfirmation = sesion.pendiente !== null
    emitir({ tipo: "fin", texto, needsConfirmation, llamadas: totalLlamadas, iteraciones })
    return { ok: true, data: { texto, needsConfirmation, llamadas: totalLlamadas, iteraciones, sesion } }
  }

  while (iteraciones < maxIteraciones) {
    iteraciones += 1

    const respuesta = await adaptador.enviar([sistema, ...sesion.mensajes], definiciones)
    if (!respuesta.ok) {
      // CA5: el fallo se cuenta en el chat y la sesión no muere.
      emitir({ tipo: "error", texto: `No pude hablar con el modelo: ${respuesta.error}` })
      guardarSesion(sesion, ahora())
      return { ok: false, error: respuesta.error }
    }

    const { texto, llamadas, uso } = respuesta.data
    sesion.tokens += uso.entrada + uso.salida

    if (sesion.tokens > maxTokensSesion) {
      const aviso = `Se alcanzó el tope de tokens de esta sesión (${maxTokensSesion}). Abre una sesión nueva para seguir trabajando.`
      sesion.mensajes.push({ rol: "assistant", contenido: aviso })
      emitir({ tipo: "error", texto: aviso })
      return cerrar(aviso)
    }

    if (llamadas.length === 0) {
      const textoFinal = texto ?? "(el modelo no devolvió texto)"
      sesion.mensajes.push({ rol: "assistant", contenido: textoFinal })
      return cerrar(textoFinal)
    }

    sesion.mensajes.push({ rol: "assistant", contenido: texto ?? "", llamadas })
    totalLlamadas += await ejecutarLlamadas({
      sesion,
      llamadas,
      indice,
      nombresDisponibles: [...nombres],
      contexto,
      pendientePrevio,
      confirma,
      emitir,
    })
  }

  // CA1: al alcanzar el tope se responde con lo que hay, sin morir.
  const textoFinal = `Alcancé el tope de ${maxIteraciones} iteraciones de herramientas en este turno. Esto es lo que tengo hasta ahora; dime cómo seguir.`
  sesion.mensajes.push({ rol: "assistant", contenido: textoFinal })
  emitir({ tipo: "aviso", texto: textoFinal })
  return cerrar(textoFinal)
}

