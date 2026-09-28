/**
 * Navegador mínimo para probar el front sin navegador.
 *
 * El front es JavaScript que corre en el navegador: si ninguna prueba lo
 * ejecutara, un `limpiarAviso()` sin definir —o un `estado.turnos` que ya no
 * existe— llegaría a la pantalla con la suite entera en verde. Aquí se carga
 * `web/app.js` dentro de un contexto de `vm` con lo justo del DOM que el front
 * usa, y su `fetch` se conecta al backend real con `app.inject()`: el turno que
 * se prueba es el de verdad, y el stream SSE llega **troceado a propósito** para
 * probar también el reensamblado.
 *
 * Lo que esto **no** es: un navegador. No hay CSS ni pintado, así que no sustituye
 * a mirar la pantalla (para eso, el chequeo visual de F5).
 */
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import { TextDecoder } from "node:util"
import type { FastifyInstance } from "fastify"
import { crearAcumulador, FIN } from "../web/sse.js"

/** Petición que el front manda al backend. */
export interface Peticion {
  url: string
  metodo: string
  cuerpo: string
}

/** Respuesta tal como la ve el front (solo lo que `app.js` usa). */
interface RespuestaFalsa {
  ok: boolean
  status: number
  json: () => Promise<unknown>
  body: { getReader: () => { read: () => Promise<{ value: Uint8Array | undefined; done: boolean }> } }
}

/** Si un nodo responde a un selector simple de los que usa el front (`#id`, `.clase`). */
function coincide(nodo: Nodo, selector: string): boolean {
  if (selector.startsWith("#")) return nodo.id === selector.slice(1)
  if (selector.startsWith(".")) {
    const clase = selector.slice(1)
    return nodo.className.split(/\s+/).includes(clase) || nodo.clases.has(clase)
  }
  return nodo.etiqueta === selector
}

/** Nodo del DOM falso: guarda lo que el front le escribe. */
export class Nodo {
  readonly etiqueta: string
  hijos: Nodo[] = []
  padre: Nodo | null = null
  className = ""
  id = ""
  hidden = false
  value = ""
  type = ""
  title = ""
  href = ""
  target = ""
  rel = ""
  key = ""
  shiftKey = false
  #texto = ""
  readonly dataset: Record<string, string> = {}
  readonly clases = new Set<string>()
  readonly oyentes: { tipo: string; fn: (evento: unknown) => void }[] = []
  /** Lo mismo que ofrece el navegador: `classList.add(...)` y `contains(...)`. */
  readonly classList = {
    add: (nombre: string): void => {
      this.clases.add(nombre)
    },
    contains: (nombre: string): boolean => this.clases.has(nombre),
  }

  constructor(etiqueta: string) {
    this.etiqueta = etiqueta
  }

  /** El texto del nodo y sus hijos, como el `textContent` del navegador. */
  get textContent(): string {
    return [this.#texto, ...this.hijos.map((hijo) => hijo.textContent)].join("")
  }

  /** Escribir texto reemplaza el contenido, igual que en el navegador. */
  set textContent(valor: string) {
    this.#texto = valor
    this.hijos = []
  }

  /** Los hijos, como `element.children` del navegador. */
  get children(): Nodo[] {
    return this.hijos
  }

  append(...nodos: Nodo[]): void {
    for (const nodo of nodos) {
      nodo.padre = this
      this.hijos.push(nodo)
    }
  }

  replaceChildren(...nodos: Nodo[]): void {
    this.hijos = []
    this.append(...nodos)
  }

  /** Busca por identificador o clase entre los descendientes, como el navegador. */
  querySelector(selector: string): Nodo | null {
    for (const hijo of this.hijos) {
      if (coincide(hijo, selector)) return hijo
      const encontrado = hijo.querySelector(selector)
      if (encontrado !== null) return encontrado
    }
    return null
  }

  /** Todos los descendientes que cumplen el selector. */
  querySelectorAll(selector: string): Nodo[] {
    const encontrados: Nodo[] = []
    for (const hijo of this.hijos) {
      if (coincide(hijo, selector)) encontrados.push(hijo)
      encontrados.push(...hijo.querySelectorAll(selector))
    }
    return encontrados
  }

  addEventListener(tipo: string, fn: (evento: unknown) => void): void {
    this.oyentes.push({ tipo, fn })
  }

  /** Lo que hace el navegador al enfocar; aquí solo se deja constancia. */
  focus(): void {
    this.dataset["enfocado"] = "si"
  }

  scrollIntoView(): void {
    // Sin pintado no hay nada que desplazar.
  }

  /** Dispara los oyentes de este nodo con un evento falso. */
  disparar(tipo: string, evento: Record<string, unknown> = {}): number {
    let disparados = 0
    for (const oyente of this.oyentes) {
      if (oyente.tipo !== tipo) continue
      disparados += 1
      oyente.fn({ target: this, preventDefault: () => {}, ...evento })
    }
    return disparados
  }
}

/**
 * El `document` del navegador, reducido a lo que el front usa.
 * Los nodos se identifican por su `id` (el front solo busca así) y se crean bajo
 * demanda, de modo que un `#lo-que-sea` del HTML siempre existe.
 */
export class Documento {
  readonly porId = new Map<string, Nodo>()
  readonly oyentes: { tipo: string; fn: (evento: unknown) => void }[] = []

