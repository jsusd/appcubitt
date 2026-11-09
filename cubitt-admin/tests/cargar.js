// Carga todos los archivos .gs en un mismo contexto (como hace Apps Script) para probarlos en Node.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function cargar(globales) {
  const ctx = vm.createContext(Object.assign({ console, JSON, Math, Date, Object, Array, String, Number, RegExp, Error, isFinite, parseInt, parseFloat, encodeURIComponent }, globales || {}));
  const dir = path.join(__dirname, '..', 'src');
  fs.readdirSync(dir).filter(f => f.endsWith('.gs')).sort().forEach(f => {
    vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  });
  return ctx;
}
module.exports = { cargar };
