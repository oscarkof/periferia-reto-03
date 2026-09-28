# Arquitectura del agente — Reto 03 «Órdenes de Compra SAP»

> Periferia IT Group · Equipo Perxia 2.0
> **Estado:** diseño cerrado en F0 (setup). El código llega en F1–F5; si algún detalle cambia al
> implementarlo, se corrige aquí en el mismo commit. Lo que describe este documento es lo que se
> construye, no una idea suelta.

Este documento responde a la pregunta «¿cómo está armado y por qué así?». El
[`README`](../../README.md) cuenta *qué es y cómo se usa*; `SOLUCION.md` —que llega en F5— contará *cómo
se pensó*, con el diseño del adaptador SAP real (PRD §7.5), la lectura del proceso y los riesgos. El
estado de cada fase está en la §0 del README.

---

## 0. Qué resuelve, en una frase

Cada compra de Periferia llega a administración como un **paquete de tres piezas** —solicitud, cotización
y correo de aprobación del líder— y hoy se digita a mano en SAP GUI; el agente **lee el paquete, lo
valida contra los maestros, construye el payload de la OC, genera la evidencia de aprobación y crea la OC
en un SAP simulado**. Lo que no cuadra **no se arregla a la fuerza**: se clasifica (bloqueo o
confirmación) y se devuelve al humano con la razón y la acción sugerida.

Dos consecuencias del diseño que sostienen todo lo demás:

1. **El modelo no calcula valores.** Digita, valida y arma el payload una capa determinista
   (`src/core/`), con las reglas RC1–RC10 del PRD §7.3. El modelo conversa, elige herramientas y explica;
   si propusiera un payload distinto del validado, la herramienta lo rechaza (CA2).
2. **Nada se crea en SAP sin que el control lo permita.** Un bloqueo detiene la creación; una
   confirmación exige un «sí» humano en el turno siguiente (CA3). Las OC retroactivas —el desvío que la
   dirección quiere medir— se crean **solo** con esa confirmación y quedan marcadas.

---

## 1. Vista general

```
   analista administrativa
            │  "procesa sol-004" · "confirmo"
            ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ FRONT (web/)  chat sin build: historial, tarjetas de herramienta, banda de     │
│               confirmación y descargas de lo generado                          │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │ POST /api/chat (SSE con cada evento del turno)
┌───────────────────────────────▼──────────────────────────────────────────────┐
│ BACKEND (src/server.ts + src/server/) · una pieza: API + front estático       │
│   ciclo del agente · sesiones · topes · stream de eventos                     │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │ ejecutarTurno(ctx, sesion, mensaje, adaptador, prompt, conocimiento)
┌───────────────────────────────▼──────────────────────────────────────────────┐
│ CICLO (src/agent/)   modelo → herramientas → modelo, con topes (CA1 · §8)     │
│   loop · paso (valida con zod y AUDITA) · confirmacion (CA3) · sesion · eventos│
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │ las seis herramientas del PRD §6.2
┌───────────────────────────────▼──────────────────────────────────────────────┐
│ HERRAMIENTAS (src/tools/oc.ts)   oc_leer_paquete · oc_validar ·              │
│   oc_construir_payload · oc_generar_evidencia · oc_crear · (oc_leer_excel P1) │
│   única superficie que el modelo puede llamar y única fuente de valores       │
└───────────────┬──────────────────────────────────────┬───────────────────────┘
                │                                      │
┌───────────────▼──────────────────────┐  ┌────────────▼────────────────────────┐
│ MOTOR DETERMINISTA (src/core/)       │  │ SAP SIMULADO (src/sap/)             │
│  paquete · maestros · RC1–RC10 ·     │  │  adapter.ts (interfaz del PRD §7.4) │
│  derivados · payload (zod) ·         │  │  mock.ts  → out/sap/ (ficheros)     │
│  evidencia (huella) · control · log  │  └────────────┬────────────────────────┘
└───────────────┬──────────────────────┘               │
   LECTURA (nunca se escribe)                    ESCRITURA (confinada a out/)
                ▼                                       ▼
  fixtures/reto-03/                          out/
    solicitudes/sol-00N/{correo,               evidencia/<caso>-aprobacion.txt
      solicitud,aprobacion}.json               sap/ordenes/<numero_oc>.json
      cotizacion.txt · factura.txt             sap/indice.json
    maestros/{proveedores,centros-costo,       control.csv · log.jsonl · sessions/
      indicadores-iva,condiciones-pago}.json
```

**Separación que el PRD §6.5 pide y que este diseño respeta:** *comportamiento* en `agent/prompt.md`,
*conocimiento* en `src/knowledge/`, *ejecución* en `src/tools/`. Cambiar una regla de negocio no toca el
servidor; cambiar el trato del agente no recompila nada.

### 1.1 Diagrama navegable

