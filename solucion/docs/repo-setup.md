# Puesta en marcha del repositorio Git — Reto 03

> Periferia IT Group · Equipo Perxia 2.0
> Guía ejecutable de **F0 (setup)**. Los comandos de §4 ya se ejecutaron y su resultado está verificado
> ahí mismo; si clonas el repositorio, no necesitas hacer nada.

---

## 0. Dos decisiones heredadas de los retos 01 y 02 (y re-verificadas aquí)

### 0.1 Un repositorio por reto

No es una suposición: está en el PRD de **este** reto.

| Evidencia (PRD de reto-03) | Qué implica |
|---|---|
| §9.5 — «Repositorio Git con historial de commits, o `reto-03-<apellido>.zip`» | La entrega se empaqueta por reto |
| §7.1 — los datos viven en `fixtures/reto-03/…` | Los paths embeben el número del reto |
| §9.4 — el bonus pide `modulo/tools/oc.ts` y `modulo/skill/ordenes-compra/` | El módulo es propio de este reto |
| §0 — «agente conversacional completo e **independiente**» | No comparte código con otro reto |

**Conclusión:** la raíz del repositorio es `reto-03/`. Un monorepo con los tres retos obligaría a tallar
el `.zip` y dejaría código de otro reto dentro de «su» entrega.

### 0.2 Raíz en `reto-03/`, no en `reto-03/solucion/`

| Opción | Raíz | Ventajas | Costos |
|---|---|---|---|
| **A (elegida)** | `reto-03/` | Los fixtures quedan en su sitio y **no se duplican** (el PRD §7.1 los entrega y solo se leen); el `.zip` es exactamente esta carpeta | La app vive en `solucion/`, así que resuelve los datos con una constante documentada: `FIXTURES_DIR`, por defecto `../fixtures/reto-03` |
| B | `reto-03/solucion/` | Estructura plana como la del PRD §6.5 (`fixtures/` junto a `src/`) | Hay que **copiar** los 29 fixtures dentro y mantenerlos sincronizados: dos fuentes de verdad |

La ruta se resuelve **una sola vez** en código (`src/core/rutas.ts`) y se declara como supuesto en
`SOLUCION.md`. En Docker se resuelve igual sin tocar nada: el contexto de build será `reto-03/` y los
fixtures quedarán en `/fixtures/reto-03`, que es exactamente lo que espera `../fixtures/reto-03` respecto
a `/app`.

---

## 1. Archivos de control de versiones

| Archivo | Responsabilidad |
|---|---|
| `reto-03/.gitignore` | **Raíz del repo**: reglas de todo el árbol — secretos, dependencias, `out/*`, builds y cachés, logs y `*.jsonl`, cobertura, basura de SO/IDE, tooling de agentes, salida de archify, modelos locales y `*.zip` |
| `solucion/.gitignore` | **Portabilidad de la app**: solo lo mínimo para reutilizar `solucion/` como base de otro reto sin arrastrar basura. **No dupliques aquí las reglas del repo** |
| `solucion/out/.gitkeep` | Git no versiona carpetas vacías; conserva `out/` sin versionar su contenido |

### Lo que este reto añade respecto a los anteriores (y por qué)

| Regla | Motivo |
|---|---|
| `*.jsonl` ignorado | `out/log.jsonl` es una salida (CA4). Comprobado: **ningún** fixture es `.jsonl` |
| **NO** se ignora `*.json` | Los fixtures son `correo.json`, `solicitud.json`, `aprobacion.json` y los cuatro maestros |
| **NO** se ignora `*.txt` | `cotizacion.txt` y la `factura.txt` del caso retroactivo son fixtures |
| **NO** se ignora `*.csv` | El único CSV del reto (`out/control.csv`) es una salida y ya está cubierto por `out/*` |
| **NO** se ignora `*.md` | `README.md`, `SOLUCION.md`… el entregable es documental |
| Nada de `*.xlsx` | El PRD §7.1 entrega la solicitud **ya normalizada** a JSON; el Excel real es P1 opcional (PRD §2.3) |

La tentación aquí es ignorar «todos los JSON, que son datos», y es el error clásico: **los fixtures de
este reto son JSON**. Lo que se genera vive en `out/`, que ya está cubierto.

