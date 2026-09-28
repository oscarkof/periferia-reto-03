/**
 * Ejecución de las llamadas a herramientas de una respuesta del modelo.
 *
 * Aquí viven las dos reglas que el PRD no deja en manos del prompt:
 *
 *   · **CA3** — el valor de `confirmado` **y la identidad de quien confirma**
 *     (`confirmado_por`, que es lo que queda firmado en las excepciones del
 *     payload) los impone este código a partir del mensaje del usuario y de la
 *     sesión. El modelo no puede autorizarse a sí mismo.
 *   · **CA2** — los valores salen de las herramientas: si el modelo propone un
 *     paquete, unos derivados o un payload, la herramienta los audita contra el
 *     documento y lo que llega a SAP es siempre lo del motor (el aviso viaja al
 *     chat para que se vea).
 *
 * El reparto con el resto del ciclo: `oc_validar` **descubre** que hace falta una
 * confirmación (`requiere_confirmacion`), así que es él quien deja la acción
 * pendiente y quien hace que el turno cierre con `needsConfirmation = true`. El
 * «sí» llega en el turno siguiente y solo entonces `oc_crear` queda autorizado, y
 * solo para **ese** caso: confirmar una solicitud no confirma la siguiente.
 */
import { ejecutarValidando, NOMBRES, type ContextoHerramienta, type HerramientaGenerica } from "../tools/contrato.ts"
import type { LlamadaHerramienta } from "../llm/adapter.ts"
import { interpretarRespuestaHerramienta, resumirRespuesta, type EventoTurno } from "./eventos.ts"
import type { AccionPendiente, Sesion } from "./sesion.ts"

/** Herramienta gobernada por la confirmación humana (CA3). */
export const HERRAMIENTA_CREAR = NOMBRES.crear

/** Herramienta que descubre que hace falta confirmar. */
export const HERRAMIENTA_VALIDAR = NOMBRES.validar

/** Aviso cuando el modelo intenta firmar la confirmación que le toca a la persona. */
export const AVISO_SIN_CONFIRMACION =
  "el modelo intentó crear la orden sin confirmación del usuario: se forzó confirmado=false y no se escribió nada (CA3)"

export interface OpcionesPaso {
  sesion: Sesion
  llamadas: LlamadaHerramienta[]
  indice: Map<string, HerramientaGenerica>
  nombresDisponibles: string[]
  contexto: ContextoHerramienta
  pendientePrevio: AccionPendiente | null
  /** ¿El mensaje del usuario en este turno es una confirmación explícita? */
  confirma: boolean
  /** Escritor de eventos del turno. */
  emitir: (evento: EventoTurno) => void
}

/** Códigos de una lista de hallazgos del veredicto (`confirmaciones`). */
function codigosDe(datos: Record<string, unknown> | null, campo: string): string[] {
  const hallazgos = datos?.[campo]
  if (!Array.isArray(hallazgos)) return []
  return hallazgos
    .map((crudo) => (crudo as { codigo?: string }).codigo ?? "")
    .filter((codigo) => codigo !== "")
}

/**
 * ¿El error de `oc_crear` es el de la confirmación pendiente?
 *
 * Es la única comprobación sobre texto de error del ciclo, y existe porque una
 * creación sin confirmación **no es un fallo**: es una acción pendiente. El
 * mensaje de `oc_crear` dice «faltan confirmaciones humanas…», y aquí se traduce a
 * estado del turno.
 */
function requiereConfirmacion(error: string | null): boolean {
  return error !== null && /faltan confirmaciones humanas/i.test(error)
}

/**
 * Ejecuta todas las llamadas y devuelve cuántas se intentaron.
 * Los resultados se añaden al historial de la sesión (CA4).
 */