  createElement(etiqueta: string): Nodo {
    return new Nodo(etiqueta)
  }

  createTextNode(texto: string): Nodo {
    const nodo = new Nodo("#texto")
    nodo.textContent = texto
    return nodo
  }

  /** Nodo por identificador, creándolo si el HTML no lo declaraba. */
  para(selector: string): Nodo {
    const id = selector.startsWith("#") ? selector.slice(1) : selector
    const existente = this.porId.get(id)
    if (existente !== undefined) return existente

    const nodo = new Nodo("div")
    nodo.id = id
    this.porId.set(id, nodo)
    return nodo
  }

  querySelector(selector: string): Nodo | null {
    if (!selector.startsWith("#")) return null
    const id = selector.slice(1)
    const nodo = this.porId.get(id)
    return nodo ?? null
  }

  addEventListener(tipo: string, fn: (evento: unknown) => void): void {
    this.oyentes.push({ tipo, fn })
  }

  /**
   * Dispara un evento: atiende al `target` y, si ese nodo no escuchaba, a los
   * oyentes del documento. Así una prueba puede simular un clic en un botón o un
   * `submit` sin distinguir quién lo escucha.
   */
  disparar(tipo: string, evento: Record<string, unknown> = {}): number {
    const objetivo = evento["target"]
    if (objetivo instanceof Nodo) {
      const disparados = objetivo.disparar(tipo, evento)
      if (disparados > 0) return disparados
    }

    let disparados = 0
    for (const oyente of this.oyentes) {
      if (oyente.tipo !== tipo) continue
      disparados += 1
      oyente.fn(evento)
    }
    return disparados
  }
}

/**
 * El estado inicial del HTML: lo que el HTML declara `hidden` empieza oculto.
 * Se lee el archivo de verdad para que borrar un `hidden` del HTML se note aquí.
 */
function plantarHtml(documento: Documento, html: string): void {
  for (const etiqueta of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const nodo = documento.para(`#${etiqueta[1] ?? ""}`)
    if (/\shidden[\s>/]/.test(etiqueta[0] ?? "")) nodo.hidden = true
  }
}

/** Temporizadores que no impiden que el proceso de la prueba termine. */
function relojFalso() {
  const suelta = <T extends { unref?: () => void }>(temporizador: T): T => {
    temporizador.unref?.()
    return temporizador
  }

  return {
    Date: globalThis.Date,
    setTimeout: (fn: () => void, ms?: number) => suelta(setTimeout(fn, ms)),
    clearTimeout: (temporizador: NodeJS.Timeout) => clearTimeout(temporizador),
    setInterval: (fn: () => void, ms?: number) => suelta(setInterval(fn, ms)),
    clearInterval: (temporizador: NodeJS.Timeout) => clearInterval(temporizador),
  }
}

/** Consola que además deja registrar las líneas las enseña si se pide. */
function consolaFalsa(lineas: string[], verboso: boolean) {
  const apuntar = (nivel: string) => (...argumentos: unknown[]): void => {
    const texto = argumentos.map((argumento) => String(argumento)).join(" ")
    lineas.push(texto)
    if (verboso) console.log(`[front:${nivel}] ${texto}`)
  }

  return { log: apuntar("log"), info: apuntar("info"), warn: apuntar("warn"), error: apuntar("error"), debug: apuntar("debug") }
}

/**
 * Respuesta del `fetch` falso, con el cuerpo partido en trozos pequeños.
 * El troceado es deliberado: un stream real no llega entero, y así cada prueba
 * del front comprueba de paso el reensamblado de `sse.js`.
 */
/**
 * Respuesta del `fetch` falso, con el cuerpo partido en trozos pequeños.
 * El troceado es deliberado: un stream real no llega entero, y así cada prueba del
 * front comprueba de paso el reensamblado de `sse.js`.
 */
function respuestaFalsa(cuerpo: string, status: number): RespuestaFalsa {
  const bytes = new TextEncoder().encode(cuerpo)
  const TAMANO = 23
  let posicion = 0

  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(cuerpo) as unknown,
    body: {
      getReader: () => ({
        read: async (): Promise<{ value: Uint8Array | undefined; done: boolean }> => {
          if (posicion >= bytes.length) return { value: undefined, done: true }
          const trozo = bytes.slice(posicion, posicion + TAMANO)
          posicion += TAMANO
          return { value: trozo, done: false }
        },
      }),
    },
  }
}

