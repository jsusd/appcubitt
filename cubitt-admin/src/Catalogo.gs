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