[`diagramas/arquitectura-reto03.html`](diagramas/arquitectura-reto03.html) es este mismo recorrido como HTML
autocontenido: analista → front → API → agente → herramientas → motor determinista → SAP simulado, con el
paquete del caso, los maestros, las reglas del entorno y `out/` como almacenes. Se abre con doble clic (sin
servidor ni dependencias), trae tema claro/oscuro y **cada nodo enlaza a la línea exacta que lo sostiene**
—código o documento— en la revisión `61d0eed` del repositorio: así el diagrama no puede quedarse descolgado
del código sin que se note (por ejemplo `oc_crear` apunta a `src/sap/mock.ts:101` y el motor a
`src/core/controles.ts:309`).

Se generó con la skill **archify** sobre este repositorio y pasó sus cuatro gates automáticos (`validate`,
`deliver`, `check` y `browser-check`, este último en un navegador real; los comprobantes quedan en
`.archify/`, que no se versiona):

```bash
cd reto-03
node ~/.claude/skills/archify/bin/archify.mjs finalize architecture \
  .archify/architecture-reto03-<fecha>/candidate.json \
  solucion/docs/diagramas/arquitectura-reto03.html --repo-root . --quality showcase
```

La herramienta deja un aviso **opcional** de forma: tres conexiones usan un codo más del sugerido
(`herramientas→motor`, `sap→out` y la vuelta de confirmación `agente→analista`). Es disposición, no
contenido, y se documenta en vez de esconderlo.

---

## 2. Capas: qué hace cada una y por qué está separada

| Capa | Módulos (planificados) | Qué decide | Qué **no** hace |
|---|---|---|---|
| `src/core/` | `paquete` · `maestros` · `controles` · `derivados` · `payload` · `evidencia` · `control` · `rutas` · `io` · `tipos` · `log` | Lee y **normaliza** el paquete (§7.2), aplica **RC1–RC10**, deriva lo que falta, arma y valida el payload, calcula la huella de la evidencia y escribe el log de control | No habla con el modelo ni con HTTP; no escribe fuera de `out/` |
| `src/sap/` | `adapter.ts` (la interfaz del PRD §7.4) · `mock.ts` | Crear la orden, consultar proveedor y **buscar por referencia** (idempotencia) | No valida reglas de negocio: si el payload llegó, se crea |
| `src/tools/oc.ts` | las seis herramientas | Exponer el motor con esquemas `zod` y devolver JSON | No decide nada: delega y traduce a `{ ok, data | error }` |
| `src/agent/` | `loop` · `paso` · `confirmacion` · `sesion` · `eventos` · `prompt` | El ciclo, los topes (CA1), la **auditoría** de lo que propone el modelo (CA2) y la confirmación humana (CA3) | No conoce ni un solo valor de negocio |
| `src/llm/` | `adapter` · `ollama` · `openai` · `mock` · `fabrica` | Traducir el contrato `enviar(mensajes, herramientas)` a cada proveedor | No conoce el dominio ni el payload |
| `src/server/` + `src/server.ts` | `aplicacion` · `chat` · `estaticos` · `front` · `sesiones` | API, stream SSE y front estático | Cero lógica de control |
| `web/` | `index.html` · `estilos.css` · `app.js` · `sse.js` | Pintar, mostrar cada llamada y pedir confirmación | No valida ni calcula |

Motivo de la separación, en una frase: **el control es auditable porque es una función pura sobre
ficheros**; si estuviera repartido entre el prompt, el servidor y el front, nadie podría demostrar por qué
una OC no se creó.

---

## 3. El contrato de herramientas (PRD §6.2)

Cada herramienta es un objeto con `description` (una frase precisa, lo único que el modelo lee para decidir
cuándo llamarla), `args` (esquemas `zod` con `.describe()` en cada campo) y `execute(args, ctx)` que
**devuelve siempre un string JSON** —`{ ok: true, data }` o `{ ok: false, error }`— y **nunca lanza**. El
nombre que ve el modelo es `<archivo>_<export>`: de `src/tools/oc.ts` salen `oc_leer_paquete`,
`oc_validar`, `oc_construir_payload`, `oc_generar_evidencia`, `oc_crear` y, si entra, `oc_leer_excel`.

| Herramienta | Entrada | Salida (`data`) | Prioridad |
|---|---|---|---|
| `oc_leer_paquete` | `{ caso }` | Paquete normalizado del PRD §7.2; un adjunto ausente es `null` **con el nombre de lo que falta**, no una excepción (HU-1) | P0 |
| `oc_validar` | `{ caso, paquete? }` | `{ apta, bloqueos[], confirmaciones[], derivados, retroactiva }` | P0 |
| `oc_construir_payload` | `{ caso, paquete?, derivados? }` | `OrdenCompra` del PRD §7.4 + `trazabilidad` (de dónde salió cada valor) | P0 |
| `oc_generar_evidencia` | `{ caso }` | `{ ruta, sha256 }` (txt en P0; PDF en P1) | P0 |
| `oc_crear` | `{ caso, confirmado? }` | `{ numero_oc, fecha, idempotente }` o `{ ok: false, error }` | P0 |
| `oc_leer_excel` | `{ ruta }` | `{ filas[] }` | P1 opcional |

