#!/usr/bin/env node
/**
 * Verificación de las herramientas **sin modelo de lenguaje** (PRD §6.6).
 *
 *   npm run demo              recorre los seis casos, sin confirmar nada
 *   npm run demo -- --confirmar
 *                             segunda pasada con el «sí» humano
 *
 * Lo que demuestra, que es el punto del reto:
 *   · `sol-001` se crea sola y **repetir el recorrido no duplica la OC**
 *     (idempotencia por referencia de solicitud);
 *   · `sol-002` y `sol-003` **no** se crean, y devuelven **todas** las razones
 *     (RC1; RC2 y RC3 juntas);
 *   · `sol-004` (y `sol-005`, `sol-006`) solo se crean **después** de que una
 *     persona confirme, y `sol-005` queda marcada como retroactiva (RC8).
 *
 * Garantías del PRD §8 que el script respeta: corre sin claves de proveedor, sin
 * red y sin dependencias externas; limpia `out/` al empezar (salvo `log.jsonl`,
 * que se trunca) para que dos ejecuciones seguidas den lo mismo; y escribe
 * `out/resumen.json` **sin timestamps** para poder comparar corridas.
 */
import path from "node:path"
import { leerCsv } from "./src/core/csv.ts"
import { crearEntorno } from "./src/core/entorno.ts"
import { leerTexto } from "./src/core/io.ts"
import {
  CASOS,
  HOY_POR_DEFECTO,
  recorrer,
  type FilaRecorrido,
  type ResumenRecorrido,
} from "./src/demo/recorrido.ts"
import type { ContextoHerramienta } from "./src/tools/contrato.ts"

/** ¿Se confirmó todo lo que estaba pendiente? (`--confirmar`). */
const CONFIRMAR = process.argv.includes("--confirmar")

/** Fecha de referencia: la del prompt de ejemplo del PRD §11, no la del reloj. */
const HOY = process.env["FECHA_EJECUCION"] ?? HOY_POR_DEFECTO

/** Correo de quien confirma; es el que queda firmado en las excepciones. */
const CONFIRMADO_POR = process.env["CONFIRMADO_POR"] ?? "compras@periferia-ficticia.com"

/** Ruta relativa a `solucion/`, para que la salida se lea sin ruido. */
function relativa(ruta: string | null): string {
  return ruta === null ? "—" : path.relative(process.cwd(), ruta)
}

/** Etiqueta del desenlace de un caso, para leerlo de un vistazo. */
function marca(fila: FilaRecorrido): string {
  switch (fila.estado) {
    case "creada":
      return `✔ OC ${fila.numero_oc ?? ""}`.trim()
    case "idempotente":
      return `≈ ya existía: OC ${fila.numero_oc ?? ""}`.trim()
    case "bloqueada":
      return "✖ bloqueada (no se crea)"
    case "pendiente_confirmacion":
      return "⏳ pendiente de confirmación"
    default:
      return "✖ error"
  }
}

/** Bloque legible de un caso. */
function imprimir(fila: FilaRecorrido): void {
  console.log(`\n━━━ ${fila.caso} · ${fila.solicitud_id || "?"} · ${marca(fila)}`)
  console.log(
    `  apta: ${fila.apta ? "sí" : "no"}` +
      ` · bloqueos: ${fila.bloqueos.join(", ") || "ninguno"}` +
      ` · confirmaciones: ${fila.confirmaciones.join(", ") || "ninguna"}` +
      ` · retroactiva: ${fila.retroactiva ? "sí" : "no"}`,
  )
  if (fila.detalle !== null) console.log(`  OC como quedaría: ${fila.detalle}`)
  if (fila.excepciones.length > 0) console.log(`  excepciones: ${fila.excepciones.join("+")}`)
  if (fila.ruta_evidencia !== null) console.log(`  evidencia: ${relativa(fila.ruta_evidencia)}`)
  if (fila.ruta_orden !== null) console.log(`  orden en el simulador: ${relativa(fila.ruta_orden)}`)
  for (const faltante of fila.faltantes) console.log(`  falta en el paquete: ${faltante}`)
  for (const aviso of fila.avisos) console.log(`  aviso: ${aviso}`)
  if (fila.motivo !== null) console.log(`  motivo: ${fila.motivo}`)
}

