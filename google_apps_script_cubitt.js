/**
 * ============================================================================
 * CUBITT POS - SCRIPT DE CONEXIÓN BIDIRECCIONAL CON GOOGLE SHEETS
 * Base de Datos: 18a86QMObmZnX611SmtSBRLVIvZJRYHnqFSr5vFCBtIw (Hoja: ventas)
 * Columnas A a Q (17 Columnas):
 * A: Responsable | B: Cliente | C: Producto | D: Código | E: Modelo | F: Color
 * G: Foto | H: Fecha | I: Cantidad | J: Precio Unidad | K: Total
 * L..P: Pago 1 a Pago 5 | Q: Pendiente
 * ============================================================================
 */

const SPREADSHEET_ID = '18a86QMObmZnX611SmtSBRLVIvZJRYHnqFSr5vFCBtIw';
const SHEET_NAME_VENTAS = 'ventas';
const SHEET_NAME_GASTOS = 'gastos';
const SHEET_NAME_BDD = 'BDD';

function testConn() {
  const ss = SpreadsheetApp.getActiveSpreadsheet() || (SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : null);
  const sheet = ss.getSheetByName(SHEET_NAME_VENTAS) || ss.getSheets()[0];
  Logger.log("✅ Conexión Exitosa con Hoja: " + sheet.getName() + " (Filas: " + sheet.getLastRow() + ")");
  return "OK: " + sheet.getName();
}

function syncMomentopToBDD() {
  const ss = SpreadsheetApp.getActiveSpreadsheet() || (SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : null);
  return handleSyncBDD(ss, {}, null);
}

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) ? e.parameter.action : '';
    if (action === 'ping') {
      return jsonResponse({
        status: 'success',
        message: 'Conexión activa con Google Apps Script y hoja de cálculo Cubitt',
        timestamp: new Date().toISOString()
      }, e);
    }

    let ss = null;
    try {
      ss = SpreadsheetApp.getActiveSpreadsheet();
    } catch (err) {}
    if (!ss && SPREADSHEET_ID) {
      ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    }
    if (!ss) {
      ss = SpreadsheetApp.getActiveSpreadsheet();
    }

    if (action === 'repair_row_450') {
      return repairRow450(ss, e);
    }
    if (action === 'delete_sale') {
      return handleDeleteSale(ss, e.parameter || {}, e);
    }
    if (action === 'sync_bdd') {
      return handleSyncBDD(ss, e.parameter || {}, e);
    }

    let sheet = ss.getSheetByName(SHEET_NAME_VENTAS);
    if (!sheet) {
      const sheets = ss.getSheets();
      sheet = sheets.find(function(s) { return s.getName().toLowerCase().indexOf('venta') > -1; }) || sheets[0];
    }

    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();

    if (lastRow <= 1) {
      return jsonResponse({ status: 'success', data: [], sales: [], message: 'La hoja no tiene registros de datos.' }, e);
    }

    const headerRange = sheet.getRange(1, 1, 1, lastCol);
    const headers = headerRange.getValues()[0].map(function(h) { return (h || '').toString().trim(); });

    const dataRange = sheet.getRange(2, 1, lastRow - 1, lastCol);
    const values = dataRange.getValues();
    const notes = dataRange.getNotes();

    const salesList = [];
    const colResponsable = findColIndex(headers, ['responsable', 'vendedor', 'seller', 'asesor']);
    const colCliente = findColIndex(headers, ['cliente', 'client', 'comprador', 'nombre']);
    const colProducto = findColIndex(headers, ['producto', 'product', 'descripcion', 'artículo']);
    const colCodigo = findColIndex(headers, ['codigo', 'código', 'code', 'sku']);
    const colModelo = findColIndex(headers, ['modelo', 'model']);
    const colColor = findColIndex(headers, ['color', 'tono']);
    const colImagen = findColIndex(headers, ['imagen', 'image', 'foto', 'photo']);
    const colFecha = findColIndex(headers, ['fecha', 'date', 'dia']);
    const colCantidad = findColIndex(headers, ['cantidad', 'quantity', 'qty', 'cant']);
    const colPrecioUnidad = findColIndex(headers, ['precio unidad', 'precio unitario', 'unit price']);
    const colMonto = findColIndex(headers, ['total', 'monto total', 'importe', 'precio', 'monto']);
    const colCobrado = findColIndex(headers, ['pago 1', 'pago1', 'cobrado', 'pagado', 'paid', 'abono']);
    const colPendiente = findColIndex(headers, ['pendiente', 'saldo', 'pending', 'resta']);
    const colAlmacen = findColIndex(headers, ['almacen', 'almacén', 'sede', 'warehouse']);

    for (let r = 0; r < values.length; r++) {
      const row = values[r];
      const rowNotes = notes[r];
      const rowNumber = r + 2;

      const fechaRaw = colFecha >= 0 ? row[colFecha] : '';
      const codigoRaw = colCodigo >= 0 ? row[colCodigo] : '';
      const productoRaw = colProducto >= 0 ? row[colProducto] : '';
      const modeloRaw = colModelo >= 0 ? row[colModelo] : '';
      const colorRaw = colColor >= 0 ? row[colColor] : '';
      const imagenRaw = colImagen >= 0 ? row[colImagen] : '';
      const cantidadRaw = colCantidad >= 0 ? row[colCantidad] : 1;
      const precioUnidadRaw = colPrecioUnidad >= 0 ? row[colPrecioUnidad] : 0;
      const montoRaw = colMonto >= 0 ? row[colMonto] : 0;
      const cobradoRaw = colCobrado >= 0 ? row[colCobrado] : 0;
      const pendienteRaw = colPendiente >= 0 ? row[colPendiente] : 0;
      const vendedorRaw = colResponsable >= 0 ? row[colResponsable] : '';
      const clienteRaw = colCliente >= 0 ? row[colCliente] : '';
      const almacenRaw = colAlmacen >= 0 ? row[colAlmacen] : 'barquisimeto_trinitarias';

      const montoNote = colMonto >= 0 ? (rowNotes[colMonto] || '') : '';
      const paymentDates = parsePaymentDatesFromComment(montoNote);

      if (!fechaRaw && !productoRaw && !montoRaw) continue;

      const totalNum = parseFloat(montoRaw) || 0;
      const cobradoNum = parseFloat(cobradoRaw) || 0;
      const parsedPend = parseFloat(pendienteRaw);
      const pendienteNum = (!isNaN(parsedPend) && pendienteRaw !== '') ? parsedPend : Math.max(0, totalNum - cobradoNum);

      salesList.push({
        rowNumber: rowNumber,
        date: formatDateOutput(fechaRaw),
        productCode: (codigoRaw || '').toString().trim(),
        productName: (productoRaw || '').toString().trim(),
        model: (modeloRaw || '').toString().trim(),
        color: (colorRaw || '').toString().trim(),
        quantity: parseInt(cantidadRaw) || 1,
        unitPrice: parseFloat(precioUnidadRaw) || 0,
        image: (imagenRaw || '').toString().trim(),
        totalAmount: totalNum,
        collectedAmount: cobradoNum,
        pendingAmount: pendienteNum,
        seller: (vendedorRaw || '').toString().trim(),
        responsable: (vendedorRaw || '').toString().trim(),
        client: (clienteRaw || '').toString().trim(),
        warehouse: (almacenRaw || '').toString().trim(),
        paymentDatesComment: montoNote,
        installments: paymentDates,
        status: pendienteNum > 0 ? 'pendiente' : 'pagado'
      });
    }

    return jsonResponse({
      status: 'success',
      spreadsheetId: ss.getId(),
      sheetName: sheet.getName(),
      totalRecords: salesList.length,
      lastSync: new Date().toISOString(),
      sales: salesList
    }, e);
  } catch (error) {
    return jsonResponse({
      status: 'error',
      message: error.toString()
    }, e);
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (lockErr) {}

  try {
    let payload = {};
    if (e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    } else if (e.parameter) {
      payload = e.parameter;
    }

    const action = payload.action || 'add_sale';
    const ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();

    if (action === 'add_sale' || action === 'create_sale') {
      return handleAddSale(ss, payload, e);
    } else if (action === 'repair_row_450') {
      return repairRow450(ss, e);
    } else if (action === 'add_abono' || action === 'update_sale') {
      return handleUpdateAbono(ss, payload, e);
    } else if (action === 'delete_sale') {
      return handleDeleteSale(ss, payload, e);
    } else if (action === 'update_client') {
      return handleUpdateClient(ss, payload, e);
    } else if (action === 'add_expense') {
      return handleAddExpense(ss, payload, e);
    } else if (action === 'sync_bdd') {
      return handleSyncBDD(ss, payload, e);
    } else {
      return jsonResponse({ status: 'error', message: 'Acción no reconocida: ' + action }, e);
    }
  } catch (error) {
    return jsonResponse({ status: 'error', message: error.toString() }, e);
  } finally {
    try {
      lock.releaseLock();
    } catch (re) {}
  }
}

