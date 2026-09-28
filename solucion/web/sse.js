/**
 * Lectura del stream SSE del chat (PRD §6.1 y §6.4).
 *
 * Va en su propio módulo, sin tocar el DOM, por dos razones: el navegador puede
 * importarlo tal cual y las pruebas de Node pueden probar el troceado sin
 * navegador. Un stream llega partido en trozos arbitrarios —de ahí que `app.js`
 * no use `EventSource`, que solo sabe de `GET` sin cuerpo—, así que el parser
 * guarda el resto incompleto y lo devuelve en el siguiente trozo.
 */

/** Marca final del stream, distinta de un evento. */
export const FIN = "DONE"

/**
 * Separa los bloques completos del resto incompleto.
 * Los eventos SSE se separan con una línea vacía.
 */
export function separarBloques(texto) {
  const normalizado = texto.replace(/\r\n/g, "\n")
  const partes = normalizado.split("\n\n")
  const resto = partes.pop() ?? ""
  return { bloques: partes.filter((bloque) => bloque.trim() !== ""), resto }
}

/**
 * Interpreta un bloque SSE.
 * Devuelve el evento ya decodificado, `FIN` si era la marca de cierre, o `null`
 * si el bloque no traía datos válidos (comentario, línea vacía, JSON roto).
 */
export function leerBloque(bloque) {
  const datos = bloque
    .split("\n")
    .filter((linea) => linea.startsWith("data:"))
    .map((linea) => linea.slice(5).trimStart())
    .join("\n")

  if (datos === "") return null
  if (datos === `[${FIN}]`) return FIN

  try {
    const evento = JSON.parse(datos)
    return typeof evento === "object" && evento !== null && typeof evento.tipo === "string" ? evento : null
  } catch {
    return null
  }
}

/**
 * Acumulador de eventos: recibe trozos de texto tal como llegan y devuelve los
 * eventos que ya están completos.
 */
export function crearAcumulador() {
  let pendiente = ""

  return {
    /** Añade un trozo y devuelve los eventos listos. */
    empujar(trozo) {
      const { bloques, resto } = separarBloques(pendiente + trozo)
      pendiente = resto
      return bloques.map(leerBloque).filter((evento) => evento !== null)
    },

    /** Resto sin cerrar; sirve para diagnosticar un stream cortado. */
    get resto() {
      return pendiente
    },
  }
}