export async function ejecutarLlamadas(opciones: OpcionesPaso): Promise<number> {
  const { sesion, llamadas, indice, nombresDisponibles, contexto, pendientePrevio, confirma, emitir } = opciones

  let ejecutadas = 0
  /** Caso que este turno creó de verdad, si creó alguno. */
  let creado: string | null = null
  /** Acción que este turno deja esperando un «sí». */
  let pendienteDeEsteTurno: AccionPendiente | null = null

  for (const llamada of llamadas) {
    const implementacion = indice.get(llamada.nombre)
    if (implementacion === undefined) {
      const error = `${llamada.nombre} no está en el registro de herramientas. Disponibles: ${nombresDisponibles.join(", ")}`
      emitir({ tipo: "aviso", texto: error })
      emitir({ tipo: "resultado", nombre: llamada.nombre, ok: false, resumen: error })
      sesion.mensajes.push({
        rol: "tool",
        contenido: JSON.stringify({ ok: false, error }),
        idLlamada: llamada.id,
      })
      continue
    }

    let argumentos = llamada.argumentos
    let autorizada = false
    const caso = String(argumentos["caso"] ?? "")

    if (llamada.nombre === HERRAMIENTA_CREAR) {
      const esLaPendiente =
        pendientePrevio !== null &&
        pendientePrevio.herramienta === llamada.nombre &&
        String(pendientePrevio.argumentos["caso"] ?? "") === caso

      autorizada = confirma && (pendientePrevio === null || esLaPendiente)
      if (argumentos["confirmado"] === true && !autorizada) {
        emitir({ tipo: "aviso", texto: AVISO_SIN_CONFIRMACION })
      }
      // El ciclo impone el valor y la identidad: quien confirma es la persona de
      // la sesión, no una cadena que el modelo escriba.
      argumentos = {
        ...argumentos,
        confirmado: autorizada,
        confirmado_por: autorizada ? sesion.usuario : undefined,
      }
    }

    emitir({ tipo: "llamada", nombre: llamada.nombre, argumentos })
    const salida = await ejecutarValidando(implementacion, llamada.nombre, argumentos, contexto)
    const interpretada = interpretarRespuestaHerramienta(salida)
    emitir({
      tipo: "resultado",
      nombre: llamada.nombre,
      ok: interpretada.ok,
      resumen: resumirRespuesta(llamada.nombre, interpretada),
    })
    sesion.mensajes.push({ rol: "tool", contenido: salida, idLlamada: llamada.id })
    ejecutadas += 1

    if (llamada.nombre === HERRAMIENTA_VALIDAR && interpretada.ok) {
      const confirmaciones = codigosDe(interpretada.data, "confirmaciones")
      if (interpretada.data?.["requiere_confirmacion"] === true && confirmaciones.length > 0) {
        pendienteDeEsteTurno = {
          herramienta: HERRAMIENTA_CREAR,
          argumentos: { caso, confirmado: true },
          descripcion: `crear la orden de ${caso} confirmando: ${confirmaciones.join(", ")}`,
        }
      }
    }

    if (llamada.nombre === HERRAMIENTA_CREAR) {
      if (interpretada.ok) {
        creado = caso
      } else if (requiereConfirmacion(interpretada.error)) {
        // El modelo intentó crear sin pasar por la confirmación: la herramienta lo
        // rechaza (CA3) y aquí se deja pendiente, para que el turno cierre pidiendo
        // el «sí» en vez de terminar en silencio.
        pendienteDeEsteTurno = {
          herramienta: HERRAMIENTA_CREAR,
          argumentos: { caso, confirmado: true },
          descripcion: `crear la orden de ${caso} una vez confirmadas las excepciones`,
        }
        emitir({
          tipo: "aviso",
          texto: `la creación de ${caso} queda pendiente de confirmación del usuario (CA3)`,
        })
      }
    }
  }

  // El estado de la sesión se decide aquí, al final y no dentro del bucle: así el
  // orden en que el modelo pida las herramientas no cambia el resultado.
  //
  //   · una creación efectiva cierra el pendiente **solo si era ese mismo caso**;
  //   · una validación que pide confirmación abre el suyo (y gana, porque describe
  //     lo último que la persona tiene delante);
  //   · si el turno no hizo ninguna de las dos cosas, el pendiente anterior sigue
  //     vigente: el usuario todavía no ha respondido.
  if (creado !== null && pendientePrevio !== null && pendientePrevio.argumentos["caso"] === creado) {
    sesion.pendiente = null
  }
  if (pendienteDeEsteTurno !== null) sesion.pendiente = pendienteDeEsteTurno

  return ejecutadas
}