function resolveSheetProductLine(code, name, lineHint) {
  var uc = (code || '').toString().trim().toUpperCase();
  var un = (name || '').toString().trim().toUpperCase();
  var ul = (lineHint || '').toString().trim().toUpperCase();

  // Normalizar sinónimos directos hacia los 26 nombres exactos de la regla de validación en Columna C
  if (ul === 'HYDRO BOTTLE' || ul === 'WATER BOTTLE' || ul === 'HYDRO') return 'HYDRO';
  if (ul === 'TUMBLER' || ul === 'TUMBLR') {
    if (uc.indexOf('TUMBS') > -1 || un.indexOf('MINI') > -1) return 'TUMBLR MINI';
    return 'TUMBLR';
  }
  if (ul === 'TUMBLER MINI' || ul === 'TUMBLR MINI') return 'TUMBLR MINI';

  // Detección exacta por SKU oficial de la hoja Ventas
  if (uc.indexOf('CT-AURAP2') === 0 || un.indexOf('AURA 2 PRO') > -1 || un.indexOf('AURA PRO 2') > -1) return 'AURA 2 PRO';
  if (uc.indexOf('CT-AURA') === 0 || un.indexOf('AURA 2') > -1 || un.indexOf('AURA') > -1) return 'AURA 2';
  if (uc.indexOf('CT-VIVAP2') === 0 || un.indexOf('VIVA 2 PRO') > -1 || un.indexOf('VIVA PRO 2') > -1) return 'VIVA 2 PRO';
  if (uc.indexOf('CT-VIVA2') === 0 || un.indexOf('VIVA 2') > -1) return 'VIVA 2';
  if (uc.indexOf('CT-TERRA') === 0 || un.indexOf('TERRA') > -1) return 'TERRA';
  if (uc.indexOf('CTJR-') === 0 || uc.indexOf('CTHR-') === 0 || un.indexOf('RELOJ JR') > -1 || un.indexOf('HERO') > -1) return 'RELOJ JR';
  if (un.indexOf('CASIO') > -1) return 'RELOJ CASIO';
  if (uc.indexOf('CTBJ-') === 0 || ul === 'JR') return 'JR';
  if (uc.indexOf('CT-COF') === 0 || un.indexOf('COFFEE MUG') > -1 || ul === 'COFFEE MUG') return 'COFFEE MUG';
  if (uc.indexOf('CT-TUMBS') === 0 || un.indexOf('TUMBLR MINI') > -1 || un.indexOf('TUMBLER MINI') > -1) return 'TUMBLR MINI';
  if (uc.indexOf('CT-TUMB') === 0 || uc.indexOf('TM') === 0 || un.indexOf('TUMBL') > -1) return 'TUMBLR';
  if (uc.indexOf('CTHB') === 0 || uc.indexOf('WB') === 0 || uc.indexOf('LWBT') === 0 || uc.indexOf('KWB') === 0 || un.indexOf('HYDRO') > -1 || un.indexOf('WATER BOTTLE') > -1) return 'HYDRO';
  if (uc.indexOf('CTBPK') === 0 || uc.indexOf('LBC') === 0 || un.indexOf('BACKPACK') > -1 || ul === 'BACKPACK') return 'BACKPACK';
  if (uc.indexOf('CTBLT') === 0 || uc.indexOf('CTSB') === 0 || un.indexOf('BELT BAG') > -1 || un.indexOf('SPORTBELT') > -1 || ul === 'BELT BAG') return 'BELT BAG';
  if (uc.indexOf('CTDUF') === 0 || uc.indexOf('CTDFL') === 0 || un.indexOf('DUFFLE') > -1 || ul === 'DUFFLE BAG') return 'DUFFLE BAG';
  if (uc.indexOf('CT-TOTE') === 0 || uc.indexOf('CTTOT') === 0 || un.indexOf('TOTE') > -1 || ul === 'TOTE BAG') return 'TOTE BAG';
  if (uc.indexOf('CT-PWANCL') === 0 || un.indexOf('HEADPHONES LITE') > -1 || ul === 'POWER HEADPHONES LITE') return 'POWER HEADPHONES LITE';
  if (uc.indexOf('CT-PWANC') === 0 || un.indexOf('POWER HEADPHONES') > -1 || ul === 'POWER HEADPHONES') return 'POWER HEADPHONES';
  if (uc.indexOf('CT-PWEP') === 0 || un.indexOf('EARBUDS PRO') > -1 || ul === 'EARBUDS PRO') return 'EARBUDS PRO';
  if (uc.indexOf('CT-PWOE') === 0 || un.indexOf('OPEN-EAR') > -1 || un.indexOf('OPEN EAR') > -1 || ul === 'OPEN-EAR EARBUDS') return 'OPEN-EAR EARBUDS';
  if (uc.indexOf('CTCAP') === 0 || un.indexOf('GORRA') > -1 || un.indexOf('CAP ') > -1 || ul === 'GORRA') return 'GORRA';
  if (uc.indexOf('CTSC-') === 0 || un.indexOf('SCRUNCHIE') > -1 || ul === 'SCRUNCHIES') return 'SCRUNCHIES';
  if (uc.indexOf('BASE-') === 0 || un.indexOf('PROTECTOR SILICON') > -1 || un.indexOf('SILICONE') > -1 || ul === 'PROTECTOR SILICON') return 'PROTECTOR SILICON';
  if (uc.indexOf('CUBRE-') === 0 || un.indexOf('CUBRE PITILLO') > -1 || ul === 'CUBRE PITILLO') return 'CUBRE PITILLO';
  if (uc.indexOf('CTSP-') === 0 || un.indexOf('PROTECTOR PANTALLA') > -1 || un.indexOf('SCREEN PROTECTOR') > -1 || ul === 'PROTECTOR PANTALLA') return 'PROTECTOR PANTALLA';
  if (uc.indexOf('S22R') === 0 || uc.indexOf('S20R') === 0 || un.indexOf('CORREA') > -1 || un.indexOf('STRAP') > -1 || ul === 'CORREA') return 'CORREA';

  return ul || 'HYDRO';
}

