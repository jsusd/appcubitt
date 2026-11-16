/**
 * Actualizador.gs — La app se actualiza sola desde GitHub, sin copiar archivos ni crear versiones a mano.
 *
 * Cómo funciona (botón "Actualizar ahora" en Ajustes ▸ Actualizaciones):
 *   1. Descarga instalar/version.json, instalar/Codigo.gs e instalar/Index.html del repositorio.
 *   2. Reemplaza el código de este proyecto con la API de Apps Script (conserva el manifiesto).
 *   3. Crea una versión nueva y apunta a ella la implementación web existente (la URL no cambia).
 *
 * Requisitos (una sola vez): activar "API de Google Apps Script" en https://script.google.com/home/usersettings
 * y que el manifiesto incluya los permisos script.projects y script.deployments.
 */

var VERSION_APP = '1.5.0';
var REPO_ACTUALIZACIONES = 'jsusd/appcubitt';
var RAMA_ACTUALIZACIONES = 'ccr-b258b60b-x1r4r1';
var CARPETA_ACTUALIZACIONES = 'cubitt-admin/instalar';
var API_SCRIPT = 'https://script.googleapis.com/v1/projects/';
var PERMISOS_ACTUALIZADOR = ['https://www.googleapis.com/auth/script.projects', 'https://www.googleapis.com/auth/script.deployments'];