Tres decisiones del contrato que no son obvias y conviene fijar en F0:

1. **`oc_validar` y `oc_construir_payload` aceptan un `paquete`/`derivados` opcional**, pero **no lo
   necesitan**: si no llega, el motor lo recalcula desde el fixture. Así el modelo puede encadenar
   herramientas sin acarrear objetos grandes, y la validación es la misma. Si el modelo **sí** propone un
   payload, el ciclo lo **audita contra el documento** (CA2) y, ante cualquier discrepancia, **manda el
   fixture**: se informa y se marca como excepción en vez de rechazarse en silencio.
2. **Ninguna herramienta recibe rutas absolutas.** Todas reciben el nombre del caso (`sol-00N`) o lo
   derivan; las rutas se resuelven en `src/core/rutas.ts` a partir de `ctx.directory` y se **confinan** con
   validación del id (`^sol-\d{3}$`). El id lo propone el modelo: hay que impedir `../` antes de tocar el
   disco.
3. **`oc_crear` pide `confirmado`**, pero no se fía de él: el ciclo lo **sobrescribe** según la acción
   pendiente de la sesión (CA3 · §9). Escribir en SAP es la única acción irreversible, y el permiso tiene
   que venir de una persona, no de una cadena que el modelo escriba.

---

## 4. Un turno, paso a paso (el caso `sol-004` del PRD §11)

1. La analista escribe: *«Procesa la solicitud "sol-004". Muéstrame la OC como quedaría en SAP, qué
   validaciones pasó y cuáles no, y no la crees hasta que yo lo confirme.»* → `POST /api/chat`.
2. Se carga la sesión (memoria → fichero → nueva) y se compone el mensaje de sistema:
   `agent/prompt.md` **+** `src/knowledge/ordenes-compra.md`.
3. El modelo pide `oc_leer_paquete { caso: "sol-004" }`. El ciclo valida los argumentos con `zod`, ejecuta
   y emite los eventos `llamada` y `resultado`: el front pinta la tarjeta con el resumen (proveedor, valor,
   centro de costo, si hay cotización y aprobación).
4. El modelo pide `oc_validar { caso: "sol-004" }`. El motor devuelve
   `{ apta: true, bloqueos: [], confirmaciones: [RC5 con 25.000.000 vs 26.500.000], derivados: {...},
   retroactiva: false }`.
5. Como hay **confirmación** pendiente, la herramienta devuelve `requiere_confirmacion` y el ciclo deja esa
   acción como pendiente de la sesión: el turno **termina con una pregunta explícita**
   (`needsConfirmation: true`) y la banda del front se resalta.
6. La analista responde «confirmo». `confirmacion.ts` mira el turno **inmediatamente anterior** y autoriza
   ese caso; si hubiera dicho «espera» o «revisa», no habría autorización.
7. El modelo pide `oc_generar_evidencia { caso: "sol-004" }` → se escribe
   `out/evidencia/sol-004-aprobacion.txt` (txt normalizado del correo de aprobación) y se devuelve su
   `sha256`, que es lo que viaja en el payload.
8. El modelo pide `oc_construir_payload { caso: "sol-004" }` → payload validado con `zod` + trazabilidad de
   cada valor (fixture, maestro o derivación).
9. El modelo pide `oc_crear { caso: "sol-004" }` → el ciclo fuerza `confirmado: true` (venía de la persona).
   El adaptador primero **busca por referencia** (`buscarOrdenPorReferencia("SOL-2026-004")`): si ya existe,
   devuelve `{ idempotente: true }` **sin crear nada**; si no, `crearOrden` escribe
   `out/sap/ordenes/4500000123.json`, actualiza `out/sap/indice.json` y añade la fila a `out/control.csv`.
10. El modelo cierra el turno: número de OC, ruta de la evidencia y qué excepción quedó firmada.
11. Todo el recorrido está en `out/log.jsonl` (una línea por llamada, CA4) y en
    `out/sessions/<id>.json`, así que recargar la página no pierde nada.

Si en el paso 4 hubiera aparecido un **bloqueo** (RC1–RC4 o RC10), el turno termina explicando el motivo y
la acción sugerida, y **no existe** ningún camino que llegue a `oc_crear`: la herramienta se niega a crear
lo que el motor no declaró apto.

---

## 5. Los seis casos del fixture: qué se espera de cada uno

Esta tabla es el contrato de F1 y F2 (el motor y las herramientas) y el guion de `demo.ts`.

