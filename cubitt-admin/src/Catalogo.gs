/**
 * Catalogo.gs — Productos, líneas (comisión por línea), vendedores, ubicaciones,
 * usuarios y configuración.
 */

var Catalogo = {
  /** Todo lo que la app necesita al abrir. */
  inicial: function (u) {
    var admin = esAdmin(u);
    var stock = _stockActual();
    var ubic = Db.leer('Ubicaciones').filter(function (x) { return x.activo !== 'NO'; }).map(_limpio);
    var productos = Db.leer('Productos').map(function (p) {
      var o = _limpio(p);
      o.sku = normSku(p.sku);
      o.stock = {};
      o.stockTotal = 0;
      ubic.forEach(function (ub) { var n = stock[claveStock(o.sku, ub.id)] || 0; o.stock[ub.id] = n; o.stockTotal += n; });
      if (!admin) delete o.costo;
      return o;
    });
    var cfg = Db.config();
    return {
      usuario: usuarioPublico(u),
      negocio: cfg.NOMBRE_NEGOCIO || 'Cubitt',
      hoy: hoyIso(),
      productos: productos,
      lineas: Db.leer('Lineas').map(_limpio),
      vendedores: Db.leer('Vendedores').map(_limpio),
      ubicaciones: ubic,
      metodosPago: (cfg.METODOS_PAGO || 'EFECTIVO USD,ZELLE,BINANCE,PAGO MOVIL,TRANSFERENCIA BS,PUNTO DE VENTA,CASHEA').split(',').map(texto).filter(String),
      iaDisponible: admin && !!PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY'),
      ubicacionPorDefecto: cfg.UBICACION_POR_DEFECTO || (ubic[0] && ubic[0].id) || ''
    };
  },

  guardarProducto: function (u, p) {
    exigirAdmin(u);
    return conBloqueo(function () {
      var sku = normSku(p.sku);
      if (!sku) throw new Error('El código (SKU) es obligatorio.');
      if (num(p.costo) < 0 || num(p.pvp) < 0 || num(p.comision) < 0) throw new Error('Costo, precio y comisión no pueden ser negativos.');
      var datos = {
        sku: sku, linea: normNombre(p.linea), modelo: texto(p.modelo).toUpperCase(), color: texto(p.color).toUpperCase(),
        descripcion: texto(p.descripcion), costo: texto(p.costo) === '' ? '' : r2(num(p.costo)), pvp: texto(p.pvp) === '' ? '' : r2(num(p.pvp)),
        comision: texto(p.comision) === '' ? '' : r2(num(p.comision)), activo: p.activo === false || p.activo === 'NO' ? 'NO' : 'SI',
        imagen: texto(p.imagen), actualizado_en: ahoraIso()
      };
      if (Db.porId('Productos', sku, 'sku')) {
        if (p.nuevo) throw new Error('Ya existe un producto con el código ' + sku + '.');
        Db.actualizar('Productos', sku, datos, 'sku');
      } else {
        Db.insertar('Productos', [datos]);
      }
      if (datos.linea && !Db.porId('Lineas', datos.linea, 'nombre')) Db.insertar('Lineas', [{ nombre: datos.linea, comision: '', notas: '' }]);
      auditar(u, 'PRODUCTO_GUARDADO', sku);
      return datos;
    });
  },

  guardarLinea: function (u, l) {
    exigirAdmin(u);
    return conBloqueo(function () {
      var nombre = normNombre(l.nombre);
      if (!nombre) throw new Error('El nombre de la línea es obligatorio.');
      if (num(l.comision) < 0) throw new Error('La comisión no puede ser negativa.');
      var datos = { nombre: nombre, comision: texto(l.comision) === '' ? '' : r2(num(l.comision)), notas: texto(l.notas) };
      if (Db.porId('Lineas', nombre, 'nombre')) Db.actualizar('Lineas', nombre, datos, 'nombre');
      else Db.insertar('Lineas', [datos]);
      auditar(u, 'LINEA_GUARDADA', nombre + ' comisión ' + datos.comision);
      return datos;
    });
  },

  guardarVendedor: function (u, v) {
    exigirAdmin(u);
    return conBloqueo(function () {
      var nombre = normNombre(v.nombre);
      if (!nombre) throw new Error('El nombre es obligatorio.');
      var existente = v.id ? Db.porId('Vendedores', v.id) : null;
      var repetido = Db.leer('Vendedores').filter(function (x) { return x.nombre === nombre && (!existente || x.id !== existente.id); })[0];
      if (repetido) throw new Error('Ya existe el vendedor ' + nombre + '.');
      var datos = { nombre: nombre, telefono: texto(v.telefono), activo: v.activo === false || v.activo === 'NO' ? 'NO' : 'SI', notas: texto(v.notas) };
      if (existente) {
        Db.actualizar('Vendedores', existente.id, datos);
        datos.id = existente.id;
      } else {
        datos.id = Db.siguienteId('VEN');
        datos.creado_en = ahoraIso();
        Db.insertar('Vendedores', [datos]);
      }
      auditar(u, 'VENDEDOR_GUARDADO', datos.id + ' ' + nombre);
      return datos;
    });
  },

  guardarUbicacion: function (u, x) {
    exigirAdmin(u);
    return conBloqueo(function () {
      var nombre = texto(x.nombre);
      if (!nombre) throw new Error('El nombre es obligatorio.');
      var datos = { nombre: nombre, activo: x.activo === false || x.activo === 'NO' ? 'NO' : 'SI', notas: texto(x.notas) };
      if (x.id && Db.porId('Ubicaciones', x.id)) {
        if (datos.activo === 'NO') {
          var st = _stockActual();
          var conStock = Object.keys(st).filter(function (k) { return k.split('|')[1] === x.id && st[k] !== 0; });
          if (conStock.length) throw new Error('No se puede desactivar: todavía tiene stock en ' + conStock.length + ' productos. Trasládalo primero.');
        }
        Db.actualizar('Ubicaciones', x.id, datos);
        datos.id = x.id;
      } else {
        datos.id = Db.siguienteId('UB');
        Db.insertar('Ubicaciones', [datos]);
      }
      auditar(u, 'UBICACION_GUARDADA', datos.id + ' ' + nombre);
      return datos;
    });
  },

  usuarios: function (u) {
    exigirAdmin(u);
    return Db.leer('Usuarios').map(usuarioPublico);
  },

  crearUsuario: function (u, d) {
    exigirAdmin(u);
    return conBloqueo(function () { d.debe_cambiar_clave = true; return Auth.crearUsuario(d, u); });
  },

  editarUsuario: function (u, d) {
    exigirAdmin(u);
    return conBloqueo(function () {
      var x = Db.porId('Usuarios', d.id);
      if (!x) throw new Error('Usuario no encontrado.');
      var cambios = {};
      if (d.nombre !== undefined) cambios.nombre = texto(d.nombre);
      if (d.activo !== undefined) {
        if (x.id === u.id && !d.activo) throw new Error('No puedes desactivar tu propio usuario.');
        cambios.activo = d.activo ? 'SI' : 'NO';
        if (!d.activo) Auth._cerrarSesionesDe(x.id);
      }
      if (d.rol !== undefined) {
        if (x.id === u.id && d.rol !== ROL.ADMIN) throw new Error('No puedes quitarte el rol de administrador.');
        cambios.rol = d.rol === ROL.ADMIN ? ROL.ADMIN : ROL.VENDEDOR;
      }
      if (d.vendedor_id !== undefined) cambios.vendedor_id = texto(d.vendedor_id);
      var rolFinal = cambios.rol || x.rol;
      if (rolFinal === ROL.VENDEDOR && !texto(cambios.vendedor_id !== undefined ? cambios.vendedor_id : x.vendedor_id)) throw new Error('Un usuario vendedor debe estar vinculado a un vendedor.');
      Db.actualizar('Usuarios', x.id, cambios);
      auditar(u, 'USUARIO_EDITADO', x.usuario + ' ' + JSON.stringify(cambios));
      return usuarioPublico(Db.porId('Usuarios', x.id));
    });
  },

  restablecerClave: function (u, d) {
    exigirAdmin(u);
    return conBloqueo(function () { Auth.restablecerClave(u, d.id, d.clave); return true; });
  },

  config: function (u) {
    exigirAdmin(u);
    var cfg = Db.config();
    return {
      NOMBRE_NEGOCIO: cfg.NOMBRE_NEGOCIO || 'Cubitt',
      METODOS_PAGO: cfg.METODOS_PAGO || 'EFECTIVO USD,ZELLE,BINANCE,PAGO MOVIL,TRANSFERENCIA BS,PUNTO DE VENTA,CASHEA',
      UBICACION_POR_DEFECTO: cfg.UBICACION_POR_DEFECTO || '',
      MODELO_GEMINI: cfg.MODELO_GEMINI || 'gemini-flash-latest',
      HOJA_ORIGEN_ID: cfg.HOJA_ORIGEN_ID || '',
      CARPETA_FACTURAS_ORIGEN_ID: cfg.CARPETA_FACTURAS_ORIGEN_ID || '',
      geminiConfigurado: !!PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY'),
      baseDeDatosUrl: Db.ss().getUrl()
    };
  },

  guardarConfig: function (u, d) {
    exigirAdmin(u);
    return conBloqueo(function () {
      ['NOMBRE_NEGOCIO', 'METODOS_PAGO', 'UBICACION_POR_DEFECTO', 'MODELO_GEMINI', 'HOJA_ORIGEN_ID', 'CARPETA_FACTURAS_ORIGEN_ID'].forEach(function (k) {
        if (d[k] !== undefined) Db.guardarConfig(k, texto(d[k]));
      });
      // La clave de Gemini se guarda solo en el servidor (propiedades del script)
      if (d.GEMINI_API_KEY !== undefined) {
        var props = PropertiesService.getScriptProperties();
        if (texto(d.GEMINI_API_KEY)) props.setProperty('GEMINI_API_KEY', texto(d.GEMINI_API_KEY));
        else props.deleteProperty('GEMINI_API_KEY');
      }
      auditar(u, 'CONFIG_GUARDADA', Object.keys(d).filter(function (k) { return k !== 'GEMINI_API_KEY'; }).join(','));
      return Catalogo.config(u);
    });
  },

  auditoria: function (u) {
    exigirAdmin(u);
    return Db.leer('Auditoria').slice(-300).reverse().map(_limpio);
  }
};
