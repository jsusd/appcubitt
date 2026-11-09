// Pruebas de punta a punta del backend (Apps Script simulado). Ejecutar: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearEntorno } = require('./mock-gas');
const { cargar } = require('./cargar');

function hoy() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas' }).format(new Date());
}
function haceDias(n) {
  const d = new Date(Date.now() - n * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas' }).format(d);
}

function montar() {
  const env = crearEntorno();
  const g = cargar(env.globales);
  const msg = g.instalar();
  const codigo = msg.match(/CÓDIGO DE INSTALACIÓN: (\d+)/)[1];
  const r = g.crearAdministradorInicial(codigo, { usuario: 'jesus', nombre: 'Admin Prueba', clave: 'clave-segura' });
  assert.ok(r.ok, r.error);
  const token = r.data.token;
  const api = (accion, datos, tk) => g.api(tk || token, accion, datos);
  // JSON ida y vuelta: igual que google.script.run (y evita arreglos de otro contexto de JS)
  const ok = (accion, datos, tk) => { const x = api(accion, datos, tk); assert.ok(x.ok, accion + ': ' + x.error); return JSON.parse(JSON.stringify(x.data)); };
  const falla = (accion, datos, patron, tk) => { const x = api(accion, datos, tk); assert.equal(x.ok, false, accion + ' debió fallar'); if (patron) assert.match(x.error, patron); return x.error; };
  return { env, g, token, api, ok, falla };
}

function catalogoBase(t) {
  t.ok('guardarLinea', { nombre: 'HYDRO', comision: 5 });
  t.ok('guardarProducto', { sku: 'CTHB24-7', linea: 'HYDRO', modelo: 'SNOW WHITE', color: 'BLANCO', costo: 14.63, pvp: 37 });
  t.ok('guardarProducto', { sku: 'CT-AURA2-1', linea: 'AURA 2', modelo: 'OBSIDIAN BLACK', costo: 71.5, pvp: 130, comision: 14 });
  const v1 = t.ok('guardarVendedor', { nombre: 'Vendedora A' });
  const v2 = t.ok('guardarVendedor', { nombre: 'Vendedora B' });
  t.ok('crearCompra', {
    fecha: haceDias(10), proveedor: 'Proveedor Ejemplo, C.A.', rif: 'j-12345678-9', nro_factura: '4268', ubicacion_id: 'UB-TRINITARIAS',
    iva: 2, items: [{ sku: 'CTHB24-7', cantidad: 5, costo_unit: 12.61 }, { sku: 'CT-AURA2-1', cantidad: 2, costo_unit: 61.64 }]
  });
  return { v1, v2 };
}

test('instalación: el código es de un solo uso y no hay acceso sin sesión', () => {
  const t = montar();
  const r = t.g.crearAdministradorInicial('000000', { usuario: 'otro', nombre: 'X', clave: '123456' });
  assert.equal(r.ok, false);
  assert.equal(t.g.api('token-falso', 'inicial', {}).error, 'SESION_VENCIDA');
  assert.equal(t.g.login('jesus', 'mala').ok, false);
  assert.ok(t.g.login('jesus', 'clave-segura').ok);
  // La contraseña no se guarda en texto plano
  const usuarios = t.env.SpreadsheetApp.openById(t.env.props.DB_ID).getSheetByName('Usuarios').datos;
  assert.ok(!JSON.stringify(usuarios).includes('clave-segura'));
});

test('compra suma stock por ubicación y detecta factura duplicada', () => {
  const t = montar();
  catalogoBase(t);
  const s = t.ok('stock', {});
  const hydro = s.filas.find(f => f.sku === 'CTHB24-7');
  assert.equal(hydro.porUbicacion['UB-TRINITARIAS'], 5);
  assert.equal(hydro.porUbicacion['UB-MARACAY'], 0);
  t.falla('crearCompra', { fecha: haceDias(9), proveedor: 'PROVEEDOR EJEMPLO, C.A.', nro_factura: '4268', ubicacion_id: 'UB-TRINITARIAS', items: [{ sku: 'CTHB24-7', cantidad: 1, costo_unit: 1 }] }, /DUPLICADO/);
  // Producto nuevo desde una factura queda creado en el catálogo
  t.ok('crearCompra', { fecha: haceDias(9), proveedor: 'Proveedor Dos', nro_factura: '4300', ubicacion_id: 'UB-MARACAY', items: [{ sku: 'ct-new-1', cantidad: 3, costo_unit: 10, descripcion: 'Nuevo' }] });
  const ini = t.ok('inicial');
  assert.ok(ini.productos.find(p => p.sku === 'CT-NEW-1'));
  assert.equal(ini.productos.find(p => p.sku === 'CTHB24-7').costo, 12.61); // último costo
});

test('venta a crédito con pago inicial, abonos, saldo y comisión sugerida', () => {
  const t = montar();
  const { v1 } = catalogoBase(t);
  const venta = t.ok('crearVenta', {
    fecha: haceDias(5), cliente: 'cliente uno', vendedor_id: v1.id, ubicacion_id: 'UB-TRINITARIAS', tipo: 'CREDITO',
    fiscal: true, factura_fiscal: '000123', pago_inicial: 15, metodo_pago: 'ZELLE',
    items: [{ sku: 'CTHB24-7', cantidad: 2, precio_unit: 37 }, { sku: 'CT-AURA2-1', cantidad: 1, precio_unit: 125 }]
  });
  assert.equal(venta.total, 199);
  assert.equal(venta.saldo, 184);
  assert.equal(venta.comision, 24); // 2×5 (línea HYDRO) + 14 (producto AURA)
  assert.equal(venta.fiscal, 'SI');
  assert.equal(venta.cliente, 'CLIENTE UNO');
  t.falla('crearPago', { venta_id: venta.id, fecha: hoy(), monto: 200 }, /mayor que el saldo/);
  t.falla('crearPago', { venta_id: venta.id, fecha: haceDias(6), monto: 10 }, /anterior a la venta/);
  t.falla('crearPago', { venta_id: venta.id, fecha: '2999-01-01', monto: 10 }, /futura/);
  let d = t.ok('crearPago', { venta_id: venta.id, fecha: haceDias(2), monto: 84, metodo: 'BINANCE' });
  assert.equal(d.saldo, 100);
  assert.equal(d.estadoPago, 'ABONADA');
  d = t.ok('crearPago', { venta_id: venta.id, fecha: hoy(), monto: 100 });
  assert.equal(d.estadoPago, 'PAGADA');
  const s = t.ok('stock', {});
  assert.equal(s.filas.find(f => f.sku === 'CTHB24-7').porUbicacion['UB-TRINITARIAS'], 3);
  const cob = t.ok('cobranza', {});
  assert.equal(cob.total, 0);
  const pagosHoy = t.ok('listarPagos', { desde: hoy(), hasta: hoy() });
  assert.equal(pagosHoy.total, 100);
});

test('validaciones de venta: contado completo, fiscal con número, stock suficiente', () => {
  const t = montar();
  const { v1 } = catalogoBase(t);
  const base = { fecha: hoy(), cliente: 'Ana', vendedor_id: v1.id, ubicacion_id: 'UB-TRINITARIAS', items: [{ sku: 'CTHB24-7', cantidad: 1, precio_unit: 37 }] };
  t.falla('crearVenta', Object.assign({}, base, { tipo: 'CONTADO', pago_inicial: 20 }), /contado debe pagarse completa/);
  t.falla('crearVenta', Object.assign({}, base, { tipo: 'CREDITO', fiscal: true }), /factura fiscal/);
  t.falla('crearVenta', Object.assign({}, base, { tipo: 'CREDITO', ubicacion_id: 'UB-MARACAY' }), /STOCK_INSUFICIENTE/);
  t.falla('crearVenta', Object.assign({}, base, { tipo: 'CREDITO', items: [{ sku: 'NO-EXISTE', cantidad: 1, precio_unit: 1 }] }), /no existe en el catálogo/);
  t.falla('crearVenta', Object.assign({}, base, { tipo: 'CREDITO', fecha: '2999-01-01' }), /futura/);
  const forz = t.ok('crearVenta', Object.assign({}, base, { tipo: 'CONTADO', pago_inicial: 37, ubicacion_id: 'UB-MARACAY', forzar_stock: true }));
  assert.equal(forz.estadoPago, 'PAGADA');
  const conc = t.ok('conciliacion', { solo: 'NEGATIVOS' });
  assert.equal(conc.resumen.skusNegativos, 0); // en total hay stock...
  assert.equal(conc.resumen.skusNegativosPorUbicacion, 1); // ...pero Maracay quedó en -1
  assert.match(conc.filas[0].alertas.join(' '), /Negativo en UB-MARACAY \(-1\)/);
});

test('vendedor solo ve y registra lo suyo; no accede a compras ni costos', () => {
  const t = montar();
  const { v1, v2 } = catalogoBase(t);
  t.ok('crearUsuario', { usuario: 'vendedora.a', nombre: 'Vendedora A', rol: 'VENDEDOR', vendedor_id: v1.id, clave: 'temporal1' });
  t.ok('crearVenta', { fecha: hoy(), cliente: 'Cliente de Vendedora B', vendedor_id: v2.id, ubicacion_id: 'UB-TRINITARIAS', tipo: 'CREDITO', items: [{ sku: 'CTHB24-7', cantidad: 1, precio_unit: 37 }] });
  const lg = t.g.login('vendedora.a', 'temporal1');
  assert.ok(lg.ok);
  const tk = lg.data.token;
  t.falla('inicial', {}, /DEBE_CAMBIAR_CLAVE/, tk);
  t.ok('cambiarClave', { actual: 'temporal1', nueva: 'nueva-clave' }, tk);
  const ini = t.ok('inicial', {}, tk);
  assert.equal(ini.productos[0].costo, undefined);
  // Intenta registrar a nombre de otra vendedora: se fuerza a su propio nombre
  const v = t.ok('crearVenta', { fecha: hoy(), cliente: 'Mi cliente', vendedor_id: v2.id, ubicacion_id: 'UB-TRINITARIAS', tipo: 'CREDITO', items: [{ sku: 'CTHB24-7', cantidad: 1, precio_unit: 37 }] }, tk);
  assert.equal(v.vendedor_id, v1.id);
  const lista = t.ok('listarVentas', {}, tk);
  assert.equal(lista.ventas.length, 1);
  assert.equal(lista.ventas[0].costo, undefined);
  t.falla('listarCompras', {}, /solo para administradores/, tk);
  t.falla('anularVenta', { id: v.id, motivo: 'x' }, /solo para administradores/, tk);
  t.falla('conciliacion', {}, /solo para administradores/, tk);
  const otra = t.ok('listarVentas', {}).ventas.find(x => x.cliente === 'CLIENTE DE VENDEDORA B');
  t.falla('detalleVenta', { id: otra.id }, /no encontrada/, tk);
  t.falla('crearPago', { venta_id: otra.id, fecha: hoy(), monto: 1 }, /no encontrada/, tk);
});

test('anular venta devuelve stock y anula pagos; no se borra nada', () => {
  const t = montar();
  const { v1 } = catalogoBase(t);
  const v = t.ok('crearVenta', { fecha: hoy(), cliente: 'Ana', vendedor_id: v1.id, ubicacion_id: 'UB-TRINITARIAS', tipo: 'CONTADO', pago_inicial: 74, items: [{ sku: 'CTHB24-7', cantidad: 2, precio_unit: 37 }] });
  t.falla('anularVenta', { id: v.id }, /motivo/);
  const a = t.ok('anularVenta', { id: v.id, motivo: 'Devolución' });
  assert.equal(a.estado, 'ANULADA');
  assert.ok(a.pagos.every(p => p.estado === 'ANULADA'));
  assert.equal(t.ok('stock', {}).filas.find(f => f.sku === 'CTHB24-7').porUbicacion['UB-TRINITARIAS'], 5);
  assert.equal(t.ok('listarVentas', {}).ventas.length, 0);
  assert.equal(t.ok('listarVentas', { incluirAnuladas: true }).ventas.length, 1);
  const k = t.ok('kardex', { sku: 'CTHB24-7' });
  assert.deepEqual(k.movimientos.map(m => m.tipo).sort(), ['ANULACION_VENTA', 'COMPRA', 'VENTA']);
});

test('traslados y conteo físico dejan el stock igual a la realidad', () => {
  const t = montar();
  catalogoBase(t);
  t.falla('traslado', { origen_id: 'UB-TRINITARIAS', destino_id: 'UB-TMANIA', items: [{ sku: 'CTHB24-7', cantidad: 9 }] }, /STOCK_INSUFICIENTE/);
  t.ok('traslado', { origen_id: 'UB-TRINITARIAS', destino_id: 'UB-TMANIA', items: [{ sku: 'CTHB24-7', cantidad: 2 }] });
  let s = t.ok('stock', {}).filas.find(f => f.sku === 'CTHB24-7');
  assert.equal(s.porUbicacion['UB-TRINITARIAS'], 3);
  assert.equal(s.porUbicacion['UB-TMANIA'], 2);
  assert.equal(s.total, 5);
  const c = t.ok('conteo', { ubicacion_id: 'UB-TRINITARIAS', conteos: [{ sku: 'CTHB24-7', fisico: 2 }, { sku: 'CT-AURA2-1', fisico: 2 }] });
  assert.equal(c.ajustes.length, 1);
  assert.equal(c.ajustes[0].diferencia, -1);
  s = t.ok('stock', {}).filas.find(f => f.sku === 'CTHB24-7');
  assert.equal(s.porUbicacion['UB-TRINITARIAS'], 2);
  const conc = t.ok('conciliacion', {});
  assert.equal(conc.filas.find(f => f.sku === 'CTHB24-7').ajustes, -1);
});

test('comisiones: solo se liquidan ventas cobradas y no se pagan dos veces', () => {
  const t = montar();
  const { v1 } = catalogoBase(t);
  const a = t.ok('crearVenta', { fecha: hoy(), cliente: 'A', vendedor_id: v1.id, ubicacion_id: 'UB-TRINITARIAS', tipo: 'CONTADO', pago_inicial: 37, items: [{ sku: 'CTHB24-7', cantidad: 1, precio_unit: 37 }] });
  const b = t.ok('crearVenta', { fecha: hoy(), cliente: 'B', vendedor_id: v1.id, ubicacion_id: 'UB-TRINITARIAS', tipo: 'CREDITO', items: [{ sku: 'CTHB24-7', cantidad: 1, precio_unit: 37, comision: 6 }] });
  let c = t.ok('comisiones', { vendedor_id: v1.id });
  assert.equal(c.resumen[0].generada, 11);
  assert.equal(c.resumen[0].cobrable, 5);
  assert.equal(c.resumen[0].porCobrar, 6);
  t.falla('liquidarComisiones', { vendedor_id: v1.id, venta_ids: [b.id] }, /saldo pendiente/);
  const l = t.ok('liquidarComisiones', { vendedor_id: v1.id, venta_ids: [a.id] });
  assert.equal(l.monto, 5);
  t.falla('liquidarComisiones', { vendedor_id: v1.id, venta_ids: [a.id] }, /ya fue liquidada/);
  t.falla('anularVenta', { id: a.id, motivo: 'x' }, /liquidada/);
  c = t.ok('comisiones', { vendedor_id: v1.id });
  assert.equal(c.resumen[0].pagada, 5);
  t.ok('revertirLiquidacion', { id: l.id });
  assert.equal(t.ok('comisiones', { vendedor_id: v1.id }).resumen[0].pagada, 0);
});

test('inicio resume hoy, período, por cobrar y alertas', () => {
  const t = montar();
  const { v1 } = catalogoBase(t);
  t.ok('crearVenta', { fecha: hoy(), cliente: 'A', vendedor_id: v1.id, ubicacion_id: 'UB-TRINITARIAS', tipo: 'CREDITO', pago_inicial: 10, items: [{ sku: 'CTHB24-7', cantidad: 1, precio_unit: 37 }] });
  const r = t.ok('inicio', {});
  assert.equal(r.hoy.total, 37);
  assert.equal(r.hoy.cobrado, 10);
  assert.equal(r.porCobrar.total, 27);
  assert.equal(r.periodo.credito, 37);
  assert.equal(r.alertas.skusNegativos, 0);
});

test('migración: comentarios de pago por celda, reporte y re-migración segura', () => {
  const xml = {
    'xl/workbook.xml': '<workbook><sheets><sheet name="Ventas" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/_rels/sheet1.xml.rels': '<Relationships><Relationship Id="rId9" Type="http://schemas.microsoft.com/office/2017/10/relationships/threadedComment" Target="../threadedComments/threadedComment1.xml"/></Relationships>',
    'xl/threadedComments/threadedComment1.xml': '<x18tc:ThreadedComments><x18tc:threadedComment ref="L2" id="a"><x18tc:text>PAGO 07/05</x18tc:text></x18tc:threadedComment>' +
      '<x18tc:threadedComment ref="M2" id="b"><x18tc:text>24/05</x18tc:text></x18tc:threadedComment>' +
      '<x18tc:threadedComment ref="M3" id="c"><x18tc:text>30/07 - 09/08 &amp; algo</x18tc:text></x18tc:threadedComment></x18tc:ThreadedComments>'
  };
  const env = crearEntorno({ fetch: () => ({ getResponseCode: () => 200, getBlob: () => ({ _archivos: Object.keys(xml).map(n => ({ nombre: n, contenido: xml[n] })), setContentType() { return this; } }) }) });
  const g = cargar(env.globales);
  const codigo = g.instalar().match(/CÓDIGO DE INSTALACIÓN: (\d+)/)[1];
  const tk = g.crearAdministradorInicial(codigo, { usuario: 'jesus', nombre: 'J', clave: 'clave-segura' }).data.token;
  const enc = ['RESPONSABLE', 'CLIENTE', 'PRODUCTO', 'CODIGO', 'MODELO', 'COLOR', 'FOTO', 'FECHA', 'CANTIDAD', 'PRECIO UNIDAD', 'TOTAL', 'PAGO 1', 'PAGO 2', 'PAGO 3', 'PAGO 4', 'PAGO 5', 'PENDIENTE', 'COMISION', 'COSTO', 'GANANCIA', 'GANANCIA BULL', 'TMANIA', 'PAGO A TMANIA'];
  env.SpreadsheetApp._registrar('origen', 'Cubitt', {
    Ventas: [
      enc,
      ['VENDEDOR C', 'CLIENTE UNO', 'HYDRO', 'CTHB2400M-33', 'GREEN', 'VERDE', '', new Date(2026, 3, 20), 1, 37, 37, 15, 22, '', '', '', 0, 5, '', '', '', 'NO', ''],
      ['VENDEDORA A', 'CLIENTE DOS', 'AURA 2', 'CT-AURA2-8', 'GRAY', 'GRIS', '', new Date(2026, 6, 27), 1, 125, 125, 24, 50, '', '', '', 51, 14, '', '', '', 'SI', 'PENDIENTE'],
      ['VENDEDORA B', 'CLIENTE TRES', 'HYDRO', '', '', '', '', '', 1, 37, 37, 37, '', '', '', '', 0, 5, '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', 3, 199, '<', 76, 72, 0, 0, 0, 51, '', '', '', '', '', '']
    ],
    BDD: [['x'], ['ARTICULO', 'IMAGEN', 'CATEGORIA', 'MODELO', 'COLOR', 'DISPONIBLE', 'MAYOR BS', 'MAYOR $', '', 'PVP TIENDA', 'PEDIDO', '', '', '', '', '', '', '', 'COMISION'],
      ['CTHB2400M-33', '', 'TERMO PARA AGUA', 'GREEN GRADIENT', 'VERDE', 'DISPONIBLE', '', 14.5, '', 37, '', '', '', '', '', '', '', '', ''],
      ['CTHB2400M-55', '', 'TERMO PARA AGUA', 'PINK', 'ROSA', 'DISPONIBLE', '', 14.5, '', 37, '', '', '', '', '', '', '', '', '']],
    Compras_Nueva: [['CIUDAD', 'FECHA', 'N° FACTURA', 'CODIGO / SKU', 'MODELO', 'COLOR', 'FOTO', 'CANTIDAD', 'PRECIO LISTA', '% DESCUENTO', 'COSTO NETO UNIT.', 'SUBTOTAL ($)', 'IVA (16%) ($)', 'TOTAL COMPRA ($)', 'Método de Pago'],
      ['BARQUISIMETO', new Date(2026, 3, 1), 3306, 'CTHB2400M-33', 'GREEN', 'VERDE', '', 2, 19, '', 14, 28, 4.48, 32.48, 'Divisas (Binance)'],
      ['', '', '', 0, '', '', '', '', '', '', '', '', '', '', '']],
    Registro_Facturas: [['Fecha', 'Hora', 'Proveedor', 'RIF Proveedor', 'N° Factura', 'N° Control / Doc'], ['', '', 'Proveedor Ejemplo, C.A.', 'J-12345678-9', '3306', 'FV/1']]
  });
  const ok = (a, d) => { const r = g.api(tk, a, d); assert.ok(r.ok, a + ': ' + r.error); return JSON.parse(JSON.stringify(r.data)); };
  const sim = ok('analizarMigracion', { hoja_id: 'origen' });
  assert.equal(sim.simulacion, true);
  assert.equal(sim.ventas.filas, 3);
  assert.equal(sim.ventas.total, 199);
  assert.equal(sim.ventas.pendiente, 51);
  assert.equal(sim.comprobacion.diferenciaTotal, 0);
  assert.equal(sim.comprobacion.diferenciaPendiente, 0);
  assert.equal(sim.pagos.total, 5);
  assert.equal(sim.pagos.conFechaDeComentario, 3);
  assert.equal(sim.compras.facturas, 1);
  assert.equal(sim.productos.lineaDeducida, 1); // CTHB2400M-55 deducido como HYDRO
  assert.equal(ok('listarVentas', {}).ventas.length, 0, 'la simulación no guarda nada');

  const rep = ok('ejecutarMigracion', { hoja_id: 'origen' });
  assert.equal(rep.simulacion, false);
  const ventas = ok('listarVentas', {}).ventas;
  assert.equal(ventas.length, 3);
  const v2 = ok('detalleVenta', { id: 'H-V-00002' });
  assert.deepEqual(v2.pagos.map(p => [p.fecha, p.monto, p.fecha_estimada]), [['2026-05-07', 15, 'NO'], ['2026-05-24', 22, 'NO']]);
  assert.equal(v2.tipo, 'CREDITO');
  const v3 = ok('detalleVenta', { id: 'H-V-00003' });
  assert.equal(v3.ubicacion_id, 'UB-TMANIA');
  assert.equal(v3.saldo, 51);
  assert.equal(v3.pagos[1].fecha, '2026-07-30');
  assert.match(v3.notas, /Pago a T-Mania: PENDIENTE/);
  const v4 = ok('detalleVenta', { id: 'H-V-00004' });
  assert.equal(v4.fecha, '2026-07-27'); // sin pagos con fecha: heredó la de la fila anterior
  assert.equal(v4.items[0].sku, 'SIN-CODIGO-HYDRO');
  assert.equal(v4.tipo, 'CONTADO');
  assert.equal(v4.pagos[0].fecha_estimada, 'SI');
  const compras = ok('listarCompras', {}).compras;
  assert.equal(compras[0].proveedor, 'Proveedor Ejemplo, C.A.');
  assert.equal(ok('inicial').lineas.find(l => l.nombre === 'HYDRO').comision, 5);
  // La venta T-Mania no deja stock negativo en T-Mania (traslado inferido)
  const st = ok('stock', {}).filas.find(f => f.sku === 'CT-AURA2-8');
  assert.equal(st.porUbicacion['UB-TMANIA'], 0);
  assert.equal(st.porUbicacion['UB-TRINITARIAS'], -1);

  // Re-migrar reemplaza (no duplica)
  ok('ejecutarMigracion', { hoja_id: 'origen' });
  assert.equal(ok('listarVentas', {}).ventas.length, 3);
  // Si ya se registró un abono en la app sobre el histórico, re-migrar queda bloqueado
  ok('crearPago', { venta_id: 'H-V-00003', fecha: hoy(), monto: 1 });
  const r = g.api(tk, 'ejecutarMigracion', { hoja_id: 'origen' });
  assert.equal(r.ok, false);
  assert.match(r.error, /bloqueada/);
});

test('BDD: imágenes de =IMAGE(), inventario real (col. M) y catálogo de disponibles en PDF', () => {
  const pdfPedidos = [];
  const env = crearEntorno({ fetch: (url) => { pdfPedidos.push(url); return { getResponseCode: () => 200, getBlob: () => ({ setName() { return this; } }) }; } });
  const g = cargar(env.globales);
  const codigo = g.instalar().match(/CÓDIGO DE INSTALACIÓN: (\d+)/)[1];
  const tk = g.crearAdministradorInicial(codigo, { usuario: 'admin1', nombre: 'A', clave: 'clave-segura' }).data.token;
  const ok = (a, d) => { const r = g.api(tk, a, d); assert.ok(r.ok, a + ': ' + r.error); return JSON.parse(JSON.stringify(r.data)); };
  const enc = ['ARTICULO', 'IMAGEN', 'CATEGORIA', 'MODELO', 'COLOR', 'DISPONIBLE', 'MAYOR BS', 'MAYOR $', '', 'PVP TIENDA', 'PEDIDO', '', 'INVENTARIO REAL', 'TRANSITO'];
  env.SpreadsheetApp._registrar('origen', 'Cubitt', {
    BDD: [['x'], enc,
      ['CT-AURA2-1', '', 'RELOJ', 'OBSIDIAN BLACK', 'NEGRO', 'DISPONIBLE', '', 71.5, '', 130, '', '', 2, 1],
      ['CTHB24-7', '', 'TERMO', 'SNOW WHITE', 'BLANCO', 'DISPONIBLE', '', 14.5, '', 37, '', '', 0, ''],
      ['CTBPK-1', '', 'BOLSO', 'BLACK', 'NEGRO', 'DISPONIBLE', '', 30, '', 69, '', '', '', '']]
  }, { BDD: [[], [], ['', '=image("https://cubitt.com.ve/cdn/shop/files/CT-AURA2-1-Black.webp?v=1&width=1000")'], ['', '=IMAGE("https://cubitt.com.ve/x/CTHB24-7.webp")']] });
  ok('guardarLinea', { nombre: 'AURA 2', comision: 14 });
  ok('guardarProducto', { sku: 'CTHB24-7', linea: 'HYDRO', pvp: '' });
  // Stock previo en el sistema: 3 en Trinitarias, 1 en Maracay
  ok('crearCompra', { fecha: g.hoyIso(), proveedor: 'P', nro_factura: '1', ubicacion_id: 'UB-TRINITARIAS', items: [{ sku: 'CTHB24-7', cantidad: 3, costo_unit: 10 }] });
  ok('crearCompra', { fecha: g.hoyIso(), proveedor: 'P', nro_factura: '2', ubicacion_id: 'UB-MARACAY', items: [{ sku: 'CTHB24-7', cantidad: 1, costo_unit: 10 }] });

  const r = ok('sincronizarBDD', { hoja_id: 'origen', inventario_real: true, ubicacion_inventario: 'UB-TRINITARIAS' });
  assert.equal(r.productosNuevos, 2);
  assert.equal(r.imagenes, 1); // CTHB24-7 ya existía sin imagen
  assert.equal(r.precios, 1);   // y sin PVP
  assert.equal(r.inventarioReal.unidades, 2);
  const st = ok('stock', {}).filas;
  const aura = st.find(f => f.sku === 'CT-AURA2-1'), hydro = st.find(f => f.sku === 'CTHB24-7'), bpk = st.find(f => f.sku === 'CTBPK-1');
  assert.equal(aura.porUbicacion['UB-TRINITARIAS'], 2);
  assert.equal(hydro.total, 0); // inventario real 0: se ajustan Trinitarias y Maracay
  assert.equal(bpk.total, 0);   // celda vacía en M: no se toca
  assert.match(aura.imagen, /CT-AURA2-1-Black\.webp/);
  // Repetirlo no duplica ajustes
  assert.equal(ok('sincronizarBDD', { hoja_id: 'origen', inventario_real: true }).ajustes.length, 0);
  const conc = ok('conciliacion', {});
  assert.match(conc.filas.find(f => f.sku === 'CT-AURA2-1').alertas.join(' '), /falta registrar facturas/);

  const disp = ok('disponible', {});
  assert.deepEqual(disp.items.map(i => [i.sku, i.stock, i.pvp]), [['CT-AURA2-1', 2, 130]]);
  assert.equal(ok('disponible', { incluirAgotados: true }).items.length, 3);
  const pdf = ok('generarCatalogoPdf', {});
  assert.equal(pdf.productos, 1);
  assert.match(pdfPedidos[0], /export\?format=pdf/);
  const hojaCat = env.SpreadsheetApp.openById(pdf.hoja_url.split('/').pop()).getSheets()[0];
  assert.ok(hojaCat.formulas.some(f => f && /^=IMAGE\("https:\/\/cubitt\.com\.ve/.test(f[0])));
  assert.ok(JSON.stringify(hojaCat.datos).includes('130'));
});