| Caso | Qué trae | Reglas que dispara | Desenlace esperado | Objetivo |
|---|---|---|---|---|
| **sol-001** | 11.400.000 COP · TecnoSuministros (NIT en maestro, activo, Z030/C1) · CC-1010/Infraestructura · cotización idéntica · aprobado por `mlopez` (tope 50M) | Ninguna: RC1–RC10 en verde | **OC creada sin intervención humana** | O1 |
| **sol-002** | 8.500.000 COP · NIT 901999000 **que no está** en `proveedores.json` | **RC1 · bloqueo** | No se crea. Devuelve la razón y la acción sugerida («dar de alta el proveedor o corregir el NIT») | O2 |
| **sol-003** | 74.000.000 COP · CC-2020 aprobado por `fvargas`, que es aprobador de **CC-3030** | **RC2 · bloqueo** (y RC3, porque 74M supera el tope de 30M del aprobador del centro) | No se crea. Se devuelve **las dos** razones, no solo la primera | O2 |
| **sol-004** | 25.000.000 COP en la solicitud, **26.500.000** en la cotización (6 % de diferencia) · aprobado por `dgarcia` (tope 200M) | **RC5 · confirmación** con los dos valores | Se crea **solo tras el «sí»**; la excepción queda firmada en el payload y en el control | O3 |
| **sol-005** | 3.200.000 COP · **factura del 2026-08-10** anterior a la solicitud del 2026-08-27 | **RC8 · confirmación** y `retroactiva = true` | Se crea solo con confirmación y queda **marcada** en `out/control.csv` | O4 |
| **sol-006** | 5.400.000 COP · **sin `indicador_iva`**, **sin `condiciones_pago`** y **sin NIT** | **RC6** (deriva C1 del proveedor + confirmación) · **RC7** (deriva Z030, solo se informa) · **RC1** por nombre normalizado | Se crea tras confirmar el IVA derivado | O3 |

Dos derivaciones que el fixture obliga a resolver y que quedan fijadas aquí:

- **Unidad de medida.** El payload exige `UN | H | MES` y el fixture **no la trae**: se deriva `H` cuando
  el objeto habla de horas (bolsa de horas, servicios por hora — es el caso de `sol-004`) y `UN` en el
  resto. La derivación se informa en `excepciones` para que no sea una decisión invisible.
- **Referencia de cotización.** `cotizacion_ref` sale del encabezado del `.txt`
  (`COT-TS-2026-0451`, `SDN-0093`, …): es un dato que está en el documento, no una invención, y permite
  amarrar la OC con la oferta que la originó.

Lo que **no** se espera de ningún caso: que el agente «arregle» un monto para que cuadre (PRD §10). Si la
cotización y la solicitud discrepan, se muestran **los dos valores** y decide una persona.

---

## 6. Reglas de control RC1–RC10: dónde viven y qué dejan

Todas se implementan como funciones puras en `src/core/controles.ts` y `src/core/derivados.ts` sobre datos
ya cargados (`src/core/maestros.ts`). **Ninguna regla vive en el prompt**: el prompt solo explica lo que el
motor ya decidió.

| # | Tipo | Cómo se implementa | Qué ve el humano |
|---|---|---|---|
| **RC1** | **Bloqueo** | `proveedorDe(nit \|\| nombreNormalizado)` + `activo` | «El NIT 901999000 no está en el maestro de proveedores: hay que darlo de alta o corregir el NIT de la solicitud» |
| **RC2** | **Bloqueo** | `aprobadorDe(centro_costo, de)` y que el cuerpo contenga «Aprobado» | «Mariana López no es aprobador del centro CC-2020» + **quiénes sí lo son** (acción sugerida) |
| **RC3** | **Bloqueo** | `valor_total ≤ tope` del aprobador para ese centro | «74.000.000 supera el tope de 30.000.000 del aprobador para CC-2020» |
| **RC4** | **Bloqueo** | `subarea ∈ centro.subareas` | «"Servicios Generales" no pertenece a CC-3030» + las subáreas válidas |
| **RC5** | Confirmación | `abs(cotización − solicitud) / solicitud ≤ TOLERANCIA_RC5_PCT` (2 %); sin cotización también es confirmación | **Los dos valores** y el porcentaje de diferencia, para que la persona decida |
| **RC6** | Derivado + confirmación | `indicador_iva` ausente → `indicador_iva_default` del proveedor | «El IVA no venía en la solicitud; se derivó C1 (19 %) del proveedor. ¿Confirmas?» |
| **RC7** | Derivado informativo | `condiciones_pago` ausente → `condiciones_pago_default` del proveedor | Se informa en derivados; **no** se pregunta |
| **RC8** | Confirmación + marca | `factura.fecha < solicitud.fecha_solicitud` → `retroactiva = true` | «La factura FC-88231 (2026-08-10) es anterior a la solicitud (2026-08-27): es **retroactiva**» |
| **RC9** | Confirmación | `aprobacion.fecha ≥ solicitud.fecha_solicitud` | «La aprobación es anterior a la solicitud» con las dos fechas |
| **RC10** | **Bloqueo** | `abs(cantidad × valor_unitario − valor_total) ≤ TOLERANCIA_RC10_ABS` (± 1) | «120 × 95.000 = 11.400.000 ≠ 11.000.000» |

