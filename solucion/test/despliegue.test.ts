/**
 * El despliegue y `SOLUCION.md`, comprobados como artefactos (PRD §8 · §9.1).
 *
 * El criterio de salida de F5 —«un comando levanta todo, el contenedor queda
 * *healthy* y `SOLUCION.md` no tiene secciones vacías»— se puede comprobar sin
 * Docker: lo que se vigila aquí son las promesas del despliegue (que escuche en
 * todas las interfaces, que no corra como root, que se vigile a sí mismo, que no
 * copie `.env`) y la forma del documento de entrega.
 *
 * Lo que esta prueba **no** hace es construir la imagen: eso se hizo a mano con
 * `docker compose up --build` y el contenedor quedó `healthy` (README §1).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

/** Raíz del reto: aquí viven el `Dockerfile` de la imagen y `SOLUCION.md`. */
const RAIZ = path.resolve(import.meta.dirname, "..", "..")

/** Contenido de un archivo del reto, o falla diciendo cuál falta. */
function leer(relativa: string): string {
  const ruta = path.join(RAIZ, relativa)
  assert.ok(fs.existsSync(ruta), `falta ${relativa}`)
  return fs.readFileSync(ruta, "utf8")
}

const dockerfile = (): string => leer("solucion/Dockerfile")

/** ¿Aparece la construcción entera en el Dockerfile? Ayuda a leer las pruebas. */
function tiene(contenido: string, patron: RegExp, que: string): void {
  assert.match(contenido, patron, `el Dockerfile no dice ${que}`)
}

/* ── La imagen ────────────────────────────────────────────────────────────── */

test("la imagen arranca sin paso de build y con una base concreta", () => {
  const texto = dockerfile()

  tiene(texto, /^FROM node:\d+-alpine$/m, "de qué imagen parte")
  assert.ok(!/RUN\s+npm\s+run\s+build/.test(texto), "no hay build que pueda fallar en la demo")
  tiene(texto, /npm ci --omit=dev/, "que solo instala dependencias de producción")
  tiene(texto, /CMD \["node", "src\/server\.ts"\]/, "cómo arranca (Node ejecuta el TypeScript)")
})

test("escucha en todas las interfaces y no corre como root", () => {
  const texto = dockerfile()

  // El valor por defecto de la app es 127.0.0.1, que desde fuera del contenedor no
  // existe: sin esto, el puerto publicado no responde.
  tiene(texto, /HOST=0\.0\.0\.0/, "que escuche en todas las interfaces")
  tiene(texto, /USER node/, "que baje privilegios")
  tiene(texto, /COPY --chown=node:node/, "que copie con el dueño correcto")
})

test("la fecha de referencia va fijada, para que RC8 y RC9 no cambien por día", () => {
  tiene(dockerfile(), /FECHA_EJECUCION=\d{4}-\d{2}-\d{2}/, "la fecha de referencia")
})

test("el contenedor se vigila a sí mismo contra /api/health", () => {
  const texto = dockerfile()

  tiene(texto, /HEALTHCHECK/, "que declare un healthcheck")
  tiene(texto, /\/api\/health/, "que vigile la API, no el puerto")
  assert.ok(!/HEALTHCHECK[\s\S]{0,200}ollama/.test(texto), "vigilar el modelo haría que un contenedor sano saliera insano")
})

