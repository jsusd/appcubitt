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
        id: ventaId, fecha: v.fecha, cliente: normNombre(v.cliente), telefono: texto(v.telefono),
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
    exigirAdmin(u);
    return conBloqueo(function () {
      var v = Db.porId('Ventas', d.id);
      if (!v) throw new Error('Venta no encontrada.');
      if (v.estado === ESTADO.ANULADA) throw new Error('No se puede editar una venta anulada.');
      var cambios = {};
      if (d.cliente !== undefined) { if (!texto(d.cliente)) throw new Error('El cliente es obligatorio.'); cambios.cliente = normNombre(d.cliente); }
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
      var k = v.cliente;
      if (!k) return;
      if (!vistos[k]) vistos[k] = { cliente: k, telefono: '', ultima: '' };
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
      var c = porCliente[v.cliente] = porCliente[v.cliente] || { cliente: v.cliente, telefono: '', saldo: 0, ventas: [], masAntigua: v.fecha, vendedores: {} };
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