Tres reglas de composición, que es donde se decide el comportamiento observable:

1. **Los bloqueos ganan.** Si hay al menos un bloqueo, `apta = false` y el turno termina ahí: no se generan
   evidencia ni payload, y **no existe camino** hacia `oc_crear`.
2. **Se devuelven todas las razones, no la primera.** `sol-003` acumula RC2 y RC3 a propósito: la analista
   tiene que arreglar el correo de aprobación **y** enterarse de que además el monto excede el tope de ese
   centro. Devolver solo la primera razón produce tres idas y vueltas por el mismo caso.
3. **Cada confirmación queda firmada por quien confirmó.** Las excepciones que viajan en el payload llevan
   `{ codigo, detalle, confirmado_por }`: el log de control queda auditado con el correo de la sesión, no
   con un «confirmation: true» anónimo.

---

## 7. El payload y el adaptador SAP (PRD §7.4)

El payload es **el contrato con SAP** y se valida con `zod` antes de salir del agente: `referencia`,
`sociedad` y `organizacion_compras` fijos (`1000`), `proveedor` con `codigo_sap` del maestro, `moneda`
(`COP | USD`), `condiciones_pago` como código, `aprobador`, `posiciones[]` y `excepciones[]`.

Dos piezas del payload se derivan, y conviene fijarlas en F0:

- **`aprobador.evidencia_sha256`** es el `sha256` del **texto normalizado** del correo de aprobación (`de`,
  `fecha`, `asunto` y `cuerpo` con saltos normalizados). `oc_generar_evidencia` escribe el fichero y
  devuelve esa huella; `oc_construir_payload` la **recalcula con la misma función** (`huellaEvidencia()`),
  así que el payload no depende del orden en que el modelo llame a las herramientas y la huella es
  verificable por auditoría contra el fichero.
- **`posiciones[].numero`** va de 10 en 10 (10, 20, 30…), como en SAP. Hoy cada caso produce **una**
  posición; el motor ya itera sobre los ítems de la cotización, así que una oferta con varias líneas entra
  sin rediseño.

**El adaptador** (`src/sap/adapter.ts`) implementa exactamente la interfaz del PRD:

```ts
export interface SapAdapter {
  consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null>
  crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }>
  buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string } | null>
}
```

`src/sap/mock.ts` la implementa sobre `out/sap/`:

| Pieza | Decisión de diseño |
|---|---|
| **Idempotencia** | Antes de crear, **siempre** se llama a `buscarOrdenPorReferencia(solicitud_id)` contra `out/sap/indice.json`. Si ya existe, `oc_crear` devuelve `{ numero_oc, idempotente: true }` y **no** escribe nada nuevo. Es lo que permite correr `demo.ts` dos veces seguidas (PRD §6.6) y lo que hace seguro un reintento |
| **Numeración** | Consecutivo determinista desde `4500000001` (`4500000001`, `4500000002`, …): una ejecución limpia de la demo da el mismo número siempre, que es lo que pide el determinismo del PRD §8 |
| **Persistencia** | `out/sap/ordenes/<numero_oc>.json` (payload completo + metadatos de creación) y `out/sap/indice.json` (referencia → número) |
| **Errores** | `{ ok: false, error }` tipado y con lenguaje humano: un payload inválido o una referencia repetida **no** lanzan. `consultarProveedor` devuelve `null` si no lo conoce |
| **Lo que NO hace** | No valida RC1–RC10: si un payload llegó hasta aquí, el motor ya lo declaró apto. Un adaptador con reglas de negocio duplicadas es un adaptador que se desincroniza en la primera revisión de la regla |

El **diseño del adaptador real** —OData `API_PURCHASEORDER_PROCESS_SRV`, `BAPI_PO_CREATE1`, SAP Integration
Suite o carga por archivo—, con autenticación, dónde viven las credenciales, idempotencia frente a
reintentos, qué hacer con un error parcial y el **plan B** si la conexión no es viable, es documentación
obligatoria del PRD §7.5 y vive en `SOLUCION.md` §6 (F5).

---

## 8. Escritura: `out/` y sus cinco artefactos

`out/` es **todo lo generado**, y es lo que se abre en la defensa (y lo que el `.zip` no lleva: el PRD §9.5
lo excluye porque es regenerable con `demo.ts`).

