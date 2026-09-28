/**
 * Las reglas de control del PRD §7.3 (RC1–RC10): una función pura por regla.
 *
 * Todas reciben el contexto (maestros + paquete + umbrales) y devuelven
 * hallazgos. Dos reglas de composición que son las que se ven desde fuera:
 *
 *   · **los bloqueos ganan** — si hay al menos uno, `apta = false` y el turno
 *     termina explicando; no existe camino hacia `oc_crear`;
 *   · **se devuelven todas las razones, no la primera** — `sol-003` acumula RC2
 *     y RC3 a propósito, para que la analista lo arregle de una vez.
 *
 * Ninguna regla consulta el reloj ni el azar: solo maestros y documento.
 */
import {
  aprobadorDe,
  apruebaSubarea,
  cargarMaestros,
  centroDe,
  resolverProveedor,
} from "./maestros.ts"
import { derivar, type Derivaciones } from "./derivados.ts"
import { reglasDelEntorno } from "./entorno.ts"
import { esAnterior, porcentajeDiferencia, redondear } from "./normalizacion.ts"
import { leerPaquete } from "./paquete.ts"
import type {
  Aprobador,
  CentroCosto,
  Hallazgo,
  Maestros,
  Paquete,
  Proveedor,
  Reglas,
  Resultado,
  Validacion,
} from "./tipos.ts"

/** Todo lo que necesitan las reglas, resuelto una sola vez. */
export interface Contexto {
  maestros: Maestros
  paquete: Paquete
  reglas: Reglas
  proveedor: Proveedor | null
  centro: CentroCosto | null
  aprobador: Aprobador | null
  derivaciones: Derivaciones
}

/** Importe con separador de miles a la española, para que se lea en el chat. */
function importe(valor: number, moneda = ""): string {
  const numero = valor.toLocaleString("es-CO", { maximumFractionDigits: 2 })
  return moneda === "" ? numero : `${moneda} ${numero}`
}

/** RC1 · El proveedor debe existir (por NIT o nombre) y estar activo. */
export function revisarRc1(ctx: Contexto): Hallazgo[] {
  const { solicitud } = ctx.paquete
  if (ctx.proveedor !== null) {
    if (ctx.proveedor.activo) return []
    return [
      {
        codigo: "RC1",
        tipo: "bloqueo",
        detalle: `el proveedor ${ctx.proveedor.nombre} está inactivo en el maestro (código SAP ${ctx.proveedor.codigo_sap})`,
        accion_sugerida: "reactivar el proveedor en el maestro o corregir la solicitud",
      },
    ]
  }
  const nit = solicitud.proveedor_nit?.trim()
  const comoSeBusco =
    nit !== undefined && nit !== "" ? `NIT ${nit}` : `nombre «${solicitud.proveedor_nombre}»`
  return [
    {
      codigo: "RC1",
      tipo: "bloqueo",
      detalle: `el proveedor «${solicitud.proveedor_nombre}» (${comoSeBusco}) no está en el maestro de proveedores`,
      accion_sugerida: "darlo de alta en el maestro o corregir el NIT o el nombre en la solicitud",
    },
  ]
}

/** RC2 · La aprobación debe existir, aprobar y venir de un aprobador del centro. */
export function revisarRc2(ctx: Contexto): Hallazgo[] {
  const { aprobacion } = ctx.paquete
  if (aprobacion === null) {
    return [
      {
        codigo: "RC2",
        tipo: "bloqueo",
        detalle: "el paquete no trae el correo de aprobación del líder",
        accion_sugerida: "adjuntar el correo con el que el líder aprobó el gasto",
      },
    ]
  }
  if (!aprobacion.aprobado) {
    return [
      {
        codigo: "RC2",
        tipo: "bloqueo",
        detalle: `el correo de ${aprobacion.de} no aprueba el gasto: su cuerpo no dice «Aprobado»`,
        accion_sugerida: "pedir al líder que responda aprobando, o revisar el correo adjunto",
      },
    ]
  }
  if (ctx.centro === null) return []
  if (ctx.aprobador === null) {
    const quienes = ctx.centro.aprobadores.map((a) => `${a.nombre} <${a.email}>`).join(", ")
    return [
      {
        codigo: "RC2",
        tipo: "bloqueo",
        detalle: `el correo ${aprobacion.de} no es aprobador del centro ${centroEtiqueta(ctx)}, por lo que no puede autorizar este gasto`,
        accion_sugerida: `pedir la aprobación a alguno de los aprobadores del centro: ${quienes}`,
      },
    ]
  }
  return []
}

/** Etiqueta legible del centro (`CC-2020 · Administración`). */
function centroEtiqueta(ctx: Contexto): string {
  const centro = ctx.centro
  if (centro === null) return ctx.paquete.solicitud.centro_costo
  return `${centro.centro_costo} · ${centro.nombre}`
}

