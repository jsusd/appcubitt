/**
 * CUBITT ADMIN — servidor (archivo generado; no editar aquí, editar cubitt-admin/src/ y ejecutar node construir.js)
 * Pega TODO este contenido en el archivo Código.gs del editor de Apps Script.
 */

// ==================== Dominio.gs ====================
/**
 * Dominio.gs — Reglas de negocio puras (sin acceso a hojas).
 * Todo lo que calcula saldos, stock, comisiones y conciliación vive aquí para que
 * sea fácil de probar y para que cada pantalla use exactamente las mismas fórmulas.
 */

var TIPO_VENTA = { CONTADO: 'CONTADO', CREDITO: 'CREDITO' };
var ESTADO = { ACTIVA: 'ACTIVA', ANULADA: 'ANULADA' };
var MOV = {
  INICIAL: 'INICIAL',
  COMPRA: 'COMPRA',
  VENTA: 'VENTA',
  ANULACION_VENTA: 'ANULACION_VENTA',
  ANULACION_COMPRA: 'ANULACION_COMPRA',
  TRASLADO_SALIDA: 'TRASLADO_SALIDA',
  TRASLADO_ENTRADA: 'TRASLADO_ENTRADA',
  AJUSTE: 'AJUSTE'
};

function r2(n) {
  var v = Number(n) || 0;
  return Math.round((v + (v >= 0 ? 1e-9 : -1e-9)) * 100) / 100;
}