| Artefacto | Ruta | Para qué |
|---|---|---|
| **Evidencia de aprobación** | `out/evidencia/<caso>-aprobacion.txt` | El txt normalizado del correo de aprobación; su `sha256` viaja en el payload. PDF en P1 |
| **OC creada (SAP simulado)** | `out/sap/ordenes/<numero_oc>.json` | El payload completo tal como quedó en SAP + metadatos de creación |
| **Índice de referencias** | `out/sap/indice.json` | `solicitud_id → numero_oc`: la idempotencia se apoya aquí |
| **Log de control** | `out/control.csv` | Una fila por solicitud procesada: caso, solicitud, OC, proveedor, centro, subárea, valor, aprobador, **retroactiva**, excepciones y estado. Es el archivo que consume contabilidad/auditoría (PRD §4) |
| **Traza y sesiones** | `out/log.jsonl` y `out/sessions/<id>.json` | Una línea por llamada a herramienta (CA4) y el historial completo de cada chat |

Dos reglas de higiene que el PRD §8 pide y que se cumplen por diseño: **`demo.ts` limpia `out/` al
empezar** (salvo `log.jsonl`, que se trunca) para que dos ejecuciones seguidas den el mismo resultado, y
**los fixtures nunca se escriben**: `src/core/rutas.ts` expone `leerFixture*` y las escrituras solo se
resuelven contra `out/`.

---

## 9. Sesiones, confirmación humana y topes (CA1–CA5)

| Regla del PRD §6.3 | Cómo se cumple |
|---|---|
| **CA1** tope de iteraciones | `MAX_ITERACIONES` (25) por turno y `MAX_TOKENS_SESION` (200 000) por sesión, aplicados **en el ciclo**, no en el prompt. Al agotar el tope de iteraciones el turno responde con lo que tiene y lo que falta; al agotar tokens, avisa y cierra |
| **CA2** el modelo no afirma valores | El prompt lo prohíbe y **el diseño lo hace innecesario**: el modelo nunca ve el payload validado ni los maestros, solo resúmenes. Si propone un payload, el ciclo lo audita contra el fixture y, ante cualquier discrepancia, **manda el documento** y lo marca como excepción |
| **CA3** confirmación humana | Hay **una acción pendiente por sesión** (caso + reglas que la piden). El turno cierra con la pregunta explícita y `needsConfirmation: true`; `confirmacion.ts` decide si el mensaje del **turno inmediatamente anterior** es un «sí» (y no un «espera» o un «revisa»). El ciclo **sobrescribe** `confirmado` en `oc_crear` según esa acción pendiente: si el modelo intenta crear sin permiso, la herramienta lo rechaza y el aviso se pinta en el chat |
| **CA4** traza visible | Cada llamada se emite como evento al front (`llamada` · `resultado`) y deja una línea en `out/log.jsonl` con `ts`, herramienta, caso, `ok` y resumen |
| **CA5** un error no mata la sesión | Ninguna herramienta lanza: devuelve `{ ok: false, error }`. Un fallo del proveedor (o su timeout, `LLM_TIMEOUT_MS`) se cuenta en el chat en lenguaje claro y el turno termina; la sesión sigue viva para el siguiente caso |

**Sesiones** en `out/sessions/<id>.json`: historial completo, tokens acumulados y la acción pendiente. Se
guardan en fichero (y no solo en memoria) porque la analista recarga la página, y porque `GET
/api/sessions/:id` es la forma de auditar un turno sin mirar los logs del servidor.

---

## 10. Mapa de archivos planificado

Cada archivo con su fase: **F0 ✅** es lo que ya existe, y el resto es el plan comprometido.

```
reto-03/                              raíz del repo y del entregable (.zip = esta carpeta)
├── PRD.md                            entregado por Periferia (no se toca)
├── README.md                         F0 ✅ · documento maestro
├── SOLUCION.md                       F5 · las 12 secciones del PRD §9.1
├── docker-compose.yml                F5 · `docker compose up --build`
├── .dockerignore                     F5 · qué no entra en la imagen
├── .gitignore                        F0 ✅ · reglas de todo el árbol
├── fixtures/reto-03/                 entregado · 29 archivos (25 de casos + 4 maestros)
└── solucion/                         la aplicación
    ├── .env.example                  F0 ✅ · las 22 variables documentadas, sin valores
    ├── .gitignore                    F0 ✅ · portabilidad de esta carpeta
    ├── docs/                         F0 ✅ · arquitectura.md y repo-setup.md
    ├── package.json · tsconfig.json  F1 · stack y contrato de calidad
    ├── demo.ts                       F2 ✅ · los 6 casos sin modelo (PRD §6.6)
    ├── agent/prompt.md               F3 · comportamiento del agente
    ├── src/knowledge/ordenes-compra.md  F3 · conocimiento del proceso
    ├── src/core/                     F1 · 12 módulos deterministas:
    │     rutas · io · tipos · paquete · maestros · controles · derivados ·
    │     payload · evidencia · control · csv · log
    ├── src/sap/adapter.ts · mock.ts  F1 · interfaz del PRD §7.4 + simulado sobre out/sap/
    ├── src/tools/                    F2 ✅ · contrato.ts (PRD §6.2), auditoria.ts (CA2) y
    │                                        oc.ts (las cinco `oc_*`; la P1 declarada sin implementar)
    ├── src/demo/                     F2 ✅ · la lógica del recorrido sin modelo
    ├── src/agent/                    F3 · ciclo, sesiones y confirmación humana
    ├── src/llm/                      F3 · adaptadores (ollama · openai · mock)
    ├── src/server.ts + src/server/   F3 · API HTTP, stream SSE y front estático
    ├── web/                          F4 · front de chat (HTML, CSS, JS sin build)
    ├── test/                         F1–F6 · pruebas automáticas (118 en verde tras F2)
    ├── test-utils/                   F1 · utilidades y dobles de prueba
    └── out/                          generado (solo su .gitkeep se versiona)
```