function handleAddSale(ss, payload, e) {
  let sheet = ss.getSheetByName(SHEET_NAME_VENTAS);
  if (!sheet) sheet = ss.getSheets()[0];
  const lastCol = Math.max(sheet.getLastColumn(), 17);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) {
    return (h || '').toString().trim();
  });

  const colResponsable = findColIndex(headers, ['responsable', 'vendedor', 'seller', 'asesor']);
  const colCliente = findColIndex(headers, ['cliente', 'client', 'comprador', 'nombre']);
  const colProducto = findColIndex(headers, ['producto', 'product', 'descripcion', 'artículo']);
  const colCodigo = findColIndex(headers, ['codigo', 'código', 'code', 'sku']);
  const colModelo = findColIndex(headers, ['modelo', 'model', 'variante']);
  const colColor = findColIndex(headers, ['color', 'tono']);
  const colFoto = findColIndex(headers, ['foto', 'imagen', 'image', 'photo']);
  const colFecha = findColIndex(headers, ['fecha', 'date', 'dia']);
  const colCantidad = findColIndex(headers, ['cantidad', 'quantity', 'cant', 'qty']);
  const colPrecioUnidad = findColIndex(headers, ['precio unidad', 'precio unitario', 'unit price']);
  const colTotal = findColIndex(headers, ['total', 'monto total', 'importe', 'precio', 'monto']);
  const colPago1 = findColIndex(headers, ['pago 1', 'pago1', 'abono 1']);
  const colPago2 = findColIndex(headers, ['pago 2', 'pago2', 'abono 2']);
  const colPago3 = findColIndex(headers, ['pago 3', 'pago3', 'abono 3']);
  const colPago4 = findColIndex(headers, ['pago 4', 'pago4', 'abono 4']);
  const colPago5 = findColIndex(headers, ['pago 5', 'pago5', 'abono 5']);
  const colPendiente = findColIndex(headers, ['pendiente', 'saldo', 'pending', 'resta']);

  const cResp = colResponsable >= 0 ? colResponsable : 0;
  const cCli = colCliente >= 0 ? colCliente : 1;
  const cProd = colProducto >= 0 ? colProducto : 2;
  const cCod = colCodigo >= 0 ? colCodigo : 3;
  const cMod = colModelo >= 0 ? colModelo : 4;
  const cCol = colColor >= 0 ? colColor : 5;
  const cFoto = colFoto >= 0 ? colFoto : 6;
  const cFec = colFecha >= 0 ? colFecha : 7;
  const cCant = colCantidad >= 0 ? colCantidad : 8;
  const cPU = colPrecioUnidad >= 0 ? colPrecioUnidad : 9;
  const cTot = colTotal >= 0 ? colTotal : 10;
  const cP1 = colPago1 >= 0 ? colPago1 : 11;
  const cP2 = colPago2 >= 0 ? colPago2 : 12;
  const cP3 = colPago3 >= 0 ? colPago3 : 13;
  const cP4 = colPago4 >= 0 ? colPago4 : 14;
  const cP5 = colPago5 >= 0 ? colPago5 : 15;
  const cPend = colPendiente >= 0 ? colPendiente : 16;

  const numCols = lastCol;

  // Expandir la venta en unidades individuales (1 fila por unidad, tal como está en la hoja Ventas)
  const rawQty = Math.max(1, parseInt(payload.quantity, 10) || 1);
  const rawTotal = Number(payload.totalAmount) || Number(payload.total) || 0;
  const unitPriceVal = Number(payload.unitPrice) || (rawQty > 0 ? (rawTotal / rawQty) : rawTotal);
  const isContado = (payload.paymentType || '').toLowerCase() === 'contado';
  const totalCobrado = Number(payload.collectedAmount) !== undefined && !isNaN(Number(payload.collectedAmount))
    ? Number(payload.collectedAmount)
    : (Number(payload.creditPaid) || (isContado ? rawTotal : 0));

  let remainingCobrado = totalCobrado;
  const insertedRows = [];

  for (let u = 0; u < rawQty; u++) {
    const lastRow = sheet.getLastRow();

    // 1. Localizar la fila de Totales para insertar justo debajo de la última venta
    const scanRows = Math.min(lastRow, 650);
    const scanCols = Math.min(numCols, 17);
    const checkValues = sheet.getRange(1, 1, scanRows, scanCols).getValues();
    const checkFormulas = sheet.getRange(1, 1, scanRows, scanCols).getFormulas();

    let totalRow = -1;
    let lastValidSaleRow = 1;
    for (let r = 1; r < scanRows; r++) {
      const rowNum = r + 1;
      const fTot = (cTot < scanCols && checkFormulas[r][cTot] ? checkFormulas[r][cTot] : '').toString().toUpperCase();
      const fPend = (cPend < scanCols && checkFormulas[r][cPend] ? checkFormulas[r][cPend] : '').toString().toUpperCase();
      const vCol1 = (checkValues[r][0] || '').toString().trim().toUpperCase();
      const vCol2 = (checkValues[r][1] || '').toString().trim().toUpperCase();
      const vProd = cProd < scanCols && checkValues[r][cProd] ? checkValues[r][cProd].toString().trim().toUpperCase() : '';
      const vCod = cCod < scanCols && checkValues[r][cCod] ? checkValues[r][cCod].toString().trim().toUpperCase() : '';
      const valTot = cTot < scanCols ? parseNumber(checkValues[r][cTot]) : 0;

      if (
        fTot.indexOf('SUM') > -1 ||
        fTot.indexOf('SUMA') > -1 ||
        fTot.indexOf('SUBTOTAL') > -1 ||
        fPend.indexOf('SUM') > -1 ||
        fPend.indexOf('SUMA') > -1 ||
        vCol1.indexOf('TOTAL') > -1 ||
        vCol2.indexOf('TOTAL') > -1 ||
        vProd.indexOf('TOTAL') > -1 ||
        (valTot >= 5000 && !vProd && !vCod && !vCol2)
      ) {
        totalRow = rowNum;
        break;
      }

      if ((vProd || vCod) && valTot > 0 && valTot < 5000) {
        lastValidSaleRow = rowNum;
      }
    }

    if (totalRow < 2) {
      totalRow = lastValidSaleRow > 1 ? lastValidSaleRow + 1 : lastRow + 1;
    }

    const insertRow = totalRow;
    const sourceRow = Math.max(2, totalRow - 1);

    // 2. Insertar nueva fila antes de Totales
    sheet.insertRowBefore(insertRow);

    // 3. COPIAR FORMATO Y REGLAS DE VALIDACIÓN DE LA FILA ANTERIOR
    const sourceRange = sheet.getRange(sourceRow, 1, 1, numCols);
    const targetRange = sheet.getRange(insertRow, 1, 1, numCols);

    targetRange.clearContent();
    sourceRange.copyTo(targetRange, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    targetRange.setNumberFormats(sourceRange.getNumberFormats());

    try {
      targetRange.setDataValidations(sourceRange.getDataValidations());
    } catch (e) {}

    try {
      sheet.setRowHeight(insertRow, sheet.getRowHeight(sourceRow) || 32);
    } catch (e) {}

    try {
      const prevPrev = sourceRow - 1;
      if (prevPrev >= 2) {
        targetRange.setBackgrounds(sheet.getRange(prevPrev, 1, 1, numCols).getBackgrounds());
      }
    } catch (e) {}

    // 4. Montos individuales para esta unidad (Cantidad = 1 por fila)
    const rowTotal = Math.round(unitPriceVal * 100) / 100;
    let rowCobrado = 0;
    if (isContado) {
      rowCobrado = rowTotal;
    } else if (remainingCobrado > 0) {
      rowCobrado = (u === rawQty - 1) ? Math.min(rowTotal, Math.round(remainingCobrado * 100) / 100) : Math.min(rowTotal, Math.round((totalCobrado / rawQty) * 100) / 100);
      remainingCobrado = Math.max(0, remainingCobrado - rowCobrado);
    }
    const rowPendiente = Math.max(0, Math.round((rowTotal - rowCobrado) * 100) / 100);

    // A. Responsable (Col A) - Coincidencia exacta con la regla de validación de datos de la Columna A
    let rawSeller = (payload.seller || payload.responsable || '').toString().trim().toUpperCase();
    if (!rawSeller || rawSeller === 'TIENDA PRINCIPAL' || rawSeller === 'ADMIN' || rawSeller === 'GERENCIA' || rawSeller === 'GENERAL') {
      rawSeller = 'JENNIFER';
    }
    const officialSellers = [
      'JENNIFER', 'JESUS', 'FABIOLA', 'TANIA', 'BULL', 'CASHEA',
      'TABATHA', 'SARA', 'FABIOLA PAOLA', 'VERUSKA', 'MARIELA', 'KLEIVER', 'ZULMI', 'PEDRO', 'PAOLA'
    ];
    const cellResp = sheet.getRange(insertRow, cResp + 1);
    const matchedSeller = matchValidationValue(cellResp, rawSeller, officialSellers, sheet, cResp + 1);
    cellResp.setValue(matchedSeller);

    // B. Cliente (Col B)
    const clientName = (payload.client || payload.clientName || 'CLIENTE GENERAL').toString().trim().toUpperCase();
    sheet.getRange(insertRow, cCli + 1).setValue(clientName);

    // C. Producto (Col C) - Coincidencia exacta con la regla de validación de datos de la Columna C
    const codeVal = (payload.productCode || payload.code || '').toString().trim().toUpperCase();
    const rawNameVal = (payload.productName || payload.description || '').toString().trim();
    const prodLine = resolveSheetProductLine(codeVal, rawNameVal, payload.productLine || payload.category);
    const officialLines = [
      'HYDRO', 'COFFEE MUG', 'JR', 'TUMBLR', 'TUMBLR MINI', 'BACKPACK', 'EARBUDS PRO',
      'SCRUNCHIES', 'PROTECTOR SILICON', 'POWER HEADPHONES', 'POWER HEADPHONES LITE',
      'OPEN-EAR EARBUDS', 'GORRA', 'VIVA 2', 'VIVA 2 PRO', 'TERRA', 'CUBRE PITILLO',
      'BELT BAG', 'AURA 2 PRO', 'AURA 2', 'PROTECTOR PANTALLA', 'DUFFLE BAG',
      'CORREA', 'RELOJ JR', 'RELOJ CASIO', 'TOTE BAG'
    ];
    const cellProd = sheet.getRange(insertRow, cProd + 1);
    const matchedProdLine = matchValidationValue(cellProd, prodLine, officialLines, sheet, cProd + 1);
    cellProd.setValue(matchedProdLine);

    // D. Código (Col D)
    sheet.getRange(insertRow, cCod + 1).setValue(codeVal);

    // E. Modelo (Col E)
    let modeloVal = (payload.modelo || payload.model || '').toString().trim().toUpperCase();
    if (!modeloVal) {
      let cleanM = rawNameVal.toUpperCase();
      const stopWords = ['SMARTWATCH', 'RELOJ INTELIGENTE', 'BELT BAG', 'BACKPACK', 'VIVA 2 PRO', 'VIVA 2', 'AURA 2 PRO', 'AURA 2', 'AURA', 'HERO', 'CUBITT', 'TOTE BAG', 'DUFFLE BAG', 'HYDRO BOTTLE', 'TUMBLER', 'COFFEE MUG'];
      for (let sw = 0; sw < stopWords.length; sw++) {
        cleanM = cleanM.replace(new RegExp(stopWords[sw], 'g'), ' ');
      }
      modeloVal = cleanM.replace(/\s+/g, ' ').trim() || codeVal;
    }
    sheet.getRange(insertRow, cMod + 1).setValue(modeloVal);

    // F. Color (Col F)
    let colorVal = (payload.color || '').toString().trim().toUpperCase();
    if (!colorVal) {
      const comb = (modeloVal + ' ' + rawNameVal).toUpperCase();
      if (comb.indexOf('OBSIDIAN BLACK') > -1 || comb.indexOf('BLACK') > -1 || comb.indexOf('NEGRO') > -1) colorVal = 'NEGRO';
      else if (comb.indexOf('DEEPEST BLUE') > -1 || comb.indexOf('NAVY') > -1) colorVal = 'AZUL MARINO';
      else if (comb.indexOf('SMOKE BLUE') > -1 || comb.indexOf('LIGHT BLUE') > -1 || comb.indexOf('BLUE') > -1 || comb.indexOf('AZUL') > -1) colorVal = 'AZUL';
      else if (comb.indexOf('OLIVE') > -1 || comb.indexOf('GREEN') > -1 || comb.indexOf('VERDE') > -1) colorVal = 'VERDE';
      else if (comb.indexOf('BEIGE') > -1 || comb.indexOf('SAND') > -1) colorVal = 'BEIGE';
      else if (comb.indexOf('ROSE GOLD') > -1) colorVal = 'ROSE GOLD';
      else if (comb.indexOf('PINK') > -1 || comb.indexOf('ROSADO') > -1) colorVal = 'ROSADO';
      else if (comb.indexOf('PURPLE') > -1 || comb.indexOf('MORADO') > -1) colorVal = 'MORADO';
      else if (comb.indexOf('WHITE') > -1 || comb.indexOf('BLANCO') > -1) colorVal = 'BLANCO';
      else if (comb.indexOf('GREY') > -1 || comb.indexOf('GRAY') > -1 || comb.indexOf('GRIS') > -1) colorVal = 'GRIS';
      else colorVal = 'NEGRO';
    }
    sheet.getRange(insertRow, cCol + 1).setValue(colorVal);

    // G. Foto (Col G)
    let imgUrl = (payload.image || '').toString().trim();
    if (imgUrl.indexOf('http://') !== 0 && imgUrl.indexOf('https://') !== 0) {
      imgUrl = getPublicCdnImage(codeVal);
    }
    const photoCell = sheet.getRange(insertRow, cFoto + 1);
    photoCell.clearContent();
    if (imgUrl && (imgUrl.indexOf('http://') === 0 || imgUrl.indexOf('https://') === 0)) {
      try {
        const cImg = SpreadsheetApp.newCellImage().setSourceUrl(imgUrl).setAltTextTitle(codeVal || 'Cubitt').build();
        photoCell.setValue(cImg);
      } catch (eImg) {
        photoCell.setFormula('=IMAGE("' + imgUrl + '", 1)');
      }
    } else {
      photoCell.setValue('');
    }

    // H. Fecha (Col H)
    let dateStr = payload.date || Utilities.formatDate(new Date(), 'GMT-4', 'dd/MM/yyyy');
    if (dateStr.indexOf('-') > -1) {
      const dp = dateStr.split('-');
      if (dp.length === 3 && dp[0].length === 4) {
        dateStr = dp[2] + '/' + dp[1] + '/' + dp[0];
      }
    }
    const fCell = sheet.getRange(insertRow, cFec + 1);
    fCell.setValue(dateStr);
    fCell.setNumberFormat('dd/MM/yyyy');
    fCell.setHorizontalAlignment('center');

    // I. Cantidad (Col I) -> Siempre 1 unidad por fila individual
    const qCell = sheet.getRange(insertRow, cCant + 1);
    qCell.setValue(1);
    qCell.setNumberFormat('0');
    qCell.setHorizontalAlignment('center');

    // J. Precio Unidad (Col J)
    const puCell = sheet.getRange(insertRow, cPU + 1);
    puCell.setValue(rowTotal);
    puCell.setNumberFormat('$#,##0.00');
    puCell.setHorizontalAlignment('right');

    // K. Total (Col K)
    const totCell = sheet.getRange(insertRow, cTot + 1);
    totCell.setValue(rowTotal);
    totCell.setNumberFormat('$#,##0.00');
    totCell.setHorizontalAlignment('right');

    // L. Pago 1 (Col L)
    const p1Cell = sheet.getRange(insertRow, cP1 + 1);
    p1Cell.setValue(rowCobrado);
    p1Cell.setNumberFormat('$#,##0.00');
    p1Cell.setHorizontalAlignment('right');

    // M..P. Pagos 2 a 5
    if (cP2 < numCols) sheet.getRange(insertRow, cP2 + 1).setValue('');
    if (cP3 < numCols) sheet.getRange(insertRow, cP3 + 1).setValue('');
    if (cP4 < numCols) sheet.getRange(insertRow, cP4 + 1).setValue('');
    if (cP5 < numCols) sheet.getRange(insertRow, cP5 + 1).setValue('');

    // Q. Pendiente (Col Q)
    const pendCell = sheet.getRange(insertRow, cPend + 1);
    pendCell.setValue(rowPendiente);
    pendCell.setNumberFormat('$#,##0.00');
    pendCell.setHorizontalAlignment('right');

    // Tipografía Oficial Roboto 10pt con alineación vertical al medio
    targetRange.setFontFamily('Roboto');
    targetRange.setFontSize(10);
    targetRange.setVerticalAlignment('middle');

    // Comentario de cuotas / notas
    if (payload.paymentDatesComment) {
      totCell.setNote(payload.paymentDatesComment);
    }

    // 5. Actualizar la fórmula =SUM(...) en la fila de Totales
    const shiftedTotalRow = insertRow + 1;
    for (let c = 1; c <= numCols; c++) {
      const tCell = sheet.getRange(shiftedTotalRow, c);
      const existingFormula = tCell.getFormula();
      if (existingFormula && existingFormula.toUpperCase().indexOf('SUM') > -1) {
        if (existingFormula.toUpperCase().indexOf('TABLA_1') === -1) {
          const colLetter = getColumnLetter(c);
          tCell.setFormula('=SUM(' + colLetter + '2:' + colLetter + insertRow + ')');
        }
      }
    }

    insertedRows.push(insertRow);
  }

  return jsonResponse({
    status: 'success',
    message: 'Venta registrada individualmente en fila(s) ' + insertedRows.join(', '),
    row: insertedRows[0],
    rows: insertedRows,
    saleId: payload.id || ('ROW-' + insertedRows[0])
  }, e);
}

