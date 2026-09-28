/**
 * Front del chat de órdenes de compra (PRD §6.1 · CA3 · CA4).
 *
 * Responsabilidades, y nada más:
 *   · mandar el mensaje al backend y leer su stream SSE;
 *   · mostrar el historial, **cada llamada a herramienta** —nombre, argumentos y
 *     resultado resumido— y el indicador de trabajo (CA4);
 *   · **resaltar** el turno en que el agente pide confirmación y ofrecer el «sí» y
 *     el «no» como botones (CA3);
 *   · listar y descargar lo que el motor dejó en `out/`.
 *
 * Todo lo que se pinta se construye con nodos del DOM y `textContent`: el texto
 * del modelo nunca se interpreta como HTML.
 */
import { crearAcumulador, FIN } from "./sse.js"

/** Referencias al documento, en un solo sitio. */
const dom = {
  estado: document.querySelector("#estado-servidor"),
  conversacion: document.querySelector("#conversacion"),
  pensando: document.querySelector("#pensando"),
  pensandoTexto: document.querySelector("#pensando-texto"),
  confirmacion: document.querySelector("#confirmacion"),
  confirmacionDetalle: document.querySelector("#confirmacion-detalle"),
  sugerencias: document.querySelector("#sugerencias"),
  entrada: document.querySelector("#entrada"),
  datoSesion: document.querySelector("#dato-sesion"),
  datoTurnos: document.querySelector("#dato-turnos"),
  datoUsuario: document.querySelector("#dato-usuario"),
  archivos: document.querySelector("#archivos"),
  casos: document.querySelector("#casos"),
  aviso: document.querySelector("#aviso"),
}

/** Ejemplos de mensaje: el primero es el recorrido que cuenta el README. */
const SUGERENCIAS = [
  "Procesa sol-004 y dime si se puede crear la orden de compra.",
  "Procesa sol-003: ¿por qué no se puede crear?",
  "Procesa sol-005 y confirma lo que haga falta.",
]

/**
 * Nombre legible de cada herramienta, para las tarjetas del chat.
 * La clave es el nombre que ve el modelo (`oc_*`); si aparece una herramienta
 * nueva, la tarjeta muestra su nombre tal cual y el front sigue funcionando.
 */
const ETIQUETAS = {
  oc_leer_paquete: "Leer el paquete",
  oc_validar: "Validar RC1–RC10",
  oc_construir_payload: "Armar la OC",
  oc_generar_evidencia: "Generar la evidencia",
  oc_crear: "Crear en SAP",
}

/** Estado de la sesión en curso. */
const estado = {
  sesion: nuevoIdentificador(),
  ocupado: false,
  /** Casos que el backend ve en el fixture; los pinta el panel lateral. */
  casos: [],
}

/** Identificador de sesión válido para el backend. */
function nuevoIdentificador() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
  return `web-${Date.now().toString(36)}`
}

let temporizadorAviso = null

/** Muestra un aviso flotante que se va solo. */
function avisar(texto) {
  dom.aviso.textContent = texto
  dom.aviso.hidden = false
  if (temporizadorAviso !== null) clearTimeout(temporizadorAviso)
  temporizadorAviso = setTimeout(() => {
    dom.aviso.hidden = true
  }, 8000)
}

/**
 * Quita el aviso de la pantalla ahora, sin esperar los 8 s.
 * Se llama al empezar un turno: el aviso de un problema anterior no debe quedarse
 * encima del turno nuevo. (En el reto 02, llamar a esta función sin definirla
 * rompía el turno entero; de ahí que esté arriba y con prueba.)
 */
function limpiarAviso() {
  if (temporizadorAviso !== null) {
    clearTimeout(temporizadorAviso)
    temporizadorAviso = null
  }
  dom.aviso.hidden = true
  dom.aviso.textContent = ""
}