---

## 11. Decisiones y trade-offs (los que ya están tomados en F0)

| Decisión | Alternativa descartada | Por qué |
|---|---|---|
| **El control es código, no prompt** | Pedirle al modelo que «valide las reglas RC1–RC10» | Un bloqueo decidido por un LLM no es auditable ni reproducible: la misma OC se crearía o no según el día. Aquí el veredicto sale de una función pura sobre los maestros, y el modelo solo lo explica |
| **El fixture se copia a `out/` solo para escribir, y nunca se toca** | Escribir el resultado en `fixtures/` o mantener un «maestro» duplicado | El PRD §7.1 entrega los datos y §9.5 prohíbe `out/` en la entrega: el fixture es entrada, `out/` es salida. Una sola fuente de verdad |
| **Idempotencia por `buscarOrdenPorReferencia`, no por estado en memoria** | Llevar en memoria qué solicitudes ya se procesaron | El estado en memoria se pierde al reiniciar y no sirve si dos sesiones procesan el mismo caso. La referencia vive en SAP (o en el simulador): es el sistema de registro quien decide |
| **Front sin framework y servido por el backend** | React/Vite en un servidor aparte | Sin build no hay compilación que falle al arrancar; y un solo proceso, un solo puerto, un solo contenedor (PRD §6.1 y §8) |
| **Tres adaptadores (ollama · openai · mock), no uno** | Solo Ollama, o solo una API de pago | El `mock` es lo que permite que las pruebas y `demo.ts` corran **sin modelo, sin red y sin claves**; `openai` es el plan si mañana quieren un modelo de pago y no quieren tocar el ciclo |
| **PDF de evidencia en P1, txt en P0** | Empezar por el PDF | El `sha256` del texto normalizado es lo que da valor probatorio y no depende del renderizador; el PDF es una envoltura que se añade después sin cambiar el payload |

## 12. Plan de pruebas (sin modelo y sin red)

| Suite | Qué fija |
|---|---|
| `paquete.test.ts` | Lectura de los 6 casos: adjunto ausente → `null` con el nombre de lo que falta (HU-1); normalización del formato de cotización, aprobación y factura |
| `maestros.test.ts` | Los cuatro maestros: búsqueda por NIT y por nombre normalizado, aprobadores por centro, topes, códigos de IVA y de condiciones |
| `controles.test.ts` | **RC1–RC10**, una por una, con los casos del fixture y con casos sintéticos de cada borde (diferencia exactamente del 2 %, tope justo, `±1` unidad en RC10, aprobación el mismo día) |
| `derivados.test.ts` | RC6 y RC7: qué se deriva del proveedor, qué se pregunta y qué solo se informa |
| `payload.test.ts` | El esquema del PRD §7.4 validado con `zod`, con los dos payloads reales (`sol-001` y `sol-004`) y con payloads rotos |
| `sap.test.ts` | El simulador: numeración determinista, idempotencia, errores tipados, `out/` limpio al empezar |
| `control.test.ts` | El log de control: la fila de `sol-005` queda con `retroactiva = true` |
| `herramientas.test.ts` | El contrato del PRD §6.2: string JSON en ambos caminos, **no lanza**, ids raros rechazados, caso fuera de `out/` imposible, auditoría anti-alucinación |
| `demo.test.ts` | El recorrido completo de los 6 casos y que repetirlo no crea OC nuevas |
| `bucle.test.ts` | El ciclo: topes (CA1), confirmación solo con un «sí» (CA3), auditoría (CA2), error del proveedor (CA5) | F3 ✅ |
| `api.test.ts` | Las rutas del PRD §6.4 con `inject()`: chat JSON y SSE, sesión persistida, errores claros y ninguna respuesta con la clave | F3 ✅ |
| `front-navegador.test.ts` | `web/app.js` ejecutándose en un DOM mínimo (`test-utils/front.ts`) contra el backend real con `inject()`: arranque, tarjetas de herramienta, banda de confirmación (CA3), descargas de `out/` y fallos | F4 ✅ |
| `paridad-modulo.test.ts` | Que `modulo/` siga siendo las **mismas piezas** que usa la aplicación (F6) |

