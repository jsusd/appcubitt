# Cubitt Admin

Sistema administrativo de Cubitt: ventas (contado / crédito, vendedor, comisión, factura fiscal),
cobranza con abonos fechados, compras con la foto de cada factura, inventario por ubicación,
conciliación compras vs ventas y liquidación de comisiones.

Funciona como **aplicación web de Google Apps Script**: no necesita servidor ni pagos. Los datos
viven en una hoja de Google nueva y ordenada (una pestaña por tabla), en tu Drive.

## Por qué es más confiable que la versión anterior

| Antes | Ahora |
|---|---|
| Copias de los datos en cada navegador (localStorage) que se desincronizaban de la hoja | Una sola fuente de verdad: la hoja de base de datos. Nada se guarda en el navegador salvo la sesión |
| URL del Apps Script pública que aceptaba escrituras sin clave | Cada llamada exige sesión válida; el servidor decide qué puede hacer cada rol |
| Contraseñas "123" visibles en el código | Contraseñas con hash + sal; los usuarios nuevos cambian la clave temporal al entrar |
| Fechas de pago como comentarios (no se podían leer) | Cada pago es un registro con fecha, monto, método y nota. La migración lee los comentarios de la hoja |
| Pendiente escrito a mano | Saldo = total − pagos, siempre calculado |
| Stock editable a mano | Stock calculado desde un libro de movimientos (compras, ventas, traslados, ajustes por conteo) |
| Borrar filas desplazaba otras ventas | Nada se borra: ventas, pagos y compras se **anulan** y quedan en el historial |
| Dos personas guardando a la vez se pisaban | Toda escritura usa un bloqueo (LockService) |

## Instalación (una sola vez, ~10 minutos)

1. Entra a <https://script.google.com> con tu cuenta y crea un **Proyecto nuevo**. Ponle de nombre `Cubitt Admin`.
2. En **Configuración del proyecto** (engranaje) marca **Mostrar el archivo de manifiesto "appsscript.json"**.
3. Copia el contenido de cada archivo de la carpeta `src/` a un archivo con el **mismo nombre** en el editor:
   - Archivos de **secuencia de comandos** (`+` ▸ Secuencia de comandos): `Codigo`, `Datos`, `Dominio`, `Auth`, `Ventas`,
     `Compras`, `Inventario`, `Reportes`, `Catalogo`, `Migracion` (el editor agrega `.gs`).
   - Archivos **HTML** (`+` ▸ HTML): `Index`, `Estilos`, `App`.
   - Reemplaza el contenido de `appsscript.json` con el de `src/appsscript.json`.
   - Borra el `Código.gs` vacío que trae el proyecto.

   > Alternativa para quien use la terminal: `npm i -g @google/clasp`, `clasp login`,
   > `clasp create --type webapp --title "Cubitt Admin" --rootDir src` y `clasp push`.
4. En la barra superior elige la función **`instalar`** y pulsa **Ejecutar**. Acepta los permisos
   (hojas de cálculo, Drive y conexión externa). En el **Registro de ejecución** aparecerá:
   - el enlace de la nueva hoja **"Cubitt Admin — Base de datos"**, y
   - un **CÓDIGO DE INSTALACIÓN** de 6 dígitos.
5. **Implementar ▸ Nueva implementación ▸ Aplicación web**:
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario con una cuenta de Google** (tus vendedores entran con su Gmail
     y luego con su usuario de la app).
   - Copia la **URL de la aplicación web**: ese es el enlace del sistema. Puedes agregarlo a la pantalla de inicio del celular.
6. Abre la URL, escribe el código de instalación y crea tu usuario **administrador**.

Para publicar cambios futuros del código: **Implementar ▸ Administrar implementaciones ▸ editar ▸ Versión: nueva**.
Así la URL se mantiene.

## Primeros pasos después de instalar

1. **Ajustes ▸ Migrar desde la hoja**: pulsa **Analizar** (no guarda nada) y revisa el reporte. Si se ve bien, pulsa **Migrar**.
   - Importa *Ventas* (cada PAGO 1–5 se vuelve un pago, con la fecha que dejaste como comentario en esa celda),
     *BDD* (catálogo: costo, PVP, comisión) y *Compras_Nueva* (facturas). Proveedor y RIF salen de *Registro_Facturas* cuando existen.
   - El reporte compara contra la fila de totales de la hoja y lista cada fila con algo raro (sin código, fecha futura,
     pendiente que no cuadra, pagos con fecha estimada…).
   - Puedes repetirla las veces que quieras mientras corriges la hoja: reemplaza solo lo migrado. Se bloquea sola si ya
     registraste abonos o liquidaciones sobre el histórico en la app (para no perderlos).