---

## 2. Qué se versiona y qué no

| Clase | Ejemplos | ¿Se versiona? |
|---|---|---|
| **Fuente propia** | `solucion/src/**`, `solucion/web/**`, `solucion/demo.ts`, `solucion/test/**`, los dos `.gitignore`, `.env.example`, `docs/`, `README.md`, `SOLUCION.md`, `Dockerfile`, `docker-compose.yml` | **Sí** |
| **Entregado por Periferia** | `PRD.md` y `fixtures/reto-03/**` (29 archivos: 25 de los 6 casos + 4 maestros) | **Sí, sin modificar** |
| **Configuración local** | `.env` | No (ignorado; `.env.example` sí) |
| **Dependencias** | `solucion/node_modules/`, `solucion/package-lock.json` | `node_modules` **no**; el lockfile **sí** |
| **Generado en ejecución** | `solucion/out/**`: evidencia, `sap/` (OC del simulador), `control.csv`, `log.jsonl`, `sessions/` | No (`out/*` ignorado; solo `out/.gitkeep`) |
| **Artefactos de entrega** | `reto-03-<apellido>.zip` | No (`*.zip` ignorado) |

---

## 3. Verificación de los ignores (no se cree, se comprueba)

Los tres comandos que se corren antes de cada commit, y lo que se espera:

```bash
git add -A --dry-run                 # la prueba fiable: lo ignorado NO debe aparecer
git check-ignore -v <ruta>           # qué regla aplica a una ruta concreta (diagnóstico)
git ls-files | grep -i env           # debe mostrar SOLO .env.example
```

Puntos que se verifican de forma explícita en este reto:

| Se comprueba | Se espera |
|---|---|
| `git add -A --dry-run` tras tocar fixtures | Los 29 fixtures **aparecen** (son entregable) |
| `git check-ignore -v fixtures/reto-03/maestros/proveedores.json` | Sin salida: **no** está ignorado |
| `git check-ignore -v solucion/out/control.csv` | La regla `out/*` del `.gitignore` de la raíz |
| `git check-ignore -v solucion/.env` | La regla `.env` (y `!.env.example` deja pasar el ejemplo) |
| `git status fixtures` tras una corrida completa | Limpio: el agente **lee** los fixtures, no los escribe |

---

## 4. Los dos commits de F0 (ya ejecutados)

| # | Mensaje | Contenido |
|---|---|---|
| 1 | `chore(baseline): PRD y fixtures entregados por Periferia, sin modificar` | `PRD.md` + `fixtures/reto-03/**` **tal cual se recibieron**. Es el primer commit para que el historial deje claro qué es nuestro y qué es entregado |
| 2 | `chore(setup): estructura del reto, .gitignore, arquitectura y README maestro` | Los dos `.gitignore`, `solucion/out/.gitkeep`, `solucion/.env.example`, `solucion/docs/arquitectura.md`, `solucion/docs/repo-setup.md` y `README.md` |

¿Por qué dos y no uno? Porque «sin tocar» es una afirmación verificable: `git log --stat` del primer
commit muestra exactamente el material recibido, y a partir del segundo empieza lo construido.

---

## 5. Árbol de features (rama → commits → qué cierra)

Seis features después de F0. Cada una es **una rama con nombre propio** y el mismo nombre en el mensaje de
commit; el número de la rama **no** lleva el reto (el repositorio ya es del reto).

| Fase | Rama | Qué entrega | Mensajes de commit previstos | Criterio de salida |
|---|---|---|---|---|
| **F0** ✅ | `main` | Repositorio, `.gitignore`, `out/.gitkeep`, `.env.example`, `docs/arquitectura.md`, `docs/repo-setup.md`, `README.md` | `chore(baseline): …` · `chore(setup): …` | `git status` limpio y los ignores verificados con `git add -A --dry-run` |
| **F1** ✅ | `f01-core` | `package.json`, `tsconfig.json`, `src/core/` (paquete, maestros, **RC1–RC10**, derivados, payload, evidencia, control) y `src/sap/` (interfaz + simulado) | `feat(core): base del proyecto, lectura del paquete y maestros` · `feat(core): reglas RC1-RC10, derivados y payload validado con zod` · `feat(sap): adaptador y simulador con idempotencia por referencia` | **Cumplido:** `typecheck` en 0 y 88 pruebas en verde |

