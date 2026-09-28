/**
 * Front y archivos servidos por HTTP (PRD §6.1).
 *
 * El front del chat llega en **F4**. Hasta entonces, `GET /` no devuelve un 404
 * (que parece una instalación rota) sino una página mínima que explica dónde está
 * la API y cómo probarla con `curl`. Cuando `web/` exista, se sirve tal cual.
 */
import fastifyStatic from "@fastify/static"
import fs from "node:fs"
import path from "node:path"
import type { FastifyInstance } from "fastify"

/** Página provisional mientras el front no esté en el repositorio. */
function paginaProvisional(): string {
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Agente de órdenes de compra · API</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 3rem auto; max-width: 42rem; line-height: 1.5; padding: 0 1rem; }
      code { background: #f3f3f3; padding: .1rem .3rem; border-radius: 3px; }
      pre { background: #f3f3f3; padding: .8rem; overflow-x: auto; border-radius: 6px; }
    </style>
  </head>
  <body>
    <h1>Agente de órdenes de compra</h1>
    <p>La API está en pie. El front del chat se publica en la siguiente entrega (F4).</p>
    <ul>
      <li><code>GET /api/health</code> · proveedor, herramientas y topes</li>
      <li><code>GET /api/sessions</code> · conversaciones guardadas</li>
      <li><code>GET /api/sessions/:id</code> · una conversación completa</li>
      <li><code>POST /api/chat</code> · <code>{ "sessionId": "…", "message": "procesa sol-004" }</code> (SSE; añade <code>?json=1</code> para una respuesta única)</li>
    </ul>
    <pre>curl -s localhost:3000/api/health
curl -s "localhost:3000/api/chat?json=1" -H 'content-type: application/json' \\
  -d '{"sessionId":"demo","message":"procesa sol-004"}'</pre>
  </body>
</html>
`
}

/**
 * Monta el front: `web/` si está en el repositorio, o la página provisional.
 * También sirve los archivos de `out/` bajo `/out/` cuando el front los pida, pero
 * solo si la carpeta existe (en el arranque puede no estar todavía).
 */
export async function montarFront(app: FastifyInstance, directorio: string): Promise<void> {
  const web = path.join(directorio, "web")
  if (fs.existsSync(web)) {
    await app.register(fastifyStatic, { root: web, prefix: "/" })
    return
  }

  app.get("/", async (_peticion, reply) => {
    return reply.type("text/html; charset=utf-8").send(paginaProvisional())
  })
}
