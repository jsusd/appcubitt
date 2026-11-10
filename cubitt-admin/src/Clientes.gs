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
