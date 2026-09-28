# Reto 03 · Agente conversacional «Órdenes de Compra SAP»

> Periferia IT Group · Equipo Perxia 2.0
> TypeScript sobre Node 24 · front estático sin build · `granite4.1:8b` en Ollama local · Docker opcional
> El agente prepara, valida y crea la OC. **Lo que no cumple control no se crea: se explica.**

Este README es el documento maestro del entregable: cómo levantarlo, **con qué está hecho y por qué**,
cómo se eligió el modelo, **qué hace cada archivo del repositorio**, cómo se corre `demo.ts` y qué queda
fuera del alcance. El detalle de diseño está en [`solucion/docs/arquitectura.md`](solucion/docs/arquitectura.md)
y las decisiones de repositorio en [`solucion/docs/repo-setup.md`](solucion/docs/repo-setup.md).

## Qué hace este agente

Automatiza la **preparación y creación de órdenes de compra en SAP**: lee el paquete que llega por correo
(solicitud, cotización del proveedor y correo de aprobación del líder), **lo valida contra los maestros**
—proveedores, centros de costo, matriz de aprobación, indicadores de IVA y condiciones de pago—, construye
el **payload de la OC** con la forma que espera SAP, genera el **PDF/txt de evidencia de aprobación** y crea
la orden en un **SAP simulado**, dejando el log de control para contabilidad.

**Lo que no cumple control no se crea a la fuerza**: se clasifica en **bloqueo** (RC1–RC4, RC10) o
**confirmación** (RC5, RC6, RC8, RC9) y se devuelve al humano con la razón y la acción sugerida. Y **el
modelo no calcula valores**: los montos, los códigos y el payload salen de código determinista a partir del
documento y los maestros; el modelo conversa, elige herramientas y explica. Una OC **retroactiva** —creada
después de que llegó la factura, el desvío que la dirección quiere medir— se crea solo con confirmación y
queda **marcada** en el log de control.

## Cómo leer esta entrega

| Documento | Qué cuenta |
|---|---|
| **`README.md`** (este) | Cómo levantarlo, con qué está hecho y por qué, el modelo elegido con sus mediciones, y **qué hace cada archivo** |
| [`SOLUCION.md`](SOLUCION.md) | El planteamiento completo (12 secciones del PRD §9.1), con la **matriz de controles RC1–RC10** y el **diseño del adaptador SAP real** (PRD §7.5) |
| [`solucion/docs/`](solucion/docs/) | El detalle por tema: la arquitectura por dentro y la puesta en marcha del repositorio |
| [`solucion/demo.ts`](solucion/demo.ts) | Los **seis casos** del fixture procesados sin modelo y sin claves, con idempotencia y confirmación |
| [`PRD.md`](PRD.md) | El enunciado original de Periferia: la referencia de los números de sección que cita todo el código |