function repairRow450(ss, e) {
  if (!ss) {
    ss = SpreadsheetApp.getActiveSpreadsheet() || (SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : null);
  }
  const sheet = ss.getSheetByName(SHEET_NAME_VENTAS) || ss.getSheets()[0];
  const row = 450;
  if (sheet.getLastRow() < row) {
    return jsonResponse({ status: 'error', message: 'La fila 450 no existe en la hoja.' }, e);
  }

  const cellA = sheet.getRange(row, 1);
  const matchedSeller = matchValidationValue(cellA, 'JESUS', ['JENNIFER', 'ZULMI', 'JESUS', 'FABIOLA', 'TANIA', 'BULL', 'CASHEA', 'TABATHA', 'SARA', 'VERUSKA', 'MARIELA', 'KLEIVER', 'PEDRO', 'FABIOLA PAOLA', 'PAOLA'], sheet, 1);
  cellA.setValue(matchedSeller);

  sheet.getRange(row, 2).setValue('JESUS PALMA');

  const cellC = sheet.getRange(row, 3);
  const matchedProd = matchValidationValue(cellC, 'BELT BAG', ['HYDRO', 'COFFEE MUG', 'JR', 'TUMBLR', 'TUMBLR MINI', 'BACKPACK', 'EARBUDS PRO', 'SCRUNCHIES', 'PROTECTOR SILICON', 'POWER HEADPHONES', 'POWER HEADPHONES LITE', 'OPEN-EAR EARBUDS', 'GORRA', 'VIVA 2', 'VIVA 2 PRO', 'TERRA', 'CUBRE PITILLO', 'BELT BAG', 'AURA 2 PRO', 'AURA 2', 'PROTECTOR PANTALLA', 'DUFFLE BAG', 'CORREA', 'RELOJ JR', 'RELOJ CASIO', 'TOTE BAG'], sheet, 3);
  cellC.setValue(matchedProd);

  sheet.getRange(row, 4).setValue('CTBLT-1');
  sheet.getRange(row, 5).setValue('OBSIDIAN BLACK');
  sheet.getRange(row, 6).setValue('NEGRO');

  const photoCell = sheet.getRange(row, 7);
  photoCell.clearContent();
  const beltBagImg = 'https://cdn.shopify.com/s/files/1/0279/6424/4068/files/CTBLT-1.webp?v=1750457388';
  try {
    const cImg = SpreadsheetApp.newCellImage().setSourceUrl(beltBagImg).setAltTextTitle('CTBLT-1').build();
    photoCell.setValue(cImg);
  } catch (err) {
    photoCell.setFormula('=IMAGE("' + beltBagImg + '", 1)');
  }

  const fCell = sheet.getRange(row, 8);
  fCell.setValue('08/10/2026');
  fCell.setNumberFormat('dd/MM/yyyy');
  fCell.setHorizontalAlignment('center');

  const qCell = sheet.getRange(row, 9);
  qCell.setValue(1);
  qCell.setNumberFormat('0');
  qCell.setHorizontalAlignment('center');

  const puCell = sheet.getRange(row, 10);
  puCell.setValue(25.00);
  puCell.setNumberFormat('$#,##0.00');
  puCell.setHorizontalAlignment('right');

  const totCell = sheet.getRange(row, 11);
  totCell.setValue(25.00);
  totCell.setNumberFormat('$#,##0.00');
  totCell.setHorizontalAlignment('right');

  const p1Cell = sheet.getRange(row, 12);
  p1Cell.setValue(25.00);
  p1Cell.setNumberFormat('$#,##0.00');
  p1Cell.setHorizontalAlignment('right');

  const pendCell = sheet.getRange(row, 17);
  pendCell.setValue(0.00);
  pendCell.setNumberFormat('$#,##0.00');
  pendCell.setHorizontalAlignment('right');

  const range450 = sheet.getRange(row, 1, 1, 17);
  range450.setFontFamily('Roboto');
  range450.setFontSize(10);
  range450.setVerticalAlignment('middle');

  return jsonResponse({
    status: 'success',
    message: 'Fila 450 reparada exitosamente con toda la información y formatos.'
  }, e);
}

