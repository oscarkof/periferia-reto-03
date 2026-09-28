/**
 * Pruebas del CSV propio (PRD §4).
 *
 * `out/control.csv` lo lee contabilidad, así que el formato es un contrato: el
 * caso que hay que blindar es el campo con **comas, comillas o saltos de línea
 * dentro**, que es exactamente lo que rompe un CSV escrito a mano.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { construirCsv, contarFilas, escaparCampo, leerCsv } from "../src/core/csv.ts"

test('un campo normal se escribe sin comillas', () => {
  assert.equal(escaparCampo("CT-2026-015"), "CT-2026-015")
  assert.equal(escaparCampo("COP"), "COP")
  assert.equal(escaparCampo("11400000"), "11400000")
})

test('un campo con coma, comilla o salto se entrecomilla y duplica comillas', () => {
  assert.equal(escaparCampo("Compras, Servicios Generales"), '"Compras, Servicios Generales"')
  assert.equal(escaparCampo('dice "aprobado"'), '"dice ""aprobado"""')
  assert.equal(escaparCampo("linea1\nlinea2"), '"linea1\nlinea2"')
  assert.equal(escaparCampo(" con espacio "), '" con espacio "')
})

test('el ida y vuelta conserva comas, comillas y saltos dentro de un campo', () => {
  const cabeceras = ["caso", "detalle", "valor"]
  const filas = [["sol-001", "Compras, Servicios Generales\ndice \"Aprobado\"", "11400000"]]
  const texto = construirCsv(cabeceras, filas)

  const leido = leerCsv(texto)
  assert.ok(leido !== null)
  assert.deepEqual(leido.cabeceras, cabeceras)
  assert.deepEqual(leido.filas, filas)
})

test('la cabecera y las filas se leen con sus columnas', () => {
  const leido = leerCsv("a,b,c\n1,2,3\n4,5,6\n")
  assert.ok(leido !== null)
  assert.deepEqual(leido.cabeceras, ["a", "b", "c"])
  assert.equal(leido.filas.length, 2)
  assert.deepEqual(leido.filas[1], ["4", "5", "6"])
})

test('contarFilas no cuenta la cabecera y aguanta un archivo vacío', () => {
  assert.equal(contarFilas("a,b\n1,2\n3,4\n"), 2)
  assert.equal(contarFilas("a,b\n"), 0)
  assert.equal(contarFilas(""), 0)
})

test('un texto sin cabecera no se considera un CSV', () => {
  assert.equal(leerCsv(""), null)
})

test('los saltos de línea de Windows no ensucian los campos', () => {
  const leido = leerCsv("a,b\r\n1,2\r\n")
  assert.ok(leido !== null)
  assert.deepEqual(leido.filas, [["1", "2"]])
})
