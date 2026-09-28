# syntax=docker/dockerfile:1
#
# Imagen del agente completo: front de chat + API + herramientas (PRD §9).
#
# No hay paso de build: el front es HTML/CSS/JS estático y Node ejecuta el
# TypeScript directamente (borrado de tipos nativo), así que la imagen solo
# instala dependencias de producción y copia el código.
#
# El contexto de build es la raíz del reto (`reto-03/`), no `solucion/`, porque
# la app resuelve los fixtures en `../fixtures/reto-03` (src/core/rutas.ts).
# Dejándolos en `/fixtures/reto-03`, respecto a `/app` es exactamente la ruta que
# el código espera: no hay que tocar `FIXTURES_DIR` ni duplicar los fixtures, y
# como el fixture es de solo lectura para el proceso (PRD §7.1), copiarlo es seguro.
#
#   docker build -f solucion/Dockerfile -t reto-03-agente .
#   docker run --rm -p 3000:3000 -e LLM_PROVIDER=mock reto-03-agente
#
# O el atajo, desde `reto-03/`: `docker compose up --build`.

FROM node:24-alpine

# Dentro del contenedor hay que escuchar en todas las interfaces: el valor por
# defecto de la app es 127.0.0.1, que no es alcanzable desde fuera.
# `FECHA_EJECUCION` fija la fecha de referencia: RC8 (retroactivas) y RC9
# (aprobación anterior a la solicitud) dependen de ella, y sin fecha fija el
# mismo caso daría resultados distintos cada día (PRD §8 · Determinismo).
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    FECHA_EJECUCION=2026-09-03

WORKDIR /app

# Las dependencias van primero: la capa se reutiliza mientras no cambie el
# lockfile. Solo producción (el front no se compila y TypeScript no hace falta
# en ejecución).
COPY solucion/package.json solucion/package-lock.json ./
RUN npm ci --omit=dev

# Código, front, prompt, conocimiento, documentación y fixtures. `--chown`
# porque el proceso corre como usuario sin privilegios.
COPY --chown=node:node solucion/ ./
COPY --chown=node:node fixtures/ /fixtures/

# `out/` es la salida del agente (la OC creada por el SAP simulado en
# `out/sap/`, la evidencia de aprobación, el log de control `control.csv`,
# `log.jsonl` y las sesiones). Se crea con el dueño correcto para que el usuario
# `node` escriba.
RUN mkdir -p /app/out && chown node:node /app/out

USER node

EXPOSE 3000

# Arrancar sin modelo es válido: el proveedor se resuelve al pedir un turno, no
# al escuchar. Lo que se vigila aquí es que la API y el front respondan.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "\
fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health')\
.then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.ts"]
