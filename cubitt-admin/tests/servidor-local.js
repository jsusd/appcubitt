// Servidor local para probar la interfaz sin desplegar en Google.
// Simula Apps Script (hojas, propiedades, bloqueos) en memoria y expone google.script.run vía HTTP.
//   node tests/servidor-local.js [puerto]
const http = require('http');
const fs = require('fs');
const path = require('path');
const { crearEntorno } = require('./mock-gas');
const { cargar } = require('./cargar');

function crearServidor(opciones = {}) {
  const env = crearEntorno(opciones.entorno || {});
  const g = cargar(env.globales);
  const msg = g.instalar();
  const codigo = (msg.match(/CÓDIGO DE INSTALACIÓN: (\d+)/) || [])[1];
  const src = path.join(__dirname, '..', 'src');

  function pagina() {
    let html = fs.readFileSync(path.join(src, 'Index.html'), 'utf8');
    html = html.replace(/<\?!= incluir\('(\w+)'\); \?>/g, (_, n) => fs.readFileSync(path.join(src, n + '.html'), 'utf8'));
    const puente = '<script>window.__servidor = function (fn, args) { return fetch("/rpc", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fn: fn, args: args }) }).then(function (r) { return r.json(); }); };</script>';
    return html.replace('<div id="raiz"></div>', puente + '<div id="raiz"></div>');
  }

  const PERMITIDAS = ['api', 'login', 'logout', 'estadoInstalacion', 'crearAdministradorInicial'];
  const srv = http.createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(pagina());
    }
    if (req.method === 'POST' && req.url === '/rpc') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        try {
          const { fn, args } = JSON.parse(body);
          if (PERMITIDAS.indexOf(fn) === -1) throw new Error('Función no permitida: ' + fn);
          const r = g[fn].apply(null, args || []);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(r === undefined ? null : r));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  return { srv, g, env, codigo };
}

if (require.main === module) {
  const puerto = Number(process.argv[2]) || 8780;
  const { srv, codigo } = crearServidor();
  srv.listen(puerto, () => console.log('Cubitt Admin local en http://localhost:' + puerto + '\nCódigo de instalación: ' + codigo));
}

module.exports = { crearServidor };