test("la imagen no copia el .env ni nada que no deba viajar", () => {
  const texto = dockerfile()

  assert.ok(!/^\s*COPY[^\n]*\.env/m.test(texto), "el .env no entra en la imagen (PRD §8)")
/* ── Lo que NO viaja en la imagen ─────────────────────────────────────────── */

  // El fixture sí entra: la app los lee en `../fixtures/reto-03` respecto a `solucion/`.
  tiene(texto, /COPY --chown=node:node fixtures\/ \/fixtures\//, "que copie los fixtures donde el código los espera")
})

/* ── Lo que NO viaja en la imagen ─────────────────────────────────────────── */

test("el .dockerignore deja fuera dependencias, salidas y secretos, pero no los fixtures", () => {
  const texto = leer(".dockerignore")

  assert.match(texto, /\*\*\/node_modules/, "fuera `node_modules` del host")
  assert.match(texto, /\*\*\/out/, "fuera la salida de una corrida anterior")
  assert.match(texto, /\*\*\/\.env\n/, "fuera el `.env`")
  assert.match(texto, /!\*\*\/\.env\.example/, "pero el `.env.example` es documentación y viaja")
  assert.match(texto, /\*\*\/\.archify/, "fuera la carpeta de trabajo de archify")

  // Los fixtures sí entran: `src/core/rutas.ts` los lee en `../fixtures/reto-03`.
  for (const linea of texto.split("\n")) {
    assert.ok(
      !/^\s*fixtures\/?\s*$/.test(linea),
      `el .dockerignore no puede excluir los fixtures: ${linea}`,
    )
  }
})

/* ── El «un comando» del PRD §8 ───────────────────────────────────────────── */

test("docker compose levanta el agente en un comando, con el puerto y la salida montada", () => {
  const texto = leer("docker-compose.yml")

  assert.match(texto, /dockerfile: solucion\/Dockerfile/, "el contexto de build es la raíz del reto")
  assert.match(texto, /\$\{PORT:-3000\}:3000/, "el puerto del host es configurable y el del contenedor no")
  assert.match(texto, /HOST: 0\.0\.0\.0/, "dentro del contenedor escucha en todas las interfaces")
  assert.match(texto, /\.\/solucion\/out:\/app\/out/, "lo generado queda visible desde el host")
})

test("el contenedor puede llegar al Ollama de la máquina y no lleva secretos dentro", () => {
  const texto = leer("docker-compose.yml")

  assert.match(texto, /host\.docker\.internal:11434/, "Ollama corre en el host, no en la imagen")
  assert.match(texto, /extra_hosts:/, "y en Linux eso hay que declararlo")
  assert.match(texto, /OPENAI_API_KEY: "\$\{OPENAI_API_KEY:-\}"/, "si hay clave, entra por entorno")

  // Ni una clave escrita a mano: se lee del entorno o de `.env` (ignorado por git).
  assert.ok(!/sk-[A-Za-z0-9_-]{10,}/.test(texto), "no puede haber una clave literal en el compose")
  assert.ok(!/SAP_CLIENT_SECRET: *"?[A-Za-z0-9]/.test(texto), "ni credenciales de SAP en claro")
})

/* ── El documento de entrega (PRD §9.1) ───────────────────────────────────── */

test("SOLUCION.md tiene las 12 secciones del PRD §9.1, en orden", () => {
  const texto = leer("SOLUCION.md")

  const secciones = [
    "El problema en una frase",
    "Arquitectura",
    "Ciclo del agente",
    "Elección del modelo",
    "Matriz de controles",
    "Diseño del adaptador SAP real",
    "Lectura del proceso",
    "Decisiones y trade-offs",
    "Supuestos",
    "Cobertura",
    "Uso de IA",
    "Riesgos de llevarlo a producción",
  ]

  let anterior = -1
  for (const [indice, titulo] of secciones.entries()) {
    const posicion = texto.indexOf(`## ${indice + 1}. ${titulo}`)
    assert.ok(posicion > anterior, `falta la sección ${indice + 1} («${titulo}») o está fuera de orden`)
    anterior = posicion
  }
})

test("ninguna sección de SOLUCION.md queda vacía", () => {
  const texto = leer("SOLUCION.md")
  const partes = texto.split(/^## \d+\. /m).slice(1)

  assert.equal(partes.length, 12, `se esperaban 12 secciones y hay ${partes.length}`)
  for (const [indice, parte] of partes.entries()) {
    assert.ok(parte.trim().length > 500, `la sección ${indice + 1} es un titular sin contenido`)
  }
})

test("la entrega cubre lo que el PRD pide por nombre: RC1–RC10, §7.5 y la IA usada", () => {
  const texto = leer("SOLUCION.md")

  for (let numero = 1; numero <= 10; numero += 1) {
    assert.match(texto, new RegExp(`RC${numero}\\b`), `falta RC${numero} en la matriz de controles`)
  }
  for (const pieza of ["OData", "BAPI_PO_CREATE1", "Integration Suite", "idempotencia", "credenciales"]) {
    assert.ok(texto.includes(pieza), `el apartado del adaptador real no habla de ${pieza}`)
  }
  assert.match(texto, /## 11\. Uso de IA/, "el PRD §9.1 pide declarar qué asistente se usó")
})

test("el README explica el arranque en un comando, el demo y el link", () => {
  const texto = leer("README.md")

  assert.match(texto, /docker compose up --build/, "el «un comando» del PRD §8")
  assert.match(texto, /npm run demo/, "cómo se ejecutan las herramientas sin modelo")
  assert.match(texto, /## 8\. Link de prueba/, "y dónde se prueba en línea")
  assert.ok(texto.includes("SOLUCION.md"), "el README tiene que llevar al documento de solución")
})

