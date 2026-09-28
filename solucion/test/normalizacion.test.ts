/**
 * Pruebas de normalización (PRD §8 · Determinismo).
 *
 * Es la capa de la que dependen todas las reglas: si un NIT con dígito de
 * verificación no se reconoce como el mismo proveedor, RC1 bloquea un caso
 * legítimo; si una fecha con zona horaria se interpreta distinto según la
 * máquina, RC8 decide otra cosa. Aquí se fija cada una de esas conversiones.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  claveNit,
  diasEntre,
  esAnterior,
  extraerMoneda,
  formatearFecha,
  normalizarFecha,
  normalizarNit,
  normalizarTexto,
  parsearImporte,
  porcentajeDiferencia,
  quitarFormaSocietaria,
  redondear,
  sumarDias,
  validarFecha,
} from "../src/core/normalizacion.ts"

test('normalizarTexto quita acentos, mayúsculas y espacios de más', () => {
  assert.equal(normalizarTexto("  CORPORACIÓN   Andina  "), "corporacion andina")
  assert.equal(normalizarTexto("Rocío Torres Ibáñez"), "rocio torres ibanez")
})

test('normalizarNit deja solo dígitos y sin ceros a la izquierda', () => {
  assert.equal(normalizarNit("900.555.111-2"), "9005551112")
  assert.equal(normalizarNit("0800444555"), "800444555")
  assert.equal(normalizarNit("NIT 830.111.222-8"), "8301112228")
})

test('claveNit reconoce el mismo proveedor con y sin dígito de verificación', () => {
  assert.equal(claveNit("900555111"), "900555111")
  assert.equal(claveNit("900.555.111-2"), "900555111")
  assert.equal(claveNit("900555111"), claveNit("900.555.111-2"))
})

test('quitarFormaSocietaria normaliza el nombre del proveedor', () => {
  assert.equal(quitarFormaSocietaria("TecnoSuministros S.A.S."), "tecnosuministros")
  assert.equal(quitarFormaSocietaria("Papelería Central Ltda."), "papeleria central")
  assert.equal(quitarFormaSocietaria("Mobiliario Andino S.A."), "mobiliario andino")
  assert.equal(quitarFormaSocietaria("Cloud Andina S.A.S"), "cloud andina")
})

test('validarFecha rechaza formatos raros y fechas que no existen', () => {
  assert.equal(validarFecha("2026-08-20").ok, true)
  assert.equal(validarFecha("20/08/2026").ok, false)
  assert.equal(validarFecha("2026-02-30").ok, false)
  assert.equal(validarFecha("2026-13-01").ok, false)
})

test('normalizarFecha toma la fecha escrita, sin convertir zonas horarias', () => {
  const conZona = normalizarFecha("2026-08-20T23:30:00-05:00")
  assert.equal(conZona.ok, true)
  if (conZona.ok) assert.equal(conZona.data, "2026-08-20")
  const simple = normalizarFecha("2026-08-20")
  assert.equal(simple.ok, true)
  if (simple.ok) assert.equal(simple.data, "2026-08-20")
})

test('formatearFecha compone con ceros a la izquierda y valida', () => {
  assert.equal(formatearFecha({ dia: 1, mes: 8, anio: 2026 }), "2026-08-01")
  assert.equal(formatearFecha({ dia: 31, mes: 4, anio: 2026 }), null)
})

test('esAnterior y diasEntre comparan fechas ISO', () => {
  assert.equal(esAnterior("2026-08-10", "2026-08-27"), true)
  assert.equal(esAnterior("2026-08-27", "2026-08-27"), false)
  assert.equal(esAnterior("2026-08-28", "2026-08-27"), false)
  assert.equal(diasEntre("2026-08-20", "2026-09-03"), 14)
  assert.equal(diasEntre("2026-09-03", "2026-08-20"), -14)
})

test('sumarDias respeta el fin de mes y el año bisiesto', () => {
  assert.equal(sumarDias("2026-08-18", 30), "2026-09-17")
  assert.equal(sumarDias("2026-01-31", 1), "2026-02-01")
  assert.equal(sumarDias("2026-12-31", 1), "2027-01-01")
  assert.equal(sumarDias("2028-02-28", 1), "2028-02-29")
})

test('parsearImporte entiende los formatos que escriben los proveedores', () => {
  assert.equal(parsearImporte("11.400.000"), 11_400_000)
  assert.equal(parsearImporte("11,400,000.00"), 11_400_000)
  assert.equal(parsearImporte("COP 11.400.000"), 11_400_000)
  assert.equal(parsearImporte("95000"), 95_000)
  assert.equal(parsearImporte("1.234,56"), 1234.56)
  assert.equal(parsearImporte("sin cifra"), null)
})

test('extraerMoneda reconoce el código ISO', () => {
  assert.equal(extraerMoneda("TOTAL (IVA incluido): COP 11.400.000"), "COP")
  assert.equal(extraerMoneda("Total: USD 120"), "USD")
  assert.equal(extraerMoneda("Total: 120"), null)
})

test('porcentajeDiferencia y redondear, con el cero a salvo', () => {
  assert.equal(redondear(porcentajeDiferencia(26_500_000, 25_000_000), 2), 6)
  assert.equal(redondear(porcentajeDiferencia(11_400_000, 11_400_000), 2), 0)
  assert.equal(porcentajeDiferencia(100, 0), 100)
  assert.equal(porcentajeDiferencia(0, 0), 0)
  assert.equal(redondear(2.005, 2), 2.01)
})