function normalizeValidationToken(str) {
  return (str || '')
    .toString()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function matchValidationValue(cell, targetVal, fallbackList, sheet, colOneBased) {
  var normTarget = normalizeValidationToken(targetVal);
  if (normTarget === 'HYDRO BOTTLE' || normTarget === 'WATER BOTTLE') normTarget = 'HYDRO';
  if (normTarget === 'TUMBLER') normTarget = 'TUMBLR';
  if (normTarget === 'TUMBLER MINI') normTarget = 'TUMBLR MINI';

  try {
    var rule = cell ? cell.getDataValidation() : null;
    if (!rule && sheet && colOneBased) {
      var maxCheck = Math.min(sheet.getLastRow(), 40);
      if (maxCheck >= 2) {
        var colRules = sheet.getRange(2, colOneBased, maxCheck - 1, 1).getDataValidations();
        for (var r = 0; r < colRules.length; r++) {
          if (colRules[r][0]) {
            rule = colRules[r][0];
            try {
              if (cell) cell.setDataValidation(rule);
            } catch (eSet) {}
            break;
          }
        }
      }
    }

    if (rule) {
      var criteriaVals = rule.getCriteriaValues();
      if (criteriaVals && criteriaVals.length > 0) {
        var options = [];
        if (Array.isArray(criteriaVals[0])) {
          options = criteriaVals[0];
        } else if (criteriaVals[0] && typeof criteriaVals[0].getValues === 'function') {
          options = criteriaVals[0].getValues().flat();
        }
        // 1. Coincidencia exacta (ignorando tildes/mayúsculas pero devolviendo el texto exacto de la regla)
        for (var i = 0; i < options.length; i++) {
          var rawOpt = (options[i] || '').toString();
          var trimOpt = rawOpt.trim();
          if (!trimOpt) continue;
          if (normalizeValidationToken(trimOpt) === normTarget) {
            return rawOpt;
          }
        }
        // 2. Coincidencia parcial segura
        for (var j = 0; j < options.length; j++) {
          var rawOpt2 = (options[j] || '').toString();
          var trimOpt2 = rawOpt2.trim();
          if (!trimOpt2) continue;
          var normOpt2 = normalizeValidationToken(trimOpt2);
          if (normOpt2.indexOf(normTarget) > -1 || normTarget.indexOf(normOpt2) > -1) {
            return rawOpt2;
          }
        }
      }
    }
  } catch (err) {}

  if (fallbackList && fallbackList.length > 0) {
    for (var k = 0; k < fallbackList.length; k++) {
      if (normalizeValidationToken(fallbackList[k]) === normTarget) {
        return fallbackList[k];
      }
    }
    for (var m = 0; m < fallbackList.length; m++) {
      var normFb = normalizeValidationToken(fallbackList[m]);
      if (normFb.indexOf(normTarget) > -1 || normTarget.indexOf(normFb) > -1) {
        return fallbackList[m];
      }
    }
    return fallbackList[0];
  }
  return targetVal;
}

function getPublicCdnImage(code) {
  var c = (code || '').toString().trim().toUpperCase();
  var map = {
    'CTBLT-1': 'https://cdn.shopify.com/s/files/1/0279/6424/4068/files/CTBLT-1.webp?v=1750457388',
    'CTBLT-2': 'https://cdn.shopify.com/s/files/1/0279/6424/4068/files/CTBLT-2.webp?v=1754673276',
    'CTBLT-3': 'https://cdn.shopify.com/s/files/1/0279/6424/4068/files/CTBLT-3a.webp?v=1773070881',
    'CTBLT-4': 'https://cdn.shopify.com/s/files/1/0279/6424/4068/files/CTBLT-4.webp?v=1754673276',
    'CTBPK-1': 'https://cdn.shopify.com/s/files/1/0279/6424/4068/files/CTBPK-1.webp',
    'CTBPK-2': 'https://cdn.shopify.com/s/files/1/0279/6424/4068/files/CTBPK-2.webp',
    'CT-VIVA2-1': 'https://cdn.shopify.com/s/files/1/0279/6424/4068/files/CT-VIVA2-1.webp',
    'CT-VIVA2-2': 'https://cdn.shopify.com/s/files/1/0279/6424/4068/files/CT-VIVA2-2.webp',
    'CT-VIVAP2-1': 'https://cdn.shopify.com/s/files/1/0279/6424/4068/files/CT-VIVAP2-1.webp',
    'CT-VIVAP2-2': 'https://cdn.shopify.com/s/files/1/0279/6424/4068/files/CT-VIVAP2-2.webp',
    'CT-AURA-1': 'https://cdn.shopify.com/s/files/1/0279/6424/4068/files/CT-AURA-1.webp',
    'CT-AURA2-1': 'https://cdn.shopify.com/s/files/1/0279/6424/4068/files/CT-AURA2-1.webp'
  };
  if (map[c]) return map[c];
  if (c) return 'https://raw.githubusercontent.com/jsusd/appcubitt/main/images/' + c + '.jpg';
  return '';
}

function getColumnLetter(columnNumber) {
  let temp, letter = '';
  while (columnNumber > 0) {
    temp = (columnNumber - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    columnNumber = Math.floor((columnNumber - temp - 1) / 26);
  }
  return letter;
}

function handleUpdateAbono(ss, payload, e) {
  let sheet = ss.getSheetByName(SHEET_NAME_VENTAS);
  if (!sheet) sheet = ss.getSheets()[0];
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(h) { return (h || '').toString().trim(); });
  const colResponsable = findColIndex(headers, ['responsable', 'vendedor', 'seller', 'asesor']);
  const colCliente = findColIndex(headers, ['cliente', 'client', 'comprador', 'nombre']);
  const colCantidad = findColIndex(headers, ['cantidad', 'quantity', 'cant', 'qty']);
  const colPrecioUnidad = findColIndex(headers, ['precio unidad', 'precio unitario', 'unit price']);
  const colMonto = findColIndex(headers, ['total', 'monto', 'precio']);
  const colCobrado = findColIndex(headers, ['pago 1', 'cobrado', 'pagado', 'paid', 'abono']);
  const colPendiente = findColIndex(headers, ['pendiente', 'saldo', 'pending']);

  const rowNumber = parseInt(payload.rowNumber);
  if (rowNumber > 1 && rowNumber <= sheet.getLastRow()) {
    if (colCliente >= 0 && payload.client) {
      sheet.getRange(rowNumber, colCliente + 1).setValue(payload.client.toString().trim().toUpperCase());
    }
    if (colResponsable >= 0 && payload.seller) {
      const cellA = sheet.getRange(rowNumber, colResponsable + 1);
      const matched = matchValidationValue(cellA, payload.seller, ['JENNIFER', 'ZULMI', 'JESUS', 'FABIOLA', 'TANIA', 'BULL', 'CASHEA', 'TABATHA', 'SARA', 'VERUSKA', 'MARIELA', 'KLEIVER', 'PEDRO', 'FABIOLA PAOLA', 'PAOLA']);
      cellA.setValue(matched);
    }
    if (colCantidad >= 0 && payload.quantity !== undefined) {
      sheet.getRange(rowNumber, colCantidad + 1).setValue(Number(payload.quantity) || 1);
    }
    if (colPrecioUnidad >= 0 && payload.unitPrice !== undefined) {
      sheet.getRange(rowNumber, colPrecioUnidad + 1).setValue(Number(payload.unitPrice) || 0);
    }
    if (colMonto >= 0 && payload.totalAmount !== undefined) {
      sheet.getRange(rowNumber, colMonto + 1).setValue(Number(payload.totalAmount) || 0);
    }
    if (colCobrado >= 0 && payload.newCollectedAmount !== undefined) {
      sheet.getRange(rowNumber, colCobrado + 1).setValue(payload.newCollectedAmount);
    }
    if (colPendiente >= 0 && payload.newPendingAmount !== undefined) {
      sheet.getRange(rowNumber, colPendiente + 1).setValue(payload.newPendingAmount);
    }
    if (colMonto >= 0 && payload.newPaymentComment) {
      const cell = sheet.getRange(rowNumber, colMonto + 1);
      const oldNote = cell.getNote() || '';
      const updatedNote = oldNote ? (oldNote + '\n' + payload.newPaymentComment) : payload.newPaymentComment;
      cell.setNote(updatedNote);
    }
    return jsonResponse({ status: 'success', message: 'Registro actualizado en Google Sheets fila ' + rowNumber }, e);
  }
  return jsonResponse({ status: 'error', message: 'Fila no encontrada en la hoja' }, e);
}

function handleDeleteSale(ss, payload, e) {
  let sheet = ss.getSheetByName(SHEET_NAME_VENTAS);
  if (!sheet) sheet = ss.getSheets()[0];

  const rowNumber = parseInt(payload.rowNumber);
  const lastRow = sheet.getLastRow();

  if (rowNumber && rowNumber > 1 && rowNumber <= lastRow) {
    sheet.deleteRow(rowNumber);
    return jsonResponse({ status: 'success', message: 'Fila ' + rowNumber + ' eliminada de Google Sheets' }, e);
  }

  const lastCol = sheet.getLastColumn();
  if (lastRow <= 1 || lastCol < 1) {
    return jsonResponse({ status: 'error', message: 'Hoja vacía' }, e);
  }

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) { return (h || '').toString().trim(); });
  const colCodigo = findColIndex(headers, ['codigo', 'código', 'code', 'sku']);
  const colMonto = findColIndex(headers, ['total', 'monto', 'precio']);
  const colCliente = findColIndex(headers, ['cliente', 'client', 'comprador', 'nombre']);

  const targetCode = (payload.productCode || '').toString().trim().toUpperCase();
  const targetMonto = parseFloat(payload.totalAmount) || 0;
  const targetClient = (payload.client || '').toString().trim().toUpperCase();

  const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  for (let r = data.length - 1; r >= 0; r--) {
    const row = data[r];
    const rCode = colCodigo >= 0 ? (row[colCodigo] || '').toString().trim().toUpperCase() : '';
    const rMonto = colMonto >= 0 ? (parseFloat(row[colMonto]) || 0) : 0;
    const rClient = colCliente >= 0 ? (row[colCliente] || '').toString().trim().toUpperCase() : '';

    const codeMatches = !targetCode || rCode === targetCode;
    const montoMatches = !targetMonto || Math.abs(rMonto - targetMonto) < 0.05;
    const clientMatches = !targetClient || rClient === targetClient;

    if (codeMatches && montoMatches && clientMatches && (targetCode || targetMonto > 0)) {
      const targetRowIdx = r + 2;
      sheet.deleteRow(targetRowIdx);
      return jsonResponse({ status: 'success', message: 'Fila coincidente ' + targetRowIdx + ' eliminada de Google Sheets' }, e);
    }
  }

  return jsonResponse({ status: 'error', message: 'No se encontró la fila para eliminar en Google Sheets' }, e);
}

function handleUpdateClient(ss, payload, e) {
  let sheet = ss.getSheetByName(SHEET_NAME_VENTAS);
  if (!sheet) sheet = ss.getSheets()[0];

  const oldName = (payload.oldName || '').toString().trim().toUpperCase();
  const newName = (payload.newName || '').toString().trim().toUpperCase();
  if (!oldName || !newName) {
    return jsonResponse({ status: 'error', message: 'Nombres de cliente inválidos' }, e);
  }

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow <= 1) return jsonResponse({ status: 'success', updated: 0 }, e);

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) { return (h || '').toString().trim(); });
  const colCliente = findColIndex(headers, ['cliente', 'client', 'comprador', 'nombre']);
  const cCli = colCliente >= 0 ? colCliente : 1;

  const clientRange = sheet.getRange(2, cCli + 1, lastRow - 1, 1);
  const clientVals = clientRange.getValues();
  let updatedCount = 0;

  for (let i = 0; i < clientVals.length; i++) {
    const curr = (clientVals[i][0] || '').toString().trim().toUpperCase();
    if (curr === oldName) {
      clientVals[i][0] = newName;
      updatedCount++;
    }
  }

  if (updatedCount > 0) {
    clientRange.setValues(clientVals);
  }

  return jsonResponse({ status: 'success', updated: updatedCount, message: 'Cliente actualizado en ' + updatedCount + ' filas' }, e);
}

function handleAddExpense(ss, payload, e) {
  let sheet = ss.getSheetByName(SHEET_NAME_GASTOS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME_GASTOS);
    sheet.appendRow(['Fecha', 'Categoría', 'Descripción', 'Almacén', 'Beneficiario', 'Monto USD', 'Monto Bs', 'Referencia']);
  }
  sheet.appendRow([
    payload.date || Utilities.formatDate(new Date(), 'GMT-4', 'yyyy-MM-dd'),
    payload.category || 'otro',
    payload.description || '',
    payload.warehouse || 'general',
    payload.beneficiary || '',
    Number(payload.amountUsd) || 0,
    Number(payload.amountBs) || 0,
    payload.ref || ''
  ]);
  return jsonResponse({ status: 'success', message: 'Egreso guardado en Google Sheets' }, e);
}