function num(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  var s = String(v).replace(/[$\s]/g, '').replace(/Bs\.?/i, '');
  // Formatos "1,234.56" y "1.234,56"
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  var n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

function texto(v) {
  return (v === null || v === undefined) ? '' : String(v).trim();
}

function normSku(v) {
  return texto(v).toUpperCase().replace(/\s+/g, '').replace(/\(G\)$/, '');
}

function normNombre(v) {
  return texto(v).toUpperCase().replace(/\s+/g, ' ');
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }

/** Fecha -> 'aaaa-mm-dd' en la zona del negocio (sin desfases por UTC). */
function isoFecha(d) {
  if (!d) return '';
  if (typeof d === 'string') {
    var s = d.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    var m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (m) {
      var y = Number(m[3]); if (y < 100) y += 2000;
      return y + '-' + pad2(Number(m[2])) + '-' + pad2(Number(m[1]));
    }
    return '';
  }
  if (typeof d === 'number') return serialAFecha(d);
  if (Object.prototype.toString.call(d) === '[object Date]' && !isNaN(d.getTime())) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  return '';
}

/** Número de serie de Sheets/Excel (días desde 1899-12-30) -> 'aaaa-mm-dd'. */
function serialAFecha(n) {
  if (!n || n < 20000 || n > 80000) return '';
  var ms = Math.round(n) * 86400000 + Date.UTC(1899, 11, 30);
  var d = new Date(ms);
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}

function diasEntre(isoA, isoB) {
  var a = Date.UTC(+isoA.slice(0, 4), +isoA.slice(5, 7) - 1, +isoA.slice(8, 10));
  var b = Date.UTC(+isoB.slice(0, 4), +isoB.slice(5, 7) - 1, +isoB.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

function fechaValida(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  var t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1;
}

/**
 * Interpreta el texto de un comentario de pago de la hoja ("24/07", "PAGO 07/05",
 * "30/07 09/08", "propina 15/09", "24/07/26").
 * Devuelve { fecha: 'aaaa-mm-dd' | '', fechas: [...], nota: texto original }.
 * El año se deduce de la fecha de la venta: un pago nunca es muy anterior a la venta.
 */
function interpretarComentarioPago(textoComentario, fechaVentaIso, hoyIsoTxt) {
  var t = texto(textoComentario);
  var res = { fecha: '', fechas: [], nota: t };
  if (!t) return res;
  var baseY = fechaVentaIso ? Number(fechaVentaIso.slice(0, 4)) : new Date().getFullYear();
  // dd/mm, dd/mm/aa o dd/mm/aaaa (sin espacios: "30/07 - 09/08" son dos fechas, no el año 2009)
  var re = /(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{4}|\d{2})(?![\d\/]))?(?!\d)/g;
  var m;
  while ((m = re.exec(t)) !== null) {
    var d = Number(m[1]), mo = Number(m[2]);
    var y = m[3] ? Number(m[3]) : baseY;
    if (y < 100) y += 2000;
    if (!fechaValida(y, mo, d)) continue;
    var iso = y + '-' + pad2(mo) + '-' + pad2(d);
    if (!m[3] && fechaVentaIso) {
      // Pago en enero de una venta de diciembre -> año siguiente
      if (diasEntre(fechaVentaIso, iso) < -60) {
        var iso2 = (y + 1) + '-' + pad2(mo) + '-' + pad2(d);
        // Solo si no queda en el futuro (si no, es un error de tipeo y se reporta)
        if (diasEntre(fechaVentaIso, iso2) <= 400 && (!hoyIsoTxt || iso2 <= hoyIsoTxt)) iso = iso2;
      }
    }
    res.fechas.push(iso);
  }
  if (res.fechas.length) res.fecha = res.fechas[0];
  return res;
}

/** Saldo y estado de una venta a partir de sus líneas y pagos activos. */
function calcularEstadoVenta(venta, pagos) {
  var total = r2(num(venta.total));
  var pagado = 0;
  (pagos || []).forEach(function (p) {
    if (p.estado !== ESTADO.ANULADA) pagado += num(p.monto);
  });
  pagado = r2(pagado);
  var saldo = r2(total - pagado);
  var estadoPago;
  if (venta.estado === ESTADO.ANULADA) estadoPago = 'ANULADA';
  else if (saldo <= 0.005) estadoPago = saldo < -0.005 ? 'PAGO_DE_MAS' : 'PAGADA';
  else estadoPago = pagado > 0 ? 'ABONADA' : 'PENDIENTE';
  return { total: total, pagado: pagado, saldo: saldo, estadoPago: estadoPago };
}

/** Comisión sugerida: la del producto si la tiene, si no la de su línea, por la cantidad. */
function comisionSugerida(producto, lineasPorNombre, cantidad) {
  var q = num(cantidad) || 1;
  if (!producto) return 0;
  var c = texto(producto.comision) !== '' ? num(producto.comision) : null;
  if (c === null && producto.linea && lineasPorNombre) {
    var l = lineasPorNombre[normNombre(producto.linea)];
    if (l && texto(l.comision) !== '') c = num(l.comision);
  }
  return r2((c || 0) * q);
}

function claveStock(sku, ubicacionId) {
  return normSku(sku) + '|' + texto(ubicacionId);
}

/** Stock por SKU y ubicación a partir del libro de movimientos (única fuente de verdad). */
function calcularStock(movimientos) {
  var porClave = {};
  (movimientos || []).forEach(function (m) {
    var k = claveStock(m.sku, m.ubicacion_id);
    porClave[k] = r2((porClave[k] || 0) + num(m.cantidad));
  });
  return porClave;
}

/**
 * Conciliación por SKU: comprado vs vendido vs ajustes vs stock del sistema.
 * Detecta ventas sin compra registrada (stock negativo), compras sin ventas, etc.
 */
function conciliar(productos, movimientos) {
  var porSku = {};
  function fila(sku) {
    var k = normSku(sku);
    if (!porSku[k]) porSku[k] = { sku: k, inicial: 0, comprado: 0, vendido: 0, anulado: 0, ajustes: 0, traslados: 0, stock: 0 };
    return porSku[k];
  }
  (productos || []).forEach(function (p) { if (p.sku) fila(p.sku); });
  var porUbic = calcularStock(movimientos);
  (movimientos || []).forEach(function (m) {
    var f = fila(m.sku), q = num(m.cantidad);
    switch (m.tipo) {
      case MOV.INICIAL: f.inicial += q; break;
      case MOV.COMPRA: f.comprado += q; break;
      case MOV.ANULACION_COMPRA: f.comprado += q; break;
      case MOV.VENTA: f.vendido += -q; break;
      case MOV.ANULACION_VENTA: f.vendido += -q; break;
      case MOV.AJUSTE: f.ajustes += q; break;
      case MOV.TRASLADO_SALIDA:
      case MOV.TRASLADO_ENTRADA: f.traslados += q; break;
    }
    f.stock += q;
  });
  var prodPorSku = {};
  (productos || []).forEach(function (p) { prodPorSku[normSku(p.sku)] = p; });
  var filas = Object.keys(porSku).map(function (k) {
    var f = porSku[k];
    ['inicial', 'comprado', 'vendido', 'ajustes', 'traslados', 'stock'].forEach(function (c) { f[c] = r2(f[c]); });
    var p = prodPorSku[k];
    f.descripcion = p ? [p.linea, p.modelo, p.color].filter(function (x) { return texto(x); }).join(' · ') || texto(p.descripcion) : '';
    f.existeEnCatalogo = !!p;
    var alertas = [];
    if (f.stock < 0) alertas.push('Se vendió más de lo comprado: faltan ' + (-f.stock) + ' und por registrar en compras');
    if (!p) alertas.push('SKU no está en el catálogo de productos');
    if (f.ajustes > 0) alertas.push('Hay ' + f.ajustes + ' und más de lo que explican las compras (ajuste por inventario real): probablemente falta registrar facturas de compra');
    else if (f.ajustes < 0) alertas.push('Faltan ' + (-f.ajustes) + ' und según el inventario real (pérdida, regalo o venta no registrada)');
    f.negativoEn = Object.keys(porUbic).filter(function (key) { return key.split('|')[0] === k && porUbic[key] < 0; })
      .map(function (key) { return { ubicacion_id: key.split('|')[1], stock: porUbic[key] }; });
    if (f.stock >= 0 && f.negativoEn.length) {
      alertas.push('Negativo en ' + f.negativoEn.map(function (n) { return n.ubicacion_id + ' (' + n.stock + ')'; }).join(', ') + ': falta registrar un traslado');
    }
    f.alertas = alertas;
    f.ok = alertas.length === 0 || (alertas.length === 1 && f.ajustes !== 0 && f.stock >= 0 && !f.negativoEn.length);
    return f;
  });
  filas.sort(function (a, b) { return (a.stock - b.stock) || a.sku.localeCompare(b.sku); });
  var resumen = filas.reduce(function (acc, f) {
    acc.comprado += f.comprado; acc.vendido += f.vendido; acc.ajustes += f.ajustes; acc.stock += f.stock;
    if (f.stock < 0) { acc.skusNegativos++; acc.unidadesSinCompra += -f.stock; }
    else if (f.negativoEn.length) acc.skusNegativosPorUbicacion++;
    return acc;
  }, { comprado: 0, vendido: 0, ajustes: 0, stock: 0, skusNegativos: 0, unidadesSinCompra: 0, skusNegativosPorUbicacion: 0 });
  return { filas: filas, resumen: resumen };
}

/**
 * Clientes "por identificar": en la hoja se escribía PENDIENTE (o se dejaba vacío) cuando aún no se tenía
 * el nombre. No son una persona: cada venta así se muestra aparte para asignarle su cliente real.
 */
var CLIENTES_POR_IDENTIFICAR = { '': 1, 'PENDIENTE': 1, 'SIN NOMBRE': 1, 'POR IDENTIFICAR': 1, 'SIN CLIENTE': 1, 'N/A': 1, 'NA': 1, '-': 1, '?': 1, 'NO SE': 1, 'DESCONOCIDO': 1 };
var CLIENTE_POR_IDENTIFICAR = 'POR IDENTIFICAR';

/** Clave para agrupar un cliente aunque lo hayan escrito con o sin acentos / espacios extra. */
function claveCliente(nombre) {
  var t = normNombre(nombre);
  try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
  return t;
}

function esClientePendiente(nombre) {
  return !!CLIENTES_POR_IDENTIFICAR[claveCliente(nombre)];
}

/** Saca la URL de una celda de imagen: =IMAGE("https://...") o una URL suelta. */
function extraerUrlImagen(v) {
  var t = texto(v);
  if (!t) return '';
  var m = t.match(/https?:\/\/[^"'\s)]+/i);
  return m ? m[0] : '';
}

/**
 * Ajustes para que el stock del sistema sea igual al inventario físico real.
 * reales = { SKU: cantidad }. Todo el inventario real se asigna a ubicacionDestino;
 * en las demás ubicaciones el stock de esos productos queda en 0.
 * Devuelve [{ sku, ubicacion_id, sistema, real, diferencia }] solo donde hay diferencia.
 */
function ajustesInventarioReal(stockPorClave, reales, ubicacionDestino, ubicacionIds) {
  var out = [];
  Object.keys(reales).forEach(function (sku) {
    var s = normSku(sku);
    var real = num(reales[sku]);
    (ubicacionIds || []).forEach(function (ub) {
      var sistema = stockPorClave[claveStock(s, ub)] || 0;
      var objetivo = ub === ubicacionDestino ? real : 0;
      var dif = r2(objetivo - sistema);
      if (dif !== 0) out.push({ sku: s, ubicacion_id: ub, sistema: sistema, real: objetivo, diferencia: dif });
    });
  });
  return out;
}

/** Valida y normaliza los datos de una venta nueva. Lanza Error con mensaje claro. */
function validarVentaNueva(v) {
  var errores = [];
  if (!isoFecha(v.fecha)) errores.push('La fecha es obligatoria.');
  if (!texto(v.vendedor_id)) errores.push('Selecciona el vendedor.');
  if (!texto(v.ubicacion_id)) errores.push('Selecciona la ubicación de donde sale la mercancía.');
  if (v.tipo !== TIPO_VENTA.CONTADO && v.tipo !== TIPO_VENTA.CREDITO) errores.push('Indica si es contado o crédito.');
  if (!v.items || !v.items.length) errores.push('Agrega al menos un producto.');
  (v.items || []).forEach(function (it, i) {
    if (!normSku(it.sku)) errores.push('Producto ' + (i + 1) + ': falta el código.');
    if (!(num(it.cantidad) > 0)) errores.push('Producto ' + (i + 1) + ': cantidad inválida.');
    if (num(it.precio_unit) < 0) errores.push('Producto ' + (i + 1) + ': precio inválido.');
    if (num(it.comision) < 0) errores.push('Producto ' + (i + 1) + ': comisión inválida.');
  });
  if (v.fiscal && !texto(v.factura_fiscal)) errores.push('Si se facturó fiscalmente, indica el número de factura fiscal.');
  var total = r2((v.items || []).reduce(function (a, it) { return a + num(it.cantidad) * num(it.precio_unit); }, 0));
  var pagoInicial = r2(num(v.pago_inicial));
  if (pagoInicial < 0) errores.push('El pago inicial no puede ser negativo.');
  if (pagoInicial - total > 0.005) errores.push('El pago inicial no puede ser mayor que el total ($' + total.toFixed(2) + ').');
  if (v.tipo === TIPO_VENTA.CONTADO && Math.abs(pagoInicial - total) > 0.005) {
    errores.push('Una venta de contado debe pagarse completa ($' + total.toFixed(2) + '). Si queda saldo, márcala como crédito.');
  }
  if (errores.length) throw new Error(errores.join('\n'));
  return total;
}

/** Comisiones por vendedor en un rango, separando las de ventas ya cobradas completas. */
function resumirComisiones(ventas, estadosPorVenta) {
  var porVendedor = {};
  (ventas || []).forEach(function (v) {
    if (v.estado === ESTADO.ANULADA) return;
    var k = v.vendedor_id || v.vendedor;
    if (!porVendedor[k]) porVendedor[k] = { vendedor_id: v.vendedor_id, vendedor: v.vendedor, ventas: 0, vendido: 0, generada: 0, cobrable: 0, pagada: 0, pendientePago: 0, porCobrar: 0 };
    var r = porVendedor[k];
    var com = num(v.comision);
    var est = estadosPorVenta[v.id] || { saldo: 0 };
    r.ventas++;
    r.vendido += num(v.total);
    r.generada += com;
    if (texto(v.comision_pagada_en)) r.pagada += com;
    else if (est.saldo <= 0.005) r.cobrable += com;
    else r.porCobrar += com;
  });
  return Object.keys(porVendedor).map(function (k) {
    var r = porVendedor[k];
    ['vendido', 'generada', 'cobrable', 'pagada', 'porCobrar'].forEach(function (c) { r[c] = r2(r[c]); });
    r.pendientePago = r2(r.cobrable + r.porCobrar);
    return r;
  }).sort(function (a, b) { return b.vendido - a.vendido; });
}

if (typeof module !== 'undefined') {
  module.exports = {
    r2: r2, num: num, texto: texto, normSku: normSku, isoFecha: isoFecha, serialAFecha: serialAFecha,
    interpretarComentarioPago: interpretarComentarioPago, calcularEstadoVenta: calcularEstadoVenta,
    comisionSugerida: comisionSugerida, calcularStock: calcularStock, conciliar: conciliar,
    validarVentaNueva: validarVentaNueva, resumirComisiones: resumirComisiones, MOV: MOV,
    extraerUrlImagen: extraerUrlImagen, ajustesInventarioReal: ajustesInventarioReal,
    claveCliente: claveCliente, esClientePendiente: esClientePendiente
  };
}


// ==================== Datos.gs ====================
/**
 * Datos.gs — Acceso a la base de datos (una hoja de cálculo con una pestaña por tabla).
 * Reglas para que los datos sean confiables:
 *  - La fila 1 de cada pestaña son los encabezados; no hay filas de totales ni fórmulas.
 *  - Cada registro tiene un id único que nunca se reutiliza.
 *  - Nada se borra: las ventas, pagos y compras se ANULAN (quedan en el historial).
 *  - Toda escritura se hace dentro de un bloqueo (LockService) para que dos personas
 *    registrando al mismo tiempo no se pisen.
 */

var ESQUEMA = {
  Config:        ['clave', 'valor'],
  Usuarios:      ['id', 'usuario', 'nombre', 'rol', 'vendedor_id', 'hash', 'salt', 'activo', 'debe_cambiar_clave', 'creado_en'],
  Vendedores:    ['id', 'nombre', 'telefono', 'activo', 'notas', 'creado_en'],
  Ubicaciones:   ['id', 'nombre', 'activo', 'notas'],
  Lineas:        ['nombre', 'comision', 'notas'],
  Productos:     ['sku', 'linea', 'modelo', 'color', 'descripcion', 'costo', 'pvp', 'comision', 'activo', 'imagen', 'actualizado_en'],
  Ventas:        ['id', 'fecha', 'cliente', 'telefono', 'vendedor_id', 'vendedor', 'ubicacion_id', 'tipo', 'total', 'comision',
                  'costo', 'fiscal', 'factura_fiscal', 'estado', 'motivo_anulacion', 'comision_pagada_en', 'liquidacion_id',
                  'notas', 'origen', 'fila_origen', 'creado_por', 'creado_en'],
  VentaItems:    ['id', 'venta_id', 'sku', 'descripcion', 'cantidad', 'precio_unit', 'subtotal', 'costo_unit', 'comision'],
  Pagos:         ['id', 'venta_id', 'fecha', 'monto', 'metodo', 'nota', 'fecha_estimada', 'estado', 'motivo_anulacion', 'creado_por', 'creado_en'],
  Compras:       ['id', 'fecha', 'proveedor', 'rif', 'nro_factura', 'nro_control', 'ubicacion_id', 'moneda', 'tasa', 'subtotal',
                  'iva', 'total', 'metodo_pago', 'archivo_url', 'archivo_id', 'estado', 'motivo_anulacion', 'notas', 'origen',
                  'creado_por', 'creado_en'],
  CompraItems:   ['id', 'compra_id', 'sku', 'descripcion', 'cantidad', 'costo_unit', 'subtotal'],
  Movimientos:   ['id', 'fecha', 'sku', 'ubicacion_id', 'cantidad', 'tipo', 'ref_id', 'nota', 'creado_por', 'creado_en'],
  Liquidaciones: ['id', 'fecha', 'vendedor_id', 'vendedor', 'monto', 'ventas', 'nota', 'creado_por', 'creado_en'],
  Auditoria:     ['momento', 'usuario', 'accion', 'detalle']
};

var NUMERICOS = {
  total: 1, comision: 1, costo: 1, pvp: 1, cantidad: 1, precio_unit: 1, subtotal: 1, costo_unit: 1, monto: 1,
  tasa: 1, iva: 1, fila_origen: 1
};
var FECHAS = { fecha: 1 };

var _memo = {};
var _ssMemo = null;
var _propsMemo = null;

/*
 * Caché entre solicitudes (para que la app sea rápida): cada tabla leída se guarda en CacheService
 * con la "versión" de esa tabla. Toda escritura (insertar/actualizar/borrar) cambia la versión, así
 * que nunca se sirven datos viejos. Si alguien edita la hoja a mano, usar Ajustes ▸ Recargar datos.
 */
var CACHE_TROZO = 45000;      // caracteres por entrada (CacheService admite ~100 KB por clave)
var CACHE_SEGUNDOS = 21600;   // 6 horas (máximo de CacheService)

function _props() {
  if (!_propsMemo) _propsMemo = PropertiesService.getScriptProperties().getProperties();
  return _propsMemo;
}

function _versionTabla(tabla) {
  return _props()['VER_' + tabla] || '0';
}

function _cambiarVersion(tabla) {
  var v = String(Date.now()) + Math.floor(Math.random() * 1000);
  PropertiesService.getScriptProperties().setProperty('VER_' + tabla, v);
  if (_propsMemo) _propsMemo['VER_' + tabla] = v;
}

function _leerCache(tabla) {
  try {
    var cache = CacheService.getScriptCache();
    var clave = 'T2_' + tabla + '_' + _versionTabla(tabla);
    var n = cache.get(clave);
    if (n === null || n === undefined) return null;
    n = Number(n);
    var claves = [];
    for (var i = 0; i < n; i++) claves.push(clave + '_' + i);
    var partes = n ? cache.getAll(claves) : {};
    var txt = '';
    for (var j = 0; j < n; j++) {
      if (partes[claves[j]] === undefined || partes[claves[j]] === null) return null;
      txt += partes[claves[j]];
    }
    return n ? JSON.parse(txt) : [];
  } catch (e) {
    return null;
  }
}

function _guardarCache(tabla, datos) {
  try {
    var cache = CacheService.getScriptCache();
    var clave = 'T2_' + tabla + '_' + _versionTabla(tabla);
    var txt = JSON.stringify(datos);
    var valores = {};
    var n = 0;
    for (var i = 0; i < txt.length; i += CACHE_TROZO) valores[clave + '_' + (n++)] = txt.slice(i, i + CACHE_TROZO);
    if (n > 60) return; // tabla demasiado grande para la caché: se lee de la hoja
    if (n) cache.putAll(valores, CACHE_SEGUNDOS);
    cache.put(clave, String(n), CACHE_SEGUNDOS);
  } catch (e) { /* la caché es opcional */ }
}

var Db = {
  /** Hoja de cálculo que funciona como base de datos (se crea en la instalación). */
  ss: function () {
    if (_ssMemo) return _ssMemo;
    var id = PropertiesService.getScriptProperties().getProperty('DB_ID');
    if (!id) throw new Error('La base de datos no está instalada. Abre la app como administrador para instalarla.');
    _ssMemo = SpreadsheetApp.openById(id);
    return _ssMemo;
  },

  instalada: function () {
    return !!PropertiesService.getScriptProperties().getProperty('DB_ID');
  },

  /** Crea la hoja de base de datos (si no existe) y todas las pestañas con sus encabezados. */
  instalar: function (nombre) {
    var props = PropertiesService.getScriptProperties();
    var id = props.getProperty('DB_ID');
    var ss;
    if (id) {
      ss = SpreadsheetApp.openById(id);
    } else {
      ss = SpreadsheetApp.create(nombre || 'Cubitt Admin — Base de datos');
      props.setProperty('DB_ID', ss.getId());
    }
    _ssMemo = ss;
    Db.asegurarEsquema();
    var hoja1 = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1') || ss.getSheetByName('Hoja1');
    if (hoja1 && ss.getSheets().length > 1) ss.deleteSheet(hoja1);
    return ss;
  },

  asegurarEsquema: function () {
    var ss = Db.ss();
    Object.keys(ESQUEMA).forEach(function (tabla) {
      var cols = ESQUEMA[tabla];
      var sh = ss.getSheetByName(tabla);
      if (!sh) {
        sh = ss.insertSheet(tabla);
        sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
        sh.setFrozenRows(1);
        // Texto plano: evita que Sheets convierta fechas o códigos (ej. "3-1") por su cuenta
        sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
        return;
      }
      var lastCol = Math.max(sh.getLastColumn(), 1);
      var actuales = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(texto);
      var faltan = cols.filter(function (c) { return actuales.indexOf(c) === -1; });
      if (faltan.length) {
        sh.getRange(1, actuales.filter(String).length + 1, 1, faltan.length).setValues([faltan]).setFontWeight('bold');
      }
    });
  },

  _hoja: function (tabla) {
    var sh = Db.ss().getSheetByName(tabla);
    if (!sh) throw new Error('Falta la pestaña "' + tabla + '" en la base de datos.');
    return sh;
  },

  _encabezados: function (sh) {
    var lastCol = Math.max(sh.getLastColumn(), 1);
    return sh.getRange(1, 1, 1, lastCol).getValues()[0].map(texto);
  },

  /** Devuelve todos los registros de una tabla como objetos (memoizado por solicitud). */
  leer: function (tabla) {
    if (_memo[tabla]) return _memo[tabla];
    var enCache = _leerCache(tabla);
    if (enCache) { _memo[tabla] = enCache; return enCache; }
    var sh = Db._hoja(tabla);
    var enc = Db._encabezados(sh);
    var last = sh.getLastRow();
    var filas = last > 1 ? sh.getRange(2, 1, last - 1, enc.length).getValues() : [];
    var out = [];
    for (var i = 0; i < filas.length; i++) {
      var f = filas[i];
      if (f.every(function (v) { return v === '' || v === null; })) continue;
      var o = { _fila: i + 2 };
      for (var j = 0; j < enc.length; j++) {
        var c = enc[j];
        if (!c) continue;
        var v = f[j];
        if (NUMERICOS[c]) o[c] = (v === '' || v === null) ? '' : num(v);
        else if (FECHAS[c]) o[c] = isoFecha(v);
        else o[c] = (v === null || v === undefined) ? '' : (Object.prototype.toString.call(v) === '[object Date]' ? v.toISOString() : String(v));
      }
      out.push(o);
    }
    _memo[tabla] = out;
    _guardarCache(tabla, out);
    return out;
  },

  porId: function (tabla, id, campo) {
    campo = campo || 'id';
    var lista = Db.leer(tabla);
    for (var i = 0; i < lista.length; i++) if (String(lista[i][campo]) === String(id)) return lista[i];
    return null;
  },

  _fila: function (enc, obj) {
    return enc.map(function (c) {
      var v = obj[c];
      if (v === undefined || v === null) return '';
      if (typeof v === 'boolean') return v ? 'SI' : 'NO';
      if (typeof v === 'number') return isFinite(v) ? v : '';
      return String(v);
    });
  },

  insertar: function (tabla, objs) {
    if (!objs || !objs.length) return;
    var sh = Db._hoja(tabla);
    var enc = Db._encabezados(sh);
    var filas = objs.map(function (o) { return Db._fila(enc, o); });
    var inicio = sh.getLastRow() + 1;
    // Lotes grandes (migración) en bloques para no exceder límites
    var LOTE = 2000;
    for (var k = 0; k < filas.length; k += LOTE) {
      var parte = filas.slice(k, k + LOTE);
      sh.getRange(inicio + k, 1, parte.length, enc.length).setValues(parte);
    }
    delete _memo[tabla];
    _cambiarVersion(tabla);
  },

  actualizar: function (tabla, id, cambios, campo) {
    var reg = Db.porId(tabla, id, campo);
    if (!reg) throw new Error('No se encontró el registro ' + id + ' en ' + tabla + '.');
    var sh = Db._hoja(tabla);
    var enc = Db._encabezados(sh);
    var nuevo = {};
    enc.forEach(function (c) { nuevo[c] = reg[c]; });
    Object.keys(cambios).forEach(function (c) { nuevo[c] = cambios[c]; });
    sh.getRange(reg._fila, 1, 1, enc.length).setValues([Db._fila(enc, nuevo)]);
    // Actualizar también la copia en memoria (evita releer la hoja tras cada cambio)
    if (_memo[tabla]) {
      var copia = { _fila: reg._fila };
      enc.forEach(function (c) { if (c) copia[c] = NUMERICOS[c] ? (nuevo[c] === '' || nuevo[c] === null || nuevo[c] === undefined ? '' : num(nuevo[c])) : FECHAS[c] ? isoFecha(nuevo[c]) : (nuevo[c] === undefined || nuevo[c] === null ? '' : (typeof nuevo[c] === 'boolean' ? (nuevo[c] ? 'SI' : 'NO') : String(nuevo[c]))); });
      _memo[tabla] = _memo[tabla].map(function (o) { return o._fila === reg._fila ? copia : o; });
    }
    _cambiarVersion(tabla); // la próxima solicitud relee la hoja una vez y vuelve a guardar la caché
    return nuevo;
  },

  /** Reescribe una tabla completa sin las filas que cumplan el predicado (solo para re-migrar). */
  borrarDonde: function (tabla, predicado) {
    var lista = Db.leer(tabla);
    var quedan = lista.filter(function (o) { return !predicado(o); });
    if (quedan.length === lista.length) return 0;
    var sh = Db._hoja(tabla);
    var enc = Db._encabezados(sh);
    var last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, enc.length).clearContent();
    delete _memo[tabla];
    if (quedan.length) {
      sh.getRange(2, 1, quedan.length, enc.length).setValues(quedan.map(function (o) { return Db._fila(enc, o); }));
    }
    delete _memo[tabla];
    _cambiarVersion(tabla);
    return lista.length - quedan.length;
  },

  /** Ids correlativos legibles (V-000001). Se guardan en propiedades del script: nunca se repiten. */
  siguienteId: function (prefijo, cantidad) {
    var props = PropertiesService.getScriptProperties();
    var clave = 'SEQ_' + prefijo;
    var n = Number(props.getProperty(clave) || '0');
    var n2 = n + (cantidad || 1);
    props.setProperty(clave, String(n2));
    var ids = [];
    for (var i = n + 1; i <= n2; i++) ids.push(prefijo + '-' + ('000000' + i).slice(-6));
    return cantidad ? ids : ids[0];
  },

  config: function () {
    var out = {};
    Db.leer('Config').forEach(function (r) { out[r.clave] = r.valor; });
    return out;
  },

  guardarConfig: function (clave, valor) {
    if (Db.porId('Config', clave, 'clave')) Db.actualizar('Config', clave, { valor: valor }, 'clave');
    else Db.insertar('Config', [{ clave: clave, valor: valor }]);
  },

  limpiarMemo: function () { _memo = {}; _propsMemo = null; },

  /** Olvida la caché de todas las tablas (por si alguien editó la hoja a mano). */
  olvidarCache: function () {
    Object.keys(ESQUEMA).forEach(_cambiarVersion);
    _memo = {};
  }
};

/** Ejecuta fn con el bloqueo global de escritura. */
function conBloqueo(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('El sistema está ocupado guardando otro registro. Intenta de nuevo en unos segundos.');
  try {
    Db.limpiarMemo(); // leer siempre lo último que hay en la hoja dentro del bloqueo
    var r = fn();
    SpreadsheetApp.flush();
    return r;
  } finally {
    lock.releaseLock();
  }
}

// Fija para no depender de la zona configurada en el proyecto de Apps Script
var ZONA_HORARIA = 'America/Caracas';

function ahoraIso() {
  return Utilities.formatDate(new Date(), ZONA_HORARIA, "yyyy-MM-dd'T'HH:mm:ss");
}

function hoyIso() {
  return Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd');
}

function auditar(usuario, accion, detalle) {
  Db.insertar('Auditoria', [{ momento: ahoraIso(), usuario: usuario ? usuario.usuario : 'sistema', accion: accion, detalle: typeof detalle === 'string' ? detalle : JSON.stringify(detalle) }]);
}


// ==================== Auth.gs ====================
/**
 * Auth.gs — Usuarios y sesiones.
 * - Las contraseñas se guardan con hash SHA-256 + sal (nunca en texto plano).
 * - Cada llamada al servidor exige un token de sesión válido; el servidor decide
 *   qué puede ver y hacer cada rol (no el navegador).
 * Roles: ADMIN (todo) y VENDEDOR (registra ventas/pagos propios, ve sus ventas,
 * comisiones y el stock).
 */

var ROL = { ADMIN: 'ADMIN', VENDEDOR: 'VENDEDOR' };
var DURACION_SESION_DIAS = 30;

function hashClave(clave, salt) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '::' + clave, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function validarClaveNueva(clave) {
  if (!clave || String(clave).length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');
}

function usuarioPublico(u) {
  return {
    id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, vendedor_id: u.vendedor_id,
    activo: u.activo !== 'NO', debe_cambiar_clave: u.debe_cambiar_clave === 'SI'
  };
}

var Auth = {
  hayUsuarios: function () {
    return Db.leer('Usuarios').length > 0;
  },

  crearUsuario: function (datos, autor) {
    var usuario = texto(datos.usuario).toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) throw new Error('El usuario debe tener 3 a 30 caracteres (letras, números, punto o guion).');
    if (Db.leer('Usuarios').some(function (u) { return u.usuario === usuario; })) throw new Error('Ya existe el usuario "' + usuario + '".');
    if (!texto(datos.nombre)) throw new Error('El nombre es obligatorio.');
    var rol = datos.rol === ROL.ADMIN ? ROL.ADMIN : ROL.VENDEDOR;
    if (rol === ROL.VENDEDOR && !texto(datos.vendedor_id)) throw new Error('Un usuario vendedor debe estar vinculado a un vendedor.');
    validarClaveNueva(datos.clave);
    var salt = Utilities.getUuid();
    var u = {
      id: Db.siguienteId('U'), usuario: usuario, nombre: texto(datos.nombre), rol: rol,
      vendedor_id: rol === ROL.VENDEDOR ? texto(datos.vendedor_id) : '',
      hash: hashClave(String(datos.clave), salt), salt: salt, activo: 'SI',
      debe_cambiar_clave: datos.debe_cambiar_clave ? 'SI' : 'NO', creado_en: ahoraIso()
    };
    Db.insertar('Usuarios', [u]);
    auditar(autor, 'USUARIO_CREADO', u.usuario + ' (' + rol + ')');
    return usuarioPublico(u);
  },

  login: function (usuario, clave) {
    usuario = texto(usuario).toLowerCase();
    var u = Db.leer('Usuarios').filter(function (x) { return x.usuario === usuario; })[0];
    // Mismo mensaje para usuario inexistente o clave errada (no revela qué usuarios existen)
    if (!u || hashClave(String(clave || ''), u.salt) !== u.hash) {
      Utilities.sleep(400);
      throw new Error('Usuario o contraseña incorrectos.');
    }
    if (u.activo === 'NO') throw new Error('Este usuario está desactivado. Habla con el administrador.');
    var token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
    var props = PropertiesService.getScriptProperties();
    props.setProperty('SES_' + token, JSON.stringify({ uid: u.id, exp: Date.now() + DURACION_SESION_DIAS * 86400000 }));
    Auth._limpiarSesionesVencidas(props);
    return { token: token, usuario: usuarioPublico(u) };
  },

  logout: function (token) {
    if (token) PropertiesService.getScriptProperties().deleteProperty('SES_' + token);
  },

  /** Devuelve el usuario de la sesión o lanza error. */
  sesion: function (token) {
    if (!token) throw new Error('SESION_VENCIDA');
    var raw = PropertiesService.getScriptProperties().getProperty('SES_' + token);
    if (!raw) throw new Error('SESION_VENCIDA');
    var s = JSON.parse(raw);
    if (s.exp < Date.now()) {
      PropertiesService.getScriptProperties().deleteProperty('SES_' + token);
      throw new Error('SESION_VENCIDA');
    }
    var u = Db.porId('Usuarios', s.uid);
    if (!u || u.activo === 'NO') throw new Error('SESION_VENCIDA');
    return u;
  },

  cambiarClave: function (u, actual, nueva) {
    if (hashClave(String(actual || ''), u.salt) !== u.hash) throw new Error('La contraseña actual no es correcta.');
    validarClaveNueva(nueva);
    var salt = Utilities.getUuid();
    Db.actualizar('Usuarios', u.id, { hash: hashClave(String(nueva), salt), salt: salt, debe_cambiar_clave: 'NO' });
    auditar(u, 'CLAVE_CAMBIADA', u.usuario);
  },

  restablecerClave: function (admin, usuarioId, nueva) {
    validarClaveNueva(nueva);
    var u = Db.porId('Usuarios', usuarioId);
    if (!u) throw new Error('Usuario no encontrado.');
    var salt = Utilities.getUuid();
    Db.actualizar('Usuarios', u.id, { hash: hashClave(String(nueva), salt), salt: salt, debe_cambiar_clave: 'SI' });
    Auth._cerrarSesionesDe(u.id);
    auditar(admin, 'CLAVE_RESTABLECIDA', u.usuario);
  },

  _cerrarSesionesDe: function (uid) {
    var props = PropertiesService.getScriptProperties();
    var todas = props.getProperties();
    Object.keys(todas).forEach(function (k) {
      if (k.indexOf('SES_') !== 0) return;
      try { if (JSON.parse(todas[k]).uid === uid) props.deleteProperty(k); } catch (e) { props.deleteProperty(k); }
    });
  },

  _limpiarSesionesVencidas: function (props) {
    var todas = props.getProperties();
    var ahora = Date.now();
    Object.keys(todas).forEach(function (k) {
      if (k.indexOf('SES_') !== 0) return;
      try { if (JSON.parse(todas[k]).exp < ahora) props.deleteProperty(k); } catch (e) { props.deleteProperty(k); }
    });
  }
};

function esAdmin(u) { return u && u.rol === ROL.ADMIN; }

function exigirAdmin(u) {
  if (!esAdmin(u)) throw new Error('Esta acción es solo para administradores.');
}


// ==================== Ventas.gs ====================
/**
 * Ventas.gs — Ventas, pagos (abonos) y cobranza.
 * Una venta tiene una o varias líneas (VentaItems) y cero o más pagos (Pagos).
 * El saldo pendiente SIEMPRE se calcula: total − pagos activos. No se guarda a mano.
 */

function _mapa(lista, campo) {
  var m = {};
  (lista || []).forEach(function (x) { m[campo ? x[campo] : x.id] = x; });
  return m;
}

function _agrupar(lista, campo) {
  var m = {};
  (lista || []).forEach(function (x) { (m[x[campo]] = m[x[campo]] || []).push(x); });
  return m;
}

function _productosPorSku() {
  var m = {};
  Db.leer('Productos').forEach(function (p) { m[normSku(p.sku)] = p; });
  return m;
}

function _lineasPorNombre() {
  var m = {};
  Db.leer('Lineas').forEach(function (l) { m[normNombre(l.nombre)] = l; });
  return m;
}

function _stockActual() {
  return calcularStock(Db.leer('Movimientos'));
}

function _puedeVerVenta(u, venta) {
  return esAdmin(u) || (venta && venta.vendedor_id === u.vendedor_id);
}

/** Ventas visibles para el usuario, con su estado de pago calculado. */
function _ventasConEstado(u) {
  var pagosPorVenta = _agrupar(Db.leer('Pagos'), 'venta_id');
  return Db.leer('Ventas')
    .filter(function (v) { return _puedeVerVenta(u, v); })
    .map(function (v) {
      var e = calcularEstadoVenta(v, pagosPorVenta[v.id]);
      var o = _limpio(v);
      o.pagado = e.pagado; o.saldo = e.saldo; o.estadoPago = e.estadoPago;
      return o;
    });
}

/** Quita campos internos antes de enviar al navegador. */
function _limpio(o) {
  var c = {};
  Object.keys(o).forEach(function (k) { if (k.charAt(0) !== '_') c[k] = o[k]; });
  return c;
}

var Ventas = {
  crear: function (u, v) {
    return conBloqueo(function () {
      v = v || {};
      if (!esAdmin(u)) v.vendedor_id = u.vendedor_id; // un vendedor solo registra a su nombre
      v.fecha = isoFecha(v.fecha) || hoyIso();
      v.fiscal = !!v.fiscal;
      var total = validarVentaNueva(v);
      if (v.fecha > hoyIso()) throw new Error('La fecha de la venta no puede ser futura.');

      var vendedor = Db.porId('Vendedores', v.vendedor_id);
      if (!vendedor || vendedor.activo === 'NO') throw new Error('El vendedor seleccionado no existe o está inactivo.');
      var ubic = Db.porId('Ubicaciones', v.ubicacion_id);
      if (!ubic || ubic.activo === 'NO') throw new Error('La ubicación seleccionada no existe o está inactiva.');

      var productos = _productosPorSku();
      var lineas = _lineasPorNombre();

      // Control de stock en la ubicación de salida
      var stock = _stockActual();
      var pedidoPorSku = {};
      v.items.forEach(function (it) { var s = normSku(it.sku); pedidoPorSku[s] = (pedidoPorSku[s] || 0) + num(it.cantidad); });
      var faltantes = [];
      Object.keys(pedidoPorSku).forEach(function (s) {
        if (!productos[s]) throw new Error('El código ' + s + ' no existe en el catálogo. Regístralo primero en Productos.');
        var disp = stock[claveStock(s, v.ubicacion_id)] || 0;
        if (disp < pedidoPorSku[s]) faltantes.push(s + ' (hay ' + disp + ', se venden ' + pedidoPorSku[s] + ')');
      });
      if (faltantes.length && !(v.forzar_stock && esAdmin(u))) {
        throw new Error('STOCK_INSUFICIENTE: No hay suficiente stock en ' + ubic.nombre + ':\n' + faltantes.join('\n') +
          '\nRegistra la compra o el traslado primero.' + (esAdmin(u) ? ' (Como administrador puedes registrarla igual.)' : ''));
      }

      var ventaId = Db.siguienteId('V');
      var ahora = ahoraIso();
      var itemIds = Db.siguienteId('VI', v.items.length);
      var movIds = Db.siguienteId('M', v.items.length);
      var comisionTotal = 0, costoTotal = 0;
      var items = v.items.map(function (it, i) {
        var s = normSku(it.sku);
        var p = productos[s];
        var cant = num(it.cantidad);
        var com = (it.comision === '' || it.comision === undefined || it.comision === null)
          ? comisionSugerida(p, lineas, cant) : r2(num(it.comision));
        var costoU = r2(num(p.costo));
        comisionTotal += com;
        costoTotal += costoU * cant;
        return {
          id: itemIds[i], venta_id: ventaId, sku: s,
          descripcion: texto(it.descripcion) || [p.linea, p.modelo, p.color].filter(String).join(' ') || p.descripcion,
          cantidad: cant, precio_unit: r2(num(it.precio_unit)), subtotal: r2(cant * num(it.precio_unit)),
          costo_unit: costoU, comision: com
        };
      });

      var venta = {
        id: ventaId, fecha: v.fecha, cliente: esClientePendiente(v.cliente) ? CLIENTE_POR_IDENTIFICAR : normNombre(v.cliente), telefono: texto(v.telefono),
        vendedor_id: vendedor.id, vendedor: vendedor.nombre, ubicacion_id: ubic.id, tipo: v.tipo,
        total: total, comision: r2(comisionTotal), costo: r2(costoTotal),
        fiscal: v.fiscal ? 'SI' : 'NO', factura_fiscal: v.fiscal ? texto(v.factura_fiscal) : '',
        estado: ESTADO.ACTIVA, notas: texto(v.notas), origen: 'APP', creado_por: u.usuario, creado_en: ahora
      };

      Db.insertar('Ventas', [venta]);
      Db.insertar('VentaItems', items);
      Db.insertar('Movimientos', items.map(function (it, i) {
        return { id: movIds[i], fecha: v.fecha, sku: it.sku, ubicacion_id: ubic.id, cantidad: -it.cantidad, tipo: MOV.VENTA, ref_id: ventaId, nota: venta.cliente, creado_por: u.usuario, creado_en: ahora };
      }));
      var pagoInicial = r2(num(v.pago_inicial));
      if (pagoInicial > 0) {
        Db.insertar('Pagos', [{
          id: Db.siguienteId('P'), venta_id: ventaId, fecha: v.fecha, monto: pagoInicial,
          metodo: texto(v.metodo_pago) || 'EFECTIVO', nota: v.tipo === TIPO_VENTA.CONTADO ? 'Pago de contado' : 'Inicial',
          fecha_estimada: 'NO', estado: ESTADO.ACTIVA, creado_por: u.usuario, creado_en: ahora
        }]);
      }
      auditar(u, 'VENTA_CREADA', ventaId + ' ' + venta.cliente + ' $' + total);
      return Ventas.detalle(u, ventaId);
    });
  },

  detalle: function (u, id) {
    var v = Db.porId('Ventas', id);
    if (!v || !_puedeVerVenta(u, v)) throw new Error('Venta no encontrada.');
    var pagos = Db.leer('Pagos').filter(function (p) { return p.venta_id === id; });
    var e = calcularEstadoVenta(v, pagos);
    var out = _limpio(v);
    out.pagado = e.pagado; out.saldo = e.saldo; out.estadoPago = e.estadoPago;
    out.items = Db.leer('VentaItems').filter(function (it) { return it.venta_id === id; }).map(_limpio);
    out.pagos = pagos.map(_limpio).sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; });
    if (!esAdmin(u)) delete out.costo;
    return out;
  },

  listar: function (u, f) {
    f = f || {};
    var q = normNombre(f.q);
    var itemsPorVenta = _agrupar(Db.leer('VentaItems'), 'venta_id');
    var lista = _ventasConEstado(u).filter(function (v) {
      if (f.desde && v.fecha < f.desde) return false;
      if (f.hasta && v.fecha > f.hasta) return false;
      if (f.vendedor_id && v.vendedor_id !== f.vendedor_id) return false;
      if (f.ubicacion_id && v.ubicacion_id !== f.ubicacion_id) return false;
      if (f.tipo && v.tipo !== f.tipo) return false;
      if (f.fiscal && v.fiscal !== f.fiscal) return false;
      if (f.estadoPago === 'CON_SALDO' && !(v.saldo > 0.005 && v.estado === ESTADO.ACTIVA)) return false;
      if (f.estadoPago && f.estadoPago !== 'CON_SALDO' && v.estadoPago !== f.estadoPago) return false;
      if (!f.incluirAnuladas && v.estado === ESTADO.ANULADA && f.estadoPago !== 'ANULADA') return false;
      if (q) {
        var its = itemsPorVenta[v.id] || [];
        var hay = [v.id, v.cliente, v.vendedor, v.factura_fiscal, v.notas].concat(its.map(function (i) { return i.sku + ' ' + i.descripcion; })).join(' ').toUpperCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    lista.sort(function (a, b) { return a.fecha === b.fecha ? (a.id < b.id ? 1 : -1) : (a.fecha < b.fecha ? 1 : -1); });
    var tot = lista.reduce(function (acc, v) {
      if (v.estado === ESTADO.ANULADA) return acc;
      acc.ventas++; acc.total += v.total; acc.pagado += v.pagado; acc.saldo += Math.max(0, v.saldo); acc.comision += num(v.comision);
      return acc;
    }, { ventas: 0, total: 0, pagado: 0, saldo: 0, comision: 0 });
    ['total', 'pagado', 'saldo', 'comision'].forEach(function (k) { tot[k] = r2(tot[k]); });
    var limite = Math.min(num(f.limite) || 300, 2000);
    return {
      totales: tot,
      cantidad: lista.length,
      ventas: lista.slice(0, limite).map(function (v) {
        var its = itemsPorVenta[v.id] || [];
        v.productos = its.map(function (i) { return (i.cantidad > 1 ? i.cantidad + '× ' : '') + (i.descripcion || i.sku); }).join(', ');
        v.skus = its.map(function (i) { return i.sku; }).join(', ');
        if (!esAdmin(u)) delete v.costo;
        return v;
      })
    };
  },

  /** Edita datos que no afectan inventario ni dinero ya cobrado. */
  editar: function (u, d) {
    if (!esAdmin(u)) {
      // Un vendedor solo puede corregir los datos del cliente y las notas de sus propias ventas
      d = { id: d.id, cliente: d.cliente, telefono: d.telefono, notas: d.notas };
      Object.keys(d).forEach(function (k) { if (d[k] === undefined) delete d[k]; });
    }
    return conBloqueo(function () {
      var v = Db.porId('Ventas', d.id);
      if (!v || !_puedeVerVenta(u, v)) throw new Error('Venta no encontrada.');
      if (v.estado === ESTADO.ANULADA) throw new Error('No se puede editar una venta anulada.');
      var cambios = {};
      if (d.cliente !== undefined) cambios.cliente = esClientePendiente(d.cliente) ? CLIENTE_POR_IDENTIFICAR : normNombre(d.cliente);
      if (d.telefono !== undefined) cambios.telefono = texto(d.telefono);
      if (d.notas !== undefined) cambios.notas = texto(d.notas);
      if (d.fiscal !== undefined) {
        cambios.fiscal = d.fiscal ? 'SI' : 'NO';
        cambios.factura_fiscal = d.fiscal ? texto(d.factura_fiscal) : '';
        if (d.fiscal && !cambios.factura_fiscal) throw new Error('Indica el número de factura fiscal.');
      }
      if (d.tipo !== undefined) {
        if (d.tipo !== TIPO_VENTA.CONTADO && d.tipo !== TIPO_VENTA.CREDITO) throw new Error('Tipo inválido.');
        cambios.tipo = d.tipo;
      }
      if (d.comision !== undefined) {
        if (num(d.comision) < 0) throw new Error('Comisión inválida.');
        if (texto(v.comision_pagada_en)) throw new Error('La comisión de esta venta ya fue liquidada; no se puede cambiar.');
        cambios.comision = r2(num(d.comision));
      }
      if (d.vendedor_id !== undefined && d.vendedor_id !== v.vendedor_id) {
        if (texto(v.comision_pagada_en)) throw new Error('La comisión de esta venta ya fue liquidada; no se puede cambiar el vendedor.');
        var vend = Db.porId('Vendedores', d.vendedor_id);
        if (!vend) throw new Error('Vendedor no encontrado.');
        cambios.vendedor_id = vend.id; cambios.vendedor = vend.nombre;
      }
      if (d.fecha !== undefined) {
        var f = isoFecha(d.fecha);
        if (!f) throw new Error('Fecha inválida.');
        if (f > hoyIso()) throw new Error('La fecha de la venta no puede ser futura.');
        if (f !== v.fecha) {
          cambios.fecha = f;
          Db.leer('Movimientos').filter(function (m) { return m.ref_id === v.id && m.tipo === MOV.VENTA; })
            .forEach(function (m) { Db.actualizar('Movimientos', m.id, { fecha: f }); });
        }
      }
      Db.actualizar('Ventas', v.id, cambios);
      auditar(u, 'VENTA_EDITADA', v.id + ' ' + JSON.stringify(cambios));
      return Ventas.detalle(u, v.id);
    });
  },

  /** Anula una venta: devuelve la mercancía al stock y anula sus pagos. Queda en el historial. */
  anular: function (u, d) {
    exigirAdmin(u);
    return conBloqueo(function () {
      var v = Db.porId('Ventas', d.id);
      if (!v) throw new Error('Venta no encontrada.');
      if (v.estado === ESTADO.ANULADA) throw new Error('La venta ya estaba anulada.');
      if (!texto(d.motivo)) throw new Error('Indica el motivo de la anulación.');
      if (texto(v.comision_pagada_en)) throw new Error('La comisión de esta venta ya fue liquidada. Revierte la liquidación antes de anular.');
      var ahora = ahoraIso();
      Db.actualizar('Ventas', v.id, { estado: ESTADO.ANULADA, motivo_anulacion: texto(d.motivo) });
      var movsVenta = Db.leer('Movimientos').filter(function (m) { return m.ref_id === v.id && m.tipo === MOV.VENTA; });
      var ids = movsVenta.length ? Db.siguienteId('M', movsVenta.length) : [];
      Db.insertar('Movimientos', movsVenta.map(function (m, i) {
        return { id: ids[i], fecha: hoyIso(), sku: m.sku, ubicacion_id: m.ubicacion_id, cantidad: -num(m.cantidad), tipo: MOV.ANULACION_VENTA, ref_id: v.id, nota: 'Anulación: ' + texto(d.motivo), creado_por: u.usuario, creado_en: ahora };
      }));
      Db.leer('Pagos').filter(function (p) { return p.venta_id === v.id && p.estado !== ESTADO.ANULADA; })
        .forEach(function (p) { Db.actualizar('Pagos', p.id, { estado: ESTADO.ANULADA, motivo_anulacion: 'Venta anulada: ' + texto(d.motivo) }); });
      auditar(u, 'VENTA_ANULADA', v.id + ' — ' + d.motivo);
      return Ventas.detalle(u, v.id);
    });
  },

  clientes: function (u) {
    var vistos = {};
    _ventasConEstado(u).forEach(function (v) {
      if (esClientePendiente(v.cliente)) return;
      var k = claveCliente(v.cliente);
      if (!vistos[k]) vistos[k] = { cliente: v.cliente, telefono: '', ultima: '' };
      if (v.telefono) vistos[k].telefono = v.telefono;
      if (v.fecha > vistos[k].ultima) vistos[k].ultima = v.fecha;
    });
    return Object.keys(vistos).map(function (k) { return vistos[k]; }).sort(function (a, b) { return a.cliente.localeCompare(b.cliente); });
  }
};

var Pagos = {
  crear: function (u, d) {
    return conBloqueo(function () {
      var v = Db.porId('Ventas', d.venta_id);
      if (!v || !_puedeVerVenta(u, v)) throw new Error('Venta no encontrada.');
      if (v.estado === ESTADO.ANULADA) throw new Error('No se pueden registrar pagos en una venta anulada.');
      var monto = r2(num(d.monto));
      if (!(monto > 0)) throw new Error('El monto debe ser mayor a cero.');
      var fecha = isoFecha(d.fecha);
      if (!fecha) throw new Error('La fecha del pago es obligatoria.');
      if (fecha > hoyIso()) throw new Error('La fecha del pago no puede ser futura.');
      if (fecha < v.fecha) throw new Error('El pago no puede ser anterior a la venta (' + v.fecha + ').');
      var e = calcularEstadoVenta(v, Db.leer('Pagos').filter(function (p) { return p.venta_id === v.id; }));
      if (monto - e.saldo > 0.005) throw new Error('El pago ($' + monto.toFixed(2) + ') es mayor que el saldo pendiente ($' + e.saldo.toFixed(2) + ').');
      var p = {
        id: Db.siguienteId('P'), venta_id: v.id, fecha: fecha, monto: monto, metodo: texto(d.metodo) || 'EFECTIVO',
        nota: texto(d.nota), fecha_estimada: 'NO', estado: ESTADO.ACTIVA, creado_por: u.usuario, creado_en: ahoraIso()
      };
      Db.insertar('Pagos', [p]);
      auditar(u, 'PAGO_CREADO', p.id + ' venta ' + v.id + ' $' + monto);
      return Ventas.detalle(u, v.id);
    });
  },

  anular: function (u, d) {
    exigirAdmin(u);
    return conBloqueo(function () {
      var p = Db.porId('Pagos', d.id);
      if (!p) throw new Error('Pago no encontrado.');
      if (p.estado === ESTADO.ANULADA) throw new Error('El pago ya estaba anulado.');
      if (!texto(d.motivo)) throw new Error('Indica el motivo.');
      Db.actualizar('Pagos', p.id, { estado: ESTADO.ANULADA, motivo_anulacion: texto(d.motivo) });
      auditar(u, 'PAGO_ANULADO', p.id + ' — ' + d.motivo);
      return Ventas.detalle(u, p.venta_id);
    });
  },

  /** Corrige la fecha de un pago (por ejemplo, los que vinieron de la hoja sin fecha). */
  corregirFecha: function (u, d) {
    exigirAdmin(u);
    return conBloqueo(function () {
      var p = Db.porId('Pagos', d.id);
      if (!p) throw new Error('Pago no encontrado.');
      var f = isoFecha(d.fecha);
      if (!f || f > hoyIso()) throw new Error('Fecha inválida.');
      Db.actualizar('Pagos', p.id, { fecha: f, fecha_estimada: 'NO' });
      auditar(u, 'PAGO_FECHA_CORREGIDA', p.id + ' ' + p.fecha + ' -> ' + f);
      return Ventas.detalle(u, p.venta_id);
    });
  },

  /** Pagos recibidos en un rango (para el cuadre de caja). */
  listar: function (u, f) {
    f = f || {};
    var ventas = _mapa(Db.leer('Ventas'));
    var lista = Db.leer('Pagos').filter(function (p) {
      var v = ventas[p.venta_id];
      if (!v || !_puedeVerVenta(u, v)) return false;
      if (p.estado === ESTADO.ANULADA) return false;
      if (f.desde && p.fecha < f.desde) return false;
      if (f.hasta && p.fecha > f.hasta) return false;
      if (f.vendedor_id && v.vendedor_id !== f.vendedor_id) return false;
      return true;
    }).map(function (p) {
      var v = ventas[p.venta_id];
      var o = _limpio(p);
      o.cliente = v.cliente; o.vendedor = v.vendedor;
      return o;
    }).sort(function (a, b) { return a.fecha < b.fecha ? 1 : -1; });
    var porMetodo = {};
    lista.forEach(function (p) { porMetodo[p.metodo] = r2((porMetodo[p.metodo] || 0) + p.monto); });
    return { pagos: lista.slice(0, 1000), total: r2(lista.reduce(function (a, p) { return a + p.monto; }, 0)), porMetodo: porMetodo, estimadas: lista.filter(function (p) { return p.fecha_estimada === 'SI'; }).length };
  }
};

var Cobranza = {
  /** Clientes con saldo pendiente, con antigüedad de la deuda. */
  resumen: function (u, f) {
    f = f || {};
    var hoy = hoyIso();
    var porCliente = {};
    _ventasConEstado(u).forEach(function (v) {
      if (v.estado === ESTADO.ANULADA || v.saldo <= 0.005) return;
      if (f.vendedor_id && v.vendedor_id !== f.vendedor_id) return;
      var pendiente = esClientePendiente(v.cliente);
      var k = pendiente ? '__' + v.id : claveCliente(v.cliente);
      var c = porCliente[k] = porCliente[k] || { cliente: pendiente ? 'Cliente por identificar' : v.cliente, porIdentificar: pendiente, telefono: '', saldo: 0, ventas: [], masAntigua: v.fecha, vendedores: {} };
      c.saldo = r2(c.saldo + v.saldo);
      if (v.telefono) c.telefono = v.telefono;
      if (v.fecha < c.masAntigua) c.masAntigua = v.fecha;
      c.vendedores[v.vendedor] = 1;
      c.ventas.push({ id: v.id, fecha: v.fecha, total: v.total, pagado: v.pagado, saldo: v.saldo, vendedor: v.vendedor, dias: diasEntre(v.fecha, hoy) });
    });
    var lista = Object.keys(porCliente).map(function (k) {
      var c = porCliente[k];
      c.dias = diasEntre(c.masAntigua, hoy);
      c.vendedores = Object.keys(c.vendedores).join(', ');
      c.ventas.sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; });
      return c;
    }).sort(function (a, b) { return b.saldo - a.saldo; });
    var tramos = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    lista.forEach(function (c) { c.ventas.forEach(function (v) {
      var t = v.dias <= 30 ? '0-30' : v.dias <= 60 ? '31-60' : v.dias <= 90 ? '61-90' : '90+';
      tramos[t] = r2(tramos[t] + v.saldo);
    }); });
    return { clientes: lista, total: r2(lista.reduce(function (a, c) { return a + c.saldo; }, 0)), tramos: tramos };
  }
};


// ==================== Clientes.gs ====================
/**
 * Clientes.gs — Historial completo por cliente (todas las ventas, sin filtro de fechas).
 * Los clientes se agrupan sin importar acentos o espacios ("María" = "MARIA").
 * Las ventas con cliente "PENDIENTE"/vacío se listan aparte para asignarles el cliente real.
 */

var Clientes = {
  resumen: function (u, f) {
    f = f || {};
    var q = claveCliente(f.q);
    var itemsPor = _agrupar(Db.leer('VentaItems'), 'venta_id');
    var porClave = {};
    var porIdentificar = [];
    _ventasConEstado(u).forEach(function (v) {
      if (v.estado === ESTADO.ANULADA) return;
      var its = itemsPor[v.id] || [];
      if (esClientePendiente(v.cliente)) {
        porIdentificar.push({ id: v.id, fecha: v.fecha, cliente: v.cliente, vendedor: v.vendedor, total: v.total, saldo: v.saldo, estadoPago: v.estadoPago,
          productos: its.map(function (i) { return i.descripcion || i.sku; }).join(', '), notas: v.notas });
        return;
      }
      var k = claveCliente(v.cliente);
      var c = porClave[k] = porClave[k] || { cliente: v.cliente, clave: k, telefono: '', ventas: 0, unidades: 0, total: 0, pagado: 0, saldo: 0, primera: v.fecha, ultima: v.fecha, vendedores: {} };
      c.ventas++;
      c.unidades += its.reduce(function (a, i) { return a + num(i.cantidad); }, 0);
      c.total = r2(c.total + v.total);
      c.pagado = r2(c.pagado + v.pagado);
      c.saldo = r2(c.saldo + Math.max(0, v.saldo));
      if (v.telefono) c.telefono = v.telefono;
      if (v.fecha < c.primera) c.primera = v.fecha;
      if (v.fecha > c.ultima) c.ultima = v.fecha;
      c.vendedores[v.vendedor] = 1;
    });
    var lista = Object.keys(porClave).map(function (k) { var c = porClave[k]; c.vendedores = Object.keys(c.vendedores).join(', '); return c; })
      .filter(function (c) { return !q || c.clave.indexOf(q) !== -1 || String(c.telefono).indexOf(f.q || '') !== -1; });
    var orden = f.orden || 'total';
    lista.sort(function (a, b) {
      if (orden === 'nombre') return a.cliente.localeCompare(b.cliente);
      if (orden === 'reciente') return a.ultima < b.ultima ? 1 : -1;
      if (orden === 'saldo') return b.saldo - a.saldo;
      return b.total - a.total;
    });
    porIdentificar.sort(function (a, b) { return a.fecha < b.fecha ? 1 : -1; });
    return {
      clientes: lista,
      totales: {
        clientes: lista.length,
        total: r2(lista.reduce(function (a, c) { return a + c.total; }, 0)),
        saldo: r2(lista.reduce(function (a, c) { return a + c.saldo; }, 0))
      },
      porIdentificar: porIdentificar,
      porIdentificarSaldo: r2(porIdentificar.reduce(function (a, v) { return a + Math.max(0, v.saldo); }, 0))
    };
  },

  /** Todas las ventas de un cliente (de siempre), con sus productos y pagos. */
  detalle: function (u, d) {
    var k = claveCliente(d.cliente);
    if (!k || esClientePendiente(d.cliente)) throw new Error('Indica el cliente.');
    var itemsPor = _agrupar(Db.leer('VentaItems'), 'venta_id');
    var pagosPor = _agrupar(Db.leer('Pagos'), 'venta_id');
    var productos = _productosPorSku();
    var ventas = _ventasConEstado(u).filter(function (v) { return claveCliente(v.cliente) === k; })
      .sort(function (a, b) { return a.fecha === b.fecha ? (a.id < b.id ? 1 : -1) : (a.fecha < b.fecha ? 1 : -1); });
    if (!ventas.length) throw new Error('No se encontraron ventas de ese cliente.');
    var porLinea = {};
    var nombre = ventas[0].cliente, telefono = '';
    var lista = ventas.map(function (v) {
      var its = itemsPor[v.id] || [];
      if (v.telefono && !telefono) telefono = v.telefono;
      if (v.estado !== ESTADO.ANULADA) its.forEach(function (i) {
        var p = productos[normSku(i.sku)];
        var l = (p && p.linea) || i.descripcion || i.sku;
        porLinea[l] = (porLinea[l] || 0) + num(i.cantidad);
      });
      return {
        id: v.id, fecha: v.fecha, vendedor: v.vendedor, tipo: v.tipo, fiscal: v.fiscal, total: v.total, pagado: v.pagado, saldo: v.saldo,
        estado: v.estado, estadoPago: v.estadoPago,
        productos: its.map(function (i) { return (i.cantidad > 1 ? i.cantidad + '× ' : '') + (i.descripcion || i.sku); }).join(', '),
        imagen: (function () { var p = its[0] && productos[normSku(its[0].sku)]; return p ? p.imagen : ''; })(),
        pagos: (pagosPor[v.id] || []).filter(function (p) { return p.estado !== ESTADO.ANULADA; }).length
      };
    });
    var activas = lista.filter(function (v) { return v.estado !== ESTADO.ANULADA; });
    return {
      cliente: nombre, telefono: telefono,
      totales: {
        ventas: activas.length, total: r2(activas.reduce(function (a, v) { return a + v.total; }, 0)),
        pagado: r2(activas.reduce(function (a, v) { return a + v.pagado; }, 0)),
        saldo: r2(activas.reduce(function (a, v) { return a + Math.max(0, v.saldo); }, 0)),
        primera: activas.length ? activas[activas.length - 1].fecha : '', ultima: activas.length ? activas[0].fecha : ''
      },
      porLinea: Object.keys(porLinea).map(function (l) { return { linea: l, unidades: porLinea[l] }; }).sort(function (a, b) { return b.unidades - a.unidades; }),
      ventas: lista
    };
  }
};


// ==================== Compras.gs ====================
/**
 * Compras.gs — Facturas de compra a proveedores.
 * Cada compra suma stock en la ubicación donde se recibió (movimiento COMPRA).
 * La foto/PDF de la factura se guarda en una carpeta de Drive y queda enlazada.
 * Opcional: lectura automática con Google Gemini (la clave se guarda en el servidor,
 * en las propiedades del script; nunca llega al navegador ni al repositorio).
 */

var MIMES_FACTURA = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];

function _carpetaFacturas() {
  var cfg = Db.config();
  if (cfg.CARPETA_FACTURAS_ID) {
    try { return DriveApp.getFolderById(cfg.CARPETA_FACTURAS_ID); } catch (e) { /* se recrea abajo */ }
  }
  var carpeta = DriveApp.createFolder('Cubitt Admin — Facturas de compra');
  Db.guardarConfig('CARPETA_FACTURAS_ID', carpeta.getId());
  return carpeta;
}

var Compras = {
  crear: function (u, c) {
    exigirAdmin(u);
    return conBloqueo(function () {
      c = c || {};
      var errores = [];
      var fecha = isoFecha(c.fecha);
      if (!fecha) errores.push('La fecha de la factura es obligatoria.');
      else if (fecha > hoyIso()) errores.push('La fecha no puede ser futura.');
      if (!texto(c.proveedor)) errores.push('El proveedor es obligatorio.');
      if (!texto(c.nro_factura)) errores.push('El número de factura es obligatorio (usa "S/N" si no tiene).');
      var ubic = Db.porId('Ubicaciones', c.ubicacion_id);
      if (!ubic) errores.push('Indica en qué ubicación se recibió la mercancía.');
      if (!c.items || !c.items.length) errores.push('Agrega al menos un producto.');
      (c.items || []).forEach(function (it, i) {
        if (!normSku(it.sku)) errores.push('Línea ' + (i + 1) + ': falta el código.');
        if (!(num(it.cantidad) > 0)) errores.push('Línea ' + (i + 1) + ': cantidad inválida.');
        if (num(it.costo_unit) < 0) errores.push('Línea ' + (i + 1) + ': costo inválido.');
      });
      if (errores.length) throw new Error(errores.join('\n'));

      var nro = texto(c.nro_factura).toUpperCase();
      var dup = Db.leer('Compras').filter(function (x) {
        return x.estado !== ESTADO.ANULADA && normNombre(x.proveedor) === normNombre(c.proveedor) && texto(x.nro_factura).toUpperCase() === nro && nro !== 'S/N';
      })[0];
      if (dup && !c.forzar_duplicado) throw new Error('DUPLICADO: La factura ' + nro + ' de ' + c.proveedor + ' ya está registrada (' + dup.id + ', ' + dup.fecha + ').');

      var productos = _productosPorSku();
      var ahora = ahoraIso();
      var compraId = Db.siguienteId('C');
      var ids = Db.siguienteId('CI', c.items.length);
      var movIds = Db.siguienteId('M', c.items.length);
      var nuevosProductos = [];
      var subtotal = 0;
      var items = c.items.map(function (it, i) {
        var s = normSku(it.sku);
        var cant = num(it.cantidad), cu = r2(num(it.costo_unit));
        subtotal += cant * cu;
        if (!productos[s]) {
          var np = { sku: s, linea: texto(it.linea).toUpperCase(), descripcion: texto(it.descripcion), costo: cu, pvp: '', comision: '', activo: 'SI', actualizado_en: ahora };
          productos[s] = np; nuevosProductos.push(np);
        }
        return { id: ids[i], compra_id: compraId, sku: s, descripcion: texto(it.descripcion) || productos[s].descripcion || '', cantidad: cant, costo_unit: cu, subtotal: r2(cant * cu) };
      });
      subtotal = r2(subtotal);
      var iva = r2(num(c.iva));
      var total = c.total !== undefined && c.total !== '' ? r2(num(c.total)) : r2(subtotal + iva);

      var compra = {
        id: compraId, fecha: fecha, proveedor: texto(c.proveedor), rif: texto(c.rif).toUpperCase(), nro_factura: nro,
        nro_control: texto(c.nro_control), ubicacion_id: ubic.id, moneda: texto(c.moneda) || 'USD', tasa: num(c.tasa) || '',
        subtotal: subtotal, iva: iva, total: total, metodo_pago: texto(c.metodo_pago), archivo_url: texto(c.archivo_url),
        archivo_id: texto(c.archivo_id), estado: ESTADO.ACTIVA, notas: texto(c.notas), origen: 'APP', creado_por: u.usuario, creado_en: ahora
      };
      if (nuevosProductos.length) Db.insertar('Productos', nuevosProductos);
      Db.insertar('Compras', [compra]);
      Db.insertar('CompraItems', items);
      Db.insertar('Movimientos', items.map(function (it, i) {
        return { id: movIds[i], fecha: fecha, sku: it.sku, ubicacion_id: ubic.id, cantidad: it.cantidad, tipo: MOV.COMPRA, ref_id: compraId, nota: compra.proveedor + ' #' + nro, creado_por: u.usuario, creado_en: ahora };
      }));
      // Último costo conocido del producto (para margen y comisiones)
      if (c.actualizar_costos !== false) {
        items.forEach(function (it) {
          if (it.costo_unit > 0 && nuevosProductos.every(function (np) { return np.sku !== it.sku; })) {
            Db.actualizar('Productos', it.sku, { costo: it.costo_unit, actualizado_en: ahora }, 'sku');
          }
        });
      }
      auditar(u, 'COMPRA_CREADA', compraId + ' ' + compra.proveedor + ' #' + nro + ' $' + total);
      return Compras.detalle(u, compraId);
    });
  },

  detalle: function (u, id) {
    exigirAdmin(u);
    var c = Db.porId('Compras', id);
    if (!c) throw new Error('Compra no encontrada.');
    var out = _limpio(c);
    out.items = Db.leer('CompraItems').filter(function (it) { return it.compra_id === id; }).map(_limpio);
    out.unidades = out.items.reduce(function (a, it) { return a + num(it.cantidad); }, 0);
    return out;
  },

  listar: function (u, f) {
    exigirAdmin(u);
    f = f || {};
    var q = normNombre(f.q);
    var itemsPor = _agrupar(Db.leer('CompraItems'), 'compra_id');
    var lista = Db.leer('Compras').filter(function (c) {
      if (!f.incluirAnuladas && c.estado === ESTADO.ANULADA) return false;
      if (f.desde && c.fecha < f.desde) return false;
      if (f.hasta && c.fecha > f.hasta) return false;
      if (q) {
        var hay = [c.id, c.proveedor, c.nro_factura, c.rif].concat((itemsPor[c.id] || []).map(function (i) { return i.sku; })).join(' ').toUpperCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    }).map(function (c) {
      var o = _limpio(c);
      var its = itemsPor[c.id] || [];
      o.unidades = its.reduce(function (a, it) { return a + num(it.cantidad); }, 0);
      o.lineas = its.length;
      o.sinArchivo = !texto(c.archivo_url);
      return o;
    }).sort(function (a, b) { return a.fecha < b.fecha ? 1 : -1; });
    return {
      compras: lista,
      total: r2(lista.reduce(function (a, c) { return a + (c.estado === ESTADO.ANULADA ? 0 : num(c.total)); }, 0)),
      unidades: lista.reduce(function (a, c) { return a + (c.estado === ESTADO.ANULADA ? 0 : c.unidades); }, 0)
    };
  },

  /** Corrige datos de cabecera o adjunta la foto/PDF de la factura (no cambia cantidades ni stock). */
  editar: function (u, d) {
    exigirAdmin(u);
    return conBloqueo(function () {
      var c = Db.porId('Compras', d.id);
      if (!c) throw new Error('Compra no encontrada.');
      if (c.estado === ESTADO.ANULADA) throw new Error('No se puede editar una compra anulada.');
      var cambios = {};
      ['proveedor', 'nro_control', 'metodo_pago', 'notas', 'archivo_url', 'archivo_id'].forEach(function (k) { if (d[k] !== undefined) cambios[k] = texto(d[k]); });
      if (d.rif !== undefined) cambios.rif = texto(d.rif).toUpperCase();
      if (d.nro_factura !== undefined) {
        if (!texto(d.nro_factura)) throw new Error('El número de factura es obligatorio.');
        cambios.nro_factura = texto(d.nro_factura).toUpperCase();
      }
      if (d.tasa !== undefined) cambios.tasa = num(d.tasa) || '';
      if (cambios.proveedor !== undefined && !cambios.proveedor) throw new Error('El proveedor es obligatorio.');
      if (d.fecha !== undefined) {
        var f = isoFecha(d.fecha);
        if (!f || f > hoyIso()) throw new Error('Fecha inválida.');
        if (f !== c.fecha) {
          cambios.fecha = f;
          Db.leer('Movimientos').filter(function (m) { return m.ref_id === c.id && m.tipo === MOV.COMPRA; })
            .forEach(function (m) { Db.actualizar('Movimientos', m.id, { fecha: f }); });
        }
      }
      Db.actualizar('Compras', c.id, cambios);
      auditar(u, 'COMPRA_EDITADA', c.id + ' ' + Object.keys(cambios).join(','));
      return Compras.detalle(u, c.id);
    });
  },

  anular: function (u, d) {
    exigirAdmin(u);
    return conBloqueo(function () {
      var c = Db.porId('Compras', d.id);
      if (!c) throw new Error('Compra no encontrada.');
      if (c.estado === ESTADO.ANULADA) throw new Error('La compra ya estaba anulada.');
      if (!texto(d.motivo)) throw new Error('Indica el motivo.');
      var movs = Db.leer('Movimientos').filter(function (m) { return m.ref_id === c.id && m.tipo === MOV.COMPRA; });
      var ids = movs.length ? Db.siguienteId('M', movs.length) : [];
      var ahora = ahoraIso();
      Db.actualizar('Compras', c.id, { estado: ESTADO.ANULADA, motivo_anulacion: texto(d.motivo) });
      Db.insertar('Movimientos', movs.map(function (m, i) {
        return { id: ids[i], fecha: hoyIso(), sku: m.sku, ubicacion_id: m.ubicacion_id, cantidad: -num(m.cantidad), tipo: MOV.ANULACION_COMPRA, ref_id: c.id, nota: 'Anulación: ' + texto(d.motivo), creado_por: u.usuario, creado_en: ahora };
      }));
      auditar(u, 'COMPRA_ANULADA', c.id + ' — ' + d.motivo);
      return Compras.detalle(u, c.id);
    });
  },

  /** Guarda la foto/PDF de la factura en Drive y devuelve su enlace. */
  subirArchivo: function (u, d) {
    exigirAdmin(u);
    var mime = texto(d.mime).toLowerCase();
    if (MIMES_FACTURA.indexOf(mime) === -1) throw new Error('Formato no permitido. Usa foto (JPG, PNG, WEBP) o PDF.');
    var bytes = Utilities.base64Decode(texto(d.base64));
    if (bytes.length > 15 * 1024 * 1024) throw new Error('El archivo supera 15 MB.');
    var nombre = (texto(d.nombre) || 'factura').replace(/[\\/:*?"<>|]/g, '_');
    var archivo = _carpetaFacturas().createFile(Utilities.newBlob(bytes, mime, nombre));
    return { archivo_id: archivo.getId(), archivo_url: archivo.getUrl(), nombre: archivo.getName(), mime: mime };
  },

  /**
   * Lista fotos/PDF de una carpeta de Drive (por ejemplo, tu carpeta "Facturas") que todavía
   * no están vinculadas a ninguna compra, para registrarlas una por una.
   */
  archivosPendientes: function (u, d) {
    exigirAdmin(u);
    var carpetaId = texto(d && d.carpeta_id) || Db.config().CARPETA_FACTURAS_ORIGEN_ID;
    if (!carpetaId) return { carpeta: null, archivos: [] };
    var m = carpetaId.match(/folders\/([A-Za-z0-9_-]+)/);
    if (m) carpetaId = m[1];
    var carpeta = DriveApp.getFolderById(carpetaId);
    Db.guardarConfig('CARPETA_FACTURAS_ORIGEN_ID', carpetaId);
    var usados = {};
    Db.leer('Compras').forEach(function (c) { if (c.archivo_id && c.estado !== ESTADO.ANULADA) usados[c.archivo_id] = c.id; });
    var archivos = [];
    var it = carpeta.getFiles();
    while (it.hasNext()) {
      var f = it.next();
      var mime = f.getMimeType();
      if (MIMES_FACTURA.indexOf(mime) === -1) continue;
      archivos.push({ archivo_id: f.getId(), nombre: f.getName(), mime: mime, archivo_url: f.getUrl(), fecha: isoFecha(f.getDateCreated()), compra_id: usados[f.getId()] || '' });
    }
    archivos.sort(function (a, b) { return a.nombre.localeCompare(b.nombre); });
    return { carpeta: { id: carpetaId, nombre: carpeta.getName() }, archivos: archivos };
  },

  /** Lee la factura con Gemini y devuelve un borrador para revisar (no guarda nada). */
  leerConIA: function (u, d) {
    exigirAdmin(u);
    var key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!key) throw new Error('La lectura automática no está configurada. Agrega la clave de Gemini en Ajustes, o registra la factura a mano.');
    var archivo = DriveApp.getFileById(texto(d.archivo_id));
    var blob = archivo.getBlob();
    var mime = blob.getContentType();
    if (MIMES_FACTURA.indexOf(mime) === -1) throw new Error('Formato no soportado para lectura automática.');
    var catalogo = Db.leer('Productos').filter(function (p) { return p.activo !== 'NO'; }).slice(0, 600)
      .map(function (p) { return p.sku + ' = ' + [p.linea, p.modelo, p.color, p.descripcion].filter(String).join(' / '); }).join('\n');
    var prompt = [
      'Eres un asistente contable. Extrae los datos de esta factura de compra de mercancía (Venezuela).',
      'Responde SOLO JSON con esta forma:',
      '{"proveedor":"","rif":"","nro_factura":"","nro_control":"","fecha":"aaaa-mm-dd","moneda":"USD|VES","tasa":0,',
      ' "subtotal":0,"iva":0,"total":0,"items":[{"sku":"","descripcion":"","cantidad":0,"costo_unit":0}]}',
      'Reglas: montos como números sin símbolos; si la factura está en bolívares pon moneda "VES" y la tasa BCV si aparece;',
      'costo_unit es el precio unitario neto (después de descuentos, sin IVA) en la moneda de la factura;',
      'en "sku" usa el código del catálogo que corresponda al producto (si no hay coincidencia clara, deja "sku" vacío);',
      'no inventes datos que no estén en la imagen.',
      'Catálogo (SKU = descripción):', catalogo
    ].join('\n');
    var modelo = Db.config().MODELO_GEMINI || 'gemini-flash-latest';
    var resp = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(modelo) + ':generateContent', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-goog-api-key': key },
      payload: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: Utilities.base64Encode(blob.getBytes()) } }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0 }
      })
    });
    var code = resp.getResponseCode();
    if (code !== 200) throw new Error('Gemini respondió con error ' + code + ': ' + resp.getContentText().slice(0, 300));
    var cuerpo = JSON.parse(resp.getContentText());
    var txt = (((cuerpo.candidates || [])[0] || {}).content || {}).parts;
    txt = txt && txt[0] && txt[0].text;
    if (!txt) throw new Error('Gemini no devolvió datos legibles para esta factura.');
    var datos;
    try { datos = JSON.parse(txt.replace(/^```json\s*|```$/g, '')); } catch (e) { throw new Error('No se pudo interpretar la respuesta de Gemini.'); }
    var productos = _productosPorSku();
    datos.items = (datos.items || []).map(function (it) {
      var s = normSku(it.sku);
      return { sku: productos[s] ? s : '', sku_leido: texto(it.sku), descripcion: texto(it.descripcion), cantidad: num(it.cantidad), costo_unit: r2(num(it.costo_unit)), reconocido: !!productos[s] };
    });
    datos.fecha = isoFecha(datos.fecha);
    // El sistema lleva todo en USD: si la factura viene en bolívares y trae tasa, convertir
    datos.moneda = texto(datos.moneda).toUpperCase() === 'VES' ? 'VES' : 'USD';
    datos.tasa = num(datos.tasa);
    if (datos.moneda === 'VES') {
      if (datos.tasa > 0) {
        datos.total_bs = num(datos.total);
        ['subtotal', 'iva', 'total'].forEach(function (k) { datos[k] = r2(num(datos[k]) / datos.tasa); });
        datos.items.forEach(function (it) { it.costo_bs = it.costo_unit; it.costo_unit = r2(it.costo_unit / datos.tasa); });
        datos.aviso = 'Montos convertidos de Bs a USD con tasa ' + datos.tasa + '. Revísalos.';
      } else {
        datos.aviso = 'La factura está en Bs y no se encontró la tasa: indica la tasa y convierte los costos a USD antes de guardar.';
      }
    }
    datos.archivo_id = archivo.getId();
    datos.archivo_url = archivo.getUrl();
    return datos;
  }
};


