/**
 * Eventos de un turno (CA4).
 *
 * El ciclo del agente **no habla HTTP**: emite estos eventos y el backend decide
 * cómo los transmite (SSE hacia el front, o el registro de las pruebas). Así el
 * front puede mostrar cada llamada a herramienta —nombre, argumentos y resultado
 * resumido, que es lo que pide el PRD §6.1— sin que el ciclo sepa de sockets.
 */

/** Evento emitido durante un turno. */
export type EventoTurno =
  | { tipo: "texto"; texto: string }
  | { tipo: "llamada"; nombre: string; argumentos: Record<string, unknown> }
  | { tipo: "resultado"; nombre: string; ok: boolean; resumen: string }
  | { tipo: "aviso"; texto: string }
  | { tipo: "error"; texto: string }
  | { tipo: "fin"; texto: string; needsConfirmation: boolean; llamadas: number; iteraciones: number }

/** Respuesta de una herramienta, ya interpretada. */
export interface RespuestaHerramienta {
  ok: boolean
  data: Record<string, unknown> | null
  error: string | null
}

/** Interpreta el JSON de una herramienta sin lanzar nunca. */
export function interpretarRespuestaHerramienta(json: string): RespuestaHerramienta {
  try {
    const crudo = JSON.parse(json) as { ok?: unknown; data?: unknown; error?: unknown }
    if (crudo.ok === true) {
      const datos = crudo.data
      return {
        ok: true,
        data: typeof datos === "object" && datos !== null ? (datos as Record<string, unknown>) : null,
        error: null,
      }
    }
    return {
      ok: false,
      data: null,
      error: typeof crudo.error === "string" ? crudo.error : "error sin detalle",
    }
  } catch {
    return { ok: false, data: null, error: "la herramienta no devolvió un JSON válido" }
  }
}

/** Códigos de una lista de hallazgos del veredicto (`bloqueos` / `confirmaciones`). */
function codigos(datos: Record<string, unknown> | null, campo: string): string {
  const hallazgos = datos?.[campo]
  if (!Array.isArray(hallazgos)) return ""
  return hallazgos
    .map((crudo) => (crudo as { codigo?: string }).codigo ?? "")
    .filter((codigo) => codigo !== "")
    .join(", ")
}

/**
 * Resumen legible de la respuesta de una herramienta, para la tarjeta del chat y
 * para `out/log.jsonl` (CA4). Se calcula aquí y no en el modelo: el modelo no
 * resume nada, solo lee lo que el motor decidió.
 */
export function resumirRespuesta(nombre: string, respuesta: RespuestaHerramienta): string {
  if (!respuesta.ok) return `error: ${respuesta.error ?? "sin detalle"}`
  const datos = respuesta.data
  if (datos === null) return "sin datos"

  if (nombre === "oc_leer_paquete") {
    const solicitud = datos["solicitud"] as { solicitud_id?: string; proveedor_nombre?: string } | undefined
    const faltantes = datos["faltantes"]
    const cuantas = Array.isArray(faltantes) && faltantes.length > 0 ? ` · faltan ${faltantes.length}` : ""
    return `${solicitud?.solicitud_id ?? "?"} · ${solicitud?.proveedor_nombre ?? "?"}${cuantas}`
  }

  if (nombre === "oc_validar") {
    if (datos["apta"] !== true) return `bloqueada por ${codigos(datos, "bloqueos") || "regla sin código"}`
    const confirmaciones = codigos(datos, "confirmaciones")
    const retroactiva = datos["retroactiva"] === true ? " · retroactiva" : ""
    if (datos["requiere_confirmacion"] === true) return `apta, requiere confirmar ${confirmaciones}${retroactiva}`
    return `apta, sin excepciones${retroactiva}`
  }

  if (nombre === "oc_construir_payload") {
    const orden = datos["orden"] as
      | { referencia?: { solicitud_id?: string }; posiciones?: unknown[]; excepciones?: unknown[] }
      | undefined
    return (
      `OC de ${orden?.referencia?.solicitud_id ?? "?"} · ` +
      `${orden?.posiciones?.length ?? 0} posición(es) · ${orden?.excepciones?.length ?? 0} excepción(es)`
    )
  }

  if (nombre === "oc_generar_evidencia") {
    const huella = String(datos["sha256"] ?? "")
    return `aprobación de ${String(datos["correo_de"] ?? "?")} · huella ${huella.slice(0, 12)}…`
  }

  if (nombre === "oc_crear") {
    const idempotente = datos["idempotente"] === true
    return `${idempotente ? "ya existía" : "creada"} · OC ${String(datos["numero_oc"] ?? "?")}`
  }

  const texto = JSON.stringify(datos)
  return texto.length > 140 ? `${texto.slice(0, 139)}…` : texto
}
