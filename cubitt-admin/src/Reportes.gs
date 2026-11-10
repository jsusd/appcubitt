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
