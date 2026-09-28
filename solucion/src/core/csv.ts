/**
 * CSV mínimo, escrito en casa (PRD §4: `out/control.csv` lo consume auditoría).
 *
 * No se trae una librería porque el 90 % del problema son **comas, comillas y
 * saltos de línea dentro de un campo** —y devolver eso mal escrito corrompe un
 * archivo que lee contabilidad—. Son unas 120 líneas con sus pruebas, y así el
 * formato queda bajo control: separador `,`, comillas dobles para escapar,
 * `""` para una comilla literal y campos entrecomillados cuando haga falta.
 *
 * `leerCsv` existe para poder **probarlo**: toda prueba de escritura hace el
 * viaje de ida y vuelta y comprueba que el contenido sobrevive.
 */

/** ¿El campo necesita comillas? */
function necesitaComillas(campo: string): boolean {
  return /[",\n\r]/.test(campo) || campo !== campo.trim()
}

/** Escapa un campo según RFC 4180 (el estándar que Excel y SAP aceptan). */
export function escaparCampo(campo: string): string {
  if (!necesitaComillas(campo)) return campo
  return `"${campo.replaceAll('"', '""')}"`
}

/** Construye el texto CSV completo, con cabecera y salto final. */
export function construirCsv(cabeceras: string[], filas: string[][]): string {
  const lineas = [cabeceras, ...filas].map((fila) => fila.map(escaparCampo).join(","))
  return `${lineas.join("\n")}\n`
}

/** Cabeceras + filas de un CSV ya escrito. */
export interface CsvLeido {
  cabeceras: string[]
  filas: string[][]
}

/**
 * Lee un CSV respetando comillas, comas y saltos dentro de un campo.
 * Devuelve `null` si el texto no es un CSV razonable (sin cabecera).
 */
export function leerCsv(texto: string): CsvLeido | null {
  const filas = parsear(texto)
  if (filas.length === 0) return null
  const cabeceras = filas[0]
  if (cabeceras === undefined || cabeceras.length === 0) return null
  return { cabeceras, filas: filas.slice(1) }
}

/** Autómata carácter a carácter: es la única forma de no romper con comillas. */
function parsear(texto: string): string[][] {
  const filas: string[][] = []
  let fila: string[] = []
  let campo = ""
  let entreComillas = false

  for (let i = 0; i < texto.length; i += 1) {
    const caracter = texto[i]

    if (entreComillas) {
      if (caracter === '"') {
        if (texto[i + 1] === '"') {
          campo += '"'
          i += 1
        } else {
          entreComillas = false
        }
      } else {
        campo += caracter
      }
      continue
    }

    if (caracter === '"') {
      entreComillas = true
      continue
    }
    if (caracter === ",") {
      fila.push(campo)
      campo = ""
      continue
    }
    if (caracter === "\n" || caracter === "\r") {
      if (caracter === "\r" && texto[i + 1] === "\n") i += 1
      fila.push(campo)
      filas.push(fila)
      fila = []
      campo = ""
      continue
    }
    campo += caracter
  }

  // Última fila, si el archivo no termina en salto.
  if (campo !== "" || fila.length > 0) {
    fila.push(campo)
    filas.push(fila)
  }

  return filas.filter((f) => !(f.length === 1 && f[0] === ""))
}

/** Cuenta de filas de datos (sin cabecera), o `0` si no se puede leer. */
export function contarFilas(texto: string): number {
  return leerCsv(texto)?.filas.length ?? 0
}
