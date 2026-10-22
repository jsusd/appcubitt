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

function testConn() {
  const ss = SpreadsheetApp.getActiveSpreadsheet() || (SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : null);
  const sheet = ss.getSheetByName(SHEET_NAME_VENTAS) || ss.getSheets()[0];
  Logger.log("✅ Conexión Exitosa con Hoja: " + sheet.getName() + " (Filas: " + sheet.getLastRow() + ")");
  return "OK: " + sheet.getName();
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
    } else {
      return jsonResponse({ status: 'error', message: 'Acción no reconocida: ' + action }, e);
    }
  } catch (error) {
    return jsonResponse({ status: 'error', message: error.toString() }, e);
  }
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
  const colTotal = findColIndex(headers, ['total', 'monto total', 'importe']);
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
  const lastRow = sheet.getLastRow();

  // 1. Localizar la fila de Totales para insertar justo debajo de la última venta
  const scanRows = Math.min(lastRow, 600);
  const checkValues = sheet.getRange(1, 1, scanRows, Math.min(numCols, 12)).getValues();
  const checkFormulas = sheet.getRange(1, cTot + 1, scanRows, 1).getFormulas();

  let totalRow = -1;
  for (let r = 1; r < scanRows; r++) {
    const rowNum = r + 1;
    const fTot = (checkFormulas[r][0] || '').toString().toUpperCase();
    const vCol1 = (checkValues[r][0] || '').toString().trim().toUpperCase();
    const vCol2 = (checkValues[r][1] || '').toString().trim().toUpperCase();
    const vProd = cProd < numCols && checkValues[r][cProd] ? checkValues[r][cProd].toString().trim().toUpperCase() : '';

    if (fTot.indexOf('SUM') > -1 || vCol1.indexOf('TOTAL') > -1 || vCol2.indexOf('TOTAL') > -1 || vProd.indexOf('TOTAL') > -1) {
      totalRow = rowNum;
      break;
    }
  }

  if (totalRow < 2) {
    totalRow = Math.max(450, lastRow + 1);
  }

  const insertRow = totalRow;
  const sourceRow = totalRow - 1;

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

  // 4. Preparar datos completos de la venta
  const total = Number(payload.totalAmount) || Number(payload.total) || 0;
  const qty = Number(payload.quantity) || 1;
  const unitPrice = Number(payload.unitPrice) || (qty > 0 ? (total / qty) : total);
  const isContado = (payload.paymentType || '').toLowerCase() === 'contado';
  const cobrado = Number(payload.collectedAmount) || Number(payload.creditPaid) || (isContado ? total : 0);
  const pendiente = Number(payload.pendingAmount) !== undefined && !isNaN(Number(payload.pendingAmount))
    ? Number(payload.pendingAmount)
    : Math.max(0, total - cobrado);

  // A. Responsable (Col A) - Menú Desplegable con Chip
  let rawSeller = (payload.seller || payload.responsable || '').toString().trim().toUpperCase();
  if (!rawSeller || rawSeller === 'TIENDA PRINCIPAL' || rawSeller === 'ADMIN' || rawSeller === 'GERENCIA') {
    rawSeller = 'JENNIFER';
  }
  const officialSellers = [
    'JENNIFER', 'ZULMI', 'JESUS', 'FABIOLA', 'TANIA', 'BULL', 'CASHEA',
    'TABATHA', 'SARA', 'VERUSKA', 'MARIELA', 'KLEIVER', 'PEDRO', 'FABIOLA PAOLA', 'PAOLA'
  ];
  const matchedSeller = matchValidationValue(sheet.getRange(insertRow, cResp + 1), rawSeller, officialSellers);
  sheet.getRange(insertRow, cResp + 1).setValue(matchedSeller);

  // B. Cliente (Col B)
  const clientName = (payload.client || payload.clientName || 'CLIENTE GENERAL').toString().trim().toUpperCase();
  sheet.getRange(insertRow, cCli + 1).setValue(clientName);

  // C. Producto (Col C) - Menú Desplegable con Chip
  let prodLine = (payload.productLine || payload.category || '').toString().trim().toUpperCase();
  if (!prodLine) {
    const uc = (payload.productCode || '').toString().toUpperCase();
    const un = (payload.productName || payload.description || '').toString().toUpperCase();
    if (uc.indexOf('BLT') > -1 || un.indexOf('BELT BAG') > -1) prodLine = 'BELT BAG';
    else if (uc.indexOf('BPK') > -1 || un.indexOf('BACKPACK') > -1) prodLine = 'BACKPACK';
    else if (uc.indexOf('VIVAP2') > -1 || un.indexOf('VIVA 2 PRO') > -1 || un.indexOf('VIVA PRO 2') > -1) prodLine = 'VIVA 2 PRO';
    else if (uc.indexOf('VIVA2') > -1 || un.indexOf('VIVA 2') > -1) prodLine = 'VIVA 2';
    else if (uc.indexOf('AURA2') > -1 || un.indexOf('AURA 2') > -1) prodLine = 'AURA 2';
    else if (uc.indexOf('AURA') > -1) prodLine = 'AURA';
    else if (uc.indexOf('HERO') > -1) prodLine = 'HERO';
    else if (uc.indexOf('TOTE') > -1) prodLine = 'TOTE BAG';
    else if (uc.indexOf('DFL') > -1 || un.indexOf('DUFFLE') > -1) prodLine = 'DUFFLE BAG';
    else prodLine = 'ACCESORIO';
  }
  const officialLines = [
    'BACKPACK', 'BELT BAG', 'DUFFLE BAG', 'TOTE BAG', 'VIVA 2', 'VIVA 2 PRO', 'VIVA PRO',
    'AURA', 'AURA 2', 'HERO', 'TUMBLER', 'HYDRO BOTTLE', 'COFFEE MUG', 'SPORTBELT', 'ACCESORIO'
  ];
  const matchedProdLine = matchValidationValue(sheet.getRange(insertRow, cProd + 1), prodLine, officialLines);
  sheet.getRange(insertRow, cProd + 1).setValue(matchedProdLine);

  // D. Código (Col D)
  const codeVal = (payload.productCode || payload.code || '').toString().trim().toUpperCase();
  sheet.getRange(insertRow, cCod + 1).setValue(codeVal);

  // E. Modelo (Col E)
  let modeloVal = (payload.modelo || payload.model || '').toString().trim().toUpperCase();
  if (!modeloVal) {
    let cleanM = (payload.productName || payload.description || '').toString().toUpperCase();
    const stopWords = ['SMARTWATCH', 'RELOJ INTELIGENTE', 'BELT BAG', 'BACKPACK', 'VIVA 2 PRO', 'VIVA 2', 'AURA 2', 'AURA', 'HERO', 'CUBITT', 'TOTE BAG', 'DUFFLE BAG'];
    for (let sw = 0; sw < stopWords.length; sw++) {
      cleanM = cleanM.replace(new RegExp(stopWords[sw], 'g'), ' ');
    }
    modeloVal = cleanM.replace(/\s+/g, ' ').trim() || codeVal;
  }
  sheet.getRange(insertRow, cMod + 1).setValue(modeloVal);

  // F. Color (Col F)
  let colorVal = (payload.color || '').toString().trim().toUpperCase();
  if (!colorVal) {
    const comb = (modeloVal + ' ' + (payload.productName || '')).toUpperCase();
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

  // I. Cantidad (Col I)
  const qCell = sheet.getRange(insertRow, cCant + 1);
  qCell.setValue(qty);
  qCell.setNumberFormat('0');
  qCell.setHorizontalAlignment('center');

  // J. Precio Unidad (Col J)
  const puCell = sheet.getRange(insertRow, cPU + 1);
  puCell.setValue(unitPrice);
  puCell.setNumberFormat('$#,##0.00');
  puCell.setHorizontalAlignment('right');

  // K. Total (Col K)
  const totCell = sheet.getRange(insertRow, cTot + 1);
  totCell.setValue(total);
  totCell.setNumberFormat('$#,##0.00');
  totCell.setHorizontalAlignment('right');

  // L. Pago 1 (Col L)
  const p1Cell = sheet.getRange(insertRow, cP1 + 1);
  p1Cell.setValue(cobrado);
  p1Cell.setNumberFormat('$#,##0.00');
  p1Cell.setHorizontalAlignment('right');

  // M..P. Pagos 2 a 5
  if (cP2 < numCols) sheet.getRange(insertRow, cP2 + 1).setValue('');
  if (cP3 < numCols) sheet.getRange(insertRow, cP3 + 1).setValue('');
  if (cP4 < numCols) sheet.getRange(insertRow, cP4 + 1).setValue('');
  if (cP5 < numCols) sheet.getRange(insertRow, cP5 + 1).setValue('');

  // Q. Pendiente (Col Q)
  const pendCell = sheet.getRange(insertRow, cPend + 1);
  pendCell.setValue(pendiente);
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

  // 6. Limpieza preventiva de filas residuales lejanas
  if (sheet.getLastRow() >= 486 && (sheet.getLastRow() > shiftedTotalRow + 10)) {
    try {
      const farRow = sheet.getLastRow();
      const farCode = (sheet.getRange(farRow, cCod + 1).getValue() || '').toString();
      const farMonto = Number(sheet.getRange(farRow, cTot + 1).getValue()) || 0;
      if (farMonto === 104 || farCode.indexOf('CTBPK') > -1 || farCode === codeVal) {
        sheet.deleteRow(farRow);
      }
    } catch (e) {}
  }

  return jsonResponse({
    status: 'success',
    message: 'Venta registrada con éxito en fila ' + insertRow + ' con todas las columnas A a Q completas y formato idéntico.',
    row: insertRow,
    saleId: payload.id || ('ROW-' + insertRow)
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
  const matchedSeller = matchValidationValue(cellA, 'JESUS', ['JENNIFER', 'ZULMI', 'JESUS', 'FABIOLA', 'TANIA', 'BULL', 'CASHEA', 'TABATHA', 'SARA', 'VERUSKA', 'MARIELA', 'KLEIVER', 'PEDRO', 'FABIOLA PAOLA', 'PAOLA']);
  cellA.setValue(matchedSeller);

  sheet.getRange(row, 2).setValue('JESUS PALMA');

  const cellC = sheet.getRange(row, 3);
  const matchedProd = matchValidationValue(cellC, 'BELT BAG', ['BACKPACK', 'BELT BAG', 'DUFFLE BAG', 'TOTE BAG', 'VIVA 2', 'VIVA 2 PRO', 'VIVA PRO', 'AURA', 'AURA 2', 'HERO', 'TUMBLER', 'HYDRO BOTTLE', 'COFFEE MUG', 'SPORTBELT', 'ACCESORIO']);
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

function matchValidationValue(cell, targetVal, fallbackList) {
  var normTarget = (targetVal || '').toString().trim().toUpperCase();
  try {
    var rule = cell.getDataValidation();
    if (rule) {
      var criteriaVals = rule.getCriteriaValues();
      if (criteriaVals && criteriaVals.length > 0) {
        var options = [];
        if (Array.isArray(criteriaVals[0])) {
          options = criteriaVals[0];
        } else if (criteriaVals[0] && typeof criteriaVals[0].getValues === 'function') {
          options = criteriaVals[0].getValues().flat();
        }
        for (var i = 0; i < options.length; i++) {
          var opt = (options[i] || '').toString().trim();
          if (opt.toUpperCase() === normTarget) {
            return opt;
          }
        }
        for (var j = 0; j < options.length; j++) {
          var opt2 = (options[j] || '').toString().trim();
          if (opt2.toUpperCase().indexOf(normTarget) > -1 || normTarget.indexOf(opt2.toUpperCase()) > -1) {
            return opt2;
          }
        }
      }
    }
  } catch (err) {}

  if (fallbackList && fallbackList.length > 0) {
    for (var k = 0; k < fallbackList.length; k++) {
      if (fallbackList[k].toUpperCase() === normTarget) {
        return fallbackList[k];
      }
    }
    for (var m = 0; m < fallbackList.length; m++) {
      if (fallbackList[m].toUpperCase().indexOf(normTarget) > -1 || normTarget.indexOf(fallbackList[m].toUpperCase()) > -1) {
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
  return map[c] || '';
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
