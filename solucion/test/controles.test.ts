/**
 * Pruebas de las reglas de control RC1–RC10 (PRD §7.3).
 *
 * Lo primero es el **contrato de los seis casos**: qué bloquea y qué pide
 * confirmación en cada uno, porque de eso depende el resto del reto (O1–O4). Lo
 * segundo son los **bordes** de cada regla, que es donde una regla se rompe sin
 * que nadie lo note: el 2 % exacto de RC5, el tope justo de RC3, la tolerancia
 * de una unidad de RC10 y la aprobación el mismo día de RC9.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { validar } from "../src/core/controles.ts"
import type { Maestros, Paquete, Reglas, Validacion } from "../src/core/tipos.ts"
import { entornoTemporal, maestrosDeFixture, paqueteDe } from "../test-utils/fixtures.ts"

const maestros: Maestros = maestrosDeFixture()
const reglas: Reglas = entornoTemporal("reto03-controles").reglas

/** Valida un caso del fixture. */
function validarCaso(caso: string): Validacion {
  return validar(maestros, paqueteDe(caso), reglas)
}

/** Clona el paquete de `sol-001` y le cambia lo que se le pida (casos sintéticos). */
function sintetico(
  cambios: Partial<Paquete>,
  solicitud: Partial<Paquete["solicitud"]> = {},
): Validacion {
  const base = paqueteDe("sol-001")
  return validar(maestros, { ...base, ...cambios, solicitud: { ...base.solicitud, ...solicitud } }, reglas)
}

/** ¿Aparece la regla entre los bloqueos o entre las confirmaciones? */
function tiene(resultado: Validacion, codigo: string): boolean {
  return (
    resultado.bloqueos.some((h) => h.codigo === codigo) ||
    resultado.confirmaciones.some((h) => h.codigo === codigo)
  )
}

test('sol-001 es apta y sin excepciones: se crea sin intervención (O1)', () => {
  const resultado = validarCaso("sol-001")
  assert.equal(resultado.apta, true)
  assert.deepEqual(resultado.bloqueos, [])
  assert.deepEqual(resultado.confirmaciones, [])
  assert.equal(resultado.retroactiva, false)
})

test('sol-002 bloquea por RC1 y dice qué hacer', () => {
  const resultado = validarCaso("sol-002")
  assert.equal(resultado.apta, false)
  assert.deepEqual(
    resultado.bloqueos.map((h) => h.codigo),
    ["RC1"],
  )
  assert.match(resultado.bloqueos[0]?.detalle ?? "", /901999000/)
  assert.ok((resultado.bloqueos[0]?.accion_sugerida ?? "").length > 20)
})

test('sol-003 devuelve RC2 y RC3 juntas, no solo la primera (O2)', () => {
  const resultado = validarCaso("sol-003")
  assert.equal(resultado.apta, false)
  assert.deepEqual(
    resultado.bloqueos.map((h) => h.codigo).sort(),
    ["RC2", "RC3"],
  )
  const detalles = resultado.bloqueos.map((h) => h.detalle).join(" ")
  assert.match(detalles, /no es aprobador del centro CC-2020/)
  assert.match(detalles, /tope/)
  assert.match(resultado.bloqueos[0]?.accion_sugerida ?? "", /aprobadores del centro/)
})

test('sol-004 pide confirmación por RC5 con los dos valores (O3)', () => {
  const resultado = validarCaso("sol-004")
  assert.equal(resultado.apta, true)
  assert.deepEqual(
    resultado.confirmaciones.map((h) => h.codigo),
    ["RC5"],
  )
  const detalle = resultado.confirmaciones[0]?.detalle ?? ""
  assert.match(detalle, /26\.500\.000/)
  assert.match(detalle, /25\.000\.000/)
  assert.match(detalle, /6\.00 %/)
})

test('sol-005 es retroactiva y pide confirmación por RC8 (O4)', () => {
  const resultado = validarCaso("sol-005")
  assert.equal(resultado.retroactiva, true)
  assert.deepEqual(
    resultado.confirmaciones.map((h) => h.codigo),
    ["RC8"],
  )
  const detalle = resultado.confirmaciones[0]?.detalle ?? ""
  assert.match(detalle, /FC-88231/)
  assert.match(detalle, /2026-08-10/)
})

test('sol-006 pide confirmar el IVA derivado (RC6) y no bloquea (O3)', () => {
  const resultado = validarCaso("sol-006")
  assert.equal(resultado.apta, true)
  assert.deepEqual(resultado.bloqueos, [])
  assert.deepEqual(
    resultado.confirmaciones.map((h) => h.codigo),
    ["RC6"],
  )
  assert.match(resultado.confirmaciones[0]?.detalle ?? "", /C1/)
})