const MOMENTOP_CATALOG_BDD = [
  ['VCCP20','COOLER','RETRO COOLER 20L','ROSADO','Cava Retro Cooler Momentop 20L Pink / Rosado','CAVAS Y COOLERS MOMENTOP','DISPONIBLE',45,75,0,'850064522358'],
  ['VCLH20','COOLER','RETRO COOLER 20L','MIEL','Cava Retro Cooler Momentop 20L Honey / Miel','CAVAS Y COOLERS MOMENTOP','DISPONIBLE',45,75,0,'850064522365'],
  ['HCSW24','COOLER','HARD COOLER 24L','BLANCO','Cava Rígida Hard Cooler Momentop 24L White / Blanco','CAVAS Y COOLERS MOMENTOP','DISPONIBLE',55,90,56,'850064522372'],
  ['HCSW50','COOLER','HARD COOLER 50L','BLANCO','Cava Rígida Hard Cooler Momentop 50L White / Blanco','CAVAS Y COOLERS MOMENTOP','DISPONIBLE',85,140,0,'850064522396'],
  ['HCUG50','COOLER','ROTOMOLDED HARD COOLER 50L','GRIS','Cava Rígida Rotomolded Hard Cooler Momentop 50L Grey / Gris','CAVAS Y COOLERS MOMENTOP','DISPONIBLE',85,140,0,'850064522402'],
  ['LBCCP22','BACKPACK','SOFT COOLER BACKPACK 22L','ROSADO','Bolso Cava Soft Cooler Backpack Momentop 22L Pink / Rosado','BOLSOS CUBITT - SOFT COOLER MOMENTOP','DISPONIBLE',39,65,0,'850064522433'],
  ['LBCDB22','BACKPACK','SOFT COOLER BACKPACK 22L','NEGRO','Bolso Cava Soft Cooler Backpack Momentop 22L Black / Negro','BOLSOS CUBITT - SOFT COOLER MOMENTOP','DISPONIBLE',39,65,0,'850064522440'],
  ['LBCUG22','BACKPACK','SOFT COOLER BACKPACK 22L','GRIS','Bolso Cava Soft Cooler Backpack Momentop 22L Grey / Gris','BOLSOS CUBITT - SOFT COOLER MOMENTOP','DISPONIBLE',39,65,0,'850064522457'],
  ['TMHDB40','TUMBLER','TUMBLER 40 OZ CON ASA','NEGRO','Tumbler Momentop 40 oz con Asa Black / Negro','TERMO PARA AGUA - TUMBLER MOMENTOP','DISPONIBLE',19.09,35,300,'850064522037'],
  ['TMHOB40','TUMBLER','TUMBLER 40 OZ CON ASA','AZUL','Tumbler Momentop 40 oz con Asa Blue / Azul','TERMO PARA AGUA - TUMBLER MOMENTOP','DISPONIBLE',19.09,35,249,'850064522105'],
  ['TMHSY40','TUMBLER','TUMBLER 40 OZ CON ASA','AMARILLO','Tumbler Momentop 40 oz con Asa Yellow / Amarillo','TERMO PARA AGUA - TUMBLER MOMENTOP','DISPONIBLE',19.09,35,300,'850064522006'],
  ['TMHIP40','TUMBLER','TUMBLER 40 OZ CON ASA','MORADO','Tumbler Momentop 40 oz con Asa Purple / Morado','TERMO PARA AGUA - TUMBLER MOMENTOP','DISPONIBLE',19.09,35,15,'850064522020'],
  ['TMNHDB40','TUMBLER','TUMBLER 40 OZ TAPA ASA','NEGRO','Tumbler Momentop 40 oz Tapa Asa Black / Negro','TERMO PARA AGUA - TUMBLER MOMENTOP','DISPONIBLE',19.09,35,193,'850064522082'],
  ['TMNHSW40','TUMBLER','TUMBLER 40 OZ TAPA ASA','BLANCO','Tumbler Momentop 40 oz Tapa Asa White / Blanco','TERMO PARA AGUA - TUMBLER MOMENTOP','DISPONIBLE',19.09,35,0,'850064522112'],
  ['TMNHOB40','TUMBLER','TUMBLER 40 OZ TAPA ASA','AZUL','Tumbler Momentop 40 oz Tapa Asa Blue / Azul','TERMO PARA AGUA - TUMBLER MOMENTOP','DISPONIBLE',19.09,35,40,'850064522044'],
  ['TMNHSY40','TUMBLER','TUMBLER 40 OZ TAPA ASA','AMARILLO','Tumbler Momentop 40 oz Tapa Asa Yellow / Amarillo','TERMO PARA AGUA - TUMBLER MOMENTOP','DISPONIBLE',19.09,35,300,'850064522051'],
  ['TMNHIP40','TUMBLER','TUMBLER 40 OZ TAPA ASA','MORADO','Tumbler Momentop 40 oz Tapa Asa Purple / Morado','TERMO PARA AGUA - TUMBLER MOMENTOP','DISPONIBLE',19.09,35,0,'850064522075'],
  ['WBDB40','HYDRO BOTTLE','WATER BOTTLE 40 OZ','NEGRO','Water Bottle Termo Momentop 40 oz Black / Negro','TERMO PARA AGUA - WATER BOTTLE MOMENTOP','DISPONIBLE',19.5,35,0,'791115795539'],
  ['WBSW40','HYDRO BOTTLE','WATER BOTTLE 40 OZ','BLANCO','Water Bottle Termo Momentop 40 oz White / Blanco','TERMO PARA AGUA - WATER BOTTLE MOMENTOP','DISPONIBLE',19.5,35,300,'791115795546'],
  ['WBCP40','HYDRO BOTTLE','WATER BOTTLE 40 OZ','ROSADO','Water Bottle Termo Momentop 40 oz Pink / Rosado','TERMO PARA AGUA - WATER BOTTLE MOMENTOP','DISPONIBLE',19.5,35,218,'791115795553'],
  ['WBOB40','HYDRO BOTTLE','WATER BOTTLE 40 OZ','AZUL','Water Bottle Termo Momentop 40 oz Blue / Azul','TERMO PARA AGUA - WATER BOTTLE MOMENTOP','DISPONIBLE',19.5,35,300,'791115795560'],
  ['WBSY40','HYDRO BOTTLE','WATER BOTTLE 40 OZ','AMARILLO','Water Bottle Termo Momentop 40 oz Yellow / Amarillo','TERMO PARA AGUA - WATER BOTTLE MOMENTOP','DISPONIBLE',19.5,35,300,'791115795577'],
  ['WBIP40','HYDRO BOTTLE','WATER BOTTLE 40 OZ','MORADO','Water Bottle Termo Momentop 40 oz Purple / Morado','TERMO PARA AGUA - WATER BOTTLE MOMENTOP','DISPONIBLE',19.5,35,300,'791115795591'],
  ['WBCR40','HYDRO BOTTLE','WATER BOTTLE 40 OZ','ROJO','Water Bottle Termo Momentop 40 oz Red / Rojo','TERMO PARA AGUA - WATER BOTTLE MOMENTOP','DISPONIBLE',19.5,35,300,'791115431116'],
  ['WBTG40','HYDRO BOTTLE','WATER BOTTLE 40 OZ','VERDE','Water Bottle Termo Momentop 40 oz Green / Verde','TERMO PARA AGUA - WATER BOTTLE MOMENTOP','DISPONIBLE',19.5,35,74,'791115431123'],
  ['WBDB32','HYDRO BOTTLE','WATER BOTTLE 32 OZ','NEGRO','Water Bottle Termo Momentop 32 oz Black / Negro','TERMO PARA AGUA - WATER BOTTLE MOMENTOP','DISPONIBLE',18,32,0,'791115795461'],
  ['WBSW32','HYDRO BOTTLE','WATER BOTTLE 32 OZ','BLANCO','Water Bottle Termo Momentop 32 oz White / Blanco','TERMO PARA AGUA - WATER BOTTLE MOMENTOP','DISPONIBLE',18,32,300,'791115795478'],
  ['WBCP32','HYDRO BOTTLE','WATER BOTTLE 32 OZ','ROSADO','Water Bottle Termo Momentop 32 oz Pink / Rosado','TERMO PARA AGUA - WATER BOTTLE MOMENTOP','DISPONIBLE',18,32,0,'791115795485'],
  ['WBOB32','HYDRO BOTTLE','WATER BOTTLE 32 OZ','AZUL','Water Bottle Termo Momentop 32 oz Blue / Azul','TERMO PARA AGUA - WATER BOTTLE MOMENTOP','DISPONIBLE',18,32,0,'791115795492'],
  ['WBSY32','HYDRO BOTTLE','WATER BOTTLE 32 OZ','AMARILLO','Water Bottle Termo Momentop 32 oz Yellow / Amarillo','TERMO PARA AGUA - WATER BOTTLE MOMENTOP','DISPONIBLE',18,32,139,'791115795508'],
  ['WBIP32','HYDRO BOTTLE','WATER BOTTLE 32 OZ','MORADO','Water Bottle Termo Momentop 32 oz Purple / Morado','TERMO PARA AGUA - WATER BOTTLE MOMENTOP','DISPONIBLE',18,32,0,'791115795522'],
  ['WBCR32','HYDRO BOTTLE','WATER BOTTLE 32 OZ','ROJO','Water Bottle Termo Momentop 32 oz Red / Rojo','TERMO PARA AGUA - WATER BOTTLE MOMENTOP','DISPONIBLE',18,32,88,'791115431383'],
  ['TMEML25','TUMBLER','ELITE TUMBLER 25 OZ','MOCCA LATTE','Elite Tumbler Momentop 25 oz Mocca Latte','TERMO PARA AGUA - TUMBLER MOMENTOP','DISPONIBLE',17.5,30,0,'850064522303'],
  ['TMEDG25','TUMBLER','ELITE TUMBLER 25 OZ','VERDE','Elite Tumbler Momentop 25 oz Green / Verde','TERMO PARA AGUA - TUMBLER MOMENTOP','DISPONIBLE',17.5,30,68,'850064522310'],
  ['TMEPC25','TUMBLER','ELITE TUMBLER 25 OZ','CREMA','Elite Tumbler Momentop 25 oz Cream / Crema','TERMO PARA AGUA - TUMBLER MOMENTOP','DISPONIBLE',17.5,30,0,'850064522327'],
  ['TMELB25','TUMBLER','ELITE TUMBLER 25 OZ','NEGRO','Elite Tumbler Momentop 25 oz Black / Negro','TERMO PARA AGUA - TUMBLER MOMENTOP','DISPONIBLE',17.5,30,0,'850064522334'],
  ['TMERP25','TUMBLER','ELITE TUMBLER 25 OZ','ROSADO','Elite Tumbler Momentop 25 oz Pink / Rosado','TERMO PARA AGUA - TUMBLER MOMENTOP','DISPONIBLE',17.5,30,54,'850064522341'],
  ['LWBTOB22','HYDRO BOTTLE','LIFESTYLE WATER BOTTLE 22 OZ','AZUL','Lifestyle Water Bottle Momentop 22 oz Blue / Azul','TERMO PARA AGUA - WATER BOTTLE MOMENTOP','DISPONIBLE',16.04,28,0,'850064522181'],
  ['LWBTSY22','HYDRO BOTTLE','LIFESTYLE WATER BOTTLE 22 OZ','AMARILLO','Lifestyle Water Bottle Momentop 22 oz Yellow / Amarillo','TERMO PARA AGUA - WATER BOTTLE MOMENTOP','DISPONIBLE',16.04,28,0,'850064522198'],
  ['LWBTCP22','HYDRO BOTTLE','LIFESTYLE WATER BOTTLE 22 OZ','ROSADO','Lifestyle Water Bottle Momentop 22 oz Pink / Rosado','TERMO PARA AGUA - WATER BOTTLE MOMENTOP','DISPONIBLE',16.04,28,0,'850064522204'],
  ['LWBTIP22','HYDRO BOTTLE','LIFESTYLE WATER BOTTLE 22 OZ','MORADO','Lifestyle Water Bottle Momentop 22 oz Purple / Púrpura','TERMO PARA AGUA - WATER BOTTLE MOMENTOP','DISPONIBLE',16.04,28,0,'850064522211'],
  ['LWBTTG22','HYDRO BOTTLE','LIFESTYLE WATER BOTTLE 22 OZ','VERDE','Lifestyle Water Bottle Momentop 22 oz Green / Verde','TERMO PARA AGUA - WATER BOTTLE MOMENTOP','DISPONIBLE',16.04,28,0,'850064522228'],
  ['WBDB22','HYDRO BOTTLE','WATER BOTTLE 22 OZ','NEGRO','Water Bottle Termo Momentop 22 oz Black / Negro','TERMO PARA AGUA - WATER BOTTLE MOMENTOP','DISPONIBLE',16.04,28,0,'791115795607'],
  ['WBSW22','HYDRO BOTTLE','WATER BOTTLE 22 OZ','BLANCO','Water Bottle Termo Momentop 22 oz White / Blanco','TERMO PARA AGUA - WATER BOTTLE MOMENTOP','DISPONIBLE',16.04,28,281,'791115795614'],
  ['WBCP22','HYDRO BOTTLE','WATER BOTTLE 22 OZ','ROSADO','Water Bottle Termo Momentop 22 oz Pink / Rosado','TERMO PARA AGUA - WATER BOTTLE MOMENTOP','DISPONIBLE',16.04,28,0,'791115795621'],
  ['WBOB22','HYDRO BOTTLE','WATER BOTTLE 22 OZ','AZUL','Water Bottle Termo Momentop 22 oz Blue / Azul','TERMO PARA AGUA - WATER BOTTLE MOMENTOP','DISPONIBLE',16.04,28,0,'791115431154'],
  ['WBSY22','HYDRO BOTTLE','WATER BOTTLE 22 OZ','AMARILLO','Water Bottle Termo Momentop 22 oz Yellow / Amarillo','TERMO PARA AGUA - WATER BOTTLE MOMENTOP','DISPONIBLE',16.04,28,300,'791115431338'],
  ['WBIP22','HYDRO BOTTLE','WATER BOTTLE 22 OZ','MORADO','Water Bottle Termo Momentop 22 oz Purple / Morado','TERMO PARA AGUA - WATER BOTTLE MOMENTOP','DISPONIBLE',16.04,28,0,'791115431352'],
  ['WBCR22','HYDRO BOTTLE','WATER BOTTLE 22 OZ','ROJO','Water Bottle Termo Momentop 22 oz Red / Rojo','TERMO PARA AGUA - WATER BOTTLE MOMENTOP','DISPONIBLE',16.04,28,41,'791115431369'],
  ['TMDB20','TUMBLER','TUMBLER 20 OZ','NEGRO','Tumbler Momentop 20 oz Black / Negro','TERMO PARA AGUA - TUMBLER MOMENTOP','DISPONIBLE',15.5,27,223,'791115431161'],
  ['TMSW20','TUMBLER','TUMBLER 20 OZ','BLANCO','Tumbler Momentop 20 oz White / Blanco','TERMO PARA AGUA - TUMBLER MOMENTOP','DISPONIBLE',15.5,27,300,'791115431178'],
  ['TMCP20','TUMBLER','TUMBLER 20 OZ','ROSADO','Tumbler Momentop 20 oz Pink / Rosado','TERMO PARA AGUA - TUMBLER MOMENTOP','DISPONIBLE',15.5,27,300,'791115431185'],
  ['TMOB20','TUMBLER','TUMBLER 20 OZ','AZUL','Tumbler Momentop 20 oz Blue / Azul','TERMO PARA AGUA - TUMBLER MOMENTOP','DISPONIBLE',15.5,27,223,'791115431192'],
  ['TMSY20','TUMBLER','TUMBLER 20 OZ','AMARILLO','Tumbler Momentop 20 oz Yellow / Amarillo','TERMO PARA AGUA - TUMBLER MOMENTOP','DISPONIBLE',15.5,27,300,'791115431239'],
  ['TMIP20','TUMBLER','TUMBLER 20 OZ','MORADO','Tumbler Momentop 20 oz Purple / Púrpura','TERMO PARA AGUA - TUMBLER MOMENTOP','DISPONIBLE',15.5,27,300,'791115431253'],
  ['TMCR20','TUMBLER','TUMBLER 20 OZ','ROJO','Tumbler Momentop 20 oz Red / Rojo','TERMO PARA AGUA - TUMBLER MOMENTOP','DISPONIBLE',15.5,27,300,'791115431260'],
  ['TMTG20','TUMBLER','TUMBLER 20 OZ','VERDE','Tumbler Momentop 20 oz Green / Verde','TERMO PARA AGUA - TUMBLER MOMENTOP','DISPONIBLE',15.5,27,300,'791115431277'],
  ['KWBLP18','HYDRO BOTTLE','KIDS WATER BOTTLE 18 OZ','ROSADO','Kids Water Bottle Termo Jr. Momentop 18 oz Pink / Rosado','TERMO PARA AGUA - WATER BOTTLE MOMENTOP','DISPONIBLE',14.9,25,0,'850064522143'],
  ['KWBLL18','HYDRO BOTTLE','KIDS WATER BOTTLE 18 OZ','LAVANDA','Kids Water Bottle Termo Jr. Momentop 18 oz Lavender / Lavanda','TERMO PARA AGUA - WATER BOTTLE MOMENTOP','DISPONIBLE',14.9,25,0,'850064522150'],
  ['KWBLC18','HYDRO BOTTLE','KIDS WATER BOTTLE 18 OZ','CORAL','Kids Water Bottle Termo Jr. Momentop 18 oz Coral','TERMO PARA AGUA - WATER BOTTLE MOMENTOP','DISPONIBLE',14.9,25,0,'850064522167'],
  ['KWBLB18','HYDRO BOTTLE','KIDS WATER BOTTLE 18 OZ','AZUL','Kids Water Bottle Termo Jr. Momentop 18 oz Blue / Azul','TERMO PARA AGUA - WATER BOTTLE MOMENTOP','DISPONIBLE',14.9,25,0,'850064522174'],
  ['KWBPP12','HYDRO BOTTLE','KIDS WATER BOTTLE 12 OZ','ROSADO','Kids Water Bottle Termo Jr. Momentop 12 oz Pink / Rosado','TERMO PARA AGUA - WATER BOTTLE MOMENTOP','DISPONIBLE',13.5,22,0,'791115431208'],
  ['KWBCW12','HYDRO BOTTLE','KIDS WATER BOTTLE 12 OZ','BLANCO','Kids Water Bottle Termo Jr. Momentop 12 oz White / Blanco','TERMO PARA AGUA - WATER BOTTLE MOMENTOP','DISPONIBLE',13.5,22,0,'791115431215'],
  ['KWBSB12','HYDRO BOTTLE','KIDS WATER BOTTLE 12 OZ','AZUL','Kids Water Bottle Termo Jr. Momentop 12 oz Blue / Azul','TERMO PARA AGUA - WATER BOTTLE MOMENTOP','DISPONIBLE',13.5,22,0,'791115431222'],
  ['KWBDG12','HYDRO BOTTLE','KIDS WATER BOTTLE 12 OZ','VERDE','Kids Water Bottle Termo Jr. Momentop 12 oz Green / Verde','TERMO PARA AGUA - WATER BOTTLE MOMENTOP','DISPONIBLE',13.5,22,0,'850064522129'],
  ['KWBUP12','HYDRO BOTTLE','KIDS WATER BOTTLE 12 OZ','MORADO','Kids Water Bottle Termo Jr. Momentop 12 oz Purple / Púrpura','TERMO PARA AGUA - WATER BOTTLE MOMENTOP','DISPONIBLE',13.5,22,0,'850064522136'],
  ['TMDB12','TUMBLER','TUMBLER 12 OZ','NEGRO','Mini Tumbler Momentop 12 oz Black / Negro','TERMO PARA AGUA - TUMBLER MOMENTOP','DISPONIBLE',13.5,22,0,'791115795386'],
  ['TMSW12','TUMBLER','TUMBLER 12 OZ','BLANCO','Mini Tumbler Momentop 12 oz White / Blanco','TERMO PARA AGUA - TUMBLER MOMENTOP','DISPONIBLE',13.5,22,164,'791115795393'],
  ['TMCP12','TUMBLER','TUMBLER 12 OZ','ROSADO','Mini Tumbler Momentop 12 oz Pink / Rosado','TERMO PARA AGUA - TUMBLER MOMENTOP','DISPONIBLE',13.5,22,0,'791115795409'],
  ['TMOB12','TUMBLER','TUMBLER 12 OZ','AZUL','Mini Tumbler Momentop 12 oz Blue / Azul','TERMO PARA AGUA - TUMBLER MOMENTOP','DISPONIBLE',13.5,22,0,'791115795416'],
  ['TMSY12','TUMBLER','TUMBLER 12 OZ','AMARILLO','Mini Tumbler Momentop 12 oz Yellow / Amarillo','TERMO PARA AGUA - TUMBLER MOMENTOP','DISPONIBLE',13.5,22,144,'791115431284'],
  ['TMIP12','TUMBLER','TUMBLER 12 OZ','MORADO','Mini Tumbler Momentop 12 oz Purple / Púrpura','TERMO PARA AGUA - TUMBLER MOMENTOP','DISPONIBLE',13.5,22,59,'791115431307'],
  ['TMCR12','TUMBLER','TUMBLER 12 OZ','ROJO','Mini Tumbler Momentop 12 oz Red / Rojo','TERMO PARA AGUA - TUMBLER MOMENTOP','DISPONIBLE',13.5,22,199,'791115431314']
];