// ==================== Inventario.gs ====================
/**
 * Inventario.gs — Stock por ubicación calculado desde el libro de Movimientos.
 * El stock nunca se escribe a mano: cambia solo con compras, ventas, traslados y
 * ajustes por conteo físico (cada uno deja su movimiento con fecha, usuario y motivo).
 */

var Inventario = {
  stock: function (u, f) {
    f = f || {};
    var ubicaciones = Db.leer('Ubicaciones').filter(function (x) { return x.activo !== 'NO'; });
    var stock = _stockActual();
    var q = normNombre(f.q);
    var filas = Db.leer('Productos').map(function (p) {
      var s = normSku(p.sku);
      var porUbic = {};
      var total = 0;
      ubicaciones.forEach(function (ub) {
        var n = stock[claveStock(s, ub.id)] || 0;
        porUbic[ub.id] = n;
        total += n;
      });
      return {
        sku: s, linea: p.linea, modelo: p.modelo, color: p.color, descripcion: p.descripcion, imagen: p.imagen,
        pvp: num(p.pvp), costo: esAdmin(u) ? num(p.costo) : undefined, activo: p.activo !== 'NO',
        porUbicacion: porUbic, total: r2(total)
      };
    }).filter(function (r) {
      if (q && [r.sku, r.linea, r.modelo, r.color, r.descripcion].join(' ').toUpperCase().indexOf(q) === -1) return false;
      var n = f.ubicacion_id ? r.porUbicacion[f.ubicacion_id] : r.total;
      if (f.estado === 'CON_STOCK' && !(n > 0)) return false;
      if (f.estado === 'AGOTADO' && n !== 0) return false;
      if (f.estado === 'NEGATIVO' && !(n < 0)) return false;
      if (f.estado === 'BAJO' && !(n > 0 && n <= num(f.umbral || 2))) return false;
      if (!f.incluirInactivos && !r.activo && r.total === 0) return false;
      return true;
    });
    filas.sort(function (a, b) { return (a.linea || '').localeCompare(b.linea || '') || a.sku.localeCompare(b.sku); });
    var resumen = { unidades: 0, valorCosto: 0, valorPvp: 0, negativos: 0, agotados: 0 };
    filas.forEach(function (r) {
      var n = f.ubicacion_id ? r.porUbicacion[f.ubicacion_id] : r.total;
      if (n > 0) { resumen.unidades += n; resumen.valorCosto += n * (num(r.costo) || 0); resumen.valorPvp += n * r.pvp; }
      if (n < 0) resumen.negativos++;
      if (n === 0) resumen.agotados++;
    });
    resumen.valorCosto = esAdmin(u) ? r2(resumen.valorCosto) : undefined;
    resumen.valorPvp = r2(resumen.valorPvp);
    return { ubicaciones: ubicaciones.map(_limpio), filas: filas, resumen: resumen };
  },

  /** Historial de movimientos de un producto (kardex). */
  kardex: function (u, d) {
    var s = normSku(d.sku);
    var ubic = _mapa(Db.leer('Ubicaciones'));
    var saldo = {};
    var movs = Db.leer('Movimientos').filter(function (m) { return normSku(m.sku) === s; })
      .sort(function (a, b) { return a.fecha === b.fecha ? (a.id < b.id ? -1 : 1) : (a.fecha < b.fecha ? -1 : 1); })
      .map(function (m) {
        saldo[m.ubicacion_id] = r2((saldo[m.ubicacion_id] || 0) + num(m.cantidad));
        var o = _limpio(m);
        o.ubicacion = ubic[m.ubicacion_id] ? ubic[m.ubicacion_id].nombre : m.ubicacion_id;
        o.saldoUbicacion = saldo[m.ubicacion_id];
        return o;
      });
    var p = Db.porId('Productos', s, 'sku');
    return { producto: p ? _limpio(p) : { sku: s }, movimientos: movs.reverse() };
  },

  traslado: function (u, d) {
    exigirAdmin(u);
    return conBloqueo(function () {
      var fecha = isoFecha(d.fecha) || hoyIso();
      if (fecha > hoyIso()) throw new Error('La fecha no puede ser futura.');
      var origen = Db.porId('Ubicaciones', d.origen_id), destino = Db.porId('Ubicaciones', d.destino_id);
      if (!origen || !destino) throw new Error('Indica la ubicación de origen y de destino.');
      if (origen.id === destino.id) throw new Error('El origen y el destino deben ser distintos.');
      if (!d.items || !d.items.length) throw new Error('Agrega al menos un producto.');
      var stock = _stockActual();
      var productos = _productosPorSku();
      var faltan = [];
      d.items.forEach(function (it) {
        var s = normSku(it.sku), q = num(it.cantidad);
        if (!productos[s]) throw new Error('El código ' + s + ' no existe.');
        if (!(q > 0)) throw new Error('Cantidad inválida para ' + s + '.');
        var disp = stock[claveStock(s, origen.id)] || 0;
        if (disp < q) faltan.push(s + ' (hay ' + disp + ')');
      });
      if (faltan.length && !d.forzar_stock) throw new Error('STOCK_INSUFICIENTE: No hay suficiente stock en ' + origen.nombre + ':\n' + faltan.join('\n'));
      var ref = Db.siguienteId('T');
      var ids = Db.siguienteId('M', d.items.length * 2);
      var ahora = ahoraIso();
      var nota = texto(d.nota) || (origen.nombre + ' → ' + destino.nombre);
      var movs = [];
      d.items.forEach(function (it, i) {
        var s = normSku(it.sku), q = num(it.cantidad);
        movs.push({ id: ids[2 * i], fecha: fecha, sku: s, ubicacion_id: origen.id, cantidad: -q, tipo: MOV.TRASLADO_SALIDA, ref_id: ref, nota: nota, creado_por: u.usuario, creado_en: ahora });
        movs.push({ id: ids[2 * i + 1], fecha: fecha, sku: s, ubicacion_id: destino.id, cantidad: q, tipo: MOV.TRASLADO_ENTRADA, ref_id: ref, nota: nota, creado_por: u.usuario, creado_en: ahora });
      });
      Db.insertar('Movimientos', movs);
      auditar(u, 'TRASLADO', ref + ' ' + nota);
      return { ref: ref, movimientos: movs.length };
    });
  },

  /**
   * Conteo físico: el usuario indica cuánto hay realmente; se crea un AJUSTE por la diferencia.
   * Así el sistema queda igual a la realidad y la diferencia queda documentada.
   */
  conteo: function (u, d) {
    exigirAdmin(u);
    return conBloqueo(function () {
      var fecha = isoFecha(d.fecha) || hoyIso();
      var ubic = Db.porId('Ubicaciones', d.ubicacion_id);
      if (!ubic) throw new Error('Indica la ubicación contada.');
      var stock = _stockActual();
      var productos = _productosPorSku();
      var ahora = ahoraIso();
      var ajustes = [];
      (d.conteos || []).forEach(function (c) {
        if (c.fisico === '' || c.fisico === null || c.fisico === undefined) return;
        var s = normSku(c.sku);
        if (!productos[s]) throw new Error('El código ' + s + ' no existe.');
        var fisico = num(c.fisico);
        if (fisico < 0) throw new Error('El conteo de ' + s + ' no puede ser negativo.');
        var sistema = stock[claveStock(s, ubic.id)] || 0;
        var dif = r2(fisico - sistema);
        if (dif !== 0) ajustes.push({ sku: s, sistema: sistema, fisico: fisico, diferencia: dif });
      });
      if (!ajustes.length) return { ajustes: [], mensaje: 'El conteo coincide con el sistema. No se hicieron ajustes.' };
      var ref = Db.siguienteId('AJ');
      var ids = Db.siguienteId('M', ajustes.length);
      var nota = texto(d.nota) || 'Conteo físico';
      Db.insertar('Movimientos', ajustes.map(function (a, i) {
        return { id: ids[i], fecha: fecha, sku: a.sku, ubicacion_id: ubic.id, cantidad: a.diferencia, tipo: MOV.AJUSTE, ref_id: ref, nota: nota + ' (sistema ' + a.sistema + ', físico ' + a.fisico + ')', creado_por: u.usuario, creado_en: ahora };
      }));
      auditar(u, 'CONTEO_FISICO', ref + ' ' + ubic.nombre + ': ' + ajustes.length + ' ajustes');
      return { ref: ref, ajustes: ajustes };
    });
  }
};