/** Compara versiones "1.10.0" > "1.9.3". */
function compararVersiones(a, b) {
  var pa = String(a || '0').split('.').map(Number), pb = String(b || '0').split('.').map(Number);
  for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
    var x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/**
 * Arma el nuevo contenido del proyecto a partir del actual: un solo archivo de servidor, Index y el
 * manifiesto actual (con los permisos que pida la versión nueva).
 */
function armarContenidoNuevo(actual, codigoGs, indexHtml, permisosExtra) {
  var archivos = (actual && actual.files) || [];
  var manifiesto = archivos.filter(function (f) { return f.type === 'JSON' && f.name === 'appsscript'; })[0];
  if (!manifiesto) throw new Error('No se encontró el manifiesto (appsscript.json) del proyecto.');
  var m = JSON.parse(manifiesto.source);
  m.oauthScopes = m.oauthScopes || [];
  PERMISOS_ACTUALIZADOR.concat(permisosExtra || []).forEach(function (p) { if (m.oauthScopes.indexOf(p) === -1) m.oauthScopes.push(p); });
  var servidor = archivos.filter(function (f) { return f.type === 'SERVER_JS'; })[0];
  return {
    files: [
      { name: 'appsscript', type: 'JSON', source: JSON.stringify(m, null, 2) },
      { name: servidor ? servidor.name : 'Codigo', type: 'SERVER_JS', source: codigoGs },
      { name: 'Index', type: 'HTML', source: indexHtml }
    ]
  };
}

function _urlRepo(archivo) {
  var cfg = Db.config();
  var rama = texto(cfg.RAMA_ACTUALIZACIONES) || RAMA_ACTUALIZACIONES;
  return 'https://raw.githubusercontent.com/' + REPO_ACTUALIZACIONES + '/' + encodeURIComponent(rama).replace(/%2F/g, '/') + '/' + CARPETA_ACTUALIZACIONES + '/' + archivo + '?t=' + Date.now();
}

function _descargar(archivo) {
  var r = UrlFetchApp.fetch(_urlRepo(archivo), { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('No se pudo descargar ' + archivo + ' desde GitHub (código ' + r.getResponseCode() + ').');
  return r.getContentText('UTF-8');
}

function _apiScript(metodo, ruta, cuerpo) {
  var opciones = { method: metodo, muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } };
  if (cuerpo !== undefined) { opciones.contentType = 'application/json'; opciones.payload = JSON.stringify(cuerpo); }
  var r = UrlFetchApp.fetch(API_SCRIPT + ScriptApp.getScriptId() + ruta, opciones);
  var codigo = r.getResponseCode();
  var txt = r.getContentText();
  if (codigo >= 300) {
    if (codigo === 403 && /has not been used|disabled|SERVICE_DISABLED|User has not enabled/i.test(txt)) {
      throw new Error('API_DESACTIVADA: Activa la "API de Google Apps Script" en https://script.google.com/home/usersettings y vuelve a intentar.');
    }
    if (codigo === 403 || codigo === 401) {
      throw new Error('SIN_PERMISO: Falta autorizar los permisos de actualización. En el editor de Apps Script ejecuta una vez la función "autorizarActualizaciones".');
    }
    throw new Error('La API de Apps Script respondió ' + codigo + ': ' + txt.slice(0, 300));
  }
  return txt ? JSON.parse(txt) : {};
}

var Actualizador = {
  estado: function (u) {
    exigirAdmin(u);
    var out = { actual: VERSION_APP, rama: texto(Db.config().RAMA_ACTUALIZACIONES) || RAMA_ACTUALIZACIONES };
    try {
      var info = JSON.parse(_descargar('version.json'));
      out.disponible = info.version;
      out.notas = info.notas || [];
      out.hayNueva = compararVersiones(info.version, VERSION_APP) > 0;
    } catch (e) {
      out.error = e.message;
    }
    return out;
  },

  /** Descarga la versión publicada en GitHub y la instala en este mismo proyecto. */
  actualizar: function (u, d) {
    exigirAdmin(u);
    d = d || {};
    var info = JSON.parse(_descargar('version.json'));
    if (!d.forzar && compararVersiones(info.version, VERSION_APP) <= 0) {
      return { actualizado: false, mensaje: 'Ya tienes la última versión (' + VERSION_APP + ').' };
    }
    var gs = _descargar('Codigo.gs');
    var html = _descargar('Index.html');
    // Validaciones para no instalar algo roto o incompleto
    if (gs.indexOf('function doGet') === -1 || gs.indexOf("var VERSION_APP = '" + info.version + "'") === -1) throw new Error('El código descargado no coincide con la versión ' + info.version + '. No se instaló nada.');
    if (html.indexOf('</html>') === -1 || html.indexOf('CubittApp') === -1) throw new Error('La interfaz descargada está incompleta. No se instaló nada.');

    var actual = _apiScript('get', '/content');
    _apiScript('put', '/content', armarContenidoNuevo(actual, gs, html, info.permisos));
    var version = _apiScript('post', '/versions', { description: 'Cubitt Admin ' + info.version + ' (actualización automática)' });
    var lista = _apiScript('get', '/deployments').deployments || [];
    var actualizadas = 0;
    lista.forEach(function (dep) {
      var cfg = dep.deploymentConfig || {};
      if (!cfg.versionNumber) return; // la implementación de prueba (@HEAD) ya usa el último código
      var esWeb = (dep.entryPoints || []).some(function (e) { return e.entryPointType === 'WEB_APP'; });
      if (!esWeb) return;
      _apiScript('put', '/deployments/' + dep.deploymentId, {
        deploymentConfig: { scriptId: ScriptApp.getScriptId(), versionNumber: version.versionNumber, manifestFileName: 'appsscript', description: 'Cubitt Admin ' + info.version }
      });
      actualizadas++;
    });
    if (!actualizadas) throw new Error('El código se actualizó, pero no se encontró la implementación web para apuntarla a la versión nueva. Hazlo una vez en Implementar ▸ Administrar implementaciones.');
    auditar(u, 'APP_ACTUALIZADA', VERSION_APP + ' → ' + info.version + ' (versión ' + version.versionNumber + ')');
    return { actualizado: true, de: VERSION_APP, a: info.version, versionNumero: version.versionNumber, notas: info.notas || [], url: ScriptApp.getService().getUrl() };
  }
};

/**
 * Ejecútala UNA vez desde el editor (Ejecutar ▸ autorizarActualizaciones) para aceptar los permisos
 * de actualización y comprobar que la API de Apps Script está activada.
 */
function autorizarActualizaciones() {
  var r = UrlFetchApp.fetch(API_SCRIPT + ScriptApp.getScriptId() + '/deployments', { muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } });
  var msg = r.getResponseCode() === 200
    ? 'Listo: la app ya puede actualizarse sola desde Ajustes ▸ Actualizaciones.'
    : 'Falta activar la "API de Google Apps Script" en https://script.google.com/home/usersettings (código ' + r.getResponseCode() + ').';
  console.log(msg);
  return msg;
}