test('sol-006 declara sus derivados (IVA, condiciones y unidad)', () => {
  const campos = validarCaso("sol-006").derivados.map((d) => d.campo)
  assert.ok(campos.includes("indicador_iva"))
  assert.ok(campos.includes("condiciones_pago"))
  assert.ok(campos.includes("unidad"))
})

test('un proveedor inactivo bloquea aunque todo lo demás esté bien (RC1)', () => {
  const resultado = sintetico(
    {},
    { proveedor_nit: "901777888", proveedor_nombre: "Consultores Ágiles S.A.S." },
  )
  assert.equal(resultado.apta, false)
  assert.match(resultado.bloqueos[0]?.detalle ?? "", /inactivo/)
})

test('el valor por encima del tope del aprobador bloquea (RC3)', () => {
  const dentro = sintetico({}, { cantidad: 1, valor_unitario: 50_000_000, valor_total: 50_000_000 })
  assert.equal(tiene(dentro, "RC3"), false, "el tope justo no bloquea")
  const fuera = sintetico({}, { cantidad: 1, valor_unitario: 50_000_001, valor_total: 50_000_001 })
  assert.equal(tiene(fuera, "RC3"), true, "un peso más ya bloquea")
})

test('RC10 tolera una unidad monetaria y bloquea con dos', () => {
  const uno = sintetico({}, { valor_total: 11_400_001 })
  assert.equal(tiene(uno, "RC10"), false)
  const dos = sintetico({}, { valor_total: 11_400_002 })
  assert.equal(tiene(dos, "RC10"), true)
  assert.match(dos.bloqueos.find((h) => h.codigo === "RC10")?.detalle ?? "", /11\.400\.000/)
})

test('RC5 no pide confirmación justo en el 2 % y sí por encima', () => {
  const cotizacion = paqueteDe("sol-001").cotizacion
  assert.ok(cotizacion !== null)
  const borde = sintetico({ cotizacion: { ...cotizacion, total: 11_628_000 } })
  assert.equal(tiene(borde, "RC5"), false, "2,00 % entra dentro de la tolerancia")
  const pasado = sintetico({ cotizacion: { ...cotizacion, total: 11_628_001 } })
  assert.equal(tiene(pasado, "RC5"), true, "2,0001 % ya pide confirmación")
})

test('sin cotización, RC5 también pide confirmación', () => {
  const resultado = sintetico({ cotizacion: null })
  assert.equal(tiene(resultado, "RC5"), true)
  assert.match(
    resultado.confirmaciones.find((h) => h.codigo === "RC5")?.detalle ?? "",
    /no hay una cotización legible/,
  )
})

test('una subárea que no es del centro bloquea (RC4)', () => {
  const resultado = sintetico({}, { subarea: "Marketing" })
  assert.equal(resultado.apta, false)
  assert.match(
    resultado.bloqueos.find((h) => h.codigo === "RC4")?.detalle ?? "",
    /no pertenece a CC-1010/,
  )
})

test('un centro de costo desconocido bloquea y lista los del maestro (RC4)', () => {
  const resultado = sintetico({}, { centro_costo: "CC-9999" })
  const hallazgo = resultado.bloqueos.find((h) => h.codigo === "RC4")
  assert.match(hallazgo?.detalle ?? "", /no está en el maestro/)
  assert.match(hallazgo?.accion_sugerida ?? "", /CC-1010/)
})

test('si no hay aprobación es bloqueo, no confirmación (RC2)', () => {
  const resultado = sintetico({ aprobacion: null })
  assert.equal(resultado.apta, false)
  assert.equal(tiene(resultado, "RC2"), true)
})

test('una aprobación sin la palabra clave bloquea (RC2)', () => {
  const aprobacion = paqueteDe("sol-001").aprobacion
  assert.ok(aprobacion !== null)
  const resultado = sintetico({ aprobacion: { ...aprobacion, aprobado: false } })
  assert.equal(resultado.apta, false)
  assert.match(resultado.bloqueos[0]?.detalle ?? "", /no aprueba el gasto/)
})

test('una aprobación anterior a la solicitud pide confirmación (RC9)', () => {
  const aprobacion = paqueteDe("sol-001").aprobacion
  assert.ok(aprobacion !== null)
  const resultado = sintetico({ aprobacion: { ...aprobacion, fecha: "2026-08-01" } })
  assert.equal(resultado.apta, true)
  assert.deepEqual(
    resultado.confirmaciones.map((h) => h.codigo),
    ["RC9"],
  )
})

test('la aprobación el mismo día de la solicitud no pide confirmación', () => {
  const aprobacion = paqueteDe("sol-001").aprobacion
  assert.ok(aprobacion !== null)
  const resultado = sintetico(
    { aprobacion: { ...aprobacion, fecha: "2026-08-20" } },
    { fecha_solicitud: "2026-08-20" },
  )
  assert.equal(tiene(resultado, "RC9"), false)
})

