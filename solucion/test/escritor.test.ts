/**
 * Pruebas del escritor confinado (PRD §8 · Robustez).
 *
 * `out/` es la única superficie de escritura del reto, así que lo que se fija
 * aquí vale para todo lo demás: las rutas no se escapan de la raíz, la escritura
 * es atómica (no queda un `.tmp` a medias) y `limpiar` deja la carpeta como
 * recién creada conservando lo que se le pida (el `log.jsonl` de la demo).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { crearEscritor } from "../src/core/escritor.ts"

/** Carpeta temporal por prueba: el `out/` del repositorio no se toca. */
function carpetaTemporal(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "reto03-escritor-"))
}

test('escribir crea las carpetas que falten y devuelve la ruta absoluta', () => {
  const raiz = carpetaTemporal()
  const escritor = crearEscritor(raiz)

  const escrito = escritor.escribir("hola\n", "evidencia", "sol-001-aprobacion.txt")
  assert.equal(escrito.ok, true)
  if (!escrito.ok) return
  assert.equal(escrito.data, path.join(raiz, "evidencia", "sol-001-aprobacion.txt"))
  assert.equal(fs.readFileSync(escrito.data, "utf8"), "hola\n")
})

test('anexar acumula líneas y crea el archivo si no existe', () => {
  const escritor = crearEscritor(carpetaTemporal())

  const primera = escritor.anexar("primera", "log.jsonl")
  const segunda = escritor.anexar("segunda", "log.jsonl")

  assert.equal(primera.ok, true)
  assert.equal(segunda.ok, true)
  const texto = fs.readFileSync(path.join(escritor.raiz, "log.jsonl"), "utf8")
  assert.equal(texto, "primera\nsegunda\n")
})

test('una ruta con ../ no sale de la raíz', () => {
  const raiz = carpetaTemporal()
  const escritor = crearEscritor(raiz)

  const fuera = escritor.escribir("no debería existir", "..", "colado.txt")
  assert.equal(fuera.ok, false)
  if (!fuera.ok) assert.match(fuera.error, /fuera del directorio permitido/)
  assert.equal(fs.existsSync(path.join(raiz, "..", "colado.txt")), false)
})

test('la escritura es atómica: no deja archivos .tmp', () => {
  const raiz = carpetaTemporal()
  const escritor = crearEscritor(raiz)

  escritor.escribir("contenido\n", "control.csv")
  const entradas = fs.readdirSync(raiz)
  assert.deepEqual(entradas, ["control.csv"])
})

test('limpiar vacía la carpeta y conserva lo que se le indique', () => {
  const raiz = carpetaTemporal()
  const escritor = crearEscritor(raiz)
  escritor.escribir("traza\n", "log.jsonl")
  escritor.escribir("fila\n", "control.csv")
  escritor.escribir("orden\n", "sap", "ordenes", "4500000001.json")
  escritor.escribir("evidencia\n", "evidencia", "sol-001-aprobacion.txt")

  const limpieza = escritor.limpiar(["log.jsonl"])
  assert.equal(limpieza.ok, true)
  if (limpieza.ok) assert.equal(limpieza.data, 3)

  assert.deepEqual(fs.readdirSync(raiz), ["log.jsonl"])
  assert.equal(fs.readFileSync(path.join(raiz, "log.jsonl"), "utf8"), "traza\n")
})

test('limpiar en una carpeta que no existe todavía no es un error', () => {
  const escritor = crearEscritor(path.join(carpetaTemporal(), "todavía-no"))
  const limpieza = escritor.limpiar()
  assert.equal(limpieza.ok, true)
  if (limpieza.ok) assert.equal(limpieza.data, 0)
})
