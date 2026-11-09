# Cubitt POS & Ventas

> **Nueva versión:** el sistema administrativo reescrito desde cero (Google Apps Script + Google Sheets como base de datos)
> está en [`cubitt-admin/`](cubitt-admin/README.md). Esta carpeta raíz contiene la versión anterior.

Aplicación web (HTML + JavaScript, sin servidor) para registrar ventas de Cubitt, controlar créditos,
inventario por almacén, clientes, vendedores, cuentas por pagar y ver métricas del negocio.
Los datos se guardan en el navegador y se sincronizan con la hoja de Google Sheets mediante un Apps Script.

## Archivos

| Archivo | Qué contiene |
|---|---|
| `index.html` | Todas las pantallas y ventanas (modales). |
| `app.js` | Lógica de la app: ventas, créditos, inventario, métricas, sincronización con Sheets. |
| `style.css` | Estilos. |
| `config.js` | Configuración: ID de la hoja de Google Sheets y URL del Apps Script. **No poner claves secretas aquí: el repositorio es público.** |
| `products.js` / `products.json` | Catálogo de productos (códigos, precios, imágenes). |
| `google_apps_script_cubitt.js` | Código del Apps Script que va pegado en la hoja de Google Sheets. |
| `images/` | Fotos de productos. |

## Pantallas principales

- **Registrar Venta**: venta de contado o a crédito (Cashea Bull, Cashea T-Mania, JP), por almacén y canal.
  A la derecha está el **Resumen de Hoy**: vendido hoy, cobrado hoy, vendido en el mes, total por cobrar,
  alertas (pedidos por entregar, stock bajo/agotado, cuentas por pagar, deudas de más de 30 días)
  y los 5 clientes con mayor saldo pendiente (clic para abrir su ficha).
- **Historial**: todas las ventas con filtros; editar, ver ticket o eliminar.
- **Finanzas**: créditos pendientes (abonos), cuentas por pagar (CXP) y **Métricas**.
- **Métricas**: ventas, cobrado, pendiente, egresos y utilidad; filtros por mes, almacén y canal.
  Todo se calcula con las ventas y egresos reales registrados.
- **Inventario**: stock, facturas de compra (con escaneo por IA), movimientos y préstamos entre almacenes.
- **Clientes**, **Equipo** (vendedores y metas) y **Usuarios** (accesos y roles).

## Acceso y roles

- Cada persona entra con su usuario y contraseña. La sesión queda guardada en ese dispositivo hasta pulsar **Salir**.
- Roles: **Gerencia** (todo), **Inversor** (supervisión financiera), **Vendedor** (solo sus propias ventas).
- Los usuarios de fábrica traen la contraseña `123`; al entrar con ella la app pide cambiarla.
  Gerencia puede crear usuarios y cambiar contraseñas en *Más Opciones → Usuarios*.
- Los usuarios se guardan en cada navegador: si se crean en un equipo, hay que crearlos también en los demás.

## Escaneo de facturas con IA (Google Gemini)

La clave de Gemini **no** va en `config.js`. Se pega en la app (ventana de *Registrar Factura* → configuración de IA)
y queda guardada solo en ese navegador. Sin clave, la app usa OCR local (Tesseract).

## Google Sheets

- La app lee la hoja `ventas` y escribe ventas nuevas, abonos, ediciones y eliminaciones a través del Apps Script.
- Si se modifica `google_apps_script_cubitt.js`, hay que copiarlo en el editor de Apps Script de la hoja y
  **volver a implementar** (Implementar → Administrar implementaciones → Editar → Nueva versión).

## Ejecutar localmente

Abrir `index.html` en el navegador, o servir la carpeta (por ejemplo `python3 -m http.server`) y abrir `http://localhost:8000`.