// ==================== Reportes.gs ====================
/**
 * Reportes.gs — Inicio (resumen), conciliación compras vs ventas y comisiones.
 */

var Reportes = {
  inicio: function (u, f) {
    f = f || {};
    var hoy = hoyIso();
    var desde = isoFecha(f.desde) || hoy.slice(0, 8) + '01';
    var hasta = isoFecha(f.hasta) || hoy;
    var ventas = _ventasConEstado(u).filter(function (v) { return v.estado !== ESTADO.ANULADA; });
    var ventasMap = _mapa(ventas);
    var enRango = ventas.filter(function (v) { return v.fecha >= desde && v.fecha <= hasta; });
    var pagos = Db.leer('Pagos').filter(function (p) { return p.estado !== ESTADO.ANULADA && ventasMap[p.venta_id]; });
    var cobradoRango = pagos.filter(function (p) { return p.fecha >= desde && p.fecha <= hasta; });
    var hoyVentas = ventas.filter(function (v) { return v.fecha === hoy; });
    var hoyPagos = pagos.filter(function (p) { return p.fecha === hoy; });
    var sum = function (l, k) { return r2(l.reduce(function (a, x) { return a + num(x[k]); }, 0)); };
    var unidades = function (l) {
      var ids = {}; l.forEach(function (v) { ids[v.id] = 1; });
      return Db.leer('VentaItems').reduce(function (a, it) { return a + (ids[it.venta_id] ? num(it.cantidad) : 0); }, 0);
    };

    var porVendedor = {};
    enRango.forEach(function (v) {
      var r = porVendedor[v.vendedor] = porVendedor[v.vendedor] || { vendedor: v.vendedor, ventas: 0, total: 0, comision: 0 };
      r.ventas++; r.total = r2(r.total + v.total); r.comision = r2(r.comision + num(v.comision));
    });
    var idsRango = {}; enRango.forEach(function (v) { idsRango[v.id] = 1; });
    var porProducto = {};
    var productos = _productosPorSku();
    Db.leer('VentaItems').forEach(function (it) {
      if (!idsRango[it.venta_id]) return;
      var p = productos[normSku(it.sku)];
      var k = (p && p.linea) || it.descripcion || it.sku;
      var r = porProducto[k] = porProducto[k] || { producto: k, unidades: 0, total: 0 };
      r.unidades += num(it.cantidad); r.total = r2(r.total + num(it.subtotal));
    });

    var porCobrar = ventas.filter(function (v) { return v.saldo > 0.005; });
    var out = {
      rango: { desde: desde, hasta: hasta },
      hoy: { ventas: hoyVentas.length, total: sum(hoyVentas, 'total'), cobrado: sum(hoyPagos, 'monto') },
      periodo: {
        ventas: enRango.length, unidades: unidades(enRango), total: sum(enRango, 'total'),
        cobrado: sum(cobradoRango, 'monto'), comision: sum(enRango, 'comision'),
        contado: sum(enRango.filter(function (v) { return v.tipo === TIPO_VENTA.CONTADO; }), 'total'),
        credito: sum(enRango.filter(function (v) { return v.tipo === TIPO_VENTA.CREDITO; }), 'total'),
        fiscal: sum(enRango.filter(function (v) { return v.fiscal === 'SI'; }), 'total'),
        noFiscal: sum(enRango.filter(function (v) { return v.fiscal !== 'SI'; }), 'total')
      },
      porCobrar: { total: r2(porCobrar.reduce(function (a, v) { return a + v.saldo; }, 0)), ventas: porCobrar.length },
      porVendedor: Object.keys(porVendedor).map(function (k) { return porVendedor[k]; }).sort(function (a, b) { return b.total - a.total; }),
      porProducto: Object.keys(porProducto).map(function (k) { return porProducto[k]; }).sort(function (a, b) { return b.total - a.total; }).slice(0, 10)
    };
    if (esAdmin(u)) {
      out.sistemaVacio = Db.leer('Ventas').length === 0;
      out.periodo.costo = sum(enRango, 'costo');
      out.periodo.margen = r2(out.periodo.total - out.periodo.costo - out.periodo.comision);
      var conc = conciliar(Db.leer('Productos'), Db.leer('Movimientos'));
      out.alertas = {
        skusNegativos: conc.resumen.skusNegativos,
        unidadesSinCompra: conc.resumen.unidadesSinCompra,
        skusNegativosPorUbicacion: conc.resumen.skusNegativosPorUbicacion,
        pagosFechaEstimada: Db.leer('Pagos').filter(function (p) { return p.fecha_estimada === 'SI' && p.estado !== ESTADO.ANULADA; }).length,
        comprasSinArchivo: Db.leer('Compras').filter(function (c) { return c.estado !== ESTADO.ANULADA && !texto(c.archivo_url); }).length,
        ventasPorIdentificar: ventas.filter(function (v) { return esClientePendiente(v.cliente); }).length,
        comisionesPorLiquidar: r2(ventas.filter(function (v) { return !texto(v.comision_pagada_en) && v.saldo <= 0.005; }).reduce(function (a, v) { return a + num(v.comision); }, 0))
      };
    }
    return out;
  },

  conciliacion: function (u, f) {
    exigirAdmin(u);
    f = f || {};
    var res = conciliar(Db.leer('Productos'), Db.leer('Movimientos'));
    var filas = res.filas;
    if (f.solo === 'PROBLEMAS') filas = filas.filter(function (x) { return !x.ok; });
    if (f.solo === 'NEGATIVOS') filas = filas.filter(function (x) { return x.stock < 0 || x.negativoEn.length; });
    if (f.q) {
      var q = normNombre(f.q);
      filas = filas.filter(function (x) { return (x.sku + ' ' + x.descripcion).toUpperCase().indexOf(q) !== -1; });
    }
    filas = filas.filter(function (x) { return x.comprado || x.vendido || x.ajustes || x.inicial || x.stock || !x.existeEnCatalogo; });
    var dinero = {
      compras: r2(Db.leer('Compras').filter(function (c) { return c.estado !== ESTADO.ANULADA; }).reduce(function (a, c) { return a + num(c.total); }, 0)),
      ventas: r2(Db.leer('Ventas').filter(function (v) { return v.estado !== ESTADO.ANULADA; }).reduce(function (a, v) { return a + num(v.total); }, 0))
    };
    return { resumen: res.resumen, dinero: dinero, filas: filas };
  },

  comisiones: function (u, f) {
    f = f || {};
    var desde = isoFecha(f.desde), hasta = isoFecha(f.hasta);
    var ventas = _ventasConEstado(u).filter(function (v) {
      if (desde && v.fecha < desde) return false;
      if (hasta && v.fecha > hasta) return false;
      if (f.vendedor_id && v.vendedor_id !== f.vendedor_id) return false;
      return true;
    });
    var estados = {};
    ventas.forEach(function (v) { estados[v.id] = { saldo: v.saldo }; });
    var resumen = resumirComisiones(ventas, estados);
    var detalle = [];
    if (f.vendedor_id) {
      var itemsPor = _agrupar(Db.leer('VentaItems'), 'venta_id');
      detalle = ventas.filter(function (v) { return v.estado !== ESTADO.ANULADA && num(v.comision) > 0; })
        .map(function (v) {
          return {
            id: v.id, fecha: v.fecha, cliente: v.cliente, total: v.total, saldo: v.saldo, comision: num(v.comision),
            productos: (itemsPor[v.id] || []).map(function (i) { return i.descripcion || i.sku; }).join(', '),
            pagada_en: v.comision_pagada_en, liquidable: !texto(v.comision_pagada_en) && v.saldo <= 0.005
          };
        }).sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; });
    }
    var liquidaciones = Db.leer('Liquidaciones').filter(function (l) {
      return (esAdmin(u) || l.vendedor_id === u.vendedor_id) && (!f.vendedor_id || l.vendedor_id === f.vendedor_id);
    }).map(_limpio).sort(function (a, b) { return a.fecha < b.fecha ? 1 : -1; });
    return { resumen: resumen, detalle: detalle, liquidaciones: liquidaciones };
  },

  /** Marca como pagadas las comisiones de las ventas indicadas y deja un recibo (Liquidaciones). */
  liquidarComisiones: function (u, d) {
    exigirAdmin(u);
    return conBloqueo(function () {
      var vend = Db.porId('Vendedores', d.vendedor_id);
      if (!vend) throw new Error('Vendedor no encontrado.');
      var ids = d.venta_ids || [];
      if (!ids.length) throw new Error('Selecciona las ventas a liquidar.');
      var fecha = isoFecha(d.fecha) || hoyIso();
      var pagosPor = _agrupar(Db.leer('Pagos'), 'venta_id');
      var total = 0;
      var ventas = ids.map(function (id) {
        var v = Db.porId('Ventas', id);
        if (!v || v.vendedor_id !== vend.id) throw new Error('La venta ' + id + ' no pertenece a ' + vend.nombre + '.');
        if (v.estado === ESTADO.ANULADA) throw new Error('La venta ' + id + ' está anulada.');
        if (texto(v.comision_pagada_en)) throw new Error('La comisión de ' + id + ' ya fue liquidada.');
        var e = calcularEstadoVenta(v, pagosPor[v.id]);
        if (e.saldo > 0.005 && !d.incluir_no_cobradas) throw new Error('La venta ' + id + ' aún tiene saldo pendiente ($' + e.saldo.toFixed(2) + ').');
        total += num(v.comision);
        return v;
      });
      var liqId = Db.siguienteId('L');
      Db.insertar('Liquidaciones', [{ id: liqId, fecha: fecha, vendedor_id: vend.id, vendedor: vend.nombre, monto: r2(total), ventas: ids.join(','), nota: texto(d.nota), creado_por: u.usuario, creado_en: ahoraIso() }]);
      ventas.forEach(function (v) { Db.actualizar('Ventas', v.id, { comision_pagada_en: fecha, liquidacion_id: liqId }); });
      auditar(u, 'COMISIONES_LIQUIDADAS', liqId + ' ' + vend.nombre + ' $' + r2(total));
      return { id: liqId, monto: r2(total), ventas: ids.length };
    });
  },

  revertirLiquidacion: function (u, d) {
    exigirAdmin(u);
    return conBloqueo(function () {
      var l = Db.porId('Liquidaciones', d.id);
      if (!l) throw new Error('Liquidación no encontrada.');
      texto(l.ventas).split(',').filter(String).forEach(function (id) {
        var v = Db.porId('Ventas', id);
        if (v && v.liquidacion_id === l.id) Db.actualizar('Ventas', id, { comision_pagada_en: '', liquidacion_id: '' });
      });
      Db.borrarDonde('Liquidaciones', function (x) { return x.id === l.id; });
      auditar(u, 'LIQUIDACION_REVERTIDA', l.id + ' ' + l.vendedor + ' $' + l.monto);
      return true;
    });
  }
};


