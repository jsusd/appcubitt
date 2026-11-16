// Empaqueta src/ en DOS archivos para copiar y pegar en el editor de Apps Script:
//   instalar/Codigo.gs  (todo el servidor)   instalar/Index.html (toda la interfaz)
//   node construir.js
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, 'src');
const out = path.join(__dirname, 'instalar');
const ORDEN = ['Dominio', 'Datos', 'Auth', 'Ventas', 'Clientes', 'Compras', 'Inventario', 'Reportes', 'Catalogo', 'Migracion', 'Actualizador', 'Codigo'];

function construir() {
  const extra = fs.readdirSync(src).filter(f => f.endsWith('.gs')).map(f => f.slice(0, -3)).filter(n => !ORDEN.includes(n));
  if (extra.length) throw new Error('Agrega estos archivos al ORDEN de construir.js: ' + extra.join(', '));
  const cabecera = '/**\n * CUBITT ADMIN — servidor (archivo generado; no editar aquí, editar cubitt-admin/src/ y ejecutar node construir.js)\n * Pega TODO este contenido en el archivo Código.gs del editor de Apps Script.\n */\n';
  const gs = cabecera + ORDEN.map(n => '\n// ==================== ' + n + '.gs ====================\n' + fs.readFileSync(path.join(src, n + '.gs'), 'utf8')).join('\n');
  let html = fs.readFileSync(path.join(src, 'Index.html'), 'utf8');
  html = html.replace(/<\?!= incluir\('(\w+)'\); \?>/g, (_, n) => fs.readFileSync(path.join(src, n + '.html'), 'utf8'));
  if (/<\?/.test(html)) throw new Error('Quedó un scriptlet sin resolver en Index.html');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'Codigo.gs'), gs);
  fs.writeFileSync(path.join(out, 'Index.html'), html);
  // Manifiesto y archivo de versión (lo lee el actualizador automático de la app)
  const manifiesto = fs.readFileSync(path.join(src, 'appsscript.json'), 'utf8');
  fs.writeFileSync(path.join(out, 'appsscript.json'), manifiesto);
  const version = (gs.match(/var VERSION_APP = '([^']+)'/) || [])[1];
  if (!version) throw new Error('Falta VERSION_APP en Actualizador.gs');
  const novedades = JSON.parse(fs.readFileSync(path.join(__dirname, 'novedades.json'), 'utf8'));
  const info = { version, notas: novedades[version] || [], permisos: JSON.parse(manifiesto).oauthScopes };
  const versionJson = JSON.stringify(info, null, 2) + '\n';
  fs.writeFileSync(path.join(out, 'version.json'), versionJson);
  return { gs, html, versionJson, manifiesto };
}

if (require.main === module) {
  const r = construir();
  console.log('instalar/Codigo.gs', r.gs.length, 'caracteres · instalar/Index.html', r.html.length, 'caracteres');
}
module.exports = { construir };
