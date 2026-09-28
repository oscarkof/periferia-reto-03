/**
 * Pruebas del payload de la OC (PRD §7.4) y de la evidencia de aprobación.
 *
 * Lo que se fija aquí es el contrato con SAP: que el payload salga **validado con
 * `zod`**, que la posición tome los valores de la solicitud, que la huella de la
 * evidencia viaje dentro, que las excepciones lleven a quien confirmó y que con
 * bloqueos sin resolver no se construya nada.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { EsquemaOrdenCompra, construirPayload } from "../src/core/payload.ts"
import { generarEvidencia, huellaEvidencia, textoEvidencia } from "../src/core/evidencia.ts"
import { contextoDe, validar } from "../src/core/controles.ts"
import { entornoTemporal, maestrosDeFixture, paqueteDe } from "../test-utils/fixtures.ts"

const maestros = maestrosDeFixture()
const entorno = entornoTemporal("reto03-payload")

/** Proveedor de relleno: `sol-002` bloquea precisamente porque no existe uno. */
const PROVEEDOR_RELLENO = {
  codigo_sap: "0",
  nit: "0",
  nombre: "sin proveedor en el maestro",
  condiciones_pago_default: "Z000",
  indicador_iva_default: "C0",
  activo: true,
}

/** Construye el payload como lo hará la herramienta `oc_construir_payload`. */
function payloadDe(caso: string, confirmadoPor: string | null = null, solicitud = {}) {
  const paquete = paqueteDe(caso)
  const ajustado = { ...paquete, solicitud: { ...paquete.solicitud, ...solicitud } }
  const validacion = validar(maestros, paquete, entorno.reglas)
  const contexto = contextoDe(maestros, paquete, entorno.reglas)
  return construirPayload({
    paquete: ajustado,
    proveedor: contexto.proveedor ?? PROVEEDOR_RELLENO,
    derivaciones: contexto.derivaciones,
    validacion,
    reglas: entorno.reglas,
    confirmadoPor,
  })
}

test('el payload de sol-001 cumple el contrato de SAP', () => {
  const construido = payloadDe("sol-001")
  assert.equal(construido.ok, true)
  if (!construido.ok) return

  const { orden } = construido.data
  assert.equal(EsquemaOrdenCompra.safeParse(orden).success, true)
  assert.equal(orden.referencia.solicitud_id, "SOL-2026-001")
  assert.equal(orden.referencia.correo_id, "sol-001-correo")
  assert.equal(orden.referencia.cotizacion_ref, "COT-TS-2026-0451")
  assert.equal(orden.sociedad, "1000")
  assert.equal(orden.organizacion_compras, "1000")
  assert.equal(orden.moneda, "COP")
  assert.equal(orden.condiciones_pago, "Z030")
  assert.equal(orden.proveedor.codigo_sap, "100234")
  assert.equal(orden.posiciones.length, 1)
  assert.equal(orden.posiciones[0]?.numero, 10)
  assert.equal(orden.posiciones[0]?.cantidad, 120)
  assert.equal(orden.posiciones[0]?.precio_unitario, 95_000)
  assert.equal(orden.posiciones[0]?.centro_costo, "CC-1010")
  assert.equal(orden.posiciones[0]?.subarea, "Infraestructura")
  assert.equal(orden.posiciones[0]?.indicador_iva, "C1")
  // La única excepción de un caso limpio es el recorte del texto breve: no hay
  // confirmaciones ni valores derivados que faltaran.
  assert.deepEqual(
    orden.excepciones.map((e) => e.codigo),
    ["TEXTO_RECORTADO"],
  )
})

test('un caso sin recorte no arrastra ninguna excepción', () => {
  const construido = payloadDe("sol-001", null, { descripcion: "Licencias antivirus" })
  assert.equal(construido.ok, true)
  if (!construido.ok) return
  assert.deepEqual(construido.data.orden.excepciones, [])
})

test('la descripción se recorta al límite de SAP y el recorte se informa', () => {
  const construido = payloadDe("sol-001")
  assert.equal(construido.ok, true)
  if (!construido.ok) return
  const posicion = construido.data.orden.posiciones[0]
  assert.ok(posicion !== undefined)
  assert.ok(posicion.descripcion.length <= entorno.reglas.maxTextoPosicion)
  const recorte = construido.data.orden.excepciones.find((e) => e.codigo === "TEXTO_RECORTADO")
  assert.ok(recorte !== undefined, "el recorte queda declarado")
  assert.equal(recorte.confirmado_por, null)
})

