// El paquete de 2 archivos (instalar/) debe estar al día con src/ y funcionar por sí solo.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { construir } = require('../construir');
const { crearEntorno } = require('./mock-gas');

test('instalar/ está al día con src/ (ejecuta: node construir.js)', () => {
  const dir = path.join(__dirname, '..', 'instalar');
  const antes = { gs: fs.readFileSync(path.join(dir, 'Codigo.gs'), 'utf8'), html: fs.readFileSync(path.join(dir, 'Index.html'), 'utf8') };
  const r = construir();
  assert.equal(antes.gs, r.gs, 'instalar/Codigo.gs desactualizado');
  assert.equal(antes.html, r.html, 'instalar/Index.html desactualizado');
});

test('el archivo único Codigo.gs instala, crea admin y registra una venta', () => {
  const env = crearEntorno();
  const ctx = vm.createContext(Object.assign({ console }, env.globales));
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'instalar', 'Codigo.gs'), 'utf8'), ctx);
  const codigo = ctx.instalar().match(/CÓDIGO DE INSTALACIÓN: (\d+)/)[1];
  const tk = ctx.crearAdministradorInicial(codigo, { usuario: 'admin1', nombre: 'Admin', clave: 'clave-segura' }).data.token;
  const ok = (a, d) => { const r = ctx.api(tk, a, d); assert.ok(r.ok, a + ': ' + r.error); return r.data; };
  ok('guardarProducto', { sku: 'X-1', linea: 'HYDRO', pvp: 37 });
  const vend = ok('guardarVendedor', { nombre: 'Vendedor' });
  ok('crearCompra', { fecha: ctx.hoyIso(), proveedor: 'P', nro_factura: '1', ubicacion_id: 'UB-TRINITARIAS', items: [{ sku: 'X-1', cantidad: 2, costo_unit: 10 }] });
  const v = ok('crearVenta', { fecha: ctx.hoyIso(), cliente: 'C', vendedor_id: vend.id, ubicacion_id: 'UB-TRINITARIAS', tipo: 'CONTADO', pago_inicial: 37, items: [{ sku: 'X-1', cantidad: 1, precio_unit: 37 }] });
  assert.equal(v.estadoPago, 'PAGADA');
  assert.equal(ok('stock', {}).filas[0].total, 1);
});
