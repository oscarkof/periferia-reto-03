/**
 * Pruebas de los maestros (PRD §7.1).
 *
 * Aquí se fija la resolución de identidades, que es la base de RC1: el mismo
 * proveedor con NIT escrito de tres formas distintas, con nombre sin forma
 * societaria, y el caso del proveedor **inactivo** —que existe y aun así no
 * puede usarse—.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import {
  aprobadorDe,
  apruebaSubarea,
  cargarMaestros,
  centroDe,
  condicionDe,
  indicadorDe,
  proveedorPorNit,
  proveedorPorNombre,
  resolverProveedor,
} from "../src/core/maestros.ts"
import { FIXTURES, dirTemporal, maestrosDeFixture } from "../test-utils/fixtures.ts"

test('los cuatro maestros se cargan con todos sus registros', () => {
  const maestros = maestrosDeFixture()
  assert.equal(maestros.proveedores.length, 5)
  assert.equal(maestros.centros.length, 3)
  assert.equal(maestros.indicadoresIva.length, 3)
  assert.equal(maestros.condicionesPago.length, 4)
})

test('proveedorPorNit reconoce el NIT con y sin dígito de verificación', () => {
  const maestros = maestrosDeFixture()
  const porNit = proveedorPorNit(maestros, "900555111")
  assert.equal(porNit?.codigo_sap, "100234")
  const conPuntos = proveedorPorNit(maestros, "900.555.111-2")
  assert.equal(conPuntos?.codigo_sap, "100234")
})

test('proveedorPorNit devuelve null si el NIT no está', () => {
  assert.equal(proveedorPorNit(maestrosDeFixture(), "901999000"), null)
})

test('proveedorPorNombre ignora forma societaria, acentos y mayúsculas', () => {
  const maestros = maestrosDeFixture()
  assert.equal(proveedorPorNombre(maestros, "TecnoSuministros S.A.S.")?.codigo_sap, "100234")
  assert.equal(proveedorPorNombre(maestros, "tecnosuministros")?.codigo_sap, "100234")
  assert.equal(proveedorPorNombre(maestros, "PAPELERÍA CENTRAL LTDA.")?.codigo_sap, "100118")
  assert.equal(proveedorPorNombre(maestros, "Proveedor Fantasma S.A.S."), null)
})

test('resolverProveedor prefiere el NIT y cae al nombre cuando no lo hay (RC1)', () => {
  const maestros = maestrosDeFixture()
  const conNit = resolverProveedor(maestros, { nit: "901222333", nombre: "Otro nombre" })
  assert.equal(conNit?.nombre, "Cloud Andina S.A.S.")
  const sinNit = resolverProveedor(maestros, { nombre: "TecnoSuministros S.A.S." })
  assert.equal(sinNit?.codigo_sap, "100234")
  const inexistente = resolverProveedor(maestros, { nit: "901999000", nombre: "TecnoSuministros S.A.S." })
  assert.equal(inexistente, null, "con NIT informado que no existe, no se cae al nombre")
})

test('el proveedor inactivo se carga marcado y el activo también', () => {
  const maestros = maestrosDeFixture()
  const inactivo = proveedorPorNit(maestros, "901777888")
  assert.equal(inactivo?.activo, false)
  assert.equal(proveedorPorNit(maestros, "800444555")?.activo, true)
})

test('centroDe y apruebaSubarea validan el centro y su subárea (RC4)', () => {
  const maestros = maestrosDeFixture()
  const centro = centroDe(maestros, "cc-1010")
  assert.equal(centro?.nombre, "Tecnología")
  assert.equal(apruebaSubarea(centro ?? { centro_costo: "", nombre: "", subareas: [], aprobadores: [] }, "Soporte"), true)
  assert.equal(apruebaSubarea(centro ?? { centro_costo: "", nombre: "", subareas: [], aprobadores: [] }, "Marketing"), false)
  assert.equal(centroDe(maestros, "CC-9999"), null)
})

test('aprobadorDe solo reconoce a los aprobadores de ese centro (RC2)', () => {
  const maestros = maestrosDeFixture()
  const tecnologia = centroDe(maestros, "CC-1010")
  const administracion = centroDe(maestros, "CC-2020")
  assert.ok(tecnologia !== null && administracion !== null)
  assert.equal(aprobadorDe(tecnologia, "mlopez@periferia-ficticia.com")?.tope, 50_000_000)
  assert.equal(aprobadorDe(tecnologia, "MLOPEZ@PERIFERIA-FICTICIA.COM")?.nombre, "Mariana López Cárdenas")
  assert.equal(aprobadorDe(administracion, "fvargas@periferia-ficticia.com"), null)
})

test('condicionDe e indicadorDe resuelven los códigos del payload', () => {
  const maestros = maestrosDeFixture()
  assert.equal(condicionDe(maestros, "Z030")?.dias, 30)
  assert.equal(condicionDe(maestros, "z000")?.descripcion, "Pago inmediato")
  assert.equal(indicadorDe(maestros, "C1")?.tasa, 0.19)
  assert.equal(indicadorDe(maestros, "C2")?.tasa, 0.05)
  assert.equal(condicionDe(maestros, "Z999"), null)
})

test('un maestro malformado se reporta con el nombre del archivo', () => {
  const temporal = dirTemporal("reto03-maestros")
  fs.mkdirSync(path.join(temporal, "maestros"), { recursive: true })
  for (const maestro of ["centros-costo", "indicadores-iva", "condiciones-pago"]) {
    fs.copyFileSync(
      path.join(FIXTURES, "maestros", `${maestro}.json`),
      path.join(temporal, "maestros", `${maestro}.json`),
    )
  }
  fs.writeFileSync(
    path.join(temporal, "maestros", "proveedores.json"),
    JSON.stringify([{ codigo_sap: 100234, nit: "900555111" }]),
    "utf8",
  )

  const anterior = process.env["FIXTURES_DIR"]
  process.env["FIXTURES_DIR"] = temporal
  try {
    const cargados = cargarMaestros()
    assert.equal(cargados.ok, false)
    if (!cargados.ok) assert.match(cargados.error, /proveedores\.json/)
  } finally {
    if (anterior === undefined) delete process.env["FIXTURES_DIR"]
    else process.env["FIXTURES_DIR"] = anterior
  }
})