/** Escribe texto en un nodo, sin interpretar HTML, y lo devuelve. */
function escribir(nodo, texto) {
  nodo.textContent = texto
  return nodo
}

/**
 * Pinta un texto en un contenedor: `**negrita**` y viñetas de primer nivel.
 * El resto se escribe tal cual. Nunca se usa `innerHTML`.
 */
function pintarTexto(contenedor, texto) {
  contenedor.replaceChildren()

  for (const linea of String(texto ?? "").split("\n")) {
    const recortada = linea.trim()
    if (recortada === "") continue

    const nodo = document.createElement("p")
    const vineta = /^[-*]\s+/.test(recortada)
    const cuerpo = vineta ? recortada.replace(/^[-*]\s+/, "") : recortada

    for (const pieza of cuerpo.split(/\*\*(.+?)\*\*/g)) {
      if (pieza === "") continue
      nodo.append(document.createTextNode(pieza))
    }

    if (vineta) {
      const lista = document.createElement("ul")
      lista.append(nodo)
      contenedor.append(lista)
    } else {
      contenedor.append(nodo)
    }
  }
}

/** Añade un turno a la conversación y devuelve sus nodos para ir rellenándolos. */
function agregarTurno(quien, texto) {
  const turno = document.createElement("li")
  turno.className = `turno turno--${quien}`

  const titulo = escribir(document.createElement("span"), quien === "usuario" ? "Tú" : "Agente")
  titulo.className = "turno__quien"

  const cuerpo = document.createElement("div")
  cuerpo.className = "turno__cuerpo"

  // El texto va en su propio nodo a propósito: el turno se repinta cada vez que
  // llega un trozo de respuesta, y si el texto se pintara sobre el cuerpo entero
  // borraría las tarjetas de herramienta que ya estaban en ese turno (CA4).
  const cuerpoTexto = document.createElement("div")
  cuerpoTexto.className = "turno__texto"
  if (typeof texto === "string") cuerpoTexto.textContent = texto
  cuerpo.append(cuerpoTexto)

  turno.append(titulo, cuerpo)
  dom.conversacion.append(turno)
  if (typeof turno.scrollIntoView === "function") turno.scrollIntoView({ block: "end", behavior: "smooth" })
  return { turno, cuerpo, texto: cuerpoTexto }
}

let contadorTrabajo = null
let inicioTrabajo = 0

/**
 * Muestra el indicador de trabajo, con los segundos transcurridos.
 * El contador no es decorativo: con el modelo local un turno tarda más de un
 * minuto, y sin señal de avance la pantalla parece colgada.
 */
function mostrarTrabajo(texto = "El agente está trabajando…") {
  dom.pensandoTexto.dataset["base"] = texto
  dom.pensandoTexto.textContent = `${texto} · 0 s`

  if (contadorTrabajo === null) {
    inicioTrabajo = Date.now()
    contadorTrabajo = setInterval(() => {
      const segundos = Math.round((Date.now() - inicioTrabajo) / 1000)
      dom.pensandoTexto.textContent = `${dom.pensandoTexto.dataset["base"] ?? ""} · ${segundos} s`
    }, 1000)
  }

  dom.pensando.hidden = false
}

/** Oculta el indicador y detiene el contador. */
function ocultarTrabajo() {
  if (contadorTrabajo !== null) {
    clearInterval(contadorTrabajo)
    contadorTrabajo = null
  }
  dom.pensando.hidden = true
}

/** Identificador, turnos y quién confirma en el panel lateral. */
function pintarSesion(turnos, usuario) {
  dom.datoSesion.textContent = estado.sesion
  if (typeof turnos === "number") dom.datoTurnos.textContent = String(turnos)
  if (typeof usuario === "string" && usuario !== "") dom.datoUsuario.textContent = usuario
}

