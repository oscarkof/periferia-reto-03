/**
 * Pruebas de la lectura del paquete (HU-1 · PRD §7.1 y §7.2).
 *
 * Lo que se fija: que los seis casos se interpreten **completos** (sin piezas
 * faltantes), que la cotización y la factura se lean con sus números exactos, y
 * que un adjunto ausente sea `null` con su nombre en `faltantes` —nunca una
 * excepción—, que es lo que pide HU-1.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { detectarAprobacion, leerPaquete } from "../src/core/paquete.ts"
import { CASOS, SOLICITUDES, dirTemporal, paqueteDe } from "../test-utils/fixtures.ts"

test('los seis casos del fixture se leen sin piezas faltantes', () => {
  for (const caso of CASOS) {
    const paquete = paqueteDe(caso)
    assert.equal(paquete.caso, caso)
    assert.deepEqual(paquete.faltantes, [], `${caso} no debería tener faltantes`)
  }
})

test('sol-001: cotización con referencia, fechas, total y validez', () => {
  const { cotizacion } = paqueteDe("sol-001")
  assert.ok(cotizacion !== null, "sol-001 trae cotización")
  assert.equal(cotizacion.referencia, "COT-TS-2026-0451")
  assert.equal(cotizacion.fecha, "2026-08-18")
  assert.equal(cotizacion.proveedor, "TecnoSuministros S.A.S.")
  assert.equal(cotizacion.nit, "900.555.111-2")
  assert.equal(cotizacion.moneda, "COP")
  assert.equal(cotizacion.total, 11_400_000)
  assert.equal(cotizacion.validez_hasta, "2026-09-17")
  assert.equal(cotizacion.items.length, 1)
  assert.equal(cotizacion.items[0]?.cantidad, 120)
  assert.equal(cotizacion.items[0]?.precio_unitario, 95_000)
  assert.equal(cotizacion.items[0]?.subtotal, 11_400_000)
})

test('sol-004: la cotización difiere de la solicitud (lo detectará RC5)', () => {
  const paquete = paqueteDe("sol-004")
  assert.equal(paquete.solicitud.valor_total, 25_000_000)
  assert.equal(paquete.cotizacion?.total, 26_500_000)
})

test('sol-005: la factura se interpreta con número, fecha y total', () => {
  const { factura } = paqueteDe("sol-005")
  assert.ok(factura !== null, "sol-005 es el caso retroactivo")
  assert.equal(factura.numero, "FC-88231")
  assert.equal(factura.fecha, "2026-08-10")
  assert.equal(factura.total, 3_200_000)
})

test('los demás casos no traen factura', () => {
  for (const caso of ["sol-001", "sol-002", "sol-003", "sol-004", "sol-006"]) {
    assert.equal(paqueteDe(caso).factura, null, `${caso} no debería traer factura`)
  }
})

test('sol-006 viene sin NIT, sin IVA y sin condiciones de pago', () => {
  const { solicitud } = paqueteDe("sol-006")
  assert.equal(solicitud.proveedor_nit, undefined)
  assert.equal(solicitud.indicador_iva, undefined)
  assert.equal(solicitud.condiciones_pago, undefined)
})

test('la aprobación se detecta por el cuerpo del correo y es conservadora', () => {
  assert.equal(detectarAprobacion("Aprobado, proceder con la orden de compra."), true)
  assert.equal(detectarAprobacion("APROBADO"), true)
  assert.equal(detectarAprobacion("No aprobado, falta el soporte."), false)
  assert.equal(detectarAprobacion("Desaprobado por presupuesto"), false)
  assert.equal(detectarAprobacion("Rechazado, volver a cotizar"), false)
  assert.equal(detectarAprobacion("Revisemos mañana"), false)
})

test('las aprobaciones del fixture vienen aprobadas y con fecha', () => {
  for (const caso of CASOS) {
    const aprobacion = paqueteDe(caso).aprobacion
    assert.ok(aprobacion !== null, `${caso} trae aprobación`)
    assert.equal(aprobacion.aprobado, true)
    assert.match(aprobacion.fecha, /^\d{4}-\d{2}-\d{2}$/)
  }
})

test('un adjunto ausente es null y se nombra en faltantes (HU-1)', () => {
  const temporal = dirTemporal("reto03-paquete")
  const caso = path.join(temporal, "sol-001")
  fs.mkdirSync(caso, { recursive: true })
  fs.copyFileSync(path.join(SOLICITUDES, "sol-001", "correo.json"), path.join(caso, "correo.json"))
  fs.copyFileSync(
    path.join(SOLICITUDES, "sol-001", "solicitud.json"),
    path.join(caso, "solicitud.json"),
  )

  const leido = leerPaquete("sol-001", temporal)
  assert.ok(leido.ok, "sin cotización ni aprobación el paquete se lee igual")
  assert.equal(leido.data.cotizacion, null)
  assert.equal(leido.data.aprobacion, null)
  assert.equal(leido.data.faltantes.length, 2)
  assert.ok(leido.data.faltantes.some((f) => f.includes("cotización")))
  assert.ok(leido.data.faltantes.some((f) => f.includes("aprobación")))
})

test('sin solicitud no hay paquete: error legible, no una traza', () => {
  const temporal = dirTemporal("reto03-paquete")
  const caso = path.join(temporal, "sol-002")
  fs.mkdirSync(caso, { recursive: true })
  fs.copyFileSync(path.join(SOLICITUDES, "sol-002", "correo.json"), path.join(caso, "correo.json"))

  const leido = leerPaquete("sol-002", temporal)
  assert.equal(leido.ok, false)
  if (!leido.ok) assert.match(leido.error, /solicitud\.json/)
})

test('un caso que no existe se rechaza con un mensaje que dice dónde se buscó', () => {
  const leido = leerPaquete("sol-999", SOLICITUDES)
  assert.equal(leido.ok, false)
  if (!leido.ok) assert.match(leido.error, /sol-999/)
})

test('un nombre de caso con ../ no sale de la carpeta de solicitudes', () => {
  const leido = leerPaquete("../../etc", SOLICITUDES)
  assert.equal(leido.ok, false)
  if (!leido.ok) assert.match(leido.error, /fuera del directorio permitido/)
})