/**
 * RC3 · El valor no puede superar el tope del aprobador para ese centro.
 *
 * Si el correo no viene de un aprobador del centro (RC2), se compara contra el
 * **tope más alto del centro**: así `sol-003` devuelve RC2 y RC3 juntas y la
 * analista resuelve el caso de una vez, en vez de descubrir el segundo problema
 * después de arreglar el primero.
 */
export function revisarRc3(ctx: Contexto): Hallazgo[] {
  const { solicitud } = ctx.paquete
  const centro = ctx.centro
  const aprobador = ctx.aprobador

  let tope: number | null = null
  let quien = ""
  if (aprobador !== null) {
    tope = aprobador.tope
    quien = `${aprobador.nombre} para ${centroEtiqueta(ctx)}`
  } else if (centro !== null && centro.aprobadores.length > 0) {
    const conMayorTope = centro.aprobadores.reduce((a, b) => (b.tope > a.tope ? b : a))
    tope = conMayorTope.tope
    quien = `el tope más alto de ${centroEtiqueta(ctx)}: ${conMayorTope.nombre}`
  }
  if (tope === null) return []
  if (solicitud.valor_total <= tope) return []

  return [
    {
      codigo: "RC3",
      tipo: "bloqueo",
      detalle: `${importe(solicitud.valor_total, solicitud.moneda)} supera ${importe(tope, solicitud.moneda)}: ${quien}`,
      accion_sugerida:
        "escalar la aprobación a un aprobador con tope mayor o dividir la compra en varias órdenes",
    },
  ]
}

/** RC4 · La subárea debe pertenecer al centro de costo. */
export function revisarRc4(ctx: Contexto): Hallazgo[] {
  const { solicitud } = ctx.paquete
  if (ctx.centro === null) {
    const conocidos = ctx.maestros.centros.map((c) => c.centro_costo).join(", ")
    return [
      {
        codigo: "RC4",
        tipo: "bloqueo",
        detalle: `el centro de costo ${solicitud.centro_costo} no está en el maestro de centros de costo`,
        accion_sugerida: `corregir el centro de costo en la solicitud; los del maestro son: ${conocidos}`,
      },
    ]
  }
  if (apruebaSubarea(ctx.centro, solicitud.subarea)) return []
  return [
    {
      codigo: "RC4",
      tipo: "bloqueo",
      detalle: `la subárea «${solicitud.subarea}» no pertenece a ${centroEtiqueta(ctx)}`,
      accion_sugerida: `usar una de las subáreas del centro: ${ctx.centro.subareas.join(", ")}`,
    },
  ]
}

/** RC5 · La cotización y la solicitud no pueden diferir más de la tolerancia. */
export function revisarRc5(ctx: Contexto): Hallazgo[] {
  const { cotizacion, solicitud } = ctx.paquete
  if (cotizacion === null || cotizacion.total === 0) {
    return [
      {
        codigo: "RC5",
        tipo: "confirmacion",
        detalle: `no hay una cotización legible con la que comparar el valor de la solicitud (${importe(solicitud.valor_total, solicitud.moneda)})`,
        accion_sugerida: "adjuntar la cotización o confirmar que el valor de la solicitud es el correcto",
      },
    ]
  }
  const diferencia = porcentajeDiferencia(cotizacion.total, solicitud.valor_total)
  if (diferencia <= ctx.reglas.toleranciaRc5Pct) return []
  const moneda = cotizacion.moneda !== "" ? cotizacion.moneda : solicitud.moneda
  return [
    {
      codigo: "RC5",
      tipo: "confirmacion",
      detalle: `la cotización dice ${importe(cotizacion.total, moneda)} y la solicitud ${importe(solicitud.valor_total, solicitud.moneda)}: ${diferencia.toFixed(2)} % de diferencia (la tolerancia es ${ctx.reglas.toleranciaRc5Pct} %)`,
      accion_sugerida: "confirmar con cuál de los dos valores se crea la orden",
    },
  ]
}

/** RC6 · IVA ausente: se deriva del proveedor y se pide confirmación. */
export function revisarRc6(ctx: Contexto): Hallazgo[] {
  if (!ctx.derivaciones.ivaDerivadoDelProveedor) return []
  const proveedor = ctx.proveedor
  const origen = proveedor === null ? "el maestro de proveedores" : proveedor.nombre
  return [
    {
      codigo: "RC6",
      tipo: "confirmacion",
      detalle: `la solicitud no informa el indicador de IVA; se deriva ${ctx.derivaciones.indicador_iva} del proveedor ${origen}`,
      accion_sugerida: "confirmar el indicador de IVA antes de crear la orden",
    },
  ]
}

/**
 * RC8 · Hay factura anterior a la solicitud: la OC sería retroactiva.
 * Es el desvío de proceso que la dirección quiere medir, así que además de
 * confirmarse queda **marcado** en `out/control.csv`.
 */
