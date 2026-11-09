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
