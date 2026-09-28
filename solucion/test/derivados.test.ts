/**
 * Pruebas de las derivaciones (RC6, RC7 y la unidad de medida).
 *
 * Una derivación solo vale si dice **de dónde salió**: aquí se fija que el IVA y
 * las condiciones se completen desde el maestro del proveedor cuando la solicitud
 * no los trae, que no se derive nada que ya viniera, y que la unidad se deduzca
 * del texto (las horas de `sol-004` van como `H`).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { derivar, derivarUnidad, esDeHoras } from "../src/core/derivados.ts"
import { entornoTemporal, maestrosDeFixture, paqueteDe } from "../test-utils/fixtures.ts"
import { proveedorPorNit } from "../src/core/maestros.ts"

const maestros = maestrosDeFixture()
const reglas = entornoTemporal("reto03-derivados").reglas

test('sol-004 deriva la unidad H porque el objeto habla de horas', () => {
  const paquete = paqueteDe("sol-004")
  const unidad = derivarUnidad(paquete.solicitud, paquete.cotizacion, reglas)
  assert.equal(unidad.valor, "H")
  assert.match(unidad.motivo, /horas/)
  assert.equal(esDeHoras(paquete.solicitud.descripcion), true)
})

test('sol-001 usa la unidad por defecto (UN)', () => {
  const paquete = paqueteDe("sol-001")
  const unidad = derivarUnidad(paquete.solicitud, paquete.cotizacion, reglas)
  assert.equal(unidad.valor, "UN")
  assert.equal(esDeHoras(paquete.solicitud.descripcion), false)
})

test('sol-006 deriva IVA y condiciones del proveedor y lo declara', () => {
  const paquete = paqueteDe("sol-006")
  const proveedor = proveedorPorNit(maestros, "900555111")
  assert.ok(proveedor !== null)
  const derivaciones = derivar(proveedor, paquete.solicitud, paquete.cotizacion, reglas)

  assert.equal(derivaciones.indicador_iva, "C1")
  assert.equal(derivaciones.condiciones_pago, "Z030")
  assert.equal(derivaciones.ivaDerivadoDelProveedor, true)
  assert.equal(derivaciones.condicionDerivadaDelProveedor, true)

  const iva = derivaciones.derivados.find((d) => d.campo === "indicador_iva")
  assert.equal(iva?.codigo, "RC6")
  assert.match(iva?.origen ?? "", /maestro de proveedores/)
  const condicion = derivaciones.derivados.find((d) => d.campo === "condiciones_pago")
  assert.equal(condicion?.codigo, "RC7")
})

test('si la solicitud ya trae IVA y condiciones, no se deriva nada', () => {
  const paquete = paqueteDe("sol-001")
  const proveedor = proveedorPorNit(maestros, "900555111")
  assert.ok(proveedor !== null)
  const derivaciones = derivar(proveedor, paquete.solicitud, paquete.cotizacion, reglas)

  assert.equal(derivaciones.indicador_iva, "C1")
  assert.equal(derivaciones.condiciones_pago, "Z030")
  assert.equal(derivaciones.ivaDerivadoDelProveedor, false)
  assert.equal(derivaciones.condicionDerivadaDelProveedor, false)
  assert.equal(derivaciones.derivados.some((d) => d.campo === "indicador_iva"), false)
  assert.equal(derivaciones.derivados.some((d) => d.campo === "condiciones_pago"), false)
})

test('siempre queda declarada la unidad, aunque sea la de por defecto', () => {
  const paquete = paqueteDe("sol-001")
  const proveedor = proveedorPorNit(maestros, "900555111")
  assert.ok(proveedor !== null)
  const derivaciones = derivar(proveedor, paquete.solicitud, paquete.cotizacion, reglas)
  const unidad = derivaciones.derivados.find((d) => d.campo === "unidad")
  assert.equal(unidad?.valor, "UN")
  assert.ok((unidad?.detalle ?? "").length > 10)
})
