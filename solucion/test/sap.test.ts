/**
 * Pruebas del SAP simulado (PRD §7.4).
 *
 * Aquí se fija lo que hace que la demo sea repetible y que un reintento sea
 * seguro: la **numeración correlativa** desde `4500000001`, la **idempotencia por
 * referencia** (el índice `out/sap/indice.json`) y que el adaptador **se niegue**
 * a crear dos veces la misma orden o un payload que no cumple el contrato.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { ErrorSap } from "../src/sap/adapter.ts"
import { NUMERO_INICIAL, crearSapSimulado, type SapSimulado } from "../src/sap/mock.ts"
import { contextoDe, validar } from "../src/core/controles.ts"
import { construirPayload } from "../src/core/payload.ts"
import type { OrdenCompra } from "../src/core/tipos.ts"
import {
  PROVEEDORES,
  dirTemporal,
  entornoTemporal,
  maestrosDeFixture,
  paqueteDe,
} from "../test-utils/fixtures.ts"

const maestros = maestrosDeFixture()
const entorno = entornoTemporal("reto03-sap")

/** Simulador nuevo sobre una carpeta temporal y con reloj fijo. */
function sapTemporal(prefijo: string): SapSimulado {
  return crearSapSimulado({
    raiz: path.join(dirTemporal(prefijo), "sap"),
    proveedores: PROVEEDORES,
    ahora: () => new Date("2026-09-03T12:00:00Z"),
  })
}

/** Payload real de un caso, como lo construye el motor. */
function payloadDe(caso: string, confirmadoPor: string | null = null): OrdenCompra {
  const paquete = paqueteDe(caso)
  const validacion = validar(maestros, paquete, entorno.reglas)
  const contexto = contextoDe(maestros, paquete, entorno.reglas)
  if (contexto.proveedor === null) throw new Error(`${caso} sin proveedor`)
  const construido = construirPayload({
    paquete,
    proveedor: contexto.proveedor,
    derivaciones: contexto.derivaciones,
    validacion,
    reglas: entorno.reglas,
    confirmadoPor,
  })
  if (!construido.ok) throw new Error(`payload de ${caso}: ${construido.error}`)
  return construido.data.orden
}

test('la primera orden sale con el número inicial y la fecha del reloj', async () => {
  const sap = sapTemporal("reto03-sap-uno")
  const creada = await sap.crearOrden(payloadDe("sol-001"))
  assert.equal(creada.numero_oc, String(NUMERO_INICIAL))
  assert.equal(creada.fecha, "2026-09-03")
  assert.equal(sap.indice()["SOL-2026-001"], creada.numero_oc)
})

test('la orden queda guardada con su payload completo', async () => {
  const sap = sapTemporal("reto03-sap-dos")
  const creada = await sap.crearOrden(payloadDe("sol-001"))
  const guardada = sap.orden(creada.numero_oc)
  assert.ok(guardada !== null)
  assert.equal(guardada.referencia.solicitud_id, "SOL-2026-001")
  assert.equal(guardada.posiciones.length, 1)
  assert.equal(guardada.aprobador.evidencia_sha256.length, 64)
})

test('la segunda orden usa el siguiente número correlativo', async () => {
  const sap = sapTemporal("reto03-sap-tres")
  const primera = await sap.crearOrden(payloadDe("sol-001"))
  const segunda = await sap.crearOrden(payloadDe("sol-005", "compras@periferia-ficticia.com"))
  assert.equal(primera.numero_oc, "4500000001")
  assert.equal(segunda.numero_oc, "4500000002")
})

test('buscarOrdenPorReferencia encuentra la orden y devuelve null si no existe', async () => {
  const sap = sapTemporal("reto03-sap-cuatro")
  assert.equal(await sap.buscarOrdenPorReferencia("SOL-2026-001"), null)
  const creada = await sap.crearOrden(payloadDe("sol-001"))
  const encontrada = await sap.buscarOrdenPorReferencia("SOL-2026-001")
  assert.equal(encontrada?.numero_oc, creada.numero_oc)
  assert.equal(await sap.buscarOrdenPorReferencia("SOL-2026-999"), null)
})

test('crear dos veces la misma solicitud lanza ErrorSap (idempotencia)', async () => {
  const sap = sapTemporal("reto03-sap-cinco")
  const orden = payloadDe("sol-001")
  await sap.crearOrden(orden)
  await assert.rejects(
    () => sap.crearOrden(orden),
    (error: unknown) => {
      assert.ok(error instanceof ErrorSap)
      assert.match(error.message, /ya tiene la orden/)
      return true
    },
  )
  assert.equal(Object.keys(sap.indice()).length, 1, "el índice queda con una sola orden")
})

test('consultarProveedor resuelve por NIT y distingue el inactivo', async () => {
  const sap = sapTemporal("reto03-sap-seis")
  const activo = await sap.consultarProveedor("900.555.111-2")
  assert.equal(activo?.codigo_sap, "100234")
  assert.equal(activo?.activo, true)
  const inactivo = await sap.consultarProveedor("901777888")
  assert.equal(inactivo?.activo, false)
  assert.equal(await sap.consultarProveedor("000000000"), null)
})

test('un payload que no cumple el contrato se rechaza con ErrorSap', async () => {
  const sap = sapTemporal("reto03-sap-siete")
  const roto = { referencia: { solicitud_id: "SOL-1" } } as unknown as OrdenCompra
  await assert.rejects(
    () => sap.crearOrden(roto),
    (error: unknown) => {
      assert.ok(error instanceof ErrorSap)
      assert.match(error.message, /contrato/)
      return true
    },
  )
})
