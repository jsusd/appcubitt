// Prueba de punta a punta de la interfaz con Playwright contra el servidor local.
//   node tests/e2e.js [carpeta-capturas]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { crearServidor } = require('./servidor-local');

(async () => {
  const capturas = process.argv[2] || null;
  const { srv, codigo } = crearServidor();
  await new Promise(r => srv.listen(0, r));
  const url = 'http://localhost:' + srv.address().port + '/';
  const navegador = await chromium.launch();
  const errores = [];
  const ctx = await navegador.newContext({ viewport: { width: 1280, height: 860 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errores.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errores.push('console: ' + m.text()); });
  const foto = async (n, page) => { if (capturas) await (page || p).screenshot({ path: capturas + '/' + n + '.png', fullPage: true }); };
  const ir = async (vista) => { await p.click('.lateral [data-v=' + vista + ']'); await p.waitForTimeout(150); };
  const esperarToast = async (texto) => { await p.waitForSelector('.toast:has-text("' + texto + '")', { timeout: 5000 }); };
  const paso = (t) => console.log('✓ ' + t);

  try {
    await p.goto(url);
    await p.waitForSelector('text=Crear administrador');
    await p.fill('[name=codigo]', codigo);
    await p.fill('[name=nombre]', 'Admin Prueba');
    await p.fill('[name=usuario]', 'jesus');
    await p.fill('[name=clave]', 'clave-segura');
    await p.click('button:has-text("Crear y entrar")');
    await p.waitForSelector('#tituloVista:has-text("Inicio")');
    paso('instalación y primer administrador');

    // Ajustes: línea con comisión, vendedor y producto
    await ir('ajustes');
    await p.click('[data-a=tabAjustes][data-t=lineas]');
    await p.fill('[data-submit=guardarLinea] [name=nombre]', 'hydro');
    await p.fill('[data-submit=guardarLinea] [name=comision]', '5');
    await p.click('[data-submit=guardarLinea] button');
    await esperarToast('Línea guardada');
    await p.click('[data-a=tabAjustes][data-t=vendedores]');
    await p.fill('[data-submit=guardarVendedor] [name=nombre]', 'Vendedora A');
    await p.click('[data-submit=guardarVendedor] button');
    await esperarToast('Vendedor guardado');
    await p.click('[data-a=tabAjustes][data-t=productos]');
    await p.click('button:has-text("Nuevo producto")');
    await p.fill('[data-submit=guardarProducto] [name=sku]', 'CTHB24-7');
    await p.fill('[data-submit=guardarProducto] [name=linea]', 'HYDRO');
    await p.fill('[data-submit=guardarProducto] [name=modelo]', 'Snow White');
    await p.fill('[data-submit=guardarProducto] [name=costo]', '12.61');
    await p.fill('[data-submit=guardarProducto] [name=pvp]', '37');
    await p.click('[data-submit=guardarProducto] button');
    await esperarToast('Producto guardado');
    await p.waitForSelector('td:has-text("CTHB24-7")');
    paso('catálogo: línea, vendedor y producto');

    // Compra con producto existente y uno nuevo
    await ir('compras');
    await p.click('[data-a=nuevaCompra]');
    await p.fill('[data-c-campo=proveedor]', 'Proveedor Ejemplo, C.A.');
    await p.fill('[data-c-campo=nro_factura]', '4268');
    await p.fill('#buscarProductoCompra', 'cthb24');
    await p.keyboard.press('Enter');
    await p.fill('[data-cl="0"][data-c=cantidad]', '5');
    await p.fill('[data-cl="0"][data-c=costo_unit]', '12.61');
    await p.fill('#buscarProductoCompra', 'CT-NUEVO-1');
    await p.click('.sugerencias [data-nuevo]');
    await p.fill('[data-cl="1"][data-c=costo_unit]', '9');
    await p.fill('[data-c-campo=iva]', '11.53');
    await foto('compra-form');
    await p.click('#btnGuardarCompra');
    await esperarToast('Compra C-000001 registrada');
    await p.waitForSelector('td:has-text("4268")');
    paso('compra registrada (6 und), producto nuevo creado');

    // Venta a crédito con factura fiscal
    await ir('vender');
    await p.selectOption('[data-v-campo=vendedor_id]', { label: 'VENDEDORA A' });
    await p.fill('[data-v-campo=cliente]', 'Cliente Uno');
    await p.fill('[data-v-campo=telefono]', '04141234567');
    await p.fill('#buscarProducto', 'snow');
    await p.keyboard.press('Enter');
    await p.fill('[data-linea="0"][data-c=cantidad]', '2');
    assert.equal(await p.inputValue('[data-linea="0"][data-c=comision]'), '10');
    await p.click('[data-a=tipoVenta][data-t=CREDITO]');
    await p.fill('[data-v-campo=pago_inicial]', '20');
    await p.check('[data-v-campo=fiscal]');
    await p.fill('[data-v-campo=factura_fiscal]', '000123');
    assert.match(await p.textContent('#ventaTotal'), /\$74\.00/);
    assert.match(await p.textContent('#ventaResumen'), /\$54\.00/);
    await foto('vender');
    await p.click('#btnGuardarVenta');
    await p.waitForSelector('.modal:has-text("Venta registrada")');
    paso('venta a crédito registrada ($74, inicial $20, fiscal)');

    // Intento de vender más de lo que hay
    await p.click('.modal [data-a=cerrarModal]');
    await p.selectOption('[data-v-campo=vendedor_id]', { label: 'VENDEDORA A' });
    await p.fill('[data-v-campo=cliente]', 'Otro');
    await p.fill('#buscarProducto', 'cthb24-7');
    await p.keyboard.press('Enter');
    await p.fill('[data-linea="0"][data-c=cantidad]', '9');
    await p.click('#btnGuardarVenta');
    await p.waitForSelector('#ventaError:has-text("No hay suficiente stock")');
    paso('bloqueo por stock insuficiente');
    await p.click('[data-a=quitarLinea]');

    // Ventas: abrir y abonar el saldo
    await ir('ventas');
    await p.click('.solo-escritorio tr.clic');
    await p.waitForSelector('.modal:has-text("Registrar pago")');
    assert.equal(await p.inputValue('[data-submit=guardarPago] [name=monto]'), '54.00');
    await p.click('[data-submit=guardarPago] button');
    await esperarToast('Pago registrado');
    await p.waitForSelector('.modal .tag:has-text("Pagada")');
    await foto('venta-detalle');
    await p.click('.modal [data-a=cerrarModal]');
    paso('abono del saldo: venta pagada');

    // Inicio
    await ir('inicio');
    const textoInicio = await p.textContent('#contenido');
    assert.match(textoInicio, /Vendido hoy\$74\.00/);
    assert.match(textoInicio, /Cobrado hoy\$74\.00/);
    await foto('inicio');
    paso('inicio con KPIs del día');

    // Inventario y kardex
    await ir('inventario');
    const filaInv = await p.textContent('tr:has-text("CTHB24-7")');
    assert.match(filaInv, /3/);
    await p.click('tr:has-text("CTHB24-7")');
    await p.waitForSelector('.modal:has-text("Movimientos de CTHB24-7")');
    await p.click('.modal [data-a=cerrarModal]');
    // Traslado a T-Mania
    await p.click('[data-a=nuevoTraslado]');
    await p.selectOption('#trDestino', { label: 'Barquisimeto · T-Mania' });
    await p.fill('#buscarTraslado', 'cthb24-7');
    await p.keyboard.press('Enter');
    await p.click('[data-a=guardarTraslado]');
    await esperarToast('Traslado');
    await foto('inventario');
    paso('inventario por ubicación, kardex y traslado');

    // Conciliación
    await ir('conciliacion');
    await p.waitForSelector('text=Unidades compradas');
    await foto('conciliacion');
    paso('conciliación compras vs ventas');

    // Comisiones: liquidar
    await ir('comisiones');
    await p.click('[data-a=comVendedor]');
    await p.waitForSelector('.comChk');
    await p.check('#comTodas');
    await p.click('[data-a=liquidar]');
    await p.click('.modal-fondo form button:not([data-x])');
    await esperarToast('Comisiones pagadas: $10.00');
    await foto('comisiones');
    paso('liquidación de comisiones');

    // Usuario vendedor
    await ir('ajustes');
    await p.click('[data-a=tabAjustes][data-t=usuarios]');
    await p.fill('[data-submit=crearUsuario] [name=nombre]', 'Vendedora Prueba');
    await p.fill('[data-submit=crearUsuario] [name=usuario]', 'vendedora.a');
    await p.fill('[data-submit=crearUsuario] [name=clave]', 'temporal1');
    await p.selectOption('[data-submit=crearUsuario] [name=vendedor_id]', { label: 'VENDEDORA A' });
    await p.click('[data-submit=crearUsuario] button');
    await esperarToast('Usuario creado');
    paso('usuario vendedor creado');

    // Sesión de la vendedora en celular
    const movil = await navegador.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const m = await movil.newPage();
    m.on('pageerror', e => errores.push('movil pageerror: ' + e.message));
    await m.goto(url);
    await m.fill('[name=usuario]', 'vendedora.a');
    await m.fill('[name=clave]', 'temporal1');
    await m.click('button:has-text("Ingresar")');
    await m.waitForSelector('text=Nueva contraseña');
    await m.fill('[name=actual]', 'temporal1');
    await m.fill('[name=nueva]', 'mi-clave-1');
    await m.fill('[name=nueva2]', 'mi-clave-1');
    await m.click('button:has-text("Guardar contraseña")');
    await m.waitForSelector('.inferior');
    assert.equal(await m.$('.lateral [data-v=compras]'), null);
    const desborde = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(desborde <= 0, 'desborde horizontal en móvil: ' + desborde);
    await foto('movil-inicio', m);
    await m.click('.inferior [data-v=vender]');
    await m.waitForSelector('#buscarProducto');
    assert.equal(await m.$('[data-v-campo=vendedor_id]'), null);
    await foto('movil-vender', m);
    await m.click('.inferior [data-v=ventas]');
    await m.waitForSelector('.solo-movil .lista-item');
    await foto('movil-ventas', m);
    await m.click('[data-a=menuMas]');
    await m.waitForSelector('.modal:has-text("Comisiones")');
    paso('vendedora en celular: cambio de clave obligatorio, sin acceso a compras, sin desborde');

    assert.deepEqual(errores, []);
    console.log('\nE2E OK');
  } catch (e) {
    console.error('FALLÓ:', e.message);
    console.error(errores.join('\n'));
    await foto('error');
    process.exitCode = 1;
  } finally {
    await navegador.close();
    srv.close();
  }
})();