/** Tarjeta de una llamada a herramienta; se rellena al llegar su resultado (CA4). */
function agregarLlamada(cuerpoDelTurno, evento) {
  let lista = cuerpoDelTurno.querySelector(".llamadas")
  if (lista === null) {
    lista = document.createElement("ul")
    lista.className = "llamadas"
    cuerpoDelTurno.append(lista)
  }

  const item = document.createElement("li")
  item.className = "llamada"
  item.dataset["herramienta"] = evento.nombre

  const nombre = document.createElement("span")
  nombre.className = "llamada__nombre"
  escribir(nombre, ETIQUETAS[evento.nombre] ?? evento.nombre)
  nombre.title = evento.nombre

  const args = document.createElement("span")
  args.className = "llamada__args"
  escribir(args, JSON.stringify(evento.argumentos ?? {}))

  const resumen = document.createElement("span")
  resumen.className = "llamada__resumen"
  escribir(resumen, "…")

  item.append(nombre, args, resumen)
  lista.append(item)
  return item
}

/** Color de la tarjeta: verde si la herramienta fue bien, rojo si falló. */
function marcarResultado(contenedor, evento) {
  contenedor.classList.add(evento.ok ? "llamada--ok" : "llamada--fallo")
  const resumen = contenedor.querySelector(".llamada__resumen")
  if (resumen !== null) escribir(resumen, `${evento.ok ? "ok" : "falló"} · ${evento.resumen}`)
}

/**
 * Muestra la banda de confirmación con lo que el agente pide (CA3).
 * Es la parte que el PRD §6.1 pide **resaltar**: mientras esté visible, la orden
 * de compra no está creada.
 */
function mostrarConfirmacion(descripcion) {
  escribir(dom.confirmacionDetalle, descripcion)
  dom.confirmacion.hidden = false
}

/** Oculta la banda de confirmación. */
function ocultarConfirmacion() {
  dom.confirmacion.hidden = true
}

/** Estado del backend, quién confirma y los casos que hay en el fixture. */
async function consultarSalud() {
  try {
    const respuesta = await fetch("/api/health")
    const datos = await respuesta.json()

    escribir(dom.estado, `${datos.proveedor} · ${datos.modelo}`)
    dom.estado.className = "insignia insignia--ok"
    pintarSesion(undefined, datos.usuario)

    estado.casos = Array.isArray(datos.casos) ? datos.casos : []
    pintarCasos()
  } catch {
    escribir(dom.estado, "Sin conexión con el backend")
    dom.estado.className = "insignia insignia--error"
    dom.casos.replaceChildren(escribir(document.createElement("li"), "No pude leer los casos del fixture."))
    avisar("No pude hablar con el backend. Revisa que el servidor esté levantado.")
  }
}

/** Botones con los casos del fixture: rellenan la entrada, no la envían solos. */
function pintarCasos() {
  dom.casos.replaceChildren()

  if (estado.casos.length === 0) {
    dom.casos.append(escribir(document.createElement("li"), "No hay casos en el fixture."))
    return
  }

  for (const caso of estado.casos) {
    const boton = escribir(document.createElement("button"), `Procesar ${caso}`)
    boton.type = "button"
    boton.className = "caso"
    boton.addEventListener("click", () => {
      dom.entrada.value = `Procesa ${caso} y dime si se puede crear la orden de compra.`
      dom.entrada.focus()
    })

    const item = document.createElement("li")
    item.append(boton)
    dom.casos.append(item)
  }
}

/** Botones con ejemplos de mensaje. */
function pintarSugerencias() {
  for (const sugerencia of SUGERENCIAS) {
    const etiqueta = sugerencia.length > 62 ? `${sugerencia.slice(0, 60)}…` : sugerencia
    const boton = escribir(document.createElement("button"), etiqueta)
    boton.type = "button"
    boton.className = "sugerencia"
    boton.title = sugerencia
    boton.addEventListener("click", () => {
      dom.entrada.value = sugerencia
      dom.entrada.focus()
    })
    dom.sugerencias.append(boton)
  }
}

