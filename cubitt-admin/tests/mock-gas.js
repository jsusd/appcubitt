// Simulación mínima de los servicios de Google Apps Script para probar el backend en Node.
const crypto = require('crypto');

function crearEntorno(opciones = {}) {
  const hojasDeCalculo = {};
  const archivosDrive = {};
  let seq = 0;
  const props = {};

  class Rango {
    constructor(hoja, fila, col, nf, nc) { Object.assign(this, { hoja, fila, col, nf: nf || 1, nc: nc || 1 }); }
    getValues() {
      const out = [];
      for (let i = 0; i < this.nf; i++) {
        const f = this.hoja.datos[this.fila - 1 + i] || [];
        const r = [];
        for (let j = 0; j < this.nc; j++) { const v = f[this.col - 1 + j]; r.push(v === undefined ? '' : v); }
        out.push(r);
      }
      return out;
    }
    getValue() { return this.getValues()[0][0]; }
    setValues(vals) {
      if (vals.length !== this.nf || vals.some(r => r.length !== this.nc)) throw new Error(`setValues: dimensiones ${vals.length}x${vals[0] && vals[0].length} ≠ rango ${this.nf}x${this.nc}`);
      vals.forEach((r, i) => {
        const idx = this.fila - 1 + i;
        while (this.hoja.datos.length <= idx) this.hoja.datos.push([]);
        r.forEach((v, j) => {
          if (v !== null && typeof v === 'object' && !(v instanceof Date)) throw new Error('setValues: valor no permitido ' + JSON.stringify(v));
          this.hoja.datos[idx][this.col - 1 + j] = v;
        });
      });
      return this;
    }
    clearContent() {
      for (let i = 0; i < this.nf; i++) {
        const f = this.hoja.datos[this.fila - 1 + i];
        if (f) for (let j = 0; j < this.nc; j++) f[this.col - 1 + j] = '';
      }
      return this;
    }
    getFormulas() {
      const out = [];
      for (let i = 0; i < this.nf; i++) {
        const f = this.hoja.formulas[this.fila - 1 + i] || [];
        const r = [];
        for (let j = 0; j < this.nc; j++) r.push(f[this.col - 1 + j] || '');
        out.push(r);
      }
      return out;
    }
    setFormulas(vals) {
      vals.forEach((r, i) => r.forEach((v, j) => {
        const idx = this.fila - 1 + i;
        (this.hoja.formulas[idx] = this.hoja.formulas[idx] || [])[this.col - 1 + j] = v;
        if (v) { while (this.hoja.datos.length <= idx) this.hoja.datos.push([]); this.hoja.datos[idx][this.col - 1 + j] = this.hoja.datos[idx][this.col - 1 + j] || ''; }
      }));
      return this;
    }
    setNumberFormat() { return this; }
    setFontWeight() { return this; }
    setFontSize() { return this; }
    setFontColor() { return this; }
    setBackground() { return this; }
    setHorizontalAlignment() { return this; }
    setVerticalAlignment() { return this; }
    setWrap() { return this; }
    merge() { return this; }
  }

  class Hoja {
    constructor(nombre, datos, formulas) { this.nombre = nombre; this.datos = datos || []; this.formulas = formulas || []; this.id = ++seq; }
    getSheetId() { return this.id; }
    setName(n) { this.nombre = n; return this; }
    setRowHeights() { return this; }
    setColumnWidth() { return this; }
    setHiddenGridlines() { return this; }
    getName() { return this.nombre; }
    getLastRow() {
      for (let i = this.datos.length - 1; i >= 0; i--) if ((this.datos[i] || []).some(v => v !== '' && v !== undefined && v !== null)) return i + 1;
      return 0;
    }
    getLastColumn() { return this.datos.reduce((m, f) => { let l = 0; (f || []).forEach((v, j) => { if (v !== '' && v !== undefined && v !== null) l = j + 1; }); return Math.max(m, l); }, 0); }
    getMaxRows() { return 1000; }
    getRange(f, c, nf, nc) { return new Rango(this, f, c, nf, nc); }
    setFrozenRows() {}
  }

  class Libro {
    constructor(nombre, id) { this.nombre = nombre; this.id = id; this.hojas = [new Hoja('Hoja 1')]; }
    getId() { return this.id; }
    getName() { return this.nombre; }
    getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
    getSheetByName(n) { return this.hojas.find(h => h.nombre === n) || null; }
    getSheets() { return this.hojas.slice(); }
    insertSheet(n) { const h = new Hoja(n); this.hojas.push(h); return h; }
    deleteSheet(h) { this.hojas = this.hojas.filter(x => x !== h); }
  }

  const SpreadsheetApp = {
    create(nombre) {
      const id = 'ss' + (++seq); const l = new Libro(nombre, id); hojasDeCalculo[id] = l;
      archivosDrive[id] = { getId: () => id, getUrl: () => l.getUrl(), getName: () => nombre, moveTo() { return this; }, setSharing() { return this; } };
      return l;
    },
    openById(id) { if (!hojasDeCalculo[id]) throw new Error('No existe la hoja ' + id); return hojasDeCalculo[id]; },
    flush() {},
    _registrar(id, nombre, pestañas, formulas) {
      const l = new Libro(nombre, id); l.hojas = Object.keys(pestañas).map(n => new Hoja(n, pestañas[n].map(f => f.slice()), (formulas || {})[n]));
      hojasDeCalculo[id] = l; return l;
    }
  };

  const PropertiesService = {
    getScriptProperties() {
      return {
        getProperty: k => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); },
        deleteProperty: k => { delete props[k]; },
        getProperties: () => Object.assign({}, props)
      };
    }
  };

  let bloqueado = false;
  const LockService = {
    getScriptLock() {
      return {
        tryLock() { if (bloqueado) return false; bloqueado = true; return true; },
        waitLock() { if (bloqueado) throw new Error('lock'); bloqueado = true; },
        releaseLock() { bloqueado = false; }
      };
    }
  };

  class Blob {
    constructor(bytes, mime, nombre) { this.bytes = bytes; this.mime = mime; this.nombre = nombre; }
    getBytes() { return this.bytes; }
    getContentType() { return this.mime; }
    setContentType(m) { this.mime = m; return this; }
    getName() { return this.nombre; }
    getDataAsString() { return Buffer.from(this.bytes).toString('utf8'); }
  }

  const Utilities = {
    DigestAlgorithm: { SHA_256: 'sha256' },
    Charset: { UTF_8: 'utf8' },
    computeDigest(alg, s) { return Array.from(crypto.createHash(alg).update(s, 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)); },
    getUuid() { return crypto.randomUUID(); },
    sleep() {},
    base64Decode(s) { return Array.from(Buffer.from(s, 'base64')); },
    base64Encode(b) { return Buffer.from(b).toString('base64'); },
    newBlob(bytes, mime, nombre) { return new Blob(bytes, mime, nombre); },
    unzip(blob) { return (blob._archivos || []).map(a => new Blob(Array.from(Buffer.from(a.contenido, 'utf8')), 'text/xml', a.nombre)); },
    formatDate(d, tz, fmt) {
      const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d)
        .reduce((a, x) => { a[x.type] = x.value; return a; }, {});
      const hh = p.hour === '24' ? '00' : p.hour;
      return fmt.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace("'T'", 'T').replace('HH', hh).replace('mm', p.minute).replace('ss', p.second);
    }
  };

  const DriveApp = {
    Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' }, Permission: { VIEW: 'VIEW' },
    createFolder(n) {
      const id = 'carpeta' + (++seq);
      const carpeta = { id, n, archivos: [], getId: () => id, getName: () => n, getFiles() { const l = carpeta.archivos.slice(); return { hasNext: () => l.length > 0, next: () => l.shift() }; },
        createFile(blob) { const fid = 'archivo' + (++seq); const f = { setSharing() { return f; }, moveTo() { return f; }, getId: () => fid, getName: () => blob.nombre, getUrl: () => 'https://drive.google.com/file/d/' + fid, getMimeType: () => blob.mime, getBlob: () => blob, getDateCreated: () => new Date() }; archivosDrive[fid] = f; carpeta.archivos.push(f); return f; } };
      archivosDrive[id] = carpeta; return carpeta;
    },
    getFolderById(id) { if (!archivosDrive[id]) throw new Error('carpeta no encontrada'); return archivosDrive[id]; },
    getFileById(id) { if (!archivosDrive[id]) throw new Error('archivo no encontrado'); return archivosDrive[id]; }
  };

  const UrlFetchApp = {
    fetch(url, o) {
      if (opciones.fetch) return opciones.fetch(url, o);
      throw new Error('Sin red en pruebas: ' + url);
    }
  };

  const almacenCache = {};
  const CacheService = {
    getScriptCache() {
      const valido = (k) => almacenCache[k] !== undefined;
      return {
        get: k => (valido(k) ? almacenCache[k] : null),
        getAll: ks => { const o = {}; ks.forEach(k => { if (valido(k)) o[k] = almacenCache[k]; }); return o; },
        put: (k, v) => { if (Buffer.byteLength(String(v)) > 100 * 1024) throw new Error('Valor de caché > 100KB'); almacenCache[k] = String(v); },
        putAll: (o) => { Object.keys(o).forEach(k => { if (Buffer.byteLength(String(o[k])) > 100 * 1024) throw new Error('Valor de caché > 100KB'); almacenCache[k] = String(o[k]); }); },
        remove: k => { delete almacenCache[k]; }
      };
    }
  };

  return {
    almacenCache,
    globales: {
      CacheService,
      SpreadsheetApp, PropertiesService, LockService, Utilities, DriveApp, UrlFetchApp,
      Session: { getScriptTimeZone: () => 'America/Caracas' },
      ScriptApp: { getOAuthToken: () => 'token-de-prueba' },
      HtmlService: {}
    },
    props, SpreadsheetApp, Blob, archivosDrive
  };
}

module.exports = { crearEntorno };