// ==================== Catalogo.gs ====================
/**
 * Catalogo.gs — Productos, líneas (comisión por línea), vendedores, ubicaciones,
 * usuarios y configuración.
 */

function _carpetaConfig(clave, nombre) {
  var id = Db.config()[clave];
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* se recrea */ }
  }
  var c = DriveApp.createFolder(nombre);
  conBloqueo(function () { Db.guardarConfig(clave, c.getId()); });
  return c;
}

var Catalogo = {
  /** Todo lo que la app necesita al abrir. */
  inicial: function (u, d) {
    var admin = esAdmin(u);
    var stock = _stockActual();
    var ubic = Db.leer('Ubicaciones').filter(function (x) { return x.activo !== 'NO'; }).map(_limpio);
    var productos = Db.leer('Productos').map(function (p) {
      var o = _limpio(p);
      o.sku = normSku(p.sku);
      o.stock = {};
      o.stockTotal = 0;
      ubic.forEach(function (ub) { var n = stock[claveStock(o.sku, ub.id)] || 0; o.stock[ub.id] = n; o.stockTotal += n; });
      if (!admin) delete o.costo;
      return o;
    });
    var cfg = Db.config();
    return {
      usuario: usuarioPublico(u),
      negocio: cfg.NOMBRE_NEGOCIO || 'Cubitt',
      hoy: hoyIso(),
      productos: productos,
      lineas: Db.leer('Lineas').map(_limpio),
      vendedores: Db.leer('Vendedores').map(_limpio),
      ubicaciones: ubic,
      metodosPago: (cfg.METODOS_PAGO || 'EFECTIVO USD,ZELLE,BINANCE,PAGO MOVIL,TRANSFERENCIA BS,PUNTO DE VENTA,CASHEA').split(',').map(texto).filter(String),
      iaDisponible: admin && !!PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY'),
      ubicacionPorDefecto: cfg.UBICACION_POR_DEFECTO || (ubic[0] && ubic[0].id) || '',
      // La pantalla de inicio viene en el mismo viaje para abrir más rápido
      inicio: d && d.inicio ? Reportes.inicio(u, d.inicio) : undefined
    };
  },

  guardarProducto: function (u, p) {
    exigirAdmin(u);
    return conBloqueo(function () {
      var sku = normSku(p.sku);
      if (!sku) throw new Error('El código (SKU) es obligatorio.');
      if (num(p.costo) < 0 || num(p.pvp) < 0 || num(p.comision) < 0) throw new Error('Costo, precio y comisión no pueden ser negativos.');
      var datos = {
        sku: sku, linea: normNombre(p.linea), modelo: texto(p.modelo).toUpperCase(), color: texto(p.color).toUpperCase(),
        descripcion: texto(p.descripcion), costo: texto(p.costo) === '' ? '' : r2(num(p.costo)), pvp: texto(p.pvp) === '' ? '' : r2(num(p.pvp)),
        comision: texto(p.comision) === '' ? '' : r2(num(p.comision)), activo: p.activo === false || p.activo === 'NO' ? 'NO' : 'SI',
        imagen: texto(p.imagen), actualizado_en: ahoraIso()
      };
      if (Db.porId('Productos', sku, 'sku')) {
        if (p.nuevo) throw new Error('Ya existe un producto con el código ' + sku + '.');
        Db.actualizar('Productos', sku, datos, 'sku');
      } else {
        Db.insertar('Productos', [datos]);
      }
      if (datos.linea && !Db.porId('Lineas', datos.linea, 'nombre')) Db.insertar('Lineas', [{ nombre: datos.linea, comision: '', notas: '' }]);
      auditar(u, 'PRODUCTO_GUARDADO', sku);
      return datos;
    });
  },

  guardarLinea: function (u, l) {
    exigirAdmin(u);
    return conBloqueo(function () {
      var nombre = normNombre(l.nombre);
      if (!nombre) throw new Error('El nombre de la línea es obligatorio.');
      if (num(l.comision) < 0) throw new Error('La comisión no puede ser negativa.');
      var datos = { nombre: nombre, comision: texto(l.comision) === '' ? '' : r2(num(l.comision)), notas: texto(l.notas) };
      if (Db.porId('Lineas', nombre, 'nombre')) Db.actualizar('Lineas', nombre, datos, 'nombre');
      else Db.insertar('Lineas', [datos]);
      auditar(u, 'LINEA_GUARDADA', nombre + ' comisión ' + datos.comision);
      return datos;
    });
  },

  guardarVendedor: function (u, v) {
    exigirAdmin(u);
    return conBloqueo(function () {
      var nombre = normNombre(v.nombre);
      if (!nombre) throw new Error('El nombre es obligatorio.');
      var existente = v.id ? Db.porId('Vendedores', v.id) : null;
      var repetido = Db.leer('Vendedores').filter(function (x) { return x.nombre === nombre && (!existente || x.id !== existente.id); })[0];
      if (repetido) throw new Error('Ya existe el vendedor ' + nombre + '.');
      var datos = { nombre: nombre, telefono: texto(v.telefono), activo: v.activo === false || v.activo === 'NO' ? 'NO' : 'SI', notas: texto(v.notas) };
      if (existente) {
        Db.actualizar('Vendedores', existente.id, datos);
        datos.id = existente.id;
      } else {
        datos.id = Db.siguienteId('VEN');
        datos.creado_en = ahoraIso();
        Db.insertar('Vendedores', [datos]);
      }
      auditar(u, 'VENDEDOR_GUARDADO', datos.id + ' ' + nombre);
      return datos;
    });
  },

  guardarUbicacion: function (u, x) {
    exigirAdmin(u);
    return conBloqueo(function () {
      var nombre = texto(x.nombre);
      if (!nombre) throw new Error('El nombre es obligatorio.');
      var datos = { nombre: nombre, activo: x.activo === false || x.activo === 'NO' ? 'NO' : 'SI', notas: texto(x.notas) };
      if (x.id && Db.porId('Ubicaciones', x.id)) {
        if (datos.activo === 'NO') {
          var st = _stockActual();
          var conStock = Object.keys(st).filter(function (k) { return k.split('|')[1] === x.id && st[k] !== 0; });
          if (conStock.length) throw new Error('No se puede desactivar: todavía tiene stock en ' + conStock.length + ' productos. Trasládalo primero.');
        }
        Db.actualizar('Ubicaciones', x.id, datos);
        datos.id = x.id;
      } else {
        datos.id = Db.siguienteId('UB');
        Db.insertar('Ubicaciones', [datos]);
      }
      auditar(u, 'UBICACION_GUARDADA', datos.id + ' ' + nombre);
      return datos;
    });
  },

  usuarios: function (u) {
    exigirAdmin(u);
    return Db.leer('Usuarios').map(usuarioPublico);
  },

  crearUsuario: function (u, d) {
    exigirAdmin(u);
    return conBloqueo(function () { d.debe_cambiar_clave = true; return Auth.crearUsuario(d, u); });
  },

  editarUsuario: function (u, d) {
    exigirAdmin(u);
    return conBloqueo(function () {
      var x = Db.porId('Usuarios', d.id);
      if (!x) throw new Error('Usuario no encontrado.');
      var cambios = {};
      if (d.nombre !== undefined) cambios.nombre = texto(d.nombre);
      if (d.activo !== undefined) {
        if (x.id === u.id && !d.activo) throw new Error('No puedes desactivar tu propio usuario.');
        cambios.activo = d.activo ? 'SI' : 'NO';
        if (!d.activo) Auth._cerrarSesionesDe(x.id);
      }
      if (d.rol !== undefined) {
        if (x.id === u.id && d.rol !== ROL.ADMIN) throw new Error('No puedes quitarte el rol de administrador.');
        cambios.rol = d.rol === ROL.ADMIN ? ROL.ADMIN : ROL.VENDEDOR;
      }
      if (d.vendedor_id !== undefined) cambios.vendedor_id = texto(d.vendedor_id);
      var rolFinal = cambios.rol || x.rol;
      if (rolFinal === ROL.VENDEDOR && !texto(cambios.vendedor_id !== undefined ? cambios.vendedor_id : x.vendedor_id)) throw new Error('Un usuario vendedor debe estar vinculado a un vendedor.');
      Db.actualizar('Usuarios', x.id, cambios);
      auditar(u, 'USUARIO_EDITADO', x.usuario + ' ' + JSON.stringify(cambios));
      return usuarioPublico(Db.porId('Usuarios', x.id));
    });
  },

  restablecerClave: function (u, d) {
    exigirAdmin(u);
    return conBloqueo(function () { Auth.restablecerClave(u, d.id, d.clave); return true; });
  },

  config: function (u) {
    exigirAdmin(u);
    var cfg = Db.config();
    return {
      NOMBRE_NEGOCIO: cfg.NOMBRE_NEGOCIO || 'Cubitt',
      METODOS_PAGO: cfg.METODOS_PAGO || 'EFECTIVO USD,ZELLE,BINANCE,PAGO MOVIL,TRANSFERENCIA BS,PUNTO DE VENTA,CASHEA',
      UBICACION_POR_DEFECTO: cfg.UBICACION_POR_DEFECTO || '',
      MODELO_GEMINI: cfg.MODELO_GEMINI || 'gemini-flash-latest',
      HOJA_ORIGEN_ID: cfg.HOJA_ORIGEN_ID || '',
      CARPETA_FACTURAS_ORIGEN_ID: cfg.CARPETA_FACTURAS_ORIGEN_ID || '',
      geminiConfigurado: !!PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY'),
      baseDeDatosUrl: Db.ss().getUrl()
    };
  },

  guardarConfig: function (u, d) {
    exigirAdmin(u);
    return conBloqueo(function () {
      ['NOMBRE_NEGOCIO', 'METODOS_PAGO', 'UBICACION_POR_DEFECTO', 'MODELO_GEMINI', 'HOJA_ORIGEN_ID', 'CARPETA_FACTURAS_ORIGEN_ID'].forEach(function (k) {
        if (d[k] !== undefined) Db.guardarConfig(k, texto(d[k]));
      });
      // La clave de Gemini se guarda solo en el servidor (propiedades del script)
      if (d.GEMINI_API_KEY !== undefined) {
        var props = PropertiesService.getScriptProperties();
        if (texto(d.GEMINI_API_KEY)) props.setProperty('GEMINI_API_KEY', texto(d.GEMINI_API_KEY));
        else props.deleteProperty('GEMINI_API_KEY');
      }
      auditar(u, 'CONFIG_GUARDADA', Object.keys(d).filter(function (k) { return k !== 'GEMINI_API_KEY'; }).join(','));
      return Catalogo.config(u);
    });
  },

  /** Productos disponibles (con stock) con foto y precio, para responder "¿qué hay disponible?". */
  disponible: function (u, f) {
    f = f || {};
    var stock = _stockActual();
    var ubics = Db.leer('Ubicaciones').filter(function (x) { return x.activo !== 'NO'; });
    var q = normNombre(f.q);
    var linea = normNombre(f.linea);
    var items = Db.leer('Productos').filter(function (p) { return p.activo !== 'NO'; }).map(function (p) {
      var s = normSku(p.sku);
      var porUbicacion = {}, total = 0;
      ubics.forEach(function (ub) { var n = stock[claveStock(s, ub.id)] || 0; porUbicacion[ub.id] = n; total += n; });
      return {
        sku: s, linea: p.linea, modelo: p.modelo, color: p.color, descripcion: p.descripcion, imagen: p.imagen,
        pvp: texto(p.pvp) === '' ? '' : num(p.pvp), porUbicacion: porUbicacion,
        stock: f.ubicacion_id ? (porUbicacion[f.ubicacion_id] || 0) : r2(total)
      };
    }).filter(function (it) {
      if (!f.incluirAgotados && !(it.stock > 0)) return false;
      if (linea && normNombre(it.linea) !== linea) return false;
      if (q && [it.sku, it.linea, it.modelo, it.color, it.descripcion].join(' ').toUpperCase().indexOf(q) === -1) return false;
      return true;
    });
    items.sort(function (a, b) { return (a.linea || 'ZZZ').localeCompare(b.linea || 'ZZZ') || (a.modelo || '').localeCompare(b.modelo || '') || a.sku.localeCompare(b.sku); });
    var ub = f.ubicacion_id ? Db.porId('Ubicaciones', f.ubicacion_id) : null;
    return {
      negocio: Db.config().NOMBRE_NEGOCIO || 'Cubitt', fecha: hoyIso(), ubicacion: ub ? ub.nombre : 'Todas las ubicaciones',
      items: items, unidades: r2(items.reduce(function (a, it) { return a + Math.max(0, it.stock); }, 0)),
      sinPrecio: items.filter(function (it) { return it.pvp === ''; }).length,
      sinImagen: items.filter(function (it) { return !texto(it.imagen); }).length
    };
  },

  /**
   * Genera el catálogo de disponibles como PDF con fotos y precio de venta.
   * Se arma una hoja de Google con =IMAGE() (Google muestra bien las fotos .webp de la web de Cubitt)
   * y se exporta a PDF. Ambos archivos quedan en la carpeta "Cubitt Admin — Catálogos" de tu Drive.
   */
  generarCatalogoPdf: function (u, f) {
    f = f || {};
    var d = Catalogo.disponible(u, f);
    if (!d.items.length) throw new Error('No hay productos disponibles con esos filtros.');
    var mostrarCantidad = !!f.mostrarCantidad;
    var titulo = d.negocio + ' — Disponible al ' + d.fecha.split('-').reverse().join('/');
    var ss = SpreadsheetApp.create(titulo);
    var sh = ss.getSheets()[0];
    sh.setName('Disponible');
    var nCol = mostrarCantidad ? 5 : 4;
    var filas = [], formulas = [], tipos = [];
    var fila = function (vals, tipo, formula) {
      while (vals.length < nCol) vals.push('');
      filas.push(vals); formulas.push([formula || '']); tipos.push(tipo);
    };
    fila([titulo], 'titulo');
    fila(['Precios de venta en USD · ' + d.ubicacion + ' · ' + d.items.length + ' productos'], 'sub');
    fila(mostrarCantidad ? ['Foto', 'Producto', 'Código', 'Precio', 'Disponibles'] : ['Foto', 'Producto', 'Código', 'Precio'], 'enc');
    var lineaActual = null;
    d.items.forEach(function (it) {
      var l = it.linea || 'OTROS';
      if (l !== lineaActual) { fila(['', l], 'linea'); lineaActual = l; }
      var nombre = [it.modelo, it.color].filter(function (x) { return texto(x); }).join(' · ') || it.descripcion || it.sku;
      var vals = ['', (it.linea ? it.linea + '\n' : '') + nombre, it.sku, it.pvp === '' ? 'Consultar' : it.pvp];
      if (mostrarCantidad) vals.push(it.stock);
      var url = texto(it.imagen).replace(/"/g, '');
      fila(vals, 'prod', url ? '=IMAGE("' + url + '")' : '');
    });
    sh.getRange(1, 1, filas.length, nCol).setValues(filas);
    sh.getRange(1, 1, formulas.length, 1).setFormulas(formulas);
    // Formato
    sh.setColumnWidth(1, 120); sh.setColumnWidth(2, 280); sh.setColumnWidth(3, 120); sh.setColumnWidth(4, 90);
    if (mostrarCantidad) sh.setColumnWidth(5, 90);
    sh.getRange(1, 1, 1, nCol).merge().setFontSize(16).setFontWeight('bold');
    sh.getRange(2, 1, 1, nCol).merge().setFontColor('#555555');
    sh.getRange(3, 1, 1, nCol).setFontWeight('bold').setBackground('#0f766e').setFontColor('#ffffff');
    sh.getRange(4, 1, filas.length - 3, nCol).setVerticalAlignment('middle').setWrap(true);
    sh.getRange(4, 4, filas.length - 3, 1).setNumberFormat('"$"#,##0.00').setFontWeight('bold').setHorizontalAlignment('right');
    tipos.forEach(function (t, i) {
      if (t === 'prod') sh.setRowHeights(i + 1, 1, 110);
      if (t === 'linea') sh.getRange(i + 1, 1, 1, nCol).setBackground('#e6f4f2').setFontWeight('bold');
    });
    sh.setHiddenGridlines(true);
    SpreadsheetApp.flush();
    Utilities.sleep(2500); // dar tiempo a que carguen las imágenes antes de exportar

    var carpeta = _carpetaConfig('CARPETA_CATALOGOS_ID', 'Cubitt Admin — Catálogos');
    DriveApp.getFileById(ss.getId()).moveTo(carpeta);
    var url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=pdf&size=letter&portrait=true&fitw=true&gridlines=false' +
      '&printtitle=false&sheetnames=false&pagenum=CENTER&top_margin=0.4&bottom_margin=0.4&left_margin=0.4&right_margin=0.4&gid=' + sh.getSheetId();
    var resp = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) throw new Error('No se pudo crear el PDF (código ' + resp.getResponseCode() + '). La hoja con el catálogo sí quedó en tu Drive: ' + ss.getUrl());
    var pdf = carpeta.createFile(resp.getBlob().setName(titulo.replace(/[\/:*?"<>|]/g, '-') + '.pdf'));
    if (f.compartir) pdf.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    auditar(u, 'CATALOGO_PDF', d.items.length + ' productos · ' + d.ubicacion);
    return { pdf_url: pdf.getUrl(), hoja_url: ss.getUrl(), productos: d.items.length, compartido: !!f.compartir };
  },

  /** Sube una foto de producto a Drive (visible con el enlace, para que se vea en la app y en el catálogo). */
  subirImagenProducto: function (u, d) {
    exigirAdmin(u);
    var mime = texto(d.mime).toLowerCase();
    if (!/^image\/(jpeg|png|webp)$/.test(mime)) throw new Error('Usa una foto JPG, PNG o WEBP.');
    var bytes = Utilities.base64Decode(texto(d.base64));
    if (bytes.length > 8 * 1024 * 1024) throw new Error('La foto supera 8 MB.');
    var carpeta = _carpetaConfig('CARPETA_FOTOS_ID', 'Cubitt Admin — Fotos de productos');
    var archivo = carpeta.createFile(Utilities.newBlob(bytes, mime, (normSku(d.sku) || 'producto') + '.' + mime.split('/')[1]));
    archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var url = 'https://drive.google.com/thumbnail?id=' + archivo.getId() + '&sz=w1000';
    if (normSku(d.sku) && Db.porId('Productos', normSku(d.sku), 'sku')) {
      conBloqueo(function () { Db.actualizar('Productos', normSku(d.sku), { imagen: url, actualizado_en: ahoraIso() }, 'sku'); });
    }
    return { imagen: url };
  },

  auditoria: function (u) {
    exigirAdmin(u);
    return Db.leer('Auditoria').slice(-300).reverse().map(_limpio);
  }
};


// ==================== Migracion.gs ====================
/**
 * Migracion.gs — Importa el histórico desde la hoja "Cubitt" (pestañas Ventas, BDD y Compras_Nueva).
 *
 * - Cada fila de "Ventas" se convierte en una venta con su línea de producto.
 * - Cada monto en PAGO 1..PAGO 5 se convierte en un pago. La fecha del pago se toma del
 *   COMENTARIO de esa celda (ej. "24/07"). Google no expone a qué celda pertenece un comentario
 *   por su API, así que se exporta la hoja a .xlsx internamente, donde sí viene la celda exacta.
 *   Si un pago no tiene comentario con fecha, se usa la fecha de la venta y queda marcado como
 *   "fecha estimada" para corregirlo luego.
 * - Cada fila de "Compras_Nueva" (agrupada por número de factura) se convierte en una compra.
 * - "BDD" alimenta el catálogo de productos (costo, PVP, comisión).
 * - Siempre se puede ejecutar primero en modo SIMULACIÓN para ver el reporte sin guardar nada.
 * - Repetir la migración reemplaza solo lo migrado (ids "H-…"), nunca lo registrado en la app.
 */

var UB_PRINCIPAL = 'UB-TRINITARIAS';
var UB_TMANIA = 'UB-TMANIA';
var UB_MARACAY = 'UB-MARACAY';

function _decodificarXml(s) {
  return String(s || '')
    .replace(/&#x([0-9a-fA-F]+);/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
    .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(Number(d)); })
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function _resolverRuta(base, destino) {
  if (destino.charAt(0) === '/') return destino.slice(1);
  var partes = base.split('/'); partes.pop();
  destino.split('/').forEach(function (p) { if (p === '..') partes.pop(); else if (p !== '.') partes.push(p); });
  return partes.join('/');
}

function _relaciones(xml) {
  var m = {};
  var re = /<Relationship\b([^>]*)\/?>/g, r;
  while ((r = re.exec(xml || '')) !== null) {
    var id = (r[1].match(/\bId="([^"]+)"/) || [])[1];
    var target = (r[1].match(/\bTarget="([^"]+)"/) || [])[1];
    var type = (r[1].match(/\bType="([^"]+)"/) || [])[1] || '';
    if (id && target) m[id] = { target: target, type: type };
  }
  return m;
}

/**
 * A partir de los archivos XML de un .xlsx devuelve { 'L23': ['24/07', ...], ... }
 * con los comentarios de la pestaña indicada (comentarios encadenados y notas clásicas).
 */
function extraerComentariosXlsx(archivos, nombreHoja) {
  var wb = archivos['xl/workbook.xml'];
  if (!wb) throw new Error('El archivo exportado no tiene libro de trabajo.');
  var rels = _relaciones(archivos['xl/_rels/workbook.xml.rels']);
  var re = /<sheet\b([^>]*)\/?>/g, s, rutaHoja = null;
  while ((s = re.exec(wb)) !== null) {
    var nombre = _decodificarXml((s[1].match(/\bname="([^"]*)"/) || [])[1]);
    var rid = (s[1].match(/\br:id="([^"]+)"/) || [])[1];
    if (normNombre(nombre) === normNombre(nombreHoja) && rels[rid]) rutaHoja = _resolverRuta('xl/workbook.xml', rels[rid].target);
  }
  if (!rutaHoja) throw new Error('No se encontró la pestaña "' + nombreHoja + '" en la exportación.');
  var partes = rutaHoja.split('/');
  var relsHoja = _relaciones(archivos[partes.slice(0, -1).join('/') + '/_rels/' + partes[partes.length - 1] + '.rels']);
  var out = {};
  var agregar = function (ref, txt) { txt = texto(txt); if (txt) (out[ref] = out[ref] || []).push(txt); };
  var hayEncadenados = false;
  Object.keys(relsHoja).forEach(function (k) {
    var rel = relsHoja[k];
    if (!/threadedComment/i.test(rel.type) && !/threadedComment/i.test(rel.target)) return;
    var xml = archivos[_resolverRuta(rutaHoja, rel.target)] || '';
    var reC = /<(?:\w+:)?threadedComment\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?threadedComment>/g, c;
    while ((c = reC.exec(xml)) !== null) {
      hayEncadenados = true;
      var ref = (c[1].match(/\bref="([A-Z]+\d+)"/) || [])[1];
      var t = (c[2].match(/<(?:\w+:)?text\b[^>]*>([\s\S]*?)<\/(?:\w+:)?text>/) || [])[1];
      if (ref) agregar(ref, _decodificarXml(t));
    }
  });
  if (!hayEncadenados) {
    Object.keys(relsHoja).forEach(function (k) {
      var rel = relsHoja[k];
      if (!/\/comments$/i.test(rel.type) && !/comments\d*\.xml$/i.test(rel.target)) return;
      var xml = archivos[_resolverRuta(rutaHoja, rel.target)] || '';
      var reC = /<comment\b[^>]*\bref="([A-Z]+\d+)"[^>]*>([\s\S]*?)<\/comment>/g, c;
      while ((c = reC.exec(xml)) !== null) {
        var t = (c[2].match(/<t\b[^>]*>[\s\S]*?<\/t>/g) || []).map(function (x) { return _decodificarXml(x.replace(/<[^>]+>/g, '')); }).join('');
        agregar(c[1], t.replace(/^Comentario[^:]*:\s*/i, ''));
      }
    });
  }
  return out;
}

function _letraColumna(i) {
  var s = '';
  i = i + 1;
  while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

function _indiceEncabezados(fila) {
  var m = {};
  (fila || []).forEach(function (h, i) { var k = normNombre(h); if (k && m[k] === undefined) m[k] = i; });
  return m;
}

function _col(idx, nombres) {
  for (var i = 0; i < nombres.length; i++) if (idx[nombres[i]] !== undefined) return idx[nombres[i]];
  return -1;
}

function _moda(lista) {
  var c = {}, mejor = null, n = 0;
  lista.forEach(function (x) { c[x] = (c[x] || 0) + 1; if (c[x] > n) { n = c[x]; mejor = x; } });
  return mejor;
}

/**
 * Lee la pestaña BDD (catálogo). formulas = mismas dimensiones que valores (para las =IMAGE()).
 * Devuelve { filas: [{ sku, modelo, color, descripcion, costo, pvp, comision, activo, imagen, real }], encontrada }.
 * real = INVENTARIO REAL (columna M) o null si la celda está vacía.
 */
function leerBDD(bdd, formulas) {
  bdd = bdd || []; formulas = formulas || [];
  var filaEnc = -1;
  for (var i = 0; i < Math.min(15, bdd.length); i++) if (_indiceEncabezados(bdd[i])['ARTICULO'] !== undefined) { filaEnc = i; break; }
  if (filaEnc < 0) return { encontrada: false, filas: [] };
  var ib = _indiceEncabezados(bdd[filaEnc]);
  var cSku = ib['ARTICULO'], cCat = _col(ib, ['CATEGORIA']), cMod = _col(ib, ['MODELO']), cCol = _col(ib, ['COLOR']), cImg = _col(ib, ['IMAGEN', 'FOTO']);
  var cCosto = _col(ib, ['MAYOR $', 'COSTO']), cPvp = _col(ib, ['PVP TIENDA', 'PVP']), cCom = _col(ib, ['COMISION']), cDisp = _col(ib, ['DISPONIBLE']);
  var cReal = _col(ib, ['INVENTARIO REAL', 'INVENTARIO FISICO', 'STOCK REAL']);
  var vistos = {};
  var filas = [];
  for (var r = filaEnc + 1; r < bdd.length; r++) {
    var f = bdd[r];
    var sku = normSku(f[cSku]);
    if (!sku || !/^[A-Z0-9][A-Z0-9\-_.\/]{2,}$/.test(sku) || vistos[sku]) continue;
    vistos[sku] = 1;
    var fr = formulas[r] || [];
    filas.push({
      fila: r + 1, sku: sku, modelo: texto(f[cMod]).toUpperCase(), color: texto(f[cCol]).toUpperCase(), descripcion: texto(f[cCat]),
      costo: cCosto >= 0 && num(f[cCosto]) > 0 ? r2(num(f[cCosto])) : '',
      pvp: cPvp >= 0 && num(f[cPvp]) > 0 ? r2(num(f[cPvp])) : '',
      comision: cCom >= 0 && texto(f[cCom]) !== '' ? r2(num(f[cCom])) : '',
      activo: cDisp >= 0 && /DESCONTINUADO/i.test(texto(f[cDisp])) ? 'NO' : 'SI',
      imagen: cImg >= 0 ? (extraerUrlImagen(fr[cImg]) || extraerUrlImagen(f[cImg])) : '',
      real: cReal >= 0 && texto(f[cReal]) !== '' ? num(f[cReal]) : null
    });
  }
  return { encontrada: true, filas: filas, tieneInventarioReal: cReal >= 0, tieneImagenes: cImg >= 0 };
}

/**
 * Construye todos los registros a partir de los datos crudos de la hoja.
 * fuentes = { ventas: [[...]], bdd: [[...]], compras: [[...]], comentarios: {ref: [txt]} }
 * existentes = { vendedores: [...], productos: [...], lineas: [...] } (para no duplicar)
 * Función pura: se prueba sin Google.
 */
function construirMigracion(fuentes, existentes, hoy, opciones) {
  existentes = existentes || {};
  opciones = opciones || {};
  var rep = { avisos: [], errores: [], ventas: {}, pagos: {}, compras: {}, productos: {}, comprobacion: {} };
  var aviso = function (fila, msg) { if (rep.avisos.length < 400) rep.avisos.push((fila ? 'Fila ' + fila + ': ' : '') + msg); };
  var comentarios = fuentes.comentarios || {};
  var ahora = (hoy || '') + 'T00:00:00';

  // ---------- Catálogo (BDD) ----------
  var productos = {};
  (existentes.productos || []).forEach(function (p) { productos[normSku(p.sku)] = { existente: true, p: p }; });
  var nuevosProductos = [];
  var bddLeida = leerBDD(fuentes.bdd, fuentes.bddFormulas);
  if (bddLeida.encontrada) {
    bddLeida.filas.forEach(function (b) {
      if (productos[b.sku]) return;
      var np = {
        sku: b.sku, linea: '', modelo: b.modelo, color: b.color, descripcion: b.descripcion, costo: b.costo, pvp: b.pvp,
        comision: b.comision, activo: b.activo, imagen: b.imagen, actualizado_en: ahora
      };
      productos[b.sku] = { existente: false, p: np };
      nuevosProductos.push(np);
    });
  } else {
    aviso(null, 'No se encontró la pestaña BDD (catálogo) o su encabezado "ARTICULO". Los productos se crearán desde las ventas y compras.');
  }
  function asegurarProducto(sku, datos, fila) {
    if (productos[sku]) {
      var p = productos[sku].p;
      if (!productos[sku].existente) {
        if (!p.linea && datos.linea) p.linea = datos.linea;
        if (!p.modelo && datos.modelo) p.modelo = datos.modelo;
        if (!p.color && datos.color) p.color = datos.color;
      }
      return p;
    }
    var np = { sku: sku, linea: datos.linea || '', modelo: datos.modelo || '', color: datos.color || '', descripcion: datos.descripcion || '', costo: datos.costo || '', pvp: '', comision: '', activo: 'SI', imagen: '', actualizado_en: ahora };
    productos[sku] = { existente: false, p: np };
    nuevosProductos.push(np);
    rep.productos.creadosDesdeMovimientos = (rep.productos.creadosDesdeMovimientos || 0) + 1;
    return np;
  }

  // ---------- Vendedores ----------
  var vendedores = {};
  (existentes.vendedores || []).forEach(function (v) { vendedores[normNombre(v.nombre)] = v; });
  var nuevosVendedores = [];
  var seqVen = 0;
  function vendedor(nombre) {
    var k = normNombre(nombre) || 'SIN ASIGNAR';
    if (!vendedores[k]) {
      seqVen++;
      var v = { id: 'H-VEN-' + k.replace(/[^A-Z0-9]+/g, '-'), nombre: k, telefono: '', activo: 'SI', notas: 'Migrado de la hoja Cubitt', creado_en: ahora };
      vendedores[k] = v; nuevosVendedores.push(v);
    }
    return vendedores[k];
  }

  // ---------- Ventas ----------
  var vs = fuentes.ventas || [];
  if (!vs.length) throw new Error('La pestaña "Ventas" está vacía o no existe.');
  var iv = _indiceEncabezados(vs[0]);
  var C = {
    resp: _col(iv, ['RESPONSABLE', 'VENDEDOR']), cliente: _col(iv, ['CLIENTE']), producto: _col(iv, ['PRODUCTO']),
    codigo: _col(iv, ['CODIGO', 'CÓDIGO', 'SKU']), modelo: _col(iv, ['MODELO']), color: _col(iv, ['COLOR']), fecha: _col(iv, ['FECHA']),
    cant: _col(iv, ['CANTIDAD']), precio: _col(iv, ['PRECIO UNIDAD', 'PRECIO']), total: _col(iv, ['TOTAL']),
    pend: _col(iv, ['PENDIENTE']), com: _col(iv, ['COMISION', 'COMISIÓN']), tmania: _col(iv, ['TMANIA']), pagoTmania: _col(iv, ['PAGO A TMANIA'])
  };
  var colsPago = [];
  for (var k = 1; k <= 10; k++) { var cp = iv['PAGO ' + k]; if (cp !== undefined) colsPago.push(cp); }
  ['resp', 'cliente', 'codigo', 'fecha', 'total'].forEach(function (c) { if (C[c] < 0) throw new Error('No se encontró la columna ' + c.toUpperCase() + ' en la pestaña Ventas.'); });
  if (!colsPago.length) throw new Error('No se encontraron las columnas PAGO 1..PAGO 5 en la pestaña Ventas.');

  var ventas = [], items = [], pagos = [], movs = [];
  var ultimaFecha = '';
  var comisionesPorLinea = {};
  var finDatos = vs.length;
  var filaTotales = null;
  for (var rv = 1; rv < vs.length; rv++) {
    var fv = vs[rv];
    var vacia = !texto(fv[C.resp]) && !texto(fv[C.cliente]) && !texto(fv[C.producto]) && !texto(fv[C.codigo]);
    if (vacia) {
      finDatos = rv;
      // Fila de totales de la hoja (a veces corrida una columna: se toma el primer número grande desde PRECIO/TOTAL)
      var totHoja = num(fv[C.total]) || (C.precio >= 0 ? num(fv[C.precio]) : 0);
      if (totHoja > 0) filaTotales = { fila: rv + 1, total: r2(totHoja), pendiente: C.pend >= 0 && texto(fv[C.pend]) !== '' ? r2(num(fv[C.pend])) : null, cantidad: C.cant >= 0 ? num(fv[C.cant]) : null };
      break;
    }
  }

  for (var r2i = 1; r2i < finDatos; r2i++) {
    var fila = r2i + 1;
    var x = vs[r2i];
    var lineaNombre = normNombre(x[C.producto]);
    var sku = normSku(x[C.codigo]);
    if (!sku) {
      sku = 'SIN-CODIGO-' + (lineaNombre || 'PRODUCTO').replace(/[^A-Z0-9]+/g, '-');
      aviso(fila, 'Sin código de producto; se registró como ' + sku + ' (corrígelo en el catálogo).');
    }
    var fecha = isoFecha(x[C.fecha]);
    var fechaHeredada = false;
    if (!fecha) {
      // Sin fecha de venta: la venta ocurrió como muy tarde el día del primer pago con fecha en comentario.
      // Si ningún pago tiene fecha, se usa la de la fila anterior.
      var fechasPago = [];
      colsPago.forEach(function (cp) {
        if (!(num(x[cp]) > 0)) return;
        var cm = comentarios[_letraColumna(cp) + fila];
        var inf = cm ? interpretarComentarioPago(cm.join(' | '), ultimaFecha, hoy) : null;
        if (inf && inf.fecha) fechasPago.push(inf.fecha);
      });
      fechasPago.sort();
      if (fechasPago.length) {
        fecha = fechasPago[0];
        aviso(fila, 'Sin fecha de venta; se usó la del primer pago (' + fecha + ').');
      } else {
        fecha = ultimaFecha;
        aviso(fila, 'Sin fecha; se usó la de la fila anterior (' + (fecha || 'ninguna') + ').');
      }
      fechaHeredada = true;
    } else {
      ultimaFecha = fecha;
    }
    if (!fecha) { rep.errores.push('Fila ' + fila + ': sin fecha y sin fila anterior con fecha; se omitió.'); continue; }
    if (hoy && fecha > hoy) aviso(fila, 'Fecha futura (' + fecha + '). Revisa y corrige la fecha en la app.');

    var cant = C.cant >= 0 && num(x[C.cant]) > 0 ? num(x[C.cant]) : 1;
    var total = r2(num(x[C.total]));
    var precio = C.precio >= 0 && num(x[C.precio]) > 0 ? r2(num(x[C.precio])) : r2(total / cant);
    if (!(total > 0)) { total = r2(precio * cant); aviso(fila, 'TOTAL vacío; se calculó cantidad × precio = ' + total + '.'); }
    if (Math.abs(r2(precio * cant) - total) > 0.01) aviso(fila, 'TOTAL (' + total + ') ≠ cantidad × precio (' + r2(precio * cant) + '). Se respetó el TOTAL.');
    var comision = C.com >= 0 ? r2(num(x[C.com])) : 0;
    var vend = vendedor(x[C.resp]);
    var esTmania = C.tmania >= 0 && normNombre(x[C.tmania]) === 'SI';
    var ubic = esTmania ? UB_TMANIA : UB_PRINCIPAL;
    var prod = asegurarProducto(sku, { linea: lineaNombre, modelo: texto(x[C.modelo]).toUpperCase(), color: texto(x[C.color]).toUpperCase() }, fila);
    if (lineaNombre && comision > 0) (comisionesPorLinea[lineaNombre] = comisionesPorLinea[lineaNombre] || []).push(comision / cant);

    var id = 'H-V-' + ('00000' + fila).slice(-5);
    var pagosFila = [], pagado = 0, sinFecha = 0;
    colsPago.forEach(function (cp, j) {
      var monto = r2(num(x[cp]));
      if (monto === 0) return;
      var ref = _letraColumna(cp) + fila;
      var coms = comentarios[ref] || [];
      var info = interpretarComentarioPago(coms.join(' | '), fecha, hoy);
      if (monto < 0) { aviso(fila, 'PAGO ' + (j + 1) + ' negativo (' + monto + '); se omitió.'); return; }
      var fp = info.fecha;
      if (fp && hoy && fp > hoy) { aviso(fila, 'El comentario del PAGO ' + (j + 1) + ' ("' + coms.join(' | ') + '") da una fecha futura; se usó la fecha de la venta.'); fp = ''; }
      if (fp && fp < fecha) {
        if (diasEntre(fp, fecha) <= 3) fp = fecha; // abono el mismo día con fecha de venta corrida
        else { aviso(fila, 'El comentario del PAGO ' + (j + 1) + ' ("' + coms.join(' | ') + '") es anterior a la venta (' + fecha + '); se usó la fecha de la venta como estimada.'); fp = ''; }
      }
      if (info.fechas.length > 1) aviso(fila, 'El PAGO ' + (j + 1) + ' tiene varias fechas en el comentario ("' + coms.join(' | ') + '"); se usó ' + info.fecha + '.');
      if (!fp) sinFecha++;
      pagado += monto;
      pagosFila.push({
        id: id.replace('H-V-', 'H-P-') + '-' + (j + 1), venta_id: id, fecha: fp || fecha, monto: monto,
        metodo: 'NO REGISTRADO', nota: texto(coms.join(' | ')) || ('PAGO ' + (j + 1) + ' (hoja)'),
        fecha_estimada: fp ? 'NO' : 'SI', estado: ESTADO.ACTIVA, creado_por: 'migracion', creado_en: ahora
      });
    });
    pagado = r2(pagado);
    var saldo = r2(total - pagado);
    var pendHoja = C.pend >= 0 && texto(x[C.pend]) !== '' ? r2(num(x[C.pend])) : null;
    if (pendHoja !== null && Math.abs(pendHoja - saldo) > 0.01 && Math.abs(pendHoja - Math.max(0, saldo)) > 0.01) {
      aviso(fila, 'PENDIENTE en la hoja (' + r2(num(x[C.pend])) + ') no cuadra con TOTAL − PAGOS (' + saldo + '). El sistema usa ' + saldo + '.');
    }
    if (saldo < -0.005) aviso(fila, 'Pagaron $' + (-saldo) + ' de más (pagos ' + pagado + ' > total ' + total + ').');
    var unPagoCompleto = pagosFila.length === 1 && Math.abs(pagosFila[0].monto - total) < 0.01 && (pagosFila[0].fecha === fecha || pagosFila[0].fecha_estimada === 'SI');
    var notas = [];
    if (esTmania) notas.push('Venta T-Mania' + (C.pagoTmania >= 0 && texto(x[C.pagoTmania]) ? ' · Pago a T-Mania: ' + texto(x[C.pagoTmania]).toUpperCase() : ''));
    if (fechaHeredada) notas.push('La hoja no tenía fecha de venta: se dedujo (revisar)');
    var comCliente = comentarios[_letraColumna(C.cliente) + fila];
    if (comCliente) notas.push('Comentario: ' + comCliente.join(' | '));

    ventas.push({
      id: id, fecha: fecha, cliente: normNombre(x[C.cliente]) || 'SIN NOMBRE', telefono: '', vendedor_id: vend.id, vendedor: vend.nombre,
      ubicacion_id: ubic, tipo: unPagoCompleto ? TIPO_VENTA.CONTADO : TIPO_VENTA.CREDITO, total: total, comision: comision,
      costo: num(prod.costo) ? r2(num(prod.costo) * cant) : '', fiscal: 'NO', factura_fiscal: '', estado: ESTADO.ACTIVA,
      notas: notas.join(' · '), origen: 'MIGRACION', fila_origen: fila, creado_por: 'migracion', creado_en: ahora
    });
    items.push({
      id: id.replace('H-V-', 'H-VI-'), venta_id: id, sku: sku,
      descripcion: [lineaNombre, texto(x[C.modelo]).toUpperCase()].filter(String).join(' ') || sku,
      cantidad: cant, precio_unit: precio, subtotal: total, costo_unit: num(prod.costo) || '', comision: comision
    });
    if (esTmania) {
      // La mercancía vendida en T-Mania salió de la sede principal: traslado inferido para cuadrar el stock por ubicación
      movs.push({ id: id.replace('H-V-', 'H-M-TS'), fecha: fecha, sku: sku, ubicacion_id: UB_PRINCIPAL, cantidad: -cant, tipo: MOV.TRASLADO_SALIDA, ref_id: id, nota: 'Traslado inferido a T-Mania (migración)', creado_por: 'migracion', creado_en: ahora });
      movs.push({ id: id.replace('H-V-', 'H-M-TE'), fecha: fecha, sku: sku, ubicacion_id: UB_TMANIA, cantidad: cant, tipo: MOV.TRASLADO_ENTRADA, ref_id: id, nota: 'Traslado inferido a T-Mania (migración)', creado_por: 'migracion', creado_en: ahora });
    }
    movs.push({ id: id.replace('H-V-', 'H-M-V'), fecha: fecha, sku: sku, ubicacion_id: ubic, cantidad: -cant, tipo: MOV.VENTA, ref_id: id, nota: normNombre(x[C.cliente]), creado_por: 'migracion', creado_en: ahora });
    pagos = pagos.concat(pagosFila);
    rep.pagos.sinFecha = (rep.pagos.sinFecha || 0) + sinFecha;
  }

  // ---------- Compras (Compras_Nueva) ----------
  var compras = [], compraItems = [];
  var cs = fuentes.compras || [];
  // Proveedor, RIF y N° de control de las facturas que estén en "Registro_Facturas"
  var facturasConocidas = {};
  var rf = fuentes.registroFacturas || [];
  if (rf.length > 1) {
    var irf = _indiceEncabezados(rf[0]);
    var cProv = _col(irf, ['PROVEEDOR']), cRif = _col(irf, ['RIF PROVEEDOR']), cNro = _col(irf, ['N° FACTURA', 'Nº FACTURA']), cCtrl = _col(irf, ['N° CONTROL / DOC', 'N° CONTROL']);
    if (cProv >= 0 && cNro >= 0) rf.slice(1).forEach(function (z) {
      var n = texto(z[cNro]).toUpperCase();
      if (n && !facturasConocidas[n]) facturasConocidas[n] = { proveedor: texto(z[cProv]), rif: cRif >= 0 ? texto(z[cRif]).toUpperCase() : '', nro_control: cCtrl >= 0 ? texto(z[cCtrl]) : '' };
    });
  }
  if (cs.length > 1) {
    var ic = _indiceEncabezados(cs[0]);
    var K = {
      ciudad: _col(ic, ['CIUDAD']), fecha: _col(ic, ['FECHA']), factura: _col(ic, ['N° FACTURA', 'Nº FACTURA', 'NRO FACTURA', 'FACTURA']),
      sku: _col(ic, ['CODIGO / SKU', 'CODIGO', 'SKU']), modelo: _col(ic, ['MODELO']), color: _col(ic, ['COLOR']), cant: _col(ic, ['CANTIDAD']),
      costo: _col(ic, ['COSTO NETO UNIT.', 'COSTO NETO UNIT', 'COSTO UNITARIO']), sub: _col(ic, ['SUBTOTAL ($)', 'SUBTOTAL']),
      iva: _col(ic, ['IVA (16%) ($)', 'IVA']), total: _col(ic, ['TOTAL COMPRA ($)', 'TOTAL COMPRA', 'TOTAL']), metodo: _col(ic, ['MÉTODO DE PAGO', 'METODO DE PAGO'])
    };
    if (K.sku < 0 || K.cant < 0 || K.fecha < 0) {
      aviso(null, 'La pestaña Compras_Nueva no tiene las columnas esperadas (FECHA, CODIGO / SKU, CANTIDAD); no se migraron compras.');
    } else {
      var grupos = {}, orden = [];
      for (var rc = 1; rc < cs.length; rc++) {
        var y = cs[rc];
        var s2 = normSku(y[K.sku]);
        if (!s2 || !/[A-Z]/.test(s2)) continue; // filas de subtotales o separadores
        var filaC = rc + 1;
        var fc = isoFecha(y[K.fecha]);
        if (!fc) { aviso('Compras ' + filaC, 'Sin fecha; se omitió la línea ' + s2 + '.'); continue; }
        var nro = texto(y[K.factura]).toUpperCase() || 'S/N';
        var ciudad = normNombre(y[K.ciudad]);
        var gk = nro + '|' + fc + '|' + ciudad;
        if (!grupos[gk]) {
          grupos[gk] = {
            id: 'H-C-' + (nro.replace(/[^A-Z0-9]+/g, '') || 'SN') + '-' + fc.replace(/-/g, '') + (ciudad === 'MARACAY' ? '-MCY' : ''),
            fecha: fc, proveedor: (facturasConocidas[nro] || {}).proveedor || 'POR DEFINIR', rif: (facturasConocidas[nro] || {}).rif || '',
            nro_factura: nro, nro_control: (facturasConocidas[nro] || {}).nro_control || '',
            ubicacion_id: ciudad === 'MARACAY' ? UB_MARACAY : UB_PRINCIPAL, moneda: 'USD', tasa: '',
            subtotal: 0, iva: 0, total: 0, metodo_pago: K.metodo >= 0 ? texto(y[K.metodo]) : '', archivo_url: '', archivo_id: '',
            estado: ESTADO.ACTIVA, notas: 'Migrado de Compras_Nueva', origen: 'MIGRACION', creado_por: 'migracion', creado_en: ahora
          };
          orden.push(gk);
        }
        var g = grupos[gk];
        var q = num(y[K.cant]);
        if (!(q > 0)) { aviso('Compras ' + filaC, 'Cantidad inválida para ' + s2 + '; se omitió.'); continue; }
        var cu = K.costo >= 0 ? r2(num(y[K.costo])) : 0;
        var sub = K.sub >= 0 && texto(y[K.sub]) !== '' ? r2(num(y[K.sub])) : r2(cu * q);
        var iva = K.iva >= 0 ? r2(num(y[K.iva])) : 0;
        var tot = K.total >= 0 && texto(y[K.total]) !== '' ? r2(num(y[K.total])) : r2(sub + iva);
        g.subtotal = r2(g.subtotal + sub); g.iva = r2(g.iva + iva); g.total = r2(g.total + tot);
        asegurarProducto(s2, { modelo: texto(y[K.modelo]).toUpperCase(), color: texto(y[K.color]).toUpperCase(), costo: cu }, filaC);
        var ciId = 'H-CI-' + ('00000' + filaC).slice(-5);
        compraItems.push({ id: ciId, compra_id: g.id, sku: s2, descripcion: [texto(y[K.modelo]), texto(y[K.color])].filter(String).join(' ').toUpperCase(), cantidad: q, costo_unit: cu, subtotal: sub });
        movs.push({ id: 'H-M-C' + ('00000' + filaC).slice(-5), fecha: fc, sku: s2, ubicacion_id: g.ubicacion_id, cantidad: q, tipo: MOV.COMPRA, ref_id: g.id, nota: 'Factura ' + nro + ' (migración)', creado_por: 'migracion', creado_en: ahora });
      }
      orden.forEach(function (gk2) { compras.push(grupos[gk2]); });
    }
  } else {
    aviso(null, 'No se encontró la pestaña Compras_Nueva; no se migraron compras.');
  }

  // ---------- Línea de productos no vendidos: se deduce por el prefijo del código ----------
  // (ej. CTHB2400M-33 se vendió como HYDRO => CTHB2400M-55 también es HYDRO)
  var prefijo = function (s) { var i = s.lastIndexOf('-'); return i > 2 ? s.slice(0, i) : s; };
  var lineaPorPrefijo = {};
  Object.keys(productos).forEach(function (s) { var p = productos[s].p; if (p.linea) lineaPorPrefijo[prefijo(s)] = p.linea; });
  var inferidas = 0;
  nuevosProductos.forEach(function (p) {
    if (!p.linea && lineaPorPrefijo[prefijo(p.sku)]) { p.linea = lineaPorPrefijo[prefijo(p.sku)]; inferidas++; }
  });
  rep.productos.lineaDeducida = inferidas;

  // ---------- Líneas con su comisión típica ----------
  var lineasExist = {};
  (existentes.lineas || []).forEach(function (l) { lineasExist[normNombre(l.nombre)] = 1; });
  var nuevasLineas = [];
  Object.keys(productos).forEach(function (s) {
    var l = normNombre(productos[s].p.linea);
    if (l && !lineasExist[l]) {
      lineasExist[l] = 1;
      var lista = (comisionesPorLinea[l] || []).map(function (c) { return r2(c); });
      nuevasLineas.push({ nombre: l, comision: lista.length ? _moda(lista) : '', notas: lista.length ? 'Comisión más frecuente en la hoja' : '' });
    }
  });

  // ---------- Reporte ----------
  var totVentas = r2(ventas.reduce(function (a, v) { return a + v.total; }, 0));
  var totPagos = r2(pagos.reduce(function (a, p) { return a + p.monto; }, 0));
  var saldoTotal = 0;
  var pagosPorVenta = {};
  pagos.forEach(function (p) { pagosPorVenta[p.venta_id] = r2((pagosPorVenta[p.venta_id] || 0) + p.monto); });
  ventas.forEach(function (v) { saldoTotal += Math.max(0, r2(v.total - (pagosPorVenta[v.id] || 0))); });
  rep.ventas = {
    filas: ventas.length, total: totVentas, cobrado: totPagos, pendiente: r2(saldoTotal),
    unidades: items.reduce(function (a, it) { return a + it.cantidad; }, 0),
    contado: ventas.filter(function (v) { return v.tipo === TIPO_VENTA.CONTADO; }).length,
    credito: ventas.filter(function (v) { return v.tipo === TIPO_VENTA.CREDITO; }).length,
    comision: r2(ventas.reduce(function (a, v) { return a + v.comision; }, 0)),
    vendedores: Object.keys(vendedores).length
  };
  rep.pagos.total = pagos.length;
  rep.pagos.conFechaDeComentario = pagos.filter(function (p) { return p.fecha_estimada === 'NO'; }).length;
  rep.pagos.sinFecha = pagos.length - rep.pagos.conFechaDeComentario;
  rep.compras = {
    facturas: compras.length, sinProveedor: compras.filter(function (c) { return c.proveedor === 'POR DEFINIR'; }).length, lineas: compraItems.length,
    unidades: compraItems.reduce(function (a, it) { return a + it.cantidad; }, 0),
    total: r2(compras.reduce(function (a, c) { return a + c.total; }, 0)),
    unidadesMaracay: compraItems.filter(function (it) { return /-MCY$/.test(it.compra_id); }).reduce(function (a, it) { return a + it.cantidad; }, 0)
  };
  rep.productos.nuevos = nuevosProductos.length;
  rep.productos.sinLinea = nuevosProductos.filter(function (p) { return !p.linea; }).length;
  rep.lineas = nuevasLineas.length;
  if (filaTotales) {
    rep.comprobacion = {
      filaTotales: filaTotales.fila,
      totalHoja: filaTotales.total, totalMigrado: totVentas, diferenciaTotal: r2(totVentas - filaTotales.total),
      pendienteHoja: filaTotales.pendiente, pendienteMigrado: r2(saldoTotal),
      diferenciaPendiente: filaTotales.pendiente === null ? null : r2(saldoTotal - filaTotales.pendiente)
    };
    if (Math.abs(rep.comprobacion.diferenciaTotal) > 0.01) aviso(null, 'El total migrado ($' + totVentas + ') difiere de la fila de totales de la hoja ($' + filaTotales.total + ') por $' + rep.comprobacion.diferenciaTotal + '. Revisa la fórmula de totales de la hoja.');
  }
  // ---------- Inventario real (BDD, columna "INVENTARIO REAL") ----------
  if (opciones.inventarioReal && bddLeida.encontrada) {
    if (!bddLeida.tieneInventarioReal) {
      aviso(null, 'BDD no tiene la columna "INVENTARIO REAL"; el stock queda como compras − ventas.');
    } else {
      var reales = {};
      bddLeida.filas.forEach(function (b) { if (b.real !== null) reales[b.sku] = b.real; });
      var stockAntes = calcularStock((existentes.movimientos || []).concat(movs));
      var ajustes = ajustesInventarioReal(stockAntes, reales, opciones.ubicacionInventario || UB_PRINCIPAL, opciones.ubicaciones || [UB_PRINCIPAL, UB_TMANIA, UB_MARACAY]);
      ajustes.forEach(function (a) {
        movs.push({ id: 'H-M-AJ-' + a.sku + '-' + a.ubicacion_id, fecha: hoy, sku: a.sku, ubicacion_id: a.ubicacion_id, cantidad: a.diferencia, tipo: MOV.AJUSTE, ref_id: 'H-AJ-BDD',
          nota: 'Inventario real de BDD (sistema ' + a.sistema + ', real ' + a.real + ')', creado_por: 'migracion', creado_en: ahora });
      });
      rep.inventarioReal = {
        productos: Object.keys(reales).length,
        unidades: r2(Object.keys(reales).reduce(function (acc, k) { return acc + reales[k]; }, 0)),
        ajustes: ajustes.length,
        ubicacion: opciones.ubicacionInventario || UB_PRINCIPAL
      };
    }
  }
  rep.productos.conImagen = nuevosProductos.filter(function (p) { return p.imagen; }).length;

  var conc = conciliar(nuevosProductos.concat((existentes.productos || [])), (existentes.movimientos || []).concat(movs));
  rep.conciliacion = conc.resumen;
  if (rep.compras.unidadesMaracay) aviso(null, rep.compras.unidadesMaracay + ' unidades se compraron en Maracay, pero la hoja de ventas no dice desde qué ubicación se vendió; todas las ventas se asignaron a Trinitarias (o T-Mania). Haz un conteo físico por ubicación después de migrar.');

  return {
    reporte: rep,
    registros: {
      Productos: nuevosProductos, Lineas: nuevasLineas, Vendedores: nuevosVendedores,
      Ventas: ventas, VentaItems: items, Pagos: pagos, Compras: compras, CompraItems: compraItems, Movimientos: movs
    }
  };
}

/** Descarga la hoja como .xlsx y devuelve sus archivos XML. */
function _xmlDeLaHojaExportada(hojaId) {
  var resp = UrlFetchApp.fetch('https://docs.google.com/spreadsheets/d/' + hojaId + '/export?format=xlsx', {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) throw new Error('No se pudo exportar la hoja para leer los comentarios (código ' + resp.getResponseCode() + ').');
  var archivos = {};
  Utilities.unzip(resp.getBlob().setContentType('application/zip')).forEach(function (b) {
    var n = b.getName();
    if (/\.(xml|rels)$/i.test(n) && (/^xl\/(workbook\.xml|_rels\/|worksheets\/_rels\/|threadedComments\/|comments)/.test(n))) archivos[n] = b.getDataAsString('UTF-8');
  });
  return archivos;
}

function _formulas(ss, nombre) {
  var sh = ss.getSheetByName(nombre);
  if (!sh) return [];
  var lr = sh.getLastRow(), lc = sh.getLastColumn();
  return lr && lc ? sh.getRange(1, 1, lr, lc).getFormulas() : [];
}

function _valores(ss, nombre) {
  var sh = ss.getSheetByName(nombre);
  if (!sh) return [];
  var lr = sh.getLastRow(), lc = sh.getLastColumn();
  return lr && lc ? sh.getRange(1, 1, lr, lc).getValues() : [];
}

var TABLAS_MIGRADAS = ['Ventas', 'VentaItems', 'Pagos', 'Compras', 'CompraItems', 'Movimientos'];

var Migracion = {
  /**
   * Actualiza desde BDD sin re-migrar: imágenes (y PVP/costo vacíos) de los productos, productos nuevos
   * de BDD, y opcionalmente ajusta el stock al INVENTARIO REAL. Se puede repetir cuando quieras.
   */
  sincronizarBDD: function (u, d) {
    exigirAdmin(u);
    d = d || {};
    var hojaId = texto(d.hoja_id) || Db.config().HOJA_ORIGEN_ID;
    var m = hojaId.match(/\/d\/([A-Za-z0-9_-]+)/);
    if (m) hojaId = m[1];
    if (!hojaId) throw new Error('Indica el enlace o el ID de la hoja "Cubitt".');
    var origen = SpreadsheetApp.openById(hojaId);
    var bdd = leerBDD(_valores(origen, 'BDD'), _formulas(origen, 'BDD'));
    if (!bdd.encontrada) throw new Error('No se encontró la pestaña BDD con el encabezado "ARTICULO".');
    return conBloqueo(function () {
      var ahora = ahoraIso();
      var res = { imagenes: 0, precios: 0, productosNuevos: 0, ajustes: [], inventarioReal: null };
      var porSku = _productosPorSku();
      var nuevos = [];
      bdd.filas.forEach(function (b) {
        var p = porSku[b.sku];
        if (!p) {
          nuevos.push({ sku: b.sku, linea: '', modelo: b.modelo, color: b.color, descripcion: b.descripcion, costo: b.costo, pvp: b.pvp, comision: b.comision, activo: b.activo, imagen: b.imagen, actualizado_en: ahora });
          return;
        }
        var cambios = {};
        if (d.imagenes !== false && b.imagen && (d.reemplazar_imagenes || !texto(p.imagen)) && b.imagen !== p.imagen) { cambios.imagen = b.imagen; res.imagenes++; }
        if (d.precios !== false) {
          if (b.pvp !== '' && texto(p.pvp) === '') { cambios.pvp = b.pvp; res.precios++; }
          if (b.costo !== '' && texto(p.costo) === '') cambios.costo = b.costo;
        }
        if (Object.keys(cambios).length) { cambios.actualizado_en = ahora; Db.actualizar('Productos', p.sku, cambios, 'sku'); }
      });
      if (nuevos.length) { Db.insertar('Productos', nuevos); res.productosNuevos = nuevos.length; }
      if (d.inventario_real) {
        if (!bdd.tieneInventarioReal) throw new Error('BDD no tiene la columna "INVENTARIO REAL".');
        var ubicInv = texto(d.ubicacion_inventario) || UB_PRINCIPAL;
        var ubics = Db.leer('Ubicaciones').filter(function (x) { return x.activo !== 'NO'; }).map(function (x) { return x.id; });
        if (ubics.indexOf(ubicInv) === -1) throw new Error('La ubicación elegida no existe.');
        var reales = {};
        bdd.filas.forEach(function (b) { if (b.real !== null) reales[b.sku] = b.real; });
        var ajustes = ajustesInventarioReal(_stockActual(), reales, ubicInv, ubics);
        if (ajustes.length) {
          var ref = Db.siguienteId('AJ');
          var ids = Db.siguienteId('M', ajustes.length);
          var fecha = hoyIso();
          Db.insertar('Movimientos', ajustes.map(function (a, i) {
            return { id: ids[i], fecha: fecha, sku: a.sku, ubicacion_id: a.ubicacion_id, cantidad: a.diferencia, tipo: MOV.AJUSTE, ref_id: ref,
              nota: 'Inventario real de BDD (sistema ' + a.sistema + ', real ' + a.real + ')', creado_por: u.usuario, creado_en: ahora };
          }));
        }
        res.ajustes = ajustes;
        res.inventarioReal = { productos: Object.keys(reales).length, unidades: r2(Object.keys(reales).reduce(function (a, k) { return a + reales[k]; }, 0)), ubicacion: ubicInv };
      }
      auditar(u, 'SINCRONIZAR_BDD', JSON.stringify({ imagenes: res.imagenes, precios: res.precios, nuevos: res.productosNuevos, ajustes: res.ajustes.length }));
      return res;
    });
  },

  ejecutar: function (u, d) {
    d = d || {};
    var hojaId = texto(d.hoja_id) || Db.config().HOJA_ORIGEN_ID;
    var m = hojaId.match(/\/d\/([A-Za-z0-9_-]+)/);
    if (m) hojaId = m[1];
    if (!hojaId) throw new Error('Indica el enlace o el ID de la hoja "Cubitt".');
    var origen = SpreadsheetApp.openById(hojaId);
    var inventarioReal = d.inventario_real !== false && d.inventario_real !== 'false';
    var ubicInv = texto(d.ubicacion_inventario) || UB_PRINCIPAL;
    var comentarios = {};
    var avisoComentarios = '';
    try {
      comentarios = extraerComentariosXlsx(_xmlDeLaHojaExportada(hojaId), 'Ventas');
    } catch (e) {
      avisoComentarios = 'No se pudieron leer los comentarios con fechas de pago: ' + e.message + '. Los pagos quedarán con fecha estimada.';
    }
    var fuentes = {
      ventas: _valores(origen, 'Ventas'), bdd: _valores(origen, 'BDD'), bddFormulas: _formulas(origen, 'BDD'), compras: _valores(origen, 'Compras_Nueva'),
      registroFacturas: _valores(origen, 'Registro_Facturas'), comentarios: comentarios
    };

    return conBloqueo(function () {
      // Si ya hay pagos/liquidaciones hechos en la app sobre ventas migradas, no se puede re-migrar sin perderlos
      var yaMigradas = Db.leer('Ventas').some(function (v) { return v.origen === 'MIGRACION'; });
      if (yaMigradas) {
        var pagosApp = Db.leer('Pagos').filter(function (p) { return p.origen !== 'MIGRACION' && /^H-V-/.test(p.venta_id) && p.creado_por !== 'migracion'; });
        var liquidadas = Db.leer('Ventas').filter(function (v) { return v.origen === 'MIGRACION' && texto(v.liquidacion_id); });
        var editadas = Db.leer('Ventas').filter(function (v) { return v.origen === 'MIGRACION' && v.estado === ESTADO.ANULADA; });
        if (pagosApp.length || liquidadas.length || editadas.length) {
          throw new Error('Ya hay movimientos hechos en la app sobre el histórico migrado (' + pagosApp.length + ' pagos, ' + liquidadas.length + ' comisiones liquidadas, ' + editadas.length + ' anulaciones). Repetir la migración los borraría, por eso está bloqueada.');
        }
      }
      var existentes = {
        productos: Db.leer('Productos'), vendedores: Db.leer('Vendedores'), lineas: Db.leer('Lineas'),
        // movimientos hechos en la app (no migrados): cuentan para calcular el ajuste al inventario real
        movimientos: Db.leer('Movimientos').filter(function (m) { return !/^H-/.test(String(m.id)); })
      };
      var ubics = Db.leer('Ubicaciones').filter(function (x) { return x.activo !== 'NO'; }).map(function (x) { return x.id; });
      if (inventarioReal && ubics.indexOf(ubicInv) === -1) throw new Error('La ubicación elegida para el inventario real no existe.');
      var res = construirMigracion(fuentes, existentes, hoyIso(), { inventarioReal: inventarioReal, ubicacionInventario: ubicInv, ubicaciones: ubics });
      res.reporte.hoja = origen.getName();
      res.reporte.comentariosLeidos = Object.keys(comentarios).length;
      if (avisoComentarios) res.reporte.avisos.unshift(avisoComentarios);
      res.reporte.yaHabiaMigracion = yaMigradas;
      if (d.simular) { res.reporte.simulacion = true; return res.reporte; }

      // Reemplazar solo lo migrado anteriormente
      TABLAS_MIGRADAS.forEach(function (t) { Db.borrarDonde(t, function (o) { return /^H-/.test(String(o.id)); }); });
      Db.insertar('Vendedores', res.registros.Vendedores);
      Db.insertar('Productos', res.registros.Productos);
      Db.insertar('Lineas', res.registros.Lineas);
      TABLAS_MIGRADAS.forEach(function (t) { Db.insertar(t, res.registros[t]); });
      Db.guardarConfig('HOJA_ORIGEN_ID', hojaId);
      Db.guardarConfig('MIGRACION_FECHA', ahoraIso());
      auditar(u, 'MIGRACION', JSON.stringify({ ventas: res.reporte.ventas, pagos: res.reporte.pagos.total, compras: res.reporte.compras.facturas }));
      res.reporte.simulacion = false;
      return res.reporte;
    });
  }
};


// ==================== Codigo.gs ====================
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