Las pruebas escriben en un `OUT_DIR` temporal: **nunca** tocan el `out/` del repositorio ni los fixtures.

---

## 13. Riesgos técnicos y cómo se mitigan

| Riesgo | Mitigación en el diseño |
|---|---|
| El modelo «arregla» un monto para que cuadre con la cotización (PRD §10) | Los montos salen de las herramientas; el ciclo **audita** lo que el modelo proponga y, ante discrepancia, manda el fixture y lo marca como excepción. El modelo nunca ve el payload validado |
| El texto de la cotización cambia de formato (proveedores distintos) | El parseo es tolerante y **todo lo que no se reconoce va a confirmación**, no a un valor por defecto silencioso; cada campo lleva su evidencia para poder revisarlo |
| La conexión real a SAP no es viable (PRD §7.5) | El adaptador es una interfaz: el simulador ya cubre el flujo completo y el **plan B** (archivo de carga masiva) se documenta en `SOLUCION.md` §6. El agente igual ahorra la digitación |
| Dos sesiones procesan el mismo caso a la vez | La idempotencia no vive en memoria: el simulador consulta `out/sap/indice.json` antes de crear. En SAP real, `buscarOrdenPorReferencia` |
| El `out/` del host arrastra corridas anteriores y confunde una demo | `demo.ts` limpia `out/` al empezar (PRD §8) y el README lo recuerda para la demo en Docker |
| Un cambio de regla (por ejemplo, el tope de RC5) obliga a tocar código | Los umbrales son variables de entorno (`TOLERANCIA_RC5_PCT`, `TOLERANCIA_RC10_ABS`, `UNIDAD_DEFAULT`, `MAX_TEXTO_POSICION`) y el conocimiento del proceso vive en `src/knowledge/` |

## 14. Fases y criterio de salida

| Fase | Contenido | Criterio de salida |
|---|---|---|
| **F0** ✅ | Setup: repositorio, `.gitignore`, `out/.gitkeep`, `.env.example`, este documento, `repo-setup.md` y el README maestro | Árbol limpio, `git status` sin nada pendiente e ignores verificados con `git add -A --dry-run` |
| **F1** ✅ | `package.json`, `tsconfig.json`, `src/core/` (12 módulos) y `src/sap/` | **Cumplido:** `npm run typecheck` en 0 y **88 pruebas en verde** con los 6 casos del fixture, los bordes de RC1–RC10, el payload validado con `zod` y el simulador idempotente |
| **F2** ✅ | `src/tools/` (`contrato.ts`, `auditoria.ts`, `oc.ts` con las cinco `oc_*`) · `src/demo/recorrido.ts` · `demo.ts` | **Cumplido:** `npm run demo` imprime los 6 casos con su desenlace (primera pasada «1 creada · 2 bloqueadas · 3 pendientes»; con `--confirmar`, «3 creadas · 1 ya existía»), `sol-001` repetido **no** crea otra OC y `out/control.csv` queda con **6 filas** (una por solicitud, no por pasada). 118 pruebas y `typecheck` en 0 |
| **F3** | `src/agent/`, `src/llm/`, `src/server*`, `agent/prompt.md` y `src/knowledge/` | El prompt del PRD §11 contra el modelo real, con las llamadas visibles y la confirmación; CA1–CA5 cubiertos |
| **F4** | `web/` | El recorrido de la demo se hace con ratón y `app.js` se prueba ejecutándose en un DOM mínimo |
| **F5** | `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `SOLUCION.md` (12 secciones) y el link | Un comando levanta todo, el contenedor queda *healthy* y `SOLUCION.md` no tiene secciones vacías |
| **F6** | `modulo/` (bonus) + `test/paridad-modulo.test.ts` | El test de paridad falla si las tres piezas divergen de la app |

## 15. Lo que este reto NO hace (declarado, no olvidado)

- **Conexión real a SAP** (RFC, OData, IDoc): se diseña, no se implementa (PRD §2.3 y §7.5).
- **Lectura de binarios** `.xlsx`/`.pdf`: los fixtures llegan normalizados a JSON y texto (PRD §7.1). El
  `oc_leer_excel` (P1 opcional) queda **declarado y no implementado**: leer `.xlsx` exigiría una dependencia
  nueva para un requisito opcional, y queda anotado en `src/tools/oc.ts` y en el README §9.
- **Recepción de mercancía, registro de factura y pago**: fuera del alcance (PRD §2.3). La factura solo se
  mira para detectar el caso retroactivo.
- **Autenticación, roles y multiusuario**: el link puede ser público (PRD §6.1).
- **Base de datos**: el «SAP simulado» escribe ficheros en `out/` (PRD §3.2).
- **Workflow de aprobación**: el líder ya aprobó por correo; el agente **verifica**, no solicita (PRD §3.2).
- **La política sobre OC retroactivas** no la decide el agente: las **mide** y las marca (PRD §10).







