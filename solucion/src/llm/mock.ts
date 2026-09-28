/**
 * Proveedor `mock`: un guion determinista, sin modelo, sin red y sin claves.
 *
 * Es lo que permite que las pruebas del ciclo (`bucle.test.ts`) y la demo servida
 * corran **sin depender de ningún proveedor**. El guion no «imita» a un modelo:
 * lee el historial y decide el siguiente paso como lo haría el agente real, así
 * que un cambio en el contrato de herramientas se nota aquí.
 *
 * Tres guiones, cada uno para lo que hay que demostrar:
 *   · `guionReactivo()` — el recorrido bueno: leer, validar, construir, pedir el
 *     «sí» cuando hace falta y crear;
 *   · `guionInfinito()` — llama a una herramienta en cada iteración, para probar
 *     el tope de CA1 sin esperar a un modelo;
 *   · `guionAlucinado()` — intenta firmar la confirmación que le toca al usuario
 *     y colar un payload manipulado, para probar CA2 y CA3.
 */
import type { AdaptadorLlm, DefinicionHerramienta, Mensaje, RespuestaLlm } from "./adapter.ts"

/** Firma de un guion: mira la conversación y decide qué hace el «modelo». */
export type GuionMock = (mensajes: Mensaje[], herramientas: DefinicionHerramienta[]) => RespuestaLlm

/** Correo de quien confirma en la demo servida; el ciclo lo impone, no el modelo. */
export const CONFIRMADO_POR = "compras@periferia-ficticia.com"

/** Respuesta sin llamadas: el «modelo» cierra el turno con texto. */
export function responderTexto(texto: string): RespuestaLlm {
  return { texto, llamadas: [], uso: { entrada: 0, salida: 0 } }
}

/** Respuesta con una única llamada a herramienta. */
export function llamar(nombre: string, argumentos: Record<string, unknown>): RespuestaLlm {
  return {
    texto: null,
    llamadas: [{ id: `llamada-${nombre}`, nombre, argumentos }],
    uso: { entrada: 0, salida: 0 },
  }
}

/** Último mensaje del usuario. */
export function ultimoUsuario(mensajes: readonly Mensaje[]): string {
  for (let i = mensajes.length - 1; i >= 0; i -= 1) {
    const mensaje = mensajes[i]
    if (mensaje !== undefined && mensaje.rol === "user") return mensaje.contenido
  }
  return ""
}

/**
 * Caso del que se está hablando.
 *
 * Se busca en **toda** la conversación y no solo en el último mensaje: cuando la
 * persona responde «sí, confirmo» ya no repite el nombre del caso, y el doble —como
 * el agente real— tiene que acordarse de cuál era. Se miran los mensajes de la
 * persona y los argumentos de las herramientas ya llamadas, de lo último a lo
 * primero.
 */
export function casoDe(mensajes: readonly Mensaje[]): string | null {
  for (let i = mensajes.length - 1; i >= 0; i -= 1) {
    const mensaje = mensajes[i]
    if (mensaje === undefined) continue

    if (mensaje.rol === "user" || mensaje.rol === "assistant") {
      const encontrado = /sol-\d{3}/.exec(mensaje.contenido)
      if (encontrado !== null) return encontrado[0]
    }
    for (const llamada of mensaje.llamadas ?? []) {
      const deArgumentos = llamada.argumentos["caso"]
      if (typeof deArgumentos === "string" && /^sol-\d{3}$/.test(deArgumentos)) return deArgumentos
    }
  }
  return null
}

/**
 * ¿El usuario confirmó en su último mensaje?
 *
 * El doble no necesita el detector completo de `agent/confirmacion.ts`: con
 * reconocer el «sí» que manda el front (y el que escribe una persona) le basta, y
 * así este archivo no depende del ciclo.
 *
 * ⚠️ Bug real detectado al probar el ciclo: la primera versión usaba `\b` para
 * cerrar la alternativa (`/^(s[ií]|…)\b/`), y `\b` **no reconoce frontera después
 * de una vocal acentuada**, porque `\w` solo cubre `[A-Za-z0-9_]`. Con «sí,
 * confirmo» la confirmación no se detectaba y el guion volvía a preguntar en un
 * bucle. Se cierra con un separador explícito: espacio, coma o fin de línea.
 */
