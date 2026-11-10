// Empaqueta src/ en DOS archivos para copiar y pegar en el editor de Apps Script:
//   instalar/Codigo.gs  (todo el servidor)   instalar/Index.html (toda la interfaz)
//   node construir.js
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, 'src');
const out = path.join(__dirname, 'instalar');
const ORDEN = ['Dominio', 'Datos', 'Auth', 'Ventas', 'Clientes', 'Compras', 'Inventario', 'Reportes', 'Catalogo', 'Migracion', 'Codigo'];

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
  return { gs, html };
}

if (require.main === module) {
  const r = construir();
  console.log('instalar/Codigo.gs', r.gs.length, 'caracteres · instalar/Index.html', r.html.length, 'caracteres');
}
module.exports = { construir };