function handleSyncBDD(ss, payload, e) {
  let sheet = ss.getSheetByName(SHEET_NAME_BDD);
  if (!sheet) {
    const allSheets = ss.getSheets();
    sheet = allSheets.find(function(s) {
      const n = s.getName().trim().toUpperCase();
      return n === 'BDD' || n.indexOf('BDD') > -1 || n.indexOf('BASE') > -1 || n.indexOf('PRECIOS') > -1 || n.indexOf('PRODUCTO') > -1;
    });
  }
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME_BDD);
    sheet.appendRow(['PRODUCTO', 'CODIGO', 'MODELO', 'COLOR', 'FOTO', 'ESTADO', 'MAYOR', 'PVP TIENDA', 'EXISTENCIA', 'UPC']);
  }

  const lastRow = Math.max(sheet.getLastRow(), 1);
  const lastCol = Math.max(sheet.getLastColumn(), 5);

  // Detect header row (scan rows 1..5)
  let headerRowIdx = 1;
  let headers = [];
  const maxHeaderScan = Math.min(lastRow, 5);
  const headerScanVals = sheet.getRange(1, 1, maxHeaderScan, lastCol).getValues();
  for (let r = 0; r < maxHeaderScan; r++) {
    const rowStr = headerScanVals[r].join(' ').toUpperCase();
    if (rowStr.indexOf('CODIGO') > -1 || rowStr.indexOf('CÓDIGO') > -1 || rowStr.indexOf('ARTICULO') > -1 || rowStr.indexOf('PRODUCTO') > -1 || rowStr.indexOf('MODELO') > -1) {
      headerRowIdx = r + 1;
      headers = headerScanVals[r].map(function(h) { return (h || '').toString().trim(); });
      break;
    }
  }
  if (headers.length === 0) {
    headers = headerScanVals[0].map(function(h) { return (h || '').toString().trim(); });
  }

  let colCodigo = findColIndex(headers, ['codigo', 'código', 'articulo', 'artículo', 'sku', 'code']);
  let colProducto = findColIndex(headers, ['producto', 'product', 'linea', 'línea', 'tipo']);
  let colCategoria = findColIndex(headers, ['categoria', 'categoría', 'descripcion', 'descripción']);
  let colModelo = findColIndex(headers, ['modelo', 'model', 'variante', 'nombre']);
  let colColor = findColIndex(headers, ['color', 'tono']);
  let colFoto = findColIndex(headers, ['foto', 'imagen', 'image', 'photo']);
  let colEstado = findColIndex(headers, ['estado', 'status', 'disponibilidad', 'disponible']);
  let colMayor = findColIndex(headers, ['mayor', 'costo', 'cost']);
  let colPvp = findColIndex(headers, ['pvp', 'precio', 'tienda', 'venta']);
  let colStock = findColIndex(headers, ['existencia', 'stock', 'cantidad', 'inventario']);
  let colUpc = findColIndex(headers, ['upc', 'barcode', 'barra']);

  // Fallback positional mapping if BDD uses standard Cubitt BDD columns (e.g. PRODUCTO | CODIGO | MODELO | COLOR | FOTO or ARTICULO | IMAGEN | CATEGORIA | ESTADO | MAYOR | PVP)
  if (colCodigo < 0) {
    if (headers.length >= 5 && findColIndex(headers, ['producto']) === 0) {
      colProducto = 0; colCodigo = 1; colModelo = 2; colColor = 3; colFoto = 4;
    } else {
      colCodigo = 0;
      if (colFoto < 0) colFoto = 1;
      if (colCategoria < 0) colCategoria = 2;
      if (colEstado < 0 && lastCol >= 4) colEstado = 3;
      if (colMayor < 0 && lastCol >= 5) colMayor = 4;
      if (colPvp < 0 && lastCol >= 6) colPvp = 5;
    }
  }

  // Collect existing codes to prevent duplicates
  const existingCodes = {};
  if (lastRow > headerRowIdx) {
    const allData = sheet.getRange(headerRowIdx + 1, 1, lastRow - headerRowIdx, lastCol).getValues();
    for (let r = 0; r < allData.length; r++) {
      for (let c = 0; c < allData[r].length; c++) {
        const cellVal = (allData[r][c] || '').toString().trim().toUpperCase();
        if (cellVal) existingCodes[cellVal] = headerRowIdx + 1 + r;
      }
    }
  }

  const sourceRow = lastRow > headerRowIdx ? lastRow : headerRowIdx;
  const sourceRange = sheet.getRange(sourceRow, 1, 1, lastCol);
  const sourceRowHeight = sheet.getRowHeight(sourceRow) || 42;

  const itemsToSync = (payload && Array.isArray(payload.products) && payload.products.length > 0)
    ? payload.products.map(function(p) {
        return [
          p.code, p.productLine || 'TUMBLER', p.model || p.description, p.color || 'NEGRO',
          p.description || p.model, p.category || 'MOMENTOP', 'DISPONIBLE',
          Number(p.mayor) || 15, Number(p.pvpTienda || p.pvpActual) || 28,
          Number(p.stock || p.pdfStock) || 0, p.upc || ''
        ];
      })
    : MOMENTOP_CATALOG_BDD;

  let addedCount = 0;
  let updatedCount = 0;
  let currentLastRow = sheet.getLastRow();

  for (let i = 0; i < itemsToSync.length; i++) {
    const item = itemsToSync[i];
    const code = (item[0] || '').toString().trim().toUpperCase();
    const prodLine = item[1];
    const model = item[2];
    const color = item[3];
    const desc = item[4];
    const category = item[5];
    const status = item[6] || 'DISPONIBLE';
    const mayor = Number(item[7]) || 0;
    const pvp = Number(item[8]) || 0;
    const stock = Number(item[9]) || 0;
    const upc = item[10] || '';
    const imgUrl = getPublicCdnImage(code);

    let targetRow = existingCodes[code];
    const isNew = !targetRow;
    if (isNew) {
      currentLastRow++;
      targetRow = currentLastRow;
    }

    const targetRange = sheet.getRange(targetRow, 1, 1, lastCol);
    if (isNew && sourceRow > headerRowIdx) {
      sourceRange.copyTo(targetRange, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
      try { targetRange.setNumberFormats(sourceRange.getNumberFormats()); } catch (err) {}
      try { targetRange.setDataValidations(sourceRange.getDataValidations()); } catch (err) {}
      try { sheet.setRowHeight(targetRow, sourceRowHeight); } catch (err) {}
    }

    if (colCodigo >= 0 && colCodigo < lastCol) {
      sheet.getRange(targetRow, colCodigo + 1).setValue(code);
    }
    if (colProducto >= 0 && colProducto < lastCol) {
      const pCell = sheet.getRange(targetRow, colProducto + 1);
      const matchedLine = matchValidationValue(pCell, prodLine, [prodLine, 'COOLER', 'BACKPACK', 'TUMBLER', 'HYDRO BOTTLE', 'TERMO PARA AGUA', 'ACCESORIO']);
      pCell.setValue(matchedLine);
    }
    if (colCategoria >= 0 && colCategoria < lastCol && colCategoria !== colProducto && colCategoria !== colModelo) {
      sheet.getRange(targetRow, colCategoria + 1).setValue(category || desc);
    }
    if (colModelo >= 0 && colModelo < lastCol) {
      sheet.getRange(targetRow, colModelo + 1).setValue(model || desc);
    }
    if (colColor >= 0 && colColor < lastCol) {
      sheet.getRange(targetRow, colColor + 1).setValue(color);
    }
    if (colEstado >= 0 && colEstado < lastCol) {
      sheet.getRange(targetRow, colEstado + 1).setValue(status);
    }
    if (colMayor >= 0 && colMayor < lastCol) {
      const mCell = sheet.getRange(targetRow, colMayor + 1);
      mCell.setValue(mayor);
      mCell.setNumberFormat('$#,##0.00');
    }
    if (colPvp >= 0 && colPvp < lastCol && colPvp !== colMayor) {
      const pvCell = sheet.getRange(targetRow, colPvp + 1);
      pvCell.setValue(pvp);
      pvCell.setNumberFormat('$#,##0.00');
    }
    if (colStock >= 0 && colStock < lastCol) {
      sheet.getRange(targetRow, colStock + 1).setValue(stock);
    }
    if (colUpc >= 0 && colUpc < lastCol) {
      sheet.getRange(targetRow, colUpc + 1).setValue(upc);
    }
    if (colFoto >= 0 && colFoto < lastCol && imgUrl) {
      const fCell = sheet.getRange(targetRow, colFoto + 1);
      fCell.clearContent();
      try {
        const cImg = SpreadsheetApp.newCellImage().setSourceUrl(imgUrl).setAltTextTitle(code).build();
        fCell.setValue(cImg);
      } catch (eImg) {
        fCell.setFormula('=IMAGE("' + imgUrl + '", 1)');
      }
    }

    targetRange.setFontFamily('Roboto');
    targetRange.setFontSize(10);
    targetRange.setVerticalAlignment('middle');

    if (isNew) addedCount++;
    else updatedCount++;
  }

  return jsonResponse({
    status: 'success',
    sheetName: sheet.getName(),
    added: addedCount,
    updated: updatedCount,
    totalMomentop: itemsToSync.length,
    message: 'Catálogo Momentop sincronizado en hoja "' + sheet.getName() + '" (' + addedCount + ' agregados, ' + updatedCount + ' actualizados).'
  }, e);
}

