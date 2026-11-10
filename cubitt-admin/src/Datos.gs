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