> **F1 · el orden real de los commits.** Salieron **cuatro**, y no en el orden de arriba: primero las
> reglas y el payload (`58675a7`), después el SAP simulado (`862e0ca`), la documentación (`003a365`) y al
> final la base del proyecto (`9b9e8aa`). La base quedó la última por un `git add` mal escrito en el
> script de la fase; el contenido está completo y el `HEAD` está verde (88 pruebas, `typecheck` en 0). Si
> prefieres el árbol contado en el orden lógico, es historia local **sin publicar**:
> `git rebase -i 1a3ed6d` y sube `9b9e8aa` al primer lugar.
| **F2** ✅ | `f02-tools` | `src/tools/contrato.ts` (contrato del PRD §6.2), `src/tools/auditoria.ts` (CA2), `src/tools/oc.ts` (las cinco `oc_*`), `src/demo/recorrido.ts` y `demo.ts` | `feat(tools): las cinco herramientas oc_* con contrato zod y auditoría CA2` · `feat(demo): el recorrido de los 6 casos sin modelo, con confirmación e idempotencia` | **Cumplido:** `npm run demo` imprime los 6 casos con su desenlace, `sol-001` repetido no crea dos OC y `control.csv` queda con una fila por solicitud; 118 pruebas en verde |
| **F3** ✅ | `f03-agente-llm-api` | `src/agent/` (loop, paso, sesion, confirmacion, eventos, prompt), `src/llm/` (adapter, ollama, openai, mock, fabrica), `src/server.ts` + `src/server/` (aplicacion, chat, sesiones, memoria, estaticos, identificadores), `agent/prompt.md` y `src/knowledge/ordenes-compra.md` | `feat(agent): el ciclo del agente con CA1–CA5 en código` · `feat(llm): una interfaz y tres proveedores (ollama, openai, mock)` · `feat(api): el servidor con SSE y sesiones persistidas` · `test(agent): CA1–CA5 y el contrato HTTP con el proveedor simulado` | **Cumplido:** `npm run dev` levanta la API y un turno de `sol-004` se resuelve por HTTP (SSE o `?json=1`), con la confirmación en dos POST y la excepción firmada por la persona de la sesión; **136 pruebas en verde** y `typecheck` en 0. El agente contra `granite4.1:8b` se re-mide en F4, cuando exista el front: la suite se sostiene con el proveedor `mock` para no depender de un modelo descargado |
| **F4** ✅ | `f04-web` | `web/` (index.html, estilos.css, sse.js, app.js) + `test-utils/front.ts` + `src/server/estaticos.ts` (servido del front y **descargas confinadas a `out/`**) y `GET /api/files` | `feat(web): el chat sin build con tarjetas de herramienta y confirmación` · `feat(api): sirve el front y lo generado en out/ sin salir de la carpeta` · `test(front): el guion del chat ejecutado contra el backend real` | **Cumplido:** `npm run dev` sirve el chat, un caso se resuelve con ratón (tarjetas + banda de confirmación) y las 8 pruebas del front recorren el camino completo con el stream SSE troceado; **144 pruebas en verde** y `typecheck` en 0 |
| **F5** | `f05-deploy` | `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `SOLUCION.md` (**12 secciones** del PRD §9.1) y la publicación del link | `feat(deploy): docker compose levanta el agente en un comando` · `docs(solucion): las 12 secciones del PRD §9.1` | Un comando levanta todo; el contenedor queda *healthy*; `SOLUCION.md` sin secciones vacías |
| **F6** | `f06-modulo` | `modulo/agent.md`, `modulo/tools/oc.ts`, `modulo/skill/ordenes-compra/SKILL.md` y `test/paridad-modulo.test.ts` | `feat(modulo): agente empaquetado reutilizable` · `test(modulo): paridad con las piezas de la app` | El test de paridad **falla** si las tres piezas divergen de lo que usa la aplicación |

### Flujo de Git

`main` recibe cada fase por **PR** (o `git merge --no-ff` si se hace en local), así el merge queda visible
en el historial. F0 se construyó antes de tener remoto, en dos commits lineales.

- **Rama de trabajo**: `f0X-<feature>`, creada por el candidato.
- **Conventional Commits**, un commit por intención: `feat(core)`, `feat(sap)`, `feat(tools)`,
  `feat(agent)`, `feat(web)`, `feat(deploy)`, `feat(modulo)`, y `docs(...)` / `test(...)` / `fix(...)`
  cuando toque.

---

## 6. Remoto (lo ejecuta el candidato)

```bash
git remote add origin git@github.com:<usuario>/periferia-reto-03.git
git push -u origin main
```

El remoto es independiente del **link de prueba** del PRD §9.3: son cosas distintas (uno es el código, el
otro la app corriendo).

### Reparto de responsabilidades con el asistente de IA

El flujo está partido a propósito, y conviene dejarlo escrito porque **es parte del entregable** (el PRD §0
pide declarar cómo se construyó):

| Acción | Quién |
|---|---|
| `git add` + `git commit` en la rama de trabajo (Conventional Commits, un commit por intención) | **Asistente de IA** |
| Verificación antes de commitear: `git add -A --dry-run`, `git status`, `npm test`, `npm run typecheck` | **Asistente de IA** |
| Crear la rama de la fase | **Candidato** |
| `git fetch`, `git pull`, `git push`, abrir el PR, mezclarlo | **Candidato** |
| Cambiar de rama | **Candidato** |

Motivo: el asistente no tiene —ni debe tener— permiso para escribir en el remoto, y el historial que se
publica es una decisión del candidato. En la práctica: **el asistente commitea y para**, y entrega los
comandos de Git que le tocan al candidato listos para copiar.

---

## 7. Checklist de seguridad antes de cada push

Lo corre el **asistente antes de commitear** (equivalente) y el **candidato antes de publicar**:

- [ ] `git ls-files | grep -i env` muestra **solo** `.env.example`
- [ ] Ningún diff contiene una clave (`git diff --cached` antes de cada commit)
- [ ] `node_modules/`, `out/`, `.env` y `*.jsonl` no aparecen en `git ls-files`
- [ ] `fixtures/` sin modificaciones (`git status fixtures` → limpio; el PRD los entrega, no se tocan)
- [ ] Los **29 fixtures** siguen versionados (`git ls-files fixtures | wc -l`)
- [ ] Ninguna respuesta de la API ni log contiene la clave del modelo (PRD §8)
- [ ] El `.zip` de entrega no incluye `node_modules/`, `out/` ni `.env`

---

## 8. Plan del entregable (lo que la rúbrica va a buscar)

| Entregable | Dónde | Fase |
|---|---|---|
| Las **12 secciones** del PRD §9.1: problema, arquitectura, ciclo, modelo, **matriz de controles RC1–RC10**, **diseño del adaptador SAP real (§7.5)**, lectura del proceso (retroactivas), trade-offs, supuestos, cobertura, uso de IA y riesgos | `SOLUCION.md` (raíz) | F5 |
| `README.md` con el arranque en un comando, las variables, `demo.ts` y el link | `README.md` | F0 → se actualiza hasta F5 |
| `demo.ts` que corre los 6 casos sin modelo, con idempotencia (`sol-001` dos veces) y confirmación (`sol-004`) | `solucion/demo.ts` | F2 |
| Herramientas tipadas con `zod`, importables sin el servidor | `solucion/src/tools/oc.ts` | F2 |
| Interfaz `SapAdapter` + simulado sobre ficheros | `solucion/src/sap/` | F1 |
| **Módulo reutilizable** (bonus §9.4): `agent.md` + `tools/oc.ts` + `skill/ordenes-compra/SKILL.md`, idénticos a lo que usa la app | `modulo/` + `test/paridad-modulo.test.ts` | F6 |
| Link público activo durante la defensa | README §8 | F5 |

---

## 9. Forma de entrega (PRD §9.5)

```bash
cd reto-03
zip -r ../reto-03-<apellido>.zip . -x "*/node_modules/*" -x "*/out/*" -x "*/.env" -x "*/.git/*" -x "*.DS_Store"
```

Antes de generarlo: `git status` limpio, `npm test` en verde y el link activo. `*.zip` está ignorado por
git, así que el artefacto no entra en el propio repositorio.