/** Línea de totales de una pasada. */
function totales(nombre: string, resumen: ResumenRecorrido): string {
  const { conteo } = resumen
  return (
    `${nombre}: ${conteo.total} caso(s) · creadas: ${conteo.creadas} · ya existían: ${conteo.idempotentes}` +
    ` · bloqueadas: ${conteo.bloqueadas} · pendientes: ${conteo.pendientes}` +
    (conteo.errores > 0 ? ` · errores: ${conteo.errores}` : "")
  )
}

/** Enseña la forma del log de control, que es lo que consume contabilidad. */
function resumenDelControl(entorno: { escritor: { raiz: string } }): string {
  const control = leerTexto(`${entorno.escritor.raiz}/control.csv`)
  if (!control.ok) return `no se pudo leer (${control.error})`
  const csv = leerCsv(control.data)
  if (csv === null) return "sin cabecera legible"
  return `${csv.filas.length} fila(s) · ${csv.cabeceras.length} columnas (${csv.cabeceras.slice(0, 4).join(", ")}…)`
}

async function principal(): Promise<void> {
  const raiz = path.resolve(import.meta.dirname)
  const ctx: ContextoHerramienta = { directory: raiz, sessionId: "demo" }

  const entorno = crearEntorno(raiz, { sesion: "demo", hoy: HOY })
  if (!entorno.ok) {
    console.error(`No se pudo preparar el entorno: ${entorno.error}`)
    process.exitCode = 1
    return
  }

  // Dos ejecuciones seguidas tienen que dar el mismo resultado (PRD §8).
  // `.gitkeep` se conserva: git no versiona carpetas vacías y `out/` tiene que
  // existir en el repo recién clonado aunque todavía no se haya generado nada.
  const limpieza = entorno.data.escritor.limpiar([".gitkeep", "log.jsonl"])
  entorno.data.escritor.escribir("", "log.jsonl")
  console.log(
    `out/ limpiado al inicio (${limpieza.ok ? limpieza.data : "?"} entradas borradas) · ` +
      `log.jsonl truncado · fecha de referencia: ${HOY}`,
  )
  console.log(`casos: ${CASOS.join(", ")}`)

  console.log("\n═══ PRIMERA PASADA · nada confirmado por una persona ═══")
  const primera = await recorrer(ctx, { confirmar: false, confirmadoPor: CONFIRMADO_POR })
  for (const fila of primera.filas) imprimir(fila)
  console.log(`\n${totales("primera pasada", primera)}`)

  let segunda: ResumenRecorrido | null = null
  const pendientes = primera.filas
    .filter((fila) => fila.estado === "pendiente_confirmacion")
    .map((fila) => fila.caso)

  if (CONFIRMAR && pendientes.length > 0) {
    console.log(`\n═══ SEGUNDA PASADA · confirmado: true (${CONFIRMADO_POR}) ═══`)
    segunda = await recorrer(ctx, { confirmar: true, confirmadoPor: CONFIRMADO_POR })
    for (const fila of segunda.filas) imprimir(fila)
    console.log(`\n${totales("segunda pasada", segunda)}`)

    const repetida = segunda.filas.find((fila) => fila.caso === "sol-001")
    if (repetida !== undefined) {
      console.log(
        `\nidempotencia: sol-001 se volvió a procesar y devolvió «${repetida.estado}»` +
          ` con la OC ${repetida.numero_oc ?? "?"}: no se creó otra.`,
      )
    }
  } else if (pendientes.length > 0) {
    console.log(`\n(quedan pendientes de confirmación: ${pendientes.join(", ")} · vuelve a correr con --confirmar)`)
  }

  console.log(`\nout/control.csv: ${resumenDelControl(entorno.data)}`)

  const escrito = entorno.data.escritor.escribir(
    `${JSON.stringify(
      {
        hoy: HOY,
        confirmado_por: CONFIRMADO_POR,
        primera: primera.filas,
        segunda: segunda === null ? null : segunda.filas,
      },
      null,
      2,
    )}\n`,
    "resumen.json",
  )
  console.log(
    `resumen determinista: ${escrito.ok ? relativa(escrito.data) : `no se pudo escribir (${escrito.error})`}`,
  )

  if (primera.conteo.errores > 0) process.exitCode = 1
}

await principal()

