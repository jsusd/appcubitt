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
 * Construye todos los registros a partir de los datos crudos de la hoja.
 * fuentes = { ventas: [[...]], bdd: [[...]], compras: [[...]], comentarios: {ref: [txt]} }
 * existentes = { vendedores: [...], productos: [...], lineas: [...] } (para no duplicar)
 * Función pura: se prueba sin Google.
 */
function construirMigracion(fuentes, existentes, hoy) {
  existentes = existentes || {};
  var rep = { avisos: [], errores: [], ventas: {}, pagos: {}, compras: {}, productos: {}, comprobacion: {} };
  var aviso = function (fila, msg) { if (rep.avisos.length < 400) rep.avisos.push((fila ? 'Fila ' + fila + ': ' : '') + msg); };
  var comentarios = fuentes.comentarios || {};
  var ahora = (hoy || '') + 'T00:00:00';

  // ---------- Catálogo (BDD) ----------
  var productos = {};
  (existentes.productos || []).forEach(function (p) { productos[normSku(p.sku)] = { existente: true, p: p }; });
  var nuevosProductos = [];
  var bdd = fuentes.bdd || [];
  var filaEnc = -1;
  for (var i = 0; i < Math.min(15, bdd.length); i++) if (_indiceEncabezados(bdd[i])['ARTICULO'] !== undefined) { filaEnc = i; break; }
  if (filaEnc >= 0) {
    var ib = _indiceEncabezados(bdd[filaEnc]);
    var cSku = ib['ARTICULO'], cCat = _col(ib, ['CATEGORIA']), cMod = _col(ib, ['MODELO']), cCol = _col(ib, ['COLOR']);
    var cCosto = _col(ib, ['MAYOR $', 'COSTO']), cPvp = _col(ib, ['PVP TIENDA', 'PVP']), cCom = _col(ib, ['COMISION']), cDisp = _col(ib, ['DISPONIBLE']);
    for (var r = filaEnc + 1; r < bdd.length; r++) {
      var f = bdd[r];
      var sku = normSku(f[cSku]);
      if (!sku || !/^[A-Z0-9][A-Z0-9\-_.\/]{2,}$/.test(sku) || productos[sku]) continue;
      var np = {
        sku: sku, linea: '', modelo: texto(f[cMod]).toUpperCase(), color: texto(f[cCol]).toUpperCase(),
        descripcion: texto(f[cCat]), costo: cCosto >= 0 && num(f[cCosto]) > 0 ? r2(num(f[cCosto])) : '',
        pvp: cPvp >= 0 && num(f[cPvp]) > 0 ? r2(num(f[cPvp])) : '', comision: cCom >= 0 && texto(f[cCom]) !== '' ? r2(num(f[cCom])) : '',
        activo: cDisp >= 0 && /DESCONTINUADO/i.test(texto(f[cDisp])) ? 'NO' : 'SI', imagen: '', actualizado_en: ahora
      };
      productos[sku] = { existente: false, p: np };
      nuevosProductos.push(np);
    }
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
  var conc = conciliar(nuevosProductos.concat((existentes.productos || [])), movs);
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

function _valores(ss, nombre) {
  var sh = ss.getSheetByName(nombre);
  if (!sh) return [];
  var lr = sh.getLastRow(), lc = sh.getLastColumn();
  return lr && lc ? sh.getRange(1, 1, lr, lc).getValues() : [];
}

var TABLAS_MIGRADAS = ['Ventas', 'VentaItems', 'Pagos', 'Compras', 'CompraItems', 'Movimientos'];

var Migracion = {
  ejecutar: function (u, d) {
    d = d || {};
    var hojaId = texto(d.hoja_id) || Db.config().HOJA_ORIGEN_ID;
    var m = hojaId.match(/\/d\/([A-Za-z0-9_-]+)/);
    if (m) hojaId = m[1];
    if (!hojaId) throw new Error('Indica el enlace o el ID de la hoja "Cubitt".');
    var origen = SpreadsheetApp.openById(hojaId);
    var comentarios = {};
    var avisoComentarios = '';
    try {
      comentarios = extraerComentariosXlsx(_xmlDeLaHojaExportada(hojaId), 'Ventas');
    } catch (e) {
      avisoComentarios = 'No se pudieron leer los comentarios con fechas de pago: ' + e.message + '. Los pagos quedarán con fecha estimada.';
    }
    var fuentes = {
      ventas: _valores(origen, 'Ventas'), bdd: _valores(origen, 'BDD'), compras: _valores(origen, 'Compras_Nueva'),
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
      var existentes = { productos: Db.leer('Productos'), vendedores: Db.leer('Vendedores'), lineas: Db.leer('Lineas') };
      var res = construirMigracion(fuentes, existentes, hoyIso());
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