function findColIndex(headers, matchWords) {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase();
    for (let m = 0; m < matchWords.length; m++) {
      const w = matchWords[m].toLowerCase();
      if (h === w || h.indexOf(w) > -1) return i;
    }
  }
  return -1;
}

function formatDateOutput(dateVal) {
  if (!dateVal) return '';
  if (dateVal instanceof Date) {
    return Utilities.formatDate(dateVal, 'GMT-4', 'dd/MM/yyyy');
  }
  return dateVal.toString();
}

function parsePaymentDatesFromComment(commentText) {
  if (!commentText || typeof commentText !== 'string') return [];
  const lines = commentText.split(/\r?\n/);
  const installments = [];
  const dateRegex = /(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})/;
  const amountRegex = /\$?\s*(\d+(?:[.,]\d{1,2})?)/;
  lines.forEach(function(line, index) {
    const trimmed = line.trim();
    if (!trimmed) return;
    const dateMatch = trimmed.match(dateRegex);
    const amtMatch = trimmed.match(amountRegex);
    installments.push({
      index: index + 1,
      rawText: trimmed,
      date: dateMatch ? dateMatch[1] : null,
      amount: amtMatch ? parseFloat(amtMatch[1].replace(',', '.')) : null
    });
  });
  return installments;
}

function jsonResponse(data, e) {
  var callback = (e && e.parameter && e.parameter.callback) ? e.parameter.callback : null;
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + JSON.stringify(data) + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
