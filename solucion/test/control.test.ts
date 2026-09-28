/**
 * Pruebas del log de control (`out/control.csv`, PRD §4 · RC8).
 *
 * Es el archivo que consume contabilidad, así que lo que se fija es su forma:
 * una fila por solicitud, la cabecera una sola vez, la **marca de retroactiva**
 * (lo que la dirección quiere medir) y que el CSV se pueda volver a leer sin
 * perder campos con comas.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import {
  CABECERAS_CONTROL,
  codigosDeExcepcion,
  filaDeControl,
  registrarControl,
  valoresDeFila,
  type EstadoControl,
} from "../src/core/control.ts"
import { validar } from "../src/core/controles.ts"
import { leerCsv } from "../src/core/csv.ts"
import type { Maestros, Paquete, Reglas, Validacion } from "../src/core/tipos.ts"
import { entornoTemporal, maestrosDeFixture, paqueteDe } from "../test-utils/fixtures.ts"

const maestros: Maestros = maestrosDeFixture()
const reglas: Reglas = entornoTemporal("reto03-control").reglas

/** Valida un caso del fixture. */
function validacionDe(caso: string): Validacion {
  return validar(maestros, paqueteDe(caso), reglas)
}

/** Arma la fila de control de un caso, como lo hará `oc_crear`. */
function filaDe(caso: string, estado: EstadoControl = "creada", numeroOc = "4500000001") {
  const paquete: Paquete = paqueteDe(caso)
  const validacion = validacionDe(caso)
  return filaDeControl({
    caso,
    solicitudId: paquete.solicitud.solicitud_id,
    numeroOc,
    proveedor: paquete.solicitud.proveedor_nombre,
    nit: paquete.solicitud.proveedor_nit ?? "",
    centroCosto: paquete.solicitud.centro_costo,
    subarea: paquete.solicitud.subarea,
    valor: paquete.solicitud.valor_total,
    moneda: paquete.solicitud.moneda,
    aprobador: paquete.aprobacion?.de ?? "",
    validacion,
    estado,
    fechaProceso: "2026-09-03",
  })
}

test('la cabecera tiene los 14 campos del log de control, en orden', () => {
  assert.equal(CABECERAS_CONTROL.length, 14)
  assert.equal(CABECERAS_CONTROL[0], "fecha_proceso")
  assert.equal(CABECERAS_CONTROL[13], "estado")
  assert.equal(valoresDeFila(filaDe("sol-001")).length, CABECERAS_CONTROL.length)
})

test('la primera fila escribe la cabecera y la segunda se anexa', () => {
  const entorno = entornoTemporal("reto03-control-dos")
  const primera = registrarControl(entorno.escritor, filaDe("sol-001"))
  assert.equal(primera.ok, true)
  const segunda = registrarControl(entorno.escritor, filaDe("sol-005", "pendiente_confirmacion", ""))
  assert.equal(segunda.ok, true)

  const texto = fs.readFileSync(entorno.control, "utf8")
  const leido = leerCsv(texto)
  assert.ok(leido !== null)
  assert.deepEqual(leido.cabeceras, [...CABECERAS_CONTROL])
  assert.equal(leido.filas.length, 2)
  assert.equal(leido.filas[0]?.[1], "sol-001")
  assert.equal(leido.filas[1]?.[1], "sol-005")
})

test('la fila de sol-005 queda marcada como retroactiva (O4)', () => {
  const fila = filaDe("sol-005", "pendiente_confirmacion", "")
  assert.equal(fila.retroactiva, "si")
  assert.equal(fila.estado, "pendiente_confirmacion")
  assert.equal(filaDe("sol-001").retroactiva, "no")
})

test('las excepciones de la fila unen confirmaciones y derivados', () => {
  assert.equal(codigosDeExcepcion(validacionDe("sol-001")), "")
  assert.equal(codigosDeExcepcion(validacionDe("sol-004")), "RC5")
  const sol006 = codigosDeExcepcion(validacionDe("sol-006"))
  assert.ok(sol006.includes("RC6"))
  assert.ok(sol006.includes("RC7"))
})

test('una fila bloqueada se registra con su estado y sin número de OC', () => {
  const fila = filaDe("sol-002", "bloqueada", "")
  assert.equal(fila.estado, "bloqueada")
  assert.equal(fila.numero_oc, "")
  assert.equal(fila.excepciones, "")
})

test('un campo con comas sobrevive al ida y vuelta del CSV', () => {
  const entorno = entornoTemporal("reto03-control-tres")
  const base = filaDe("sol-001")
  const conComas = { ...base, proveedor: "Compras, Servicios Generales\nS.A.S." }
  registrarControl(entorno.escritor, conComas)

  const leido = leerCsv(fs.readFileSync(entorno.control, "utf8"))
  assert.ok(leido !== null)
  assert.equal(leido.filas[0]?.[4], "Compras, Servicios Generales\nS.A.S.")
})
