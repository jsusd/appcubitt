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