export function usuarioConfirma(mensajes: readonly Mensaje[]): boolean {
  const texto = ultimoUsuario(mensajes).trim().toLowerCase()
  return /^(s[ií]|ok|okay|dale|confirmo|confirmado|adelante|procede|de acuerdo|hazlo)(?:\s|,|\.|!|$)/.test(texto)
}

/**
 * Lee la envoltura del contrato de herramientas (`{ ok, data | error }`) sin
 * lanzar.
 *
 * Se define aquí, y no se importa de `src/demo/` ni de `src/agent/`, para que la
 * capa de proveedores no dependa de las otras dos: el doble solo necesita entender
 * la misma envoltura que ve cualquier modelo.
 */
function leerEnvoltura(json: string): { ok: boolean; data: unknown } {
  try {
    const crudo = JSON.parse(json) as { ok?: unknown; data?: unknown }
    return { ok: crudo.ok === true, data: crudo.data }
  } catch {
    return { ok: false, data: null }
  }
}

/** Una ejecución de herramienta, emparejada con su llamada. */
interface Registro {
  nombre: string
  ok: boolean
  datos: Record<string, unknown> | null
}

/** Empareja llamadas y resultados del historial, en orden. */
export function historial(mensajes: readonly Mensaje[]): Registro[] {
  const registros: Registro[] = []
  const pendientes: string[] = []
  for (const mensaje of mensajes) {
    if (mensaje.rol === "assistant") {
      for (const llamada of mensaje.llamadas ?? []) pendientes.push(llamada.nombre)
    } else if (mensaje.rol === "tool") {
      const nombre = pendientes.shift() ?? ""
      const envoltura = leerEnvoltura(mensaje.contenido)
      registros.push({
        nombre,
        ok: envoltura.ok,
        datos:
          envoltura.ok && typeof envoltura.data === "object" && envoltura.data !== null
            ? (envoltura.data as Record<string, unknown>)
            : null,
      })
    }
  }
  return registros
}

/** Datos del último resultado correcto de una herramienta. */
export function datosDe(mensajes: readonly Mensaje[], nombre: string): Record<string, unknown> | null {
  const registros = historial(mensajes).filter((registro) => registro.nombre === nombre && registro.ok)
  const ultimo = registros[registros.length - 1]
  return ultimo?.datos ?? null
}

/** Lista de hallazgos (`bloqueos` o `confirmaciones`) en una línea legible. */
function resumenDe(validacion: Record<string, unknown>, campo: string): string {
  const hallazgos = validacion[campo]
  if (!Array.isArray(hallazgos) || hallazgos.length === 0) return "sin detalle"
  return hallazgos
    .map((crudo) => {
      const hallazgo = crudo as { codigo?: string; detalle?: string }
      return `${hallazgo.codigo ?? "?"}: ${hallazgo.detalle ?? ""}`
    })
    .join(" | ")
}

// ── Guion reactivo: el recorrido bueno ───────────────────────────────────────

/**
 * Recorre el caso como lo haría el agente real: leer el paquete, validar, mostrar
 * la OC que quedaría, pedir el «sí» cuando hace falta y crearla. El orden importa
 * poco para el motor (la evidencia y el payload se pueden llamar en cualquier
 * orden), pero este es el orden que documenta la arquitectura §4.
 */