export function revisarRc8(ctx: Contexto): Hallazgo[] {
  const { factura, solicitud } = ctx.paquete
  if (factura === null) return []
  if (!esAnterior(factura.fecha, solicitud.fecha_solicitud)) return []
  return [
    {
      codigo: "RC8",
      tipo: "confirmacion",
      detalle: `la factura ${factura.numero} del ${factura.fecha} es anterior a la solicitud del ${solicitud.fecha_solicitud}: la orden de compra sería retroactiva`,
      accion_sugerida:
        "confirmar que se crea igualmente; queda registrada como retroactiva en el log de control",
    },
  ]
}

/** RC9 · La aprobación no puede ser anterior a la solicitud. */
export function revisarRc9(ctx: Contexto): Hallazgo[] {
  const { aprobacion, solicitud } = ctx.paquete
  if (aprobacion === null) return []
  if (!esAnterior(aprobacion.fecha, solicitud.fecha_solicitud)) return []
  return [
    {
      codigo: "RC9",
      tipo: "confirmacion",
      detalle: `la aprobación de ${aprobacion.de} es del ${aprobacion.fecha}, anterior a la solicitud del ${solicitud.fecha_solicitud}`,
      accion_sugerida: "confirmar que la aprobación corresponde a esta solicitud",
    },
  ]
}

/** RC10 · cantidad × valor_unitario debe cuadrar con valor_total (± tolerancia). */
export function revisarRc10(ctx: Contexto): Hallazgo[] {
  const { solicitud } = ctx.paquete
  const calculado = redondear(solicitud.cantidad * solicitud.valor_unitario)
  if (Math.abs(calculado - solicitud.valor_total) <= ctx.reglas.toleranciaRc10Abs) return []
  return [
    {
      codigo: "RC10",
      tipo: "bloqueo",
      detalle: `${solicitud.cantidad} × ${importe(solicitud.valor_unitario, solicitud.moneda)} = ${importe(calculado, solicitud.moneda)}, y la solicitud dice ${importe(solicitud.valor_total, solicitud.moneda)} (tolerancia ±${ctx.reglas.toleranciaRc10Abs})`,
      accion_sugerida: "corregir cantidad, valor unitario o valor total en la solicitud",
    },
  ]
}

/** Resuelve el contexto de las reglas una sola vez (proveedor, centro, aprobador). */
export function contextoDe(maestros: Maestros, paquete: Paquete, reglas: Reglas): Contexto {
  const solicitud = paquete.solicitud
  const proveedor = resolverProveedor(maestros, {
    nit: solicitud.proveedor_nit,
    nombre: solicitud.proveedor_nombre,
  })
  const centro = centroDe(maestros, solicitud.centro_costo)
  const aprobador =
    centro !== null && paquete.aprobacion !== null ? aprobadorDe(centro, paquete.aprobacion.de) : null
  const derivaciones: Derivaciones =
    proveedor !== null
      ? derivar(proveedor, solicitud, paquete.cotizacion, reglas)
      : {
          indicador_iva: solicitud.indicador_iva?.trim() ?? "",
          condiciones_pago: solicitud.condiciones_pago?.trim() ?? "",
          unidad: reglas.unidadDefault,
          ivaDerivadoDelProveedor: false,
          condicionDerivadaDelProveedor: false,
          derivados: [],
        }
  return { maestros, paquete, reglas, proveedor, centro, aprobador, derivaciones }
}

/**
 * Aplica **todas** las reglas y devuelve el veredicto.
 *
 * RC7 no aparece aquí porque no produce hallazgo: es un derivado informativo que
 * viaja en `derivados` y en la trazabilidad del payload.
 */
export function validar(maestros: Maestros, paquete: Paquete, reglas: Reglas): Validacion {
  const ctx = contextoDe(maestros, paquete, reglas)

  const bloqueos: Hallazgo[] = [
    ...revisarRc1(ctx),
    ...revisarRc2(ctx),
    ...revisarRc3(ctx),
    ...revisarRc4(ctx),
    ...revisarRc10(ctx),
  ]
  const confirmaciones: Hallazgo[] = [
    ...revisarRc5(ctx),
    ...revisarRc6(ctx),
    ...revisarRc8(ctx),
    ...revisarRc9(ctx),
  ]

  return {
    caso: paquete.caso,
    apta: bloqueos.length === 0,
    bloqueos,
    confirmaciones,
    derivados: ctx.derivaciones.derivados,
    retroactiva: confirmaciones.some((h) => h.codigo === "RC8"),
  }
}

/**
 * Atajo para `demo.ts` y las pruebas: lee el paquete del fixture, carga los
 * maestros y valida, devolviendo el primer error en lenguaje humano.
 */
export function validarCaso(
  caso: string,
  opciones: { solicitudes?: string; reglas?: Reglas } = {},
): Resultado<Validacion> {
  const paquete = leerPaquete(caso, opciones.solicitudes ?? "")
  if (!paquete.ok) return paquete
  const maestros = cargarMaestros()
  if (!maestros.ok) return maestros
  return {
    ok: true,
    data: validar(maestros.data, paquete.data, opciones.reglas ?? reglasDelEntorno()),
  }
}


