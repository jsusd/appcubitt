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
    if (f.ajustes !== 0) alertas.push('Ajustes por conteo físico: ' + (f.ajustes > 0 ? '+' : '') + f.ajustes);
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

/** Valida y normaliza los datos de una venta nueva. Lanza Error con mensaje claro. */
function validarVentaNueva(v) {
  var errores = [];
  if (!isoFecha(v.fecha)) errores.push('La fecha es obligatoria.');
  if (!texto(v.cliente)) errores.push('El cliente es obligatorio.');
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
    validarVentaNueva: validarVentaNueva, resumirComisiones: resumirComisiones, MOV: MOV
  };
}
