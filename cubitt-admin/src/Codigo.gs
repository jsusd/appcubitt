/**
 * Codigo.gs — Punto de entrada de la aplicación web y despachador de acciones.
 *
 * El navegador llama a api(token, accion, datos) con google.script.run.
 * Toda respuesta tiene la forma { ok: true, data } o { ok: false, error }.
 */

function doGet() {
  var t = HtmlService.createTemplateFromFile('Index');
  return t.evaluate()
    .setTitle('Cubitt Admin')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setFaviconUrl('https://www.gstatic.com/images/icons/material/system/2x/storefront_black_48dp.png');
}

/** Para incluir Estilos.html y App.html dentro de Index.html. */
function incluir(nombre) {
  return HtmlService.createHtmlOutputFromFile(nombre).getContent();
}

/** Se construye al primer uso: en Apps Script el orden de carga de los archivos no está garantizado. */
function acciones() {
  return {
    // Sesión
    yo: function (u) { return usuarioPublico(u); },
    cambiarClave: function (u, d) { conBloqueo(function () { Auth.cambiarClave(u, d.actual, d.nueva); }); return true; },
    inicial: Catalogo.inicial,

    // Ventas, pagos y cobranza
    crearVenta: Ventas.crear,
    detalleVenta: function (u, d) { return Ventas.detalle(u, d.id); },
    listarVentas: Ventas.listar,
    editarVenta: Ventas.editar,
    anularVenta: Ventas.anular,
    clientes: Ventas.clientes,
    clientesResumen: Clientes.resumen,
    clienteDetalle: Clientes.detalle,
    recargarDatos: function (u) { exigirAdmin(u); Db.olvidarCache(); return true; },
    crearPago: Pagos.crear,
    anularPago: Pagos.anular,
    corregirFechaPago: Pagos.corregirFecha,
    listarPagos: Pagos.listar,
    cobranza: Cobranza.resumen,

    // Compras / facturas
    crearCompra: Compras.crear,
    detalleCompra: function (u, d) { return Compras.detalle(u, d.id); },
    listarCompras: Compras.listar,
    anularCompra: Compras.anular,
    subirArchivoCompra: Compras.subirArchivo,
    archivosPendientes: Compras.archivosPendientes,
    leerFacturaIA: Compras.leerConIA,

    // Inventario
    stock: Inventario.stock,
    kardex: Inventario.kardex,
    traslado: Inventario.traslado,
    conteo: Inventario.conteo,

    // Reportes
    inicio: Reportes.inicio,
    conciliacion: Reportes.conciliacion,
    comisiones: Reportes.comisiones,
    liquidarComisiones: Reportes.liquidarComisiones,
    revertirLiquidacion: Reportes.revertirLiquidacion,

    // Catálogo y ajustes
    guardarProducto: Catalogo.guardarProducto,
    guardarLinea: Catalogo.guardarLinea,
    guardarVendedor: Catalogo.guardarVendedor,
    guardarUbicacion: Catalogo.guardarUbicacion,
    usuarios: Catalogo.usuarios,
    crearUsuario: Catalogo.crearUsuario,
    editarUsuario: Catalogo.editarUsuario,
    restablecerClave: Catalogo.restablecerClave,
    config: Catalogo.config,
    guardarConfig: Catalogo.guardarConfig,
    auditoria: Catalogo.auditoria,

    // Migración desde la hoja "Cubitt"
    analizarMigracion: function (u, d) { exigirAdmin(u); return Migracion.ejecutar(u, Object.assign({}, d, { simular: true })); },
    ejecutarMigracion: function (u, d) { exigirAdmin(u); return Migracion.ejecutar(u, Object.assign({}, d, { simular: false })); },
    sincronizarBDD: Migracion.sincronizarBDD,
    disponible: Catalogo.disponible,
    generarCatalogoPdf: Catalogo.generarCatalogoPdf,
    subirImagenProducto: Catalogo.subirImagenProducto
    };
  }

function _respuesta(fn) {
  try {
    return { ok: true, data: fn() };
  } catch (e) {
    var msg = (e && e.message) ? e.message : String(e);
    if (msg !== 'SESION_VENCIDA' && !/^(STOCK_INSUFICIENTE|DUPLICADO)/.test(msg)) console.warn(msg);
    return { ok: false, error: msg };
  }
}

