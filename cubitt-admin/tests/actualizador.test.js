// El actualizador automático: descarga de GitHub, reemplaza el código y mueve la implementación web.
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearEntorno } = require('./mock-gas');
const { cargar } = require('./cargar');

function escenario(opciones = {}) {
  const llamadas = [];
  const version = opciones.version || '9.0.0';
  const resp = (codigo, cuerpo) => ({ getResponseCode: () => codigo, getContentText: () => (typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)) });
  const fetch = (url, o = {}) => {
    const metodo = (o.method || 'get').toLowerCase();
    llamadas.push({ metodo, url: url.replace(/\?t=\d+$/, ''), cuerpo: o.payload ? JSON.parse(o.payload) : undefined, auth: o.headers && o.headers.Authorization });
    if (url.includes('raw.githubusercontent.com')) {
      if (url.includes('version.json')) return resp(200, { version, notas: ['Algo nuevo'], permisos: ['https://www.googleapis.com/auth/spreadsheets'] });
      if (url.includes('Codigo.gs')) return resp(200, opciones.gsRoto ? 'basura' : "function doGet() {}\nvar VERSION_APP = '" + version + "';");
      if (url.includes('Index.html')) return resp(200, '<html><script>window.CubittApp = {};</script></html>');
    }
    if (url.includes('script.googleapis.com')) {
      if (opciones.apiDesactivada) return resp(403, { error: { message: 'Apps Script API has not been used in project 1 before or it is disabled.', status: 'PERMISSION_DENIED' } });
      if (url.endsWith('/content') && metodo === 'get') return resp(200, { files: [
        { name: 'appsscript', type: 'JSON', source: JSON.stringify({ timeZone: 'America/Caracas', oauthScopes: ['https://www.googleapis.com/auth/spreadsheets'], webapp: { access: 'ANYONE', executeAs: 'USER_DEPLOYING' } }) },
        { name: 'Código', type: 'SERVER_JS', source: 'viejo' }, { name: 'Index', type: 'HTML', source: 'viejo' }, { name: 'Sobrante', type: 'SERVER_JS', source: 'x' }] });
      if (url.endsWith('/content') && metodo === 'put') return resp(200, {});
      if (url.endsWith('/versions')) return resp(200, { versionNumber: 7 });
      if (url.endsWith('/deployments') && metodo === 'get') return resp(200, { deployments: [
        { deploymentId: 'HEAD', deploymentConfig: { manifestFileName: 'appsscript' } },
        { deploymentId: 'WEB1', deploymentConfig: { versionNumber: 6 }, entryPoints: [{ entryPointType: 'WEB_APP', webApp: { url: 'x' } }] }] });
      if (url.includes('/deployments/') && metodo === 'put') return resp(200, {});
    }
    throw new Error('URL inesperada ' + url);
  };
  const env = crearEntorno({ fetch });
  const g = cargar(env.globales);
  const codigo = g.instalar().match(/CÓDIGO DE INSTALACIÓN: (\d+)/)[1];
  const tk = g.crearAdministradorInicial(codigo, { usuario: 'admin1', nombre: 'A', clave: 'clave-segura' }).data.token;
  return { g, tk, llamadas, api: (a, d) => JSON.parse(JSON.stringify(g.api(tk, a, d))) };
}

test('detecta la versión nueva y la instala en el mismo proyecto y la misma URL', () => {
  const t = escenario();
  const e = t.api('estadoActualizacion', {});
  assert.ok(e.ok, e.error);
  assert.equal(e.data.hayNueva, true);
  assert.equal(e.data.disponible, '9.0.0');
  t.llamadas.length = 0;
  const r = t.api('actualizarApp', {});
  assert.ok(r.ok, r.error);
  assert.equal(r.data.a, '9.0.0');
  assert.equal(r.data.versionNumero, 7);
  const put = t.llamadas.find(l => l.metodo === 'put' && l.url.endsWith('/content'));
  const nombres = put.cuerpo.files.map(f => f.name);
  assert.deepEqual(nombres, ['appsscript', 'Código', 'Index']); // conserva el nombre del archivo y quita sobrantes
  const manifiesto = JSON.parse(put.cuerpo.files[0].source);
  assert.equal(manifiesto.webapp.access, 'ANYONE'); // conserva la configuración del usuario
  assert.ok(manifiesto.oauthScopes.includes('https://www.googleapis.com/auth/script.deployments'));
  assert.match(put.cuerpo.files[1].source, /VERSION_APP = '9.0.0'/);
  const deps = t.llamadas.filter(l => l.metodo === 'put' && l.url.includes('/deployments/'));
  assert.equal(deps.length, 1); // solo la implementación web, no la de prueba
  assert.match(deps[0].url, /deployments\/WEB1$/);
  assert.equal(deps[0].cuerpo.deploymentConfig.versionNumber, 7);
  assert.ok(t.llamadas.filter(l => l.url.includes('script.googleapis.com')).every(l => l.auth === 'Bearer token-de-prueba'));
});

test('no instala nada si el código descargado no coincide, si ya está al día o si la API está apagada', () => {
  let t = escenario({ gsRoto: true });
  let r = t.api('actualizarApp', {});
  assert.equal(r.ok, false);
  assert.match(r.error, /No se instaló nada/);
  assert.ok(!t.llamadas.some(l => l.metodo === 'put'));

  t = escenario({ version: '0.1.0' });
  r = t.api('actualizarApp', {});
  assert.equal(r.data.actualizado, false);
  assert.ok(!t.llamadas.some(l => l.url.includes('script.googleapis.com')));

  t = escenario({ apiDesactivada: true });
  r = t.api('actualizarApp', {});
  assert.match(r.error, /^API_DESACTIVADA: Activa la "API de Google Apps Script"/);
});

test('solo un administrador puede actualizar', () => {
  const t = escenario();
  const v = t.api('guardarVendedor', { nombre: 'V' }).data;
  t.api('crearUsuario', { usuario: 'vend1', nombre: 'V', rol: 'VENDEDOR', vendedor_id: v.id, clave: 'temporal1' });
  const tk = t.g.login('vend1', 'temporal1').data.token;
  t.g.api(tk, 'cambiarClave', { actual: 'temporal1', nueva: 'otra-clave' });
  assert.match(t.g.api(tk, 'actualizarApp', {}).error, /solo para administradores/);
});

test('compararVersiones', () => {
  const g = cargar(crearEntorno().globales);
  assert.equal(g.compararVersiones('1.10.0', '1.9.3'), 1);
  assert.equal(g.compararVersiones('1.5.0', '1.5.0'), 0);
  assert.equal(g.compararVersiones('1.5', '1.5.1'), -1);
});
