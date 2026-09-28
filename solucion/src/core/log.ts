/**
 * Registro de ejecuciones (PRD §6.3 · CA4).
 *
 * CA4 pide que toda llamada a herramienta quede en el historial visible del chat
 * **y** en `out/log.jsonl`. Aquí está la segunda parte: una línea por ejecución
 * con `{ ts, herramienta, caso, ok, resumen }`. La misma información es la que
 * el front pinta como tarjeta, no un adorno de depuración.
 *
 * Nunca lanza: si no se puede escribir se devuelve el error y quien llama
 * decide — un fallo de log no debe tumbar el trabajo del usuario.
 */
import type { Escritor } from "./escritor.ts"
import type { Resultado } from "./tipos.ts"

/** Formato de una línea de log. `sesion` es aditivo: permite reconstruir el turno. */
export interface EntradaLog {
  ts: string
  herramienta: string
  caso: string | null
  ok: boolean
  resumen: string
  sesion: string
}

/** Petición de registro: qué se ejecutó y cómo terminó. */
export interface PeticionLog {
  /** `null` cuando aún no se conoce el caso (p. ej. argumentos inválidos). */
  caso: string | null
  herramienta: string
  ok: boolean
  resumen: string
  sesion: string
}

/** Línea JSON de una entrada (sin salto final). */
export function serializarEntrada(entrada: EntradaLog): string {
  return JSON.stringify(entrada)
}

/** Registra una ejecución en `out/log.jsonl` y devuelve la ruta escrita. */
export function registrar(escritor: Escritor, peticion: PeticionLog): Resultado<string> {
  const entrada: EntradaLog = {
    ts: marcaTiempo(),
    herramienta: peticion.herramienta,
    caso: peticion.caso,
    ok: peticion.ok,
    resumen: recortar(peticion.resumen),
    sesion: peticion.sesion,
  }
  return escritor.anexar(serializarEntrada(entrada), "log.jsonl")
}

/** Marca de tiempo ISO de una entrada de log. */
export function marcaTiempo(ahora: Date = new Date()): string {
  return ahora.toISOString()
}

/** Los resúmenes se recortan para que el archivo no crezca sin control. */
function recortar(texto: string, limite = 500): string {
  const limpio = texto.replace(/\s+/g, " ").trim()
  return limpio.length <= limite ? limpio : `${limpio.slice(0, limite - 1)}…`
}