/** Enlaces de descarga de lo que el motor dejó en `out/`. */
async function listarArchivos() {
  try {
    const respuesta = await fetch("/api/files")
    const datos = await respuesta.json()
    const archivos = Array.isArray(datos.archivos) ? datos.archivos : []
    dom.archivos.replaceChildren()

    if (archivos.length === 0) {
      dom.archivos.append(escribir(document.createElement("li"), "Aún no hay archivos: procesa un caso."))
      return
    }

    for (const archivo of archivos) {
      const enlace = document.createElement("a")
      enlace.className = "archivo"
      enlace.href = `/api/files/${archivo.ruta}`
      enlace.target = "_blank"
      enlace.rel = "noopener"
      escribir(enlace, `${archivo.ruta} · ${formatearBytes(archivo.bytes)}`)

      const item = document.createElement("li")
      item.append(enlace)
      dom.archivos.append(item)
    }
  } catch {
    // El panel es informativo: si falla, no interrumpe la conversación.
    dom.archivos.append(escribir(document.createElement("li"), "No pude listar `out/`."))
  }
}

/** Tamaño legible, sin decimales innecesarios. */
function formatearBytes(bytes) {
  if (typeof bytes !== "number") return ""
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} kB`
}

/**
 * Manda un turno y va pintando el stream.
 *
 * Se usa `fetch` con lector de stream y no `EventSource` porque hace falta POST
 * con cuerpo; el troceado lo resuelve `sse.js`, que tiene prueba propia.
 */
async function enviar(texto) {
  const mensaje = String(texto ?? dom.entrada.value ?? "").trim()
  if (mensaje === "") {
    avisar("Escribe un mensaje antes de enviar.")
    return
  }
  if (estado.ocupado) {
    avisar("El agente todavía está trabajando en el turno anterior.")
    return
  }

  limpiarAviso()
  ocultarConfirmacion()
  estado.ocupado = true
  agregarTurno("usuario", mensaje)
  const delAgente = agregarTurno("agente", "")
  dom.entrada.value = ""
  mostrarTrabajo()
  console.log(`[front] enviando · sesión ${estado.sesion} · ${mensaje.slice(0, 60)}`)

  // Tarjetas de este turno, en orden, para emparejar cada `resultado` con su
  // `llamada`: buscándolas por nombre en el DOM, dos llamadas a la misma
  // herramienta se pisarían entre sí.
  const tarjetasPorNombre = new Map()
  let textoAcumulado = ""

  try {
    const respuesta = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: estado.sesion, message: mensaje }),
    })
    if (!respuesta.ok) throw new Error(`el backend respondió ${respuesta.status}`)

    const acumulador = crearAcumulador()
    const lector = respuesta.body.getReader()

    for (;;) {
      const { value, done } = await lector.read()
      if (done) break

      for (const evento of acumulador.empujar(new TextDecoder().decode(value))) {
        if (evento === FIN) continue

        if (evento.tipo === "texto") {
          textoAcumulado += evento.texto
          pintarTexto(delAgente.texto, textoAcumulado)
        } else if (evento.tipo === "llamada") {
          const item = agregarLlamada(delAgente.cuerpo, evento)
          const lista = tarjetasPorNombre.get(evento.nombre) ?? []
          lista.push(item)
          tarjetasPorNombre.set(evento.nombre, lista)
        } else if (evento.tipo === "resultado") {
          const lista = tarjetasPorNombre.get(evento.nombre) ?? []
          const item = lista.find((candidata) => candidata.dataset["resultado"] === undefined)
          if (item !== undefined) {
            item.dataset["resultado"] = evento.ok ? "ok" : "fallo"
            marcarResultado(item, evento)
          }
        } else if (evento.tipo === "aviso") {
          delAgente.cuerpo.append(pintarAvisoDelTurno(evento.texto))
        } else if (evento.tipo === "error") {
          delAgente.turno.classList.add("turno--error")
          textoAcumulado += `${textoAcumulado === "" ? "" : "\n"}${evento.texto}`
          pintarTexto(delAgente.texto, textoAcumulado)
          avisar(evento.texto)
        } else if (evento.tipo === "fin") {
          if (evento.texto !== "" && textoAcumulado === "") pintarTexto(delAgente.texto, evento.texto)
          // CA3: el turno que pide confirmación se resalta y se ofrece el «sí».
          if (evento.needsConfirmation === true) {
            delAgente.turno.classList.add("turno--confirmacion")
            mostrarConfirmacion(evento.texto || "El agente necesita tu confirmación para continuar.")
          }
        }
      }
    }

    estado.turnos += 1
    pintarSesion(estado.turnos)
    void listarArchivos()
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error)
    delAgente.turno.classList.add("turno--error")
    pintarTexto(delAgente.texto, `No pude completar el turno: ${detalle}`)
    avisar(`No pude completar el turno: ${detalle}`)
  } finally {
    ocultarTrabajo()
    estado.ocupado = false
  }
}

/** Nota dentro del turno para un aviso del ciclo (CA4: se ve en el historial). */
function pintarAvisoDelTurno(texto) {
  const nodo = document.createElement("p")
  nodo.className = "turno__aviso"
  escribir(nodo, texto)
  return nodo
}

/** El botón «Sí, confirmo» manda el «sí» explícito que el ciclo exige (CA3). */
async function confirmar() {
  ocultarConfirmacion()
  await enviar("sí, confirmo")
}

/** El botón «No, espera» descarta la acción pendiente sin crear nada (CA3). */
async function rechazar() {
  ocultarConfirmacion()
  await enviar("no, espera")
}

/** Empieza una conversación nueva, sin tocar los archivos ya generados. */
function nuevaSesion() {
  estado.sesion = nuevoIdentificador()
  estado.turnos = 0
  dom.conversacion.replaceChildren()
  ocultarConfirmacion()
  limpiarAviso()
  pintarSesion(0)
  console.log(`[front] sesión nueva · ${estado.sesion}`)
}

/** Conecta los controles y hace el primer saludo al backend. */
function iniciarFront() {
  console.log("[front] cargado · v1")

  pintarSugerencias()
  pintarSesion(0)

  const formulario = document.querySelector("#formulario")
  if (formulario !== null) {
    formulario.addEventListener("submit", (evento) => {
      evento.preventDefault()
      void enviar(dom.entrada.value)
    })
  }

  // El clic se atiende aparte, con `preventDefault` para que el navegador no
  // dispare además el `submit` (serían dos mensajes por clic). Hay navegadores y
  // DOM de prueba que no disparan `submit` desde un botón: sin esto, el front se
  // quedaba mudo y parecía que el agente no respondía.
  const botonEnviar = document.querySelector("#boton-enviar")
  if (botonEnviar !== null) {
    botonEnviar.addEventListener("click", (evento) => {
      evento.preventDefault()
      void enviar(dom.entrada.value)
    })
  }

  dom.entrada.addEventListener("keydown", (evento) => {
    if (evento.key === "Enter" && evento.shiftKey !== true) {
      evento.preventDefault()
      void enviar(dom.entrada.value)
    }
  })

  const botonConfirmar = document.querySelector("#boton-confirmar")
  if (botonConfirmar !== null) botonConfirmar.addEventListener("click", () => void confirmar())

  const botonRechazar = document.querySelector("#boton-rechazar")
  if (botonRechazar !== null) botonRechazar.addEventListener("click", () => void rechazar())

  const botonNueva = document.querySelector("#boton-nueva-sesion")
  if (botonNueva !== null) botonNueva.addEventListener("click", () => nuevaSesion())

  void consultarSalud()
  void listarArchivos()
}

iniciarFront()

