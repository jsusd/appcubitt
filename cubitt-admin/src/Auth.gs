/**
 * Auth.gs — Usuarios y sesiones.
 * - Las contraseñas se guardan con hash SHA-256 + sal (nunca en texto plano).
 * - Cada llamada al servidor exige un token de sesión válido; el servidor decide
 *   qué puede ver y hacer cada rol (no el navegador).
 * Roles: ADMIN (todo) y VENDEDOR (registra ventas/pagos propios, ve sus ventas,
 * comisiones y el stock).
 */

var ROL = { ADMIN: 'ADMIN', VENDEDOR: 'VENDEDOR' };
var DURACION_SESION_DIAS = 30;

function hashClave(clave, salt) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '::' + clave, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function validarClaveNueva(clave) {
  if (!clave || String(clave).length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');
}

function usuarioPublico(u) {
  return {
    id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, vendedor_id: u.vendedor_id,
    activo: u.activo !== 'NO', debe_cambiar_clave: u.debe_cambiar_clave === 'SI'
  };
}

var Auth = {
  hayUsuarios: function () {
    return Db.leer('Usuarios').length > 0;
  },

  crearUsuario: function (datos, autor) {
    var usuario = texto(datos.usuario).toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) throw new Error('El usuario debe tener 3 a 30 caracteres (letras, números, punto o guion).');
    if (Db.leer('Usuarios').some(function (u) { return u.usuario === usuario; })) throw new Error('Ya existe el usuario "' + usuario + '".');
    if (!texto(datos.nombre)) throw new Error('El nombre es obligatorio.');
    var rol = datos.rol === ROL.ADMIN ? ROL.ADMIN : ROL.VENDEDOR;
    if (rol === ROL.VENDEDOR && !texto(datos.vendedor_id)) throw new Error('Un usuario vendedor debe estar vinculado a un vendedor.');
    validarClaveNueva(datos.clave);
    var salt = Utilities.getUuid();
    var u = {
      id: Db.siguienteId('U'), usuario: usuario, nombre: texto(datos.nombre), rol: rol,
      vendedor_id: rol === ROL.VENDEDOR ? texto(datos.vendedor_id) : '',
      hash: hashClave(String(datos.clave), salt), salt: salt, activo: 'SI',
      debe_cambiar_clave: datos.debe_cambiar_clave ? 'SI' : 'NO', creado_en: ahoraIso()
    };
    Db.insertar('Usuarios', [u]);
    auditar(autor, 'USUARIO_CREADO', u.usuario + ' (' + rol + ')');
    return usuarioPublico(u);
  },

  login: function (usuario, clave) {
    usuario = texto(usuario).toLowerCase();
    var u = Db.leer('Usuarios').filter(function (x) { return x.usuario === usuario; })[0];
    // Mismo mensaje para usuario inexistente o clave errada (no revela qué usuarios existen)
    if (!u || hashClave(String(clave || ''), u.salt) !== u.hash) {
      Utilities.sleep(400);
      throw new Error('Usuario o contraseña incorrectos.');
    }
    if (u.activo === 'NO') throw new Error('Este usuario está desactivado. Habla con el administrador.');
    var token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
    var props = PropertiesService.getScriptProperties();
    props.setProperty('SES_' + token, JSON.stringify({ uid: u.id, exp: Date.now() + DURACION_SESION_DIAS * 86400000 }));
    Auth._limpiarSesionesVencidas(props);
    return { token: token, usuario: usuarioPublico(u) };
  },

  logout: function (token) {
    if (token) PropertiesService.getScriptProperties().deleteProperty('SES_' + token);
  },

  /** Devuelve el usuario de la sesión o lanza error. */
  sesion: function (token) {
    if (!token) throw new Error('SESION_VENCIDA');
    var raw = PropertiesService.getScriptProperties().getProperty('SES_' + token);
    if (!raw) throw new Error('SESION_VENCIDA');
    var s = JSON.parse(raw);
    if (s.exp < Date.now()) {
      PropertiesService.getScriptProperties().deleteProperty('SES_' + token);
      throw new Error('SESION_VENCIDA');
    }
    var u = Db.porId('Usuarios', s.uid);
    if (!u || u.activo === 'NO') throw new Error('SESION_VENCIDA');
    return u;
  },

  cambiarClave: function (u, actual, nueva) {
    if (hashClave(String(actual || ''), u.salt) !== u.hash) throw new Error('La contraseña actual no es correcta.');
    validarClaveNueva(nueva);
    var salt = Utilities.getUuid();
    Db.actualizar('Usuarios', u.id, { hash: hashClave(String(nueva), salt), salt: salt, debe_cambiar_clave: 'NO' });
    auditar(u, 'CLAVE_CAMBIADA', u.usuario);
  },

  restablecerClave: function (admin, usuarioId, nueva) {
    validarClaveNueva(nueva);
    var u = Db.porId('Usuarios', usuarioId);
    if (!u) throw new Error('Usuario no encontrado.');
    var salt = Utilities.getUuid();
    Db.actualizar('Usuarios', u.id, { hash: hashClave(String(nueva), salt), salt: salt, debe_cambiar_clave: 'SI' });
    Auth._cerrarSesionesDe(u.id);
    auditar(admin, 'CLAVE_RESTABLECIDA', u.usuario);
  },

  _cerrarSesionesDe: function (uid) {
    var props = PropertiesService.getScriptProperties();
    var todas = props.getProperties();
    Object.keys(todas).forEach(function (k) {
      if (k.indexOf('SES_') !== 0) return;
      try { if (JSON.parse(todas[k]).uid === uid) props.deleteProperty(k); } catch (e) { props.deleteProperty(k); }
    });
  },

  _limpiarSesionesVencidas: function (props) {
    var todas = props.getProperties();
    var ahora = Date.now();
    Object.keys(todas).forEach(function (k) {
      if (k.indexOf('SES_') !== 0) return;
      try { if (JSON.parse(todas[k]).exp < ahora) props.deleteProperty(k); } catch (e) { props.deleteProperty(k); }
    });
  }
};

function esAdmin(u) { return u && u.rol === ROL.ADMIN; }

function exigirAdmin(u) {
  if (!esAdmin(u)) throw new Error('Esta acción es solo para administradores.');
}