test('la huella de la evidencia es la del correo normalizado y viaja en el payload', () => {
  const paquete = paqueteDe("sol-004")
  assert.ok(paquete.aprobacion !== null)
  const huella = huellaEvidencia(paquete.aprobacion)
  assert.match(huella, /^[0-9a-f]{64}$/)
  assert.equal(huella, huellaEvidencia(paquete.aprobacion), "es estable entre llamadas")

  const construido = payloadDe("sol-004")
  assert.equal(construido.ok, true)
  if (!construido.ok) return
  assert.equal(construido.data.orden.aprobador.evidencia_sha256, huella)
  assert.equal(construido.data.orden.aprobador.email, paquete.aprobacion.de)
  assert.equal(construido.data.orden.aprobador.fecha_aprobacion, paquete.aprobacion.fecha)
})

test('el texto de la evidencia dice quién aprobó y qué dijo', () => {
  const paquete = paqueteDe("sol-001")
  assert.ok(paquete.aprobacion !== null)
  const texto = textoEvidencia(paquete.aprobacion)
  assert.match(texto, /^EVIDENCIA DE APROBACIÓN/)
  assert.match(texto, /Aprobado: sí/)
  assert.match(texto, /mlopez@periferia-ficticia\.com/)
})

test('la evidencia se escribe en out/evidencia y devuelve ruta y huella', () => {
  const paquete = paqueteDe("sol-004")
  assert.ok(paquete.aprobacion !== null)
  const generada = generarEvidencia(entorno.escritor, "sol-004", paquete.aprobacion)
  assert.equal(generada.ok, true)
  if (!generada.ok) return
  assert.equal(generada.data.ruta, `${entorno.evidencia}/sol-004-aprobacion.txt`)
  assert.equal(fs.readFileSync(generada.data.ruta, "utf8"), textoEvidencia(paquete.aprobacion))
  assert.equal(generada.data.sha256, huellaEvidencia(paquete.aprobacion))
})

test('las excepciones confirmadas llevan a quien confirmó (RC5 en sol-004)', () => {
  const construido = payloadDe("sol-004", "compras@periferia-ficticia.com")
  assert.equal(construido.ok, true)
  if (!construido.ok) return
  const excepcion = construido.data.orden.excepciones.find((e) => e.codigo === "RC5")
  assert.ok(excepcion !== undefined)
  assert.equal(excepcion.confirmado_por, "compras@periferia-ficticia.com")
})

test('los derivados informativos viajan como excepción sin confirmar (RC7)', () => {
  const construido = payloadDe("sol-006", "compras@periferia-ficticia.com")
  assert.equal(construido.ok, true)
  if (!construido.ok) return
  const derivadas = construido.data.orden.excepciones.filter((e) => e.codigo === "RC7")
  assert.ok(derivadas.length >= 1)
  assert.ok(derivadas.every((e) => e.confirmado_por === null))
  const confirmada = construido.data.orden.excepciones.find((e) => e.codigo === "RC6")
  assert.equal(confirmada?.confirmado_por, "compras@periferia-ficticia.com")
})

test('con bloqueos sin resolver no se construye payload', () => {
  const construido = payloadDe("sol-002")
  assert.equal(construido.ok, false)
  if (!construido.ok) assert.match(construido.error, /RC1/)
})

test('una moneda fuera del contrato se rechaza con un mensaje claro', () => {
  const paquete = paqueteDe("sol-001")
  const validacion = validar(maestros, paquete, entorno.reglas)
  const contexto = contextoDe(maestros, paquete, entorno.reglas)
  assert.ok(contexto.proveedor !== null)
  const construido = construirPayload({
    paquete: { ...paquete, solicitud: { ...paquete.solicitud, moneda: "EUR" } },
    proveedor: contexto.proveedor,
    derivaciones: contexto.derivaciones,
    validacion,
    reglas: entorno.reglas,
    confirmadoPor: null,
  })
  assert.equal(construido.ok, false)
  if (!construido.ok) assert.match(construido.error, /COP o USD/)
})

test('la trazabilidad dice de dónde salió cada valor', () => {
  const construido = payloadDe("sol-006")
  assert.equal(construido.ok, true)
  if (!construido.ok) return
  const iva = construido.data.trazabilidad.find((t) => t.campo === "posiciones[0].indicador_iva")
  assert.equal(iva?.valor, "C1")
  assert.match(iva?.origen ?? "", /maestro de proveedores/)
  const cantidad = construido.data.trazabilidad.find((t) => t.campo === "posiciones[0].cantidad")
  assert.equal(cantidad?.origen, "solicitud.json")
  assert.ok(construido.data.trazabilidad.length >= 15)
})

