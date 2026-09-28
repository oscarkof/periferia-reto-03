/**
 * Arranque del servidor (PRD §6.1 · §6.4).
 *
 * ```sh
 * npm run dev                    # con el proveedor que diga LLM_PROVIDER
 * LLM_PROVIDER=mock npm run dev  # sin modelo, con el guion determinista
 * ```
 *
 * La configuración se lee de `.env` (Node lo carga con `--env-file-if-exists`, ver
 * `package.json`). Aquí no se imprime nunca una clave ni una ruta absoluta: solo
 * el proveedor, el modelo y quién firma las confirmaciones.
 */
import path from "node:path"
import { crearAdaptador, describirProveedor, PROVEEDORES } from "./llm/fabrica.ts"
import { crearAplicacion } from "./server/aplicacion.ts"

/** Raíz del proyecto (`solucion/`): de aquí cuelgan `agent/`, `fixtures/` y `out/`. */
const RAIZ = path.resolve(import.meta.dirname, "..")

/** Correo de quien confirma en el chat cuando `USUARIO_ANALISTA` no está puesto. */
const USUARIO_DEFECTO = "compras@periferia-ficticia.com"
const PUERTO_DEFECTO = 3000
const HOST_DEFECTO = "127.0.0.1"

/** Puerto válido del entorno, o el de por defecto. */
function puerto(valor: string | undefined): number {
  const numero = Number(valor)
  return Number.isInteger(numero) && numero > 0 && numero < 65_536 ? numero : PUERTO_DEFECTO
}

const usuario = (process.env["USUARIO_ANALISTA"] ?? USUARIO_DEFECTO).trim() || USUARIO_DEFECTO
const host = process.env["HOST"] ?? HOST_DEFECTO
const puertoFinal = puerto(process.env["PORT"])

const adaptador = crearAdaptador()
if (!adaptador.ok) {
  console.error(`✖ ${adaptador.error}`)
  console.error(`  Proveedores soportados: ${PROVEEDORES.join(", ")}`)
  process.exit(1)
}

const app = await crearAplicacion({ directorio: RAIZ, adaptador: adaptador.data, usuario })
if (!app.ok) {
  console.error(`✖ ${app.error}`)
  process.exit(1)
}

const { proveedor, modelo } = describirProveedor(adaptador.data)

try {
  await app.data.listen({ port: puertoFinal, host })
} catch (error) {
  const detalle = error instanceof Error ? error.message : String(error)
  console.error(`✖ no se pudo escuchar en ${host}:${puertoFinal}: ${detalle}`)
  process.exit(1)
}

console.log(`✔ agente de órdenes de compra en http://${host}:${puertoFinal}`)
console.log(`  proveedor: ${proveedor} · modelo: ${modelo} · confirma: ${usuario}`)
if (proveedor === "ollama") {
  console.log("  (si el modelo local no está levantado, prueba: LLM_PROVIDER=mock npm run dev)")
}
