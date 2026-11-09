const test = require('node:test');
const assert = require('node:assert/strict');
const { cargar } = require('./cargar');
const g = cargar();

test('comentarios de pago reales de la hoja', () => {
  const f = (t, venta, hoy) => g.interpretarComentarioPago(t, venta, hoy || '2026-11-09').fecha;
  assert.equal(f('24/07', '2026-07-01'), '2026-07-24');
  assert.equal(f('PAGO 07/05', '2026-04-20'), '2026-05-07');
  assert.equal(f('propina 15/09', '2026-09-01'), '2026-09-15');
  assert.equal(f('VENTAS BULL 22/09', '2026-09-01'), '2026-09-22');
  assert.equal(f('30/07 - 09/08 | venta coffee mug 1$ 16/08', '2026-07-01'), '2026-07-30'); // no es el año 2009
  assert.equal(g.interpretarComentarioPago('30/07 09/08', '2026-07-01').fechas.length, 2);
  assert.equal(f('5.75$ 29/08', '2026-08-01'), '2026-08-29');
  assert.equal(f('24/07/26', '2026-07-01'), '2026-07-24');
  assert.equal(f('03/01/2027', '2026-12-20', '2027-02-01'), '2027-01-03');
  assert.equal(f('05/01', '2026-12-20', '2027-02-01'), '2027-01-05'); // venta de diciembre, pago de enero
  assert.equal(f('05/01', '2026-12-20', '2026-12-25'), '2026-01-05'); // nunca una fecha futura
  assert.equal(f('COMISION POR VENTAS', '2026-07-01'), '');
  assert.equal(f('31/02', '2026-01-01'), ''); // fecha imposible
});

test('saldo y estado de venta', () => {
  const e = (total, pagos, estado) => g.calcularEstadoVenta({ total, estado: estado || 'ACTIVA' }, pagos.map(m => ({ monto: m.monto || m, estado: m.estado || 'ACTIVA' })));
  assert.deepEqual(JSON.parse(JSON.stringify(e(100, []))), { total: 100, pagado: 0, saldo: 100, estadoPago: 'PENDIENTE' });
  assert.equal(e(100, [30]).estadoPago, 'ABONADA');
  assert.equal(e(100, [30, { monto: 70, estado: 'ANULADA' }]).saldo, 70);
  assert.equal(e(0.3, [0.1, 0.2]).estadoPago, 'PAGADA'); // sin errores de redondeo
  assert.equal(e(100, [115]).estadoPago, 'PAGO_DE_MAS');
  assert.equal(e(100, [], 'ANULADA').estadoPago, 'ANULADA');
});

test('números y fechas en formatos de la hoja', () => {
  assert.equal(g.num('$1,234.50'), 1234.5);
  assert.equal(g.num('Bs. 10.534,30'), 10534.3);
  assert.equal(g.num(''), 0);
  assert.equal(g.isoFecha(46132), '2026-04-20');
  assert.equal(g.isoFecha('06/08/26'), '2026-08-06');
  assert.equal(g.isoFecha('2026-10-15'), '2026-10-15');
  assert.equal(g.normSku(' ct-tumb1 (G) '), 'CT-TUMB1');
});

test('comisión sugerida: producto > línea', () => {
  const lineas = { HYDRO: { nombre: 'HYDRO', comision: 5 } };
  assert.equal(g.comisionSugerida({ linea: 'HYDRO', comision: '' }, lineas, 2), 10);
  assert.equal(g.comisionSugerida({ linea: 'HYDRO', comision: 4 }, lineas, 2), 8);
  assert.equal(g.comisionSugerida({ linea: 'OTRA', comision: '' }, lineas, 1), 0);
});

test('migración: venta sin fecha toma la del primer pago con fecha', () => {
  const enc = ['RESPONSABLE', 'CLIENTE', 'PRODUCTO', 'CODIGO', 'FECHA', 'CANTIDAD', 'PRECIO UNIDAD', 'TOTAL', 'PAGO 1', 'PAGO 2', 'PENDIENTE', 'COMISION'];
  const ventas = [enc,
    ['VENDEDOR C', 'A', 'HYDRO', 'X-1', '02/09/2026', 1, 10, 10, 10, '', 0, 1],
    ['VENDEDOR C', 'B', 'HYDRO', 'X-1', '', 1, 45, 45, 1, 44, 0, 1]];
  // Columnas: PAGO 1 = I, PAGO 2 = J
  const r = g.construirMigracion({ ventas, comentarios: { I3: ['24/06'], J3: ['09/07'] } }, {}, '2026-11-09');
  const v = r.registros.Ventas.find(x => x.fila_origen === 3);
  assert.equal(v.fecha, '2026-06-24');
  const pagos = r.registros.Pagos.filter(p => p.venta_id === v.id).map(p => [p.fecha, p.fecha_estimada]);
  assert.deepEqual(JSON.parse(JSON.stringify(pagos)), [['2026-06-24', 'NO'], ['2026-07-09', 'NO']]);
});