/** Lo que ve el script del front dentro del contexto aislado. */
interface ContextoFront extends Record<string, unknown> {
  document: Documento
  window: { addEventListener: (tipo: string, fn: (evento: unknown) => void) => void }
  console: ReturnType<typeof consolaFalsa>
  fetch: (url: string, opciones?: { method?: string; body?: string; headers?: Record<string, string> }) => Promise<RespuestaFalsa>
  TextDecoder: typeof TextDecoder
  crypto: Crypto
  Element: typeof Nodo
  Error: ErrorConstructor
  Date: DateConstructor
  setTimeout: (fn: () => void, ms?: number) => NodeJS.Timeout
  clearTimeout: (temporizador: NodeJS.Timeout) => void
  setInterval: (fn: () => void, ms?: number) => NodeJS.Timeout
  clearInterval: (temporizador: NodeJS.Timeout) => void
  crearAcumulador: typeof crearAcumulador
  FIN: string
}

/** Front cargado en el DOM falso, con lo que las pruebas necesitan mirar. */
export interface Front {
  documento: Documento
  contexto: ContextoFront
  /** Peticiones que el front mandó al backend, en orden. */
  peticiones: Peticion[]
  /** Lo que el front escribió en `console`. */
  consola: string[]
  /** Nodo del HTML falso, por ejemplo `#aviso`. */
  nodo(selector: string): Nodo
  /** Llama a una función de `app.js` como si fuera su botón. */
  llamar<T>(nombre: string, ...argumentos: unknown[]): Promise<T>
  /** Espera a que el front llegue al estado esperado; falla si no lo hace. */
  esperar(condicion: () => boolean, ms?: number): Promise<void>
  /** Espera a que el arranque (salud del backend) haya terminado. */
  listo(): Promise<void>
}

/** Todos los descendientes que llevan esa clase. */
export function conClase(contenedor: Nodo, clase: string): Nodo[] {
  return contenedor.querySelectorAll(`.${clase}`)
}

/** Carga `web/app.js` en un contexto aislado, con su `fetch` apuntando al backend. */
export async function cargarFront(app: FastifyInstance): Promise<Front> {
  const documento = new Documento()
  const consola: string[] = []
  const peticiones: Peticion[] = []
  const reloj = relojFalso()
  const raiz = path.resolve(import.meta.dirname, "..")

  plantarHtml(documento, fs.readFileSync(path.join(raiz, "web", "index.html"), "utf8"))

  const fetchFalso = async (
    url: string,
    opciones?: { method?: string; body?: string },
  ): Promise<RespuestaFalsa> => {
    const metodo = (opciones?.method ?? "GET").toUpperCase()
    const cuerpo = opciones?.body ?? ""
    peticiones.push({ url, metodo, cuerpo })

    const respuesta =
      metodo === "POST"
        ? await app.inject({ method: "POST", url, payload: JSON.parse(cuerpo) as Record<string, unknown> })
        : await app.inject({ method: "GET", url })

    return respuestaFalsa(respuesta.body, respuesta.statusCode)
  }

  const sandbox: ContextoFront = {
    document: documento,
    window: {
      addEventListener: (tipo, fn): void => {
        documento.oyentes.push({ tipo, fn })
      },
    },
    console: consolaFalsa(consola, process.env["FRONT_VERBOSE"] === "1"),
    fetch: fetchFalso,
    TextDecoder,
    crypto: globalThis.crypto,
    Element: Nodo,
    Error,
    ...reloj,
    // El navegador resuelve `import "./sse.js"` por su cuenta; aquí se le inyecta
    // ya resuelto y la línea del import se quita del guion antes de ejecutarlo.
    crearAcumulador,
    FIN,
  }

  const contexto = vm.createContext(sandbox) as unknown as ContextoFront
  const fuente = fs
    .readFileSync(path.join(raiz, "web", "app.js"), "utf8")
    .replace(/^import .*$/m, "")
  new vm.Script(fuente, { filename: "web/app.js" }).runInContext(contexto)

  const nodo = (selector: string): Nodo => documento.para(selector)

  const esperar = async (condicion: () => boolean, ms = 5000): Promise<void> => {
    const limite = Date.now() + ms
    while (!condicion()) {
      if (Date.now() > limite) throw new Error("el front no llegó al estado esperado a tiempo")
      await new Promise<void>((seguir) => {
        setTimeout(seguir, 5)
      })
    }
  }

  return {
    documento,
    contexto,
    peticiones,
    consola,
    nodo,
    esperar,
    listo: () =>
      esperar(
        () =>
          nodo("#estado-servidor").textContent !== "" &&
          nodo("#dato-sesion").textContent !== "" &&
          nodo("#sugerencias").children.length > 0,
      ),
    llamar: async <T>(nombre: string, ...argumentos: unknown[]): Promise<T> => {
      const funcion = (contexto as unknown as Record<string, unknown>)[nombre]
      if (typeof funcion !== "function") throw new Error(`app.js no define «${nombre}»: el front no responde`)
      return (await (funcion as (...args: unknown[]) => unknown)(...argumentos)) as T
    },
  }
}