export function guionReactivo(): GuionMock {
  return (mensajes) => {
    const caso = casoDe(mensajes)
    if (caso === null) {
      return responderTexto(
        "Dime qué solicitud proceso (por ejemplo «procesa sol-004») y la preparo. Los valores salen de las herramientas: no puedo leer ficheros ni inventar cifras.",
      )
    }

    if (datosDe(mensajes, "oc_leer_paquete") === null) return llamar("oc_leer_paquete", { caso })

    const validacion = datosDe(mensajes, "oc_validar")
    if (validacion === null) return llamar("oc_validar", { caso })

    if (validacion["apta"] !== true) {
      return responderTexto(
        `La solicitud ${caso} no se puede crear: ${resumenDe(validacion, "bloqueos")}. Dime si corrijo el dato o lo escalo.`,
      )
    }

    if (datosDe(mensajes, "oc_construir_payload") === null) return llamar("oc_construir_payload", { caso })

    const confirma = usuarioConfirma(mensajes)
    if (validacion["requiere_confirmacion"] === true && !confirma) {
      return responderTexto(
        `Así quedaría la OC de ${caso}. Antes de crearla necesito tu confirmación: ${resumenDe(validacion, "confirmaciones")}. ¿Confirmas que proceda?`,
      )
    }

    if (datosDe(mensajes, "oc_generar_evidencia") === null) return llamar("oc_generar_evidencia", { caso })

    const creada = datosDe(mensajes, "oc_crear")
    if (creada === null) {
      // El doble **no** se autoriza a sí mismo: manda `confirmado: false` y deja
      // que el ciclo imponga el valor que venga del usuario (CA3).
      return llamar("oc_crear", { caso, confirmado: false, confirmado_por: CONFIRMADO_POR })
    }

    const numero = String(creada["numero_oc"] ?? "")
    if (creada["idempotente"] === true) {
      return responderTexto(`Esa solicitud ya tenía la orden ${numero}: no he creado otra.`)
    }
    return responderTexto(
      `Orden de compra ${numero} creada. La evidencia y la línea de control quedan en out/ para auditoría.`,
    )
  }
}

/**
 * Llama a una herramienta en **cada** iteración, para siempre.
 * Es la forma de probar el tope de iteraciones (CA1) sin esperar a un modelo.
 */
export function guionInfinito(): GuionMock {
  return (mensajes) => llamar("oc_leer_paquete", { caso: casoDe(mensajes) ?? "sol-001" })
}

/**
 * Doble que se porta mal a propósito, en los dos puntos que el ciclo debe frenar:
 *
 *   · **CA3** — cuando le toca crear, manda `confirmado: true` por su cuenta, como
 *     si él pudiera autorizarse;
 *   · **CA2** — cuando arma la OC, propone un paquete con un `valor_total` que se
 *     inventa, para que se vea que gana el fixture y que la diferencia queda
 *     declarada como aviso.
 *
 * Lo que propone es **schema-válido** a propósito: así lo que se prueba es la
 * auditoría del motor y no el rechazo de `zod` (que ya cubren las pruebas de las
 * herramientas).
 */
export function guionAlucinado(): GuionMock {
  const bueno = guionReactivo()
  return (mensajes, herramientas) => {
    const respuesta = bueno(mensajes, herramientas)
    const llamada = respuesta.llamadas[0]
    if (llamada === undefined) return respuesta

    if (llamada.nombre === "oc_crear") {
      return llamar("oc_crear", {
        caso: llamada.argumentos["caso"],
        confirmado: true,
        confirmado_por: CONFIRMADO_POR,
      })
    }

    if (llamada.nombre === "oc_construir_payload") {
      return llamar("oc_construir_payload", {
        caso: llamada.argumentos["caso"],
        paquete: { solicitud: { valor_total: 1 } },
      })
    }

    return respuesta
  }
}

// ── Adaptador ────────────────────────────────────────────────────────────────

/** Opciones del proveedor simulado. */
export interface OpcionesMock {
  guion?: GuionMock
  /** Fuerza un fallo del proveedor, con este mensaje (CA5). */
  fallarCon?: string
  modelo?: string
  /** Tokens que se contabilizan por iteración (deterministas, para probar topes). */
  usoPorIteracion?: { entrada: number; salida: number }
}

/** Crea el adaptador simulado. */
export function crearAdaptadorMock(opciones: OpcionesMock = {}): AdaptadorLlm {
  const guion = opciones.guion ?? guionReactivo()
  const uso = opciones.usoPorIteracion ?? { entrada: 120, salida: 30 }
  let iteraciones = 0

  return {
    proveedor: "mock",
    modelo: opciones.modelo ?? "guion-determinista",

    async enviar(mensajes, herramientas) {
      iteraciones += 1
      if (opciones.fallarCon !== undefined) return { ok: false, error: opciones.fallarCon }
      const respuesta = guion([...mensajes], [...herramientas])
      return {
        ok: true,
        data: {
          ...respuesta,
          uso: { entrada: uso.entrada * iteraciones, salida: uso.salida },
        },
      }
    },
  }
}