2. **Ajustes ▸ Comisión por línea**: revisa el monto fijo por unidad de cada línea (HYDRO, AURA 2…). La migración propone
   el más frecuente de la hoja. Un producto puede tener su propia comisión (Ajustes ▸ Productos).
3. **Ajustes ▸ Vendedores / Usuarios**: crea un usuario para cada vendedor (rol Vendedor, vinculado a su nombre).
   Cada vendedor ve y registra solo sus ventas, sus cobros y sus comisiones; no ve costos ni compras.
4. **Compras y facturas ▸ Facturas en mi Drive**: pega el enlace de tu carpeta *Facturas* y registra las que falten.
   Con la clave de Gemini (paso 6) la app lee la foto y llena los datos para que solo los revises.
   A las compras migradas puedes adjuntarles su foto desde el detalle de cada compra.
5. **Conciliación**: muestra, producto por producto, lo comprado contra lo vendido. Cada negativo es mercancía vendida
   sin factura de compra registrada. Regístrala en *Compras* o, si no hay factura, deja el stock real con un **Conteo físico**.
6. **Inventario ▸ Conteo físico** en cada ubicación: cuenta lo que hay en el estante y la app ajusta la diferencia
   (queda registrada). Desde ese momento el inventario refleja la realidad.
7. (Opcional) **Ajustes ▸ Configuración ▸ Clave de Google Gemini**: crea una clave en <https://aistudio.google.com/apikey>.
   Se guarda solo en el servidor de Apps Script (nunca en el navegador ni en este repositorio).
   **Si usabas la clave que estaba en `config.js` del repositorio, revócala: era pública.**

## Uso diario

- **Vender**: cliente, vendedor, ubicación de donde sale, productos (la comisión se sugiere sola y se puede cambiar),
  contado o crédito con pago inicial, y si se emitió factura fiscal con su número. No deja vender más de lo que hay
  en esa ubicación (el administrador puede forzarlo; quedará marcado en la conciliación).
- **Cobranza**: quién debe, cuánto y hace cuántos días, con botón para abonar y recordatorio por WhatsApp.
- **Ventas**: filtros por fecha, vendedor, estado, tipo y fiscal; en el detalle se registran abonos, se corrigen fechas
  estimadas, se edita o se anula.
- **Comisiones**: lo generado, lo listo para pagar (ventas cobradas completas) y lo pagado; *Marcar como pagadas* deja un recibo.
- **Inicio**: vendido y cobrado hoy y en el período, por cobrar, contado vs crédito, fiscal vs no fiscal, margen y alertas.

La hoja de base de datos se puede abrir para consultar o exportar, pero **no la edites a mano**: usa la app para que
stock, saldos y comisiones se mantengan correctos. Cada cambio queda en *Ajustes ▸ Historial de cambios*.

## Para desarrollo

```bash
npm test          # pruebas del backend con Apps Script simulado (incluye la migración)
npm run local     # la app en http://localhost:8780 con datos en memoria (muestra el código de instalación)
npm run e2e       # prueba de punta a punta en el navegador (Playwright)
```

Estructura de `src/`:

| Archivo | Contenido |
|---|---|
| `Codigo.gs` | `doGet`, despachador `api(token, accion, datos)`, instalación |
| `Datos.gs` | Esquema de tablas y acceso a la hoja (lectura, inserción, actualización, ids, bloqueo) |
| `Dominio.gs` | Reglas puras: saldo, stock, comisión sugerida, conciliación, lectura de comentarios de pago |
| `Auth.gs` | Usuarios, hash de contraseñas, sesiones, roles |
| `Ventas.gs` | Ventas, pagos y cobranza |
| `Compras.gs` | Compras, archivos en Drive, lectura con Gemini |
| `Inventario.gs` | Stock por ubicación, kardex, traslados, conteo físico |
| `Reportes.gs` | Inicio, conciliación, comisiones y liquidaciones |
| `Catalogo.gs` | Productos, líneas, vendedores, ubicaciones, usuarios, configuración |
| `Migracion.gs` | Importación desde la hoja "Cubitt" (incluye los comentarios con fechas de pago) |
| `Index.html`, `Estilos.html`, `App.html` | Interfaz |