/** Único punto de entrada para el navegador. */
function api(token, accion, datos) {
  return _respuesta(function () {
    Db.limpiarMemo();
    var u = Auth.sesion(token);
    if (u.debe_cambiar_clave === 'SI' && accion !== 'cambiarClave' && accion !== 'yo') throw new Error('DEBE_CAMBIAR_CLAVE');
    var h = acciones()[accion];
    if (!h) throw new Error('Acción desconocida: ' + accion);
    return h(u, datos || {});
  });
}

function login(usuario, clave) {
  return _respuesta(function () {
    Db.limpiarMemo();
    if (!Db.instalada()) throw new Error('NO_INSTALADA');
    return Auth.login(usuario, clave);
  });
}

function logout(token) {
  return _respuesta(function () { Auth.logout(token); return true; });
}

/** Estado de la instalación para la pantalla inicial. */
function estadoInstalacion() {
  return _respuesta(function () {
    var instalada = Db.instalada();
    return { instalada: instalada, conUsuarios: instalada ? Auth.hayUsuarios() : false };
  });
}

/**
 * PASO 1 DE LA INSTALACIÓN — ejecútalo UNA vez desde el editor de Apps Script
 * (menú Ejecutar ▸ instalar). Crea la hoja de base de datos y muestra en el registro
 * un código de instalación de un solo uso para crear el usuario administrador en la app.
 */
function instalar() {
  var ss = Db.instalar('Cubitt Admin — Base de datos');
  conBloqueo(function () {
    if (!Db.leer('Ubicaciones').length) {
      Db.insertar('Ubicaciones', [
        { id: 'UB-TRINITARIAS', nombre: 'Barquisimeto · Trinitarias', activo: 'SI', notas: 'Sede principal' },
        { id: 'UB-TMANIA', nombre: 'Barquisimeto · T-Mania', activo: 'SI', notas: 'Consignación' },
        { id: 'UB-MARACAY', nombre: 'Maracay', activo: 'SI', notas: '' }
      ]);
    }
    var cfg = Db.config();
    if (!cfg.NOMBRE_NEGOCIO) Db.guardarConfig('NOMBRE_NEGOCIO', 'Cubitt');
    if (!cfg.UBICACION_POR_DEFECTO) Db.guardarConfig('UBICACION_POR_DEFECTO', 'UB-TRINITARIAS');
    if (!cfg.HOJA_ORIGEN_ID) Db.guardarConfig('HOJA_ORIGEN_ID', '18a86QMObmZnX611SmtSBRLVIvZJRYHnqFSr5vFCBtIw');
  });
  var mensaje = 'Base de datos lista: ' + ss.getUrl();
  if (!Auth.hayUsuarios()) {
    var codigo = String(Math.floor(100000 + Math.random() * 900000));
    PropertiesService.getScriptProperties().setProperty('CODIGO_INSTALACION', codigo);
    mensaje += '\n\nCÓDIGO DE INSTALACIÓN: ' + codigo + '\nÚsalo en la app para crear el usuario administrador.';
  }
  console.log(mensaje);
  return mensaje;
}

/** PASO 2 — desde la app: crea el primer administrador con el código del registro. */
function crearAdministradorInicial(codigo, datos) {
  return _respuesta(function () {
    return conBloqueo(function () {
      if (!Db.instalada()) throw new Error('Primero ejecuta la función "instalar" en el editor de Apps Script.');
      if (Auth.hayUsuarios()) throw new Error('Ya existe un administrador. Inicia sesión.');
      var props = PropertiesService.getScriptProperties();
      var esperado = props.getProperty('CODIGO_INSTALACION');
      if (!esperado || String(codigo).trim() !== esperado) throw new Error('El código de instalación no es correcto.');
      var u = Auth.crearUsuario({ usuario: datos.usuario, nombre: datos.nombre, clave: datos.clave, rol: ROL.ADMIN }, null);
      props.deleteProperty('CODIGO_INSTALACION');
      return Auth.login(datos.usuario, datos.clave);
    });
  });
}