| Quiero… | Sección |
|---|---|
| Levantarlo y verlo funcionando | [1. Arranque](#1-arranque-un-comando) |
| Saber el stack y por qué cada pieza | [2. Stack](#2-stack-con-qué-está-hecho-y-por-qué) |
| Entender la elección del modelo, con números | [3. El modelo](#3-el-modelo-elección-mediciones-y-costo) |
| Saber qué hace cada archivo | [4. Estructura](#4-estructura-del-repositorio-archivo-por-archivo) |
| Ver la arquitectura en un diagrama navegable | [`solucion/docs/diagramas/arquitectura-reto03.html`](solucion/docs/diagramas/arquitectura-reto03.html) |
| Ver las herramientas sin modelo | [5. `demo.ts`](#5-demots-las-herramientas-sin-modelo) |
| Correr las pruebas | [6. Pruebas](#6-pruebas-automáticas) |
| Configurar el entorno | [7. Variables de entorno](#7-variables-de-entorno) |
| Probar la aplicación en línea | [8. Link de prueba](#8-link-de-prueba) |
| Saber qué quedó fuera del alcance | [9. Limitaciones](#9-qué-queda-fuera-limitaciones-declaradas) |

---

## 0. Estado del entregable

Este reto se construye por fases; el historial de commits las sigue una a una. Hoy el repositorio está en
**F4 (front de chat)**: están el `PRD.md` y los **29 fixtures** tal como los entregó Periferia, la estructura
del repositorio, los dos `.gitignore` verificados, el `.env.example`, el README y los dos documentos de
diseño —y, encima, **`src/core/`** (12 módulos deterministas: lectura del paquete, maestros, **RC1–RC10**,
derivados, payload validado con `zod`, evidencia y log de control), **`src/sap/`** (la interfaz `SapAdapter`
del PRD y el simulador con idempotencia), **`src/tools/` + `demo.ts`** (las cinco herramientas `oc_*` con su
contrato `{ ok, data | error }` y el recorrido de los 6 casos sin modelo), **`src/agent/` + `src/llm/` +
`src/server.ts`** (el ciclo del agente con sus topes, tres proveedores tras una interfaz —`ollama`, `openai`,
`mock`—, el comportamiento en `agent/prompt.md`, el conocimiento del proceso en `src/knowledge/` y la API con
SSE) y **`web/`** (el chat sin build: historial, tarjetas de herramienta, banda de confirmación y descargas).
**144 pruebas en verde y `typecheck` sin errores.** Faltan el despliegue con `SOLUCION.md` (F5) y el módulo
reutilizable (F6).

| Fase | Feature | Rama | Qué entrega | Estado |
|---|---|---|---|---|
| **F0** | `setup` | `main` | Repositorio, `.gitignore`, `out/.gitkeep`, `.env.example`, arquitectura y README | ✅ **hecho** |
| **F1** | `core` | `f01-core` | `src/core/` (paquete, maestros, **RC1–RC10**, derivados, payload, evidencia, control) + `src/sap/` (interfaz y simulado) con **88 pruebas** | ✅ **hecho** |
| **F2** | `tools` | `f02-tools` | `src/tools/` (las cinco `oc_*` + contrato y auditoría) y `demo.ts` con el recorrido de los 6 casos | ✅ **hecho** |
| **F3** | `agente-llm-api` | `f03-agente-llm-api` | `src/agent/` (ciclo, sesión, confirmación, eventos), `src/llm/` (ollama/openai/mock), `src/server/` + API con SSE, `agent/prompt.md` y `src/knowledge/` · **136 pruebas** | ✅ **hecho** |
| **F4** | `web` | `f04-web` | `web/` (chat sin build: historial, tarjetas de herramienta, banda de confirmación, descargas), `api/files` confinado a `out/` y **8 pruebas que ejecutan el front** · **144 pruebas** | ✅ **hecho** |
| **F5** | `deploy-solucion` | `f05-deploy` | Docker, `SOLUCION.md` (12 secciones) y publicación del link | ⏳ |
| **F6** | `modulo` (bonus) | `f06-modulo` | Agente empaquetado reutilizable + test de paridad con la app | ⏳ |

Cada fase es **una feature con nombre propio**, y ese nombre es el mismo de la rama y del mensaje de
commit (`feat(core)`, `feat(sap)`, `feat(tools)`, `feat(agent)`, `feat(web)`, `feat(deploy)`…). El árbol
completo, con los mensajes de commit previstos y el criterio de salida de cada fase, está en
[`solucion/docs/repo-setup.md`](solucion/docs/repo-setup.md) §5.

---

## 1. Arranque

**En local** (lo que existe a partir de F1):

```bash
cd reto-03/solucion
npm install
npm run dev          # front de chat + API en http://127.0.0.1:3000
```

**La vía rápida, sin instalar nada** (Docker, el «un comando» del PRD §8, llega en F5):

```bash
cd reto-03
docker compose up --build     # front + API en http://127.0.0.1:3000
```

### Qué funciona hoy y qué llega con cada fase

| Comando | Hoy | Llega en |
|---|---|---|
| `npm install` | ✅ funciona (94 paquetes) | — |
| `npm run typecheck` | ✅ **0 errores**, cero `any` | — |
| `npm test` | ✅ **144 pruebas**, sin modelo y sin red | F5→F6 |
| `npm run demo` | ✅ **los 6 casos**: 1 creada, 2 bloqueadas, 3 que esperan el «sí»; con `--confirmar` se crean las 3 y `sol-001` sale idempotente | — |
| `npm run dev` | ✅ **front de chat + API** en `http://127.0.0.1:3000`; con `LLM_PROVIDER=mock` no necesita nada instalado | — |
| `docker compose up --build` | — | F5 |
| Leer la arquitectura ya decidida | ✅ | [`solucion/docs/arquitectura.md`](solucion/docs/arquitectura.md) |
| Ver el plan por fases y los mensajes de commit | ✅ | [`solucion/docs/repo-setup.md`](solucion/docs/repo-setup.md) §5 |

### Para que el agente responda de verdad hace falta un modelo

```bash
ollama pull granite4.1:8b     # 5,3 GB · máquina con ~16 GB de RAM
ollama serve                  # normalmente ya corre como servicio
```

Si Ollama corre en tu máquina y usas **Docker**, el contenedor apuntará a
`http://host.docker.internal:11434`; si copias `.env.example` a un `.env`, deja ahí ese mismo valor (un
`localhost` dentro del contenedor sería el propio contenedor, no tu máquina).

**Sin modelo también arranca**, y es lo que recomiendo para una primera mirada (desde F3):

```bash
cd reto-03/solucion && LLM_PROVIDER=mock npm run dev
```

`mock` no es un agente: es un guion que permite recorrer la pantalla completa (tarjetas de herramienta,
confirmación y archivos) sin descargar nada y sin claves.

### Requisitos

| Requisito | Versión | Nota |
|---|---|---|
| Node | **≥ 22.18** (probado en 24.19) | El PRD §0 admite Bun o Node 20+; se elige Node 24 porque ejecuta TypeScript directamente, sin compilar. `bun install && bun run demo.ts` también funciona: no hay ninguna API exclusiva de Bun |
| Ollama | opcional | Solo para el agente real; `granite4.1:8b` es el modelo del entregable |
| Docker | opcional | Probado con Docker 29.6.2 + Compose v5 (retos 01 y 02, mismo stack) |

---

## 2. Stack: con qué está hecho (y por qué)

| Capa | Elección | Por qué |
|---|---|---|
| Runtime | **Node 24** con TypeScript nativo | Ejecuta `.ts` sin compilar (borrado de tipos): un `node src/server.ts` y no hay paso de build que falle en una máquina limpia. El PRD permite Bun; este código no usa nada exclusivo |
| HTTP | **`fastify`** | Un servidor con esquemas y `inject()` para probar la API **sin abrir puertos** |
| Validación | **`zod`** (obligatorio por el PRD §8) | Los argumentos de cada herramienta se validan antes de ejecutar y los esquemas se derivan a JSON Schema para el modelo |
| Front | **HTML + CSS + módulos ES**, servido por el backend | El PRD §0 lo permite (`React, Svelte, Vue o HTML plano`); sin build, el arranque no puede romperse por una compilación y el contenedor no necesita paso de build |
| Pruebas | **`node:test`** | El runner de la plataforma: cero dependencias y `npm test` corre sin red ni modelo |
| Modelo | **Ollama local** (`granite4.1:8b`) tras una interfaz propia | Coste 0 y los datos de compras **no salen de la empresa**; cambiar de proveedor es una variable |

Nada de: base de datos (el «SAP simulado» son ficheros en `out/`, PRD §3.2), ORM, framework de front,
librería de CSV (no hay CSV de entrada; el de salida se escribe con un módulo propio y sus pruebas), ni
dependencias de cálculo de fechas (las reglas comparan fechas ISO `YYYY-MM-DD`, que `Date` de Node maneja
sin zonas horarias).


---

## 3. El modelo: elección, mediciones y costo

**`granite4.1:8b` servido por Ollama local**, detrás de la interfaz propia que pide el PRD §6.1
(`src/llm/adapter.ts` · `enviar(mensajes, herramientas)`): cambiar de modelo o de proveedor es cambiar una
variable de entorno, no tocar el ciclo del agente.

| Criterio | Por qué este modelo |
|---|---|
| Costo | 0 por caso: corre en la máquina, sin claves ni cuotas |
| Privacidad | Proveedores, montos y aprobaciones **no salen de la empresa** |
| Licencia | Apache 2.0 (IBM), sin restricciones de uso comercial |
| *Tool calling* | Verificado en los retos 01 y 02 con el mismo tipo de contrato de herramientas, incluidos los turnos de confirmación |
| Tamaño | 5,3 GB cuantizado: cabe en 16 GB de RAM junto al sistema y el KV cache |
| Dominio | Orientado a empresa (GRC, *compliance*) y con salida JSON estructurada, que es el formato del payload |

Descartados, con la razón: `qwen3:4b-instruct` (2,5 GB) **no pasa** el turno de confirmación —se niega a
ejecutar aunque el usuario haya confirmado—; `qwen3:14b` y los modelos de 30B caben a duras penas y
disparan la latencia; las APIs de pago quedan **como alternativa lista** (`openai.ts`), no como requisito.

### Mediciones

Este reto tiene **seis** herramientas (una más que el reto 02) y un conocimiento del proceso propio, así que
las cifras se **re-miden aquí** en F3 y se anotan en esta tabla; hasta entonces, lo heredado es orientativo:

| Qué | Medición |
|---|---|
| Prompt + esquemas de las herramientas | **Por medir en F3** (en el reto 02, con cinco herramientas, fueron **5 735 tokens**; por eso `OLLAMA_NUM_CTX=8192` y no el 4 096 por defecto) |
| Primera llamada del turno | **Por medir** (en el reto 02: ~32 s con el modelo frío, 3,4 s en caliente) |
| Turno de un caso con OC creada | **Por medir** (en el reto 02, un turno con 12 llamadas tardó 182,6 s) |
| El mismo recorrido con `mock` | ~20 ms: sin red, sin modelo y determinista |
| Coste con el modelo local | **0 USD** (la energía de la máquina) |
| Coste estimado con proveedor de pago | ≈ 0,005 USD/caso (0,15/0,60 USD por millón, ~14 500 tokens por turno) |

### Cómo se cambia de modelo (sin tocar código)

```bash
LLM_PROVIDER=ollama OLLAMA_MODEL=granite4.1:8b npm run dev          # por defecto
LLM_PROVIDER=openai OPENAI_API_KEY=... OPENAI_MODEL=gpt-4o-mini npm run dev
LLM_PROVIDER=mock npm run dev                                      # guion, sin modelo
```

`GET /api/health` declara en caliente qué está activo y **no expone ninguna clave**:

```bash
curl -s http://127.0.0.1:3000/api/health
# {"ok":true,"provider":"ollama","model":"granite4.1:8b","herramientas":[…]}
```

---

## 4. Estructura del repositorio, archivo por archivo

Tres clases de contenido, para que no haya dudas de qué es fuente, qué es entregado y qué es salida:

| Clase | Qué es | Se versiona |
|---|---|---|
| **Fuente** | Código, front, documentación y configuración propias | Sí |
| **Entregado por Periferia** | `PRD.md` y `fixtures/reto-03/` (**29 archivos**) | Sí, **sin modificar** |
| **Generado en ejecución** | `solucion/out/` (evidencia, `sap/`, `control.csv`, `log.jsonl`, `sessions/`) | No (`.gitignore`) |

La columna **Fase** dice cuándo existe cada archivo: **F0 ✅** ya está, el resto es el plan comprometido de
§0 y de [`solucion/docs/arquitectura.md`](solucion/docs/arquitectura.md) §10.

```
reto-03/                              ← raíz del repo y del entregable (.zip = esta carpeta)
├── PRD.md                            enunciado de Periferia
├── README.md                         este documento
├── SOLUCION.md                       planteamiento (§9.1): 12 secciones                          [F5]
├── docker-compose.yml                `docker compose up --build`                                 [F5]
├── .dockerignore                     qué NO entra en la imagen                                     [F5]
├── .gitignore                        reglas de todo el árbol                                    [F0 ✅]
├── fixtures/reto-03/                 6 casos (correo, solicitud, cotización, aprobación y la
│                                     factura del retroactivo) + 4 maestros
└── solucion/                         la aplicación
    ├── .env.example                  las 23 variables documentadas, sin valores                 [F0 ✅]
    ├── .gitignore                    lo mínimo para reutilizar esta carpeta como base           [F0 ✅]
    ├── docs/                         arquitectura.md, repo-setup.md y el diagrama navegable        [F0 ✅]
    │                                 diagramas/arquitectura-reto03.html: front → API → agente →
    │                                 herramientas → motor → SAP simulado, con cada nodo enlazado
    │                                 a la línea que lo sostiene
    ├── package.json                  dependencias, scripts y engines                            [F1 ✅]
    ├── package-lock.json             versiones exactas (sí se versiona)                         [F1 ✅]
    ├── tsconfig.json                 TypeScript estricto, sin emitir                            [F1 ✅]
    ├── demo.ts                       los 6 casos sin modelo: idempotencia y confirmación       [F2 ✅]
    ├── agent/prompt.md               comportamiento del agente (system prompt)                  [F3 ✅]
    ├── src/knowledge/                conocimiento del proceso que el agente consulta            [F3 ✅]
    │                                 (ordenes-compra.md: los maestros, RC1–RC10 y qué
    │                                 es una OC retroactiva, en lenguaje de compras)
    ├── src/core/                     12 módulos deterministas: paquete, maestros, RC1–RC10,
    │                                 derivados, payload, evidencia, control…                     [F1 ✅]
    ├── src/sap/                      interfaz SapAdapter (PRD §7.4) + simulado sobre out/sap/    [F1 ✅]
    ├── src/tools/                    contrato.ts (PRD §6.2) · auditoria.ts (CA2) · oc.ts: las
    │                                 cinco herramientas `oc_*` y la P1 declarada sin implementar   [F2 ✅]
    ├── src/demo/                     la lógica del recorrido sin modelo (recorrido.ts)          [F2 ✅]
    ├── src/agent/                    loop.ts (ciclo y topes CA1) · paso.ts (las puertas CA2/CA3)
    │                                 · sesion.ts (historial → out/sessions/) · confirmacion.ts
    │                                 · eventos.ts (lo que ve el chat) · prompt.ts                [F3 ✅]
    ├── src/llm/                      adapter.ts (la interfaz del PRD §6.1) · ollama.ts · openai.ts
    │                                 · mock.ts (guion determinista) · fabrica.ts                 [F3 ✅]
    ├── src/server.ts + src/server/   el arranque y la API: /api/chat (SSE o JSON), health…      [F3 ✅]
    ├── web/                          el chat sin build: index.html, estilos.css, sse.js (parser
    │                                 con prueba propia) y app.js (historial, tarjetas de
    │                                 herramienta, banda de confirmación y descargas)           [F4 ✅]
    ├── test-utils/                   navegador mínimo (`front.ts`): carga `web/app.js` en un
    │                                 contexto de `vm` y conecta su `fetch` al backend real       [F4 ✅]
    ├── src/llm/                      adaptadores de proveedor (ollama · openai · mock)             [F3]
    ├── src/server.ts + src/server/   API HTTP, stream SSE y front estático                         [F3]
    ├── web/                          front de chat (HTML, CSS, JS sin build)                       [F4]
    ├── test/                         pruebas automáticas: **118 en verde**                       [F1–F2 ✅]
    ├── test-utils/                   utilidades y dobles de prueba (no son pruebas)               [F1 ✅]
    └── out/                          salida generada (solo su .gitkeep se versiona)
```

---

## 5. `demo.ts`: las herramientas sin modelo (F2 ✅)

Procesa los seis casos llamando **directamente** a las herramientas —`oc_leer_paquete` → `oc_validar` →
`oc_generar_evidencia` → `oc_construir_payload` → `oc_crear`— **sin modelo, sin claves y sin red**. Es lo
primero que hay que correr para saber si el problema es el motor o el modelo:

```bash
cd reto-03/solucion
npm run demo                # primera pasada: nada confirmado por una persona
npm run demo -- --confirmar # segunda pasada: confirma lo que quedó pendiente (CA3)
```

Lo que imprime, caso por caso (PRD §6.6):

| Caso | Salida real de la demo |
|---|---|
| `sol-001` | `apta`, sin excepciones: **OC creada** (`4500000001`) con su evidencia en `out/evidencia/` |
| `sol-002` | **bloqueo RC1** (proveedor inexistente) y la acción sugerida · sin OC, fila `bloqueada` en el control |
| `sol-003` | **bloqueos RC2 y RC3** en el mismo pase (aprobador sin autoridad en ese centro **y** monto sobre el tope) · sin OC |
| `sol-004` | **confirmación RC5**: 25.000.000 frente a 26.500.000; con `--confirmar`, OC creada y la excepción **firmada** |
| `sol-005` | **confirmación RC8**: `retroactiva = true`; con confirmación, OC creada y **marcada** en `control.csv` |
| `sol-006` | **RC6** derivado del proveedor (C1) + confirmación · **RC7** informado (Z030) · OC tras confirmar |

Las tres comprobaciones que el PRD pide explícitamente, y que la demo imprime:

1. **Idempotencia** — `sol-001` se procesa en las dos pasadas y la segunda devuelve `≈ ya existía: OC
   4500000001`: no se crea otra ni se duplica su fila en `control.csv`.
2. **Una confirmación explícita** — sin `--confirmar`, `sol-004`, `sol-005` y `sol-006` quedan en
   `pendiente_confirmacion` y **no se escribe nada**: ni en SAP, ni en la evidencia, ni en el control.
3. **Una fila por solicitud** — `out/control.csv` acaba con **6 filas** (no 12) aunque el recorrido se haga
   dos veces, y `out/resumen.json` sale sin timestamps para poder comparar corridas.

`demo.ts` limpia `out/` al empezar —conservando `.gitkeep`, para que la carpeta siga versionada, y
truncando `log.jsonl`— así que dos ejecuciones consecutivas dan el mismo resultado.

---

## 6. Pruebas automáticas (F1 en adelante)

```bash
cd reto-03/solucion
npm test            # sin modelo, sin red y sin claves
npm run typecheck   # 0 errores, cero any
```

| Suite | Qué fija | Estado |
|---|---|---|
| `normalizacion.test.ts` | NIT con y sin dígito de verificación, forma societaria, fechas sin zonas horarias, importes en tres formatos, moneda y porcentajes | ✅ 12 |
| `csv.test.ts` | Comas, comillas y saltos **dentro** de un campo: el ida y vuelta no pierde nada | ✅ 7 |
| `paquete.test.ts` | Los seis casos del fixture, la cotización y la factura con sus números exactos, y el adjunto ausente → `null` + `faltantes` (HU-1) | ✅ 12 |
| `maestros.test.ts` | Proveedor por NIT y por nombre, aprobadores por centro, códigos y maestro malformado | ✅ 10 |
| `controles.test.ts` | **RC1–RC10**: el contrato de los seis casos y los bordes (2 % exacto, tope justo, ±1 unidad, aprobación el mismo día) | ✅ 18 |
| `derivados.test.ts` | RC6 y RC7: qué se deriva del proveedor, qué se pregunta y qué solo se informa; la unidad `H`/`UN` | ✅ 5 |
| `payload.test.ts` | El contrato del PRD §7.4 validado con `zod`, la huella de la evidencia, el recorte del texto breve y las excepciones firmadas | ✅ 11 |
| `sap.test.ts` | Numeración correlativa desde `4500000001`, idempotencia por referencia, proveedor inactivo y payload rechazado | ✅ 7 |
| `control.test.ts` | `out/control.csv`: cabecera, filas anexadas, marca de retroactiva y campos con comas | ✅ 6 |
| `herramientas.test.ts` | El contrato del PRD §6.2: JSON en ambos caminos, **nunca lanza**, ids raros rechazados, auditoría anti-alucinación y las dos puertas de `oc_crear` | ✅ 18 |
| `demo.test.ts` | Los 6 casos de punta a punta, la confirmación humana, que repetir la demo no duplica OC y el determinismo entre corridas | ✅ 6 |
| `escritor.test.ts` | El confinamiento a `out/` (un `../` se rechaza), la escritura atómica y `limpiar` conservando el log | ✅ 6 |
| `bucle.test.ts` | CA1–CA5 con el proveedor `mock`: topes de iteraciones y de tokens, confirmación solo con un «sí» explícito, auditoría anti-alucinación y error del proveedor sin matar la sesión | ✅ 11 |
| `api.test.ts` | Las rutas del PRD §6.4 con `inject()` (sin abrir puertos): chat en JSON y en SSE, sesiones recuperables, errores claros y ninguna respuesta con claves ni rutas del servidor | ✅ 7 |
| `front-navegador.test.ts` | `web/app.js` **ejecutándose** en un DOM mínimo contra el backend real: arranque, cinco tarjetas de herramienta, la banda de confirmación y el «sí» del botón (CA3), las descargas de `out/` y el fallo del backend en pantalla; el stream SSE llega troceado a propósito | ✅ 8 |
| `paridad-modulo.test.ts` | Que `modulo/` siga siendo las mismas piezas que usa la aplicación | F6 |

Estado: **144 pruebas en verde** y `typecheck` con 0 errores, sin modelo, sin red y sin claves; el desglose
de arriba suma 144 (118 de F1 y F2 + 11 del ciclo + 7 de la API + 8 del front). Las pruebas escriben siempre
en un `OUT_DIR` temporal, así que **nunca** tocan el `out/` del repositorio ni los fixtures. El plan
completo, suite por suite, está en [`solucion/docs/arquitectura.md`](solucion/docs/arquitectura.md) §12.

---


## 7. Variables de entorno

Ninguna tiene un valor secreto en el repositorio; todas están documentadas en
[`solucion/.env.example`](solucion/.env.example) (**23 variables**: 15 activas y 8 documentadas como
opcionales) y ninguna se registra ni se devuelve por la API.

| Variable | Por defecto | Para qué |
|---|---|---|
| `LLM_PROVIDER` | `ollama` | `ollama` (local, sin claves) · `openai` (cualquier API compatible) · `mock` (guion, para demo y pruebas) |
| `OLLAMA_HOST` | `http://localhost:11434` | Dónde escucha Ollama. En Docker, `http://host.docker.internal:11434` |
| `OLLAMA_MODEL` | `granite4.1:8b` | El modelo del ciclo del agente |
| `OLLAMA_NUM_CTX` | `8192` | Ventana de contexto: con la de por defecto (4 096) la petición no cabe |
| `OLLAMA_THINK` | *(comentada)* | Razonamiento previo, solo para modelos híbridos |
| `OPENAI_API_KEY` · `OPENAI_BASE_URL` · `OPENAI_MODEL` | *(comentadas)* | Solo si `LLM_PROVIDER=openai`. La clave **nunca** entra al repositorio |
| `PORT` · `HOST` | `3000` · `127.0.0.1` | Servidor HTTP. En Docker, `HOST=0.0.0.0` |
| `FIXTURES_DIR` | *(vacío → `../fixtures/reto-03`)* | Dónde están los datos entregados por Periferia |
| `OUT_DIR` | *(vacío → `./out`)* | Dónde escribe el agente (evidencia, `sap/`, `control.csv`, `log.jsonl`, sesiones) |
| `FECHA_EJECUCION` | `2026-09-03` | Fecha de referencia: sin ella, RC8 y RC9 darían resultados distintos cada día |
| `TOLERANCIA_RC5_PCT` | `2` | Diferencia máxima entre cotización y solicitud antes de pedir confirmación |
| `TOLERANCIA_RC10_ABS` | `1` | Tolerancia de `cantidad × valor_unitario` frente a `valor_total` |
| `UNIDAD_DEFAULT` | `UN` | Unidad de la posición cuando el texto del contrato no habla de horas (`H`) |
| `MAX_TEXTO_POSICION` | `40` | Límite de SAP en el texto breve: la descripción se recorta y el recorte se informa |
| `SAP_MODO` | `simulado` | `simulado` escribe en `out/sap/`; el adaptador real es **diseño** (PRD §7.5) |
| `SAP_SOCIEDAD` · `SAP_ORG_COMPRAS` | `1000` · `1000` | Constantes del payload de la OC |
| `SAP_RAIZ` | *(vacío → `<OUT_DIR>/sap`)* | Raíz del SAP simulado |
| `MAX_ITERACIONES` | `25` | Tope de iteraciones herramienta → modelo por turno (CA1) |
| `MAX_TOKENS_SESION` | `200000` | Tope de gasto por sesión: un usuario no puede gastar la clave sin límite |
| `LLM_TIMEOUT_MS` | `180000` | Timeout del proveedor: al agotarse, error legible y la sesión sigue viva (CA5) |
| `USUARIO_ANALISTA` | `compras@periferia-ficticia.com` | Correo de quien confirma en el chat (CA3): es el que firma las excepciones, y sale de la sesión —nunca del modelo— |

---

## 8. Link de prueba

> **Pendiente de publicar: llega en F5.** El PRD §9.3 pide una URL pública activa durante la defensa y
> admite, si el despliegue no fuera posible, correrlo en local con una penalización de −10. En F5 se
> documentarán las vías (túnel a la máquina —lo único que conserva el modelo local—, Render/Railway/Fly.io
> o Azure) con sus comandos, igual que se hizo en el reto 02.

**Clave de acceso:** no aplica. El backend no expone ninguna clave de modelo (`/api/health` solo dice el
proveedor y el modelo), así que un link público no filtraría credenciales.

---

## 9. Qué queda fuera (limitaciones declaradas)

1. **El link público llega en F5** (§8). El PRD §9.3 admite probarlo en local durante la defensa, con −10.
2. **Sin conexión real a SAP**: el adaptador es una interfaz y el simulador escribe ficheros en `out/`. El
   diseño de la integración real (OData, BAPI, Integration Suite o carga por archivo) es documentación
   obligatoria y vive en `SOLUCION.md` §6.
3. **Sin lectura de binarios**: los fixtures entregan la solicitud normalizada a JSON y la cotización como
   texto (PRD §7.1). La sexta herramienta (`oc_leer_excel`, P1 opcional) queda **declarada y no
   implementada**: leer `.xlsx` exigiría una dependencia nueva para un requisito opcional, y el flujo real
   llega ya normalizado. Está anotado también en `src/tools/oc.ts`.
4. **Recepción de mercancía, registro de factura y pago**: fuera del alcance (PRD §2.3). La factura solo se
   mira para detectar el caso retroactivo.
5. **El SAP simulado no soporta concurrencia**: dos procesos escribiendo `out/sap/` a la vez no están
   soportados; la escritura es atómica, pero no hay *locks*.
6. **Sin autenticación, roles ni multiusuario**: el link puede ser público (PRD §6.1).
7. **La cotización se parsea con las redacciones que traen los fixtures**: un formato nuevo no se
   interpreta «a la brava», cae en confirmación humana. Es deliberado, pero es cobertura limitada.
8. **La unidad de medida se deriva** (`H` para horas, `UN` para el resto) porque el fixture no la trae; la
   derivación se informa en `excepciones`.
9. **Sin cola ni reintentos automáticos**: si el proveedor falla, el turno devuelve un error legible y la
   sesión sigue. Reintentar **sí** es seguro: la idempotencia vive en `buscarOrdenPorReferencia`.
10. **La política sobre OC retroactivas no la decide el agente**: las mide y las marca. El PRD §10 deja la
    decisión (tolerarlas con marca o rechazarlas) fuera del alcance del reto.




