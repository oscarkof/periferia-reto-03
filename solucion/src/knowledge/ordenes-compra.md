# Conocimiento del proceso · Órdenes de compra en SAP

Este documento es el contexto del proceso. Explica **qué significan** las cosas que el motor decide; no
define reglas nuevas: los números (tolerancias, topes, límites) están en el código y en los maestros, y son
los que manda la herramienta.

## De dónde sale una solicitud

Cada caso es un **paquete** con piezas que pueden faltar:

| Pieza | Qué es |
|---|---|
| `correo.json` | El sobre del mensaje, con sus adjuntos |
| `solicitud.json` | La solicitud de compra ya normalizada (proveedor, objeto, valor, centro de costo, subárea) |
| `cotizacion.txt` | La oferta del proveedor, tal como llegó (formato libre) |
| `aprobacion.json` | El correo con el que un líder autoriza el gasto |
| `factura.txt` | Solo en compras que ya se hicieron (casos retroactivos) |

Cuando falta una pieza, el motor lo dice y lo nombra. **Un caso sin cotización o sin aprobación no se debe
«arreglar»**: se informa y se pide lo que falte.

## Los cuatro maestros

| Maestro | Para qué |
|---|---|
| **Proveedores** | El código de SAP, el NIT, si está activo y sus valores por defecto (IVA y condiciones de pago) |
| **Centros de costo** | Qué subáreas pertenecen a cada centro y **quiénes pueden aprobar** y hasta qué monto |
| **Indicadores de IVA** | Los códigos que viajan en la orden (por ejemplo `C1` = 19 %, `C2` = 5 %, `C0` = exento) |
| **Condiciones de pago** | Los códigos de plazo (`Z030` = 30 días, `Z000` = pago inmediato…) |

Un mismo proveedor puede estar escrito de varias formas (con puntos en el NIT, con o sin dígito de
verificación, con o sin «S.A.S.»). El motor normaliza esas formas; tú no tienes que corregirlas.

## Los diez controles, en lenguaje de compras

| # | Qué protege | En palabras |
|---|---|---|
| **RC1** | Que no se compre a un proveedor que no existe | El proveedor no está en el maestro, o está inactivo: hay que darlo de alta o corregir el dato. **Bloquea** |
| **RC2** | Que quien aprobó tenga autoridad | El correo de aprobación no viene de un aprobador de **ese** centro de costo, o no dice que aprueba. **Bloquea** |
| **RC3** | Que el monto esté dentro de la autoridad de quien firma | El valor supera el tope del aprobador para ese centro. **Bloquea** |
| **RC4** | Que la subárea pertenezca al centro | La subárea no está en la lista del centro de costo. **Bloquea** |
| **RC5** | Que lo aprobado y lo cotizado coincidan | La cotización del proveedor difiere de la solicitud más de lo tolerado: se muestran las dos cifras y decide una persona |
| **RC6** | Que el IVA esté declarado | La solicitud no trae indicador de IVA: se deriva el del proveedor y **se pregunta** |
| **RC7** | Que las condiciones de pago estén declaradas | Igual que el IVA, pero **solo se informa**: no se pregunta |
| **RC8** | Las compras retroactivas | Hay una factura **anterior** a la solicitud: la orden sería retroactiva. Se pregunta y queda **marcada** |
| **RC9** | El orden de los hechos | La aprobación es anterior al pedido: puede ser normal o un error, se pregunta |
| **RC10** | Que las cuentas cuadren | Cantidad × valor unitario no da el total de la solicitud (más allá de una unidad de redondeo). **Bloquea** |

**Los bloqueos ganan**: con un bloqueo no hay orden de compra, y no hay forma de insistir. Se devuelven
**todas** las razones, no la primera, para que el caso se arregle de una vez.

## Quién puede aprobar qué

Cada aprobador tiene un **tope** por centro de costo. Una compra de 74 millones aprobada por alguien cuyo
tope es 30 millones no es una compra aprobada: es un caso que hay que escalar. El motor dice quiénes sí
pueden aprobar en ese centro y hasta cuánto.

## Qué es una compra retroactiva (y por qué se marca)

Es la que se facturó **antes** de pedirse (por ejemplo: llega la factura del 10 de agosto y la solicitud es
del 27 del mismo mes). No se rechaza sola: se pide confirmación y queda marcada en `out/control.csv`, porque
es el desvío de proceso que la dirección quiere poder medir.

## Qué lleva la orden de compra en SAP

- La **referencia** de la solicitud y de la cotización (para amarrar la orden con la oferta que la originó).
- El **proveedor** con su código de SAP, la **moneda**, las **condiciones de pago** y el **indicador de IVA**.
- El **aprobador** con la fecha de aprobación y la **huella** del correo de aprobación (es lo que permite
  auditar después que el archivo firmado es el mismo).
- Las **posiciones**: hoy una por caso, numeradas de 10 en 10 como en SAP.
- Las **excepciones** que se confirmaron, con el correo de quien confirmó.

El texto breve de cada posición tiene un límite en SAP: si la descripción es más larga, se recorta y el
recorte queda declarado como excepción (nunca en silencio).

## Los archivos de salida

| Archivo | Quién lo usa |
|---|---|
| `out/control.csv` | Contabilidad y auditoría: **una fila por solicitud**, con la marca de retroactiva y las excepciones |
| `out/evidencia/<caso>-aprobacion.txt` | Auditoría: el texto firmado del correo de aprobación |
| `out/sap/ordenes/<numero>.json` | El payload completo tal como quedó en SAP |
| `out/log.jsonl` | Traza técnica de cada llamada a herramienta |

Una solicitud repetida **no** genera otra orden ni otra fila: la orden se identifica por la referencia de la
solicitud, así que reintentar es seguro.
