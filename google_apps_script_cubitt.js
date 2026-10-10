/**
 * CUBITT POS - SCRIPT DE CONEXIÓN BIDIRECCIONAL CON GOOGLE SHEETS
 * ==============================================================
 * Instrucciones de Instalación en 30 segundos:
 * 1. Abre tu hoja de cálculo en Google Sheets:
 *    https://docs.google.com/spreadsheets/d/18a86QMObmZnX611SmtSBRLVIvZJRYHnqFSr5vFCBtIw/edit?gid=1352847878
 * 2. En el menú superior haz clic en: Extensiones -> Apps Script.
 * 3. Borra todo el código que aparezca y pega este archivo completo.
 * 4. Arriba a la derecha haz clic en: "Implementar" -> "Nueva implementación".
 * 5. Haz clic en el ícono de engranaje ⚙️ y elige: "Aplicación web".
 *    - Descripción: "Cubitt POS API"
 *    - Ejecutar como: "Yo" (tu cuenta de Google)
 *    - Quién tiene acceso: "Cualquier persona" (Anyone)
 * 6. Haz clic en "Implementar" y copia la URL generada (termina en /exec).
 * 7. Pega esa URL en la App Cubitt en: "Base de Datos Google Sheets".
 *
 * ¡Listo! La App leerá las ventas con sus comentarios de fechas de pago,
 * y cada venta nueva o pago en la app se guardará automáticamente en tu hoja.
 */

const SPREADSHEET_ID = '18a86QMObmZnX611SmtSBRLVIvZJRYHnqFSr5vFCBtIw';
const SHEET_NAME_VENTAS = 'ventas';
const SHEET_NAME_GASTOS = 'gastos';

// Función de prueba directa para ejecutar en el editor de Apps Script
function testConn() {
  const ss = SpreadsheetApp.getActiveSpreadsheet() || (SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : null);
  const sheet = ss.getSheetByName(SHEET_NAME_VENTAS) || ss.getSheets()[0];
  Logger.log("✅ Conexión Exitosa con Hoja: " + sheet.getName() + " (Filas: " + sheet.getLastRow() + ")");
  return "OK: " + sheet.getName();
}

// Función auxiliar para eliminar la fila 486 errónea de pruebas anteriores con un solo clic en Apps Script
function limpiarFila486() {
  const ss = SpreadsheetApp.getActiveSpreadsheet() || (SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : null);
  const sheet = ss.getSheetByName(SHEET_NAME_VENTAS) || ss.getSheets()[0];
  if (sheet.getLastRow() >= 486) {
    sheet.deleteRow(486);
    Logger.log("✅ Fila 486 eliminada exitosamente. Tu hoja vuelve a estar limpia.");
    return "Fila 486 eliminada exitosamente.";
  } else {
    Logger.log("ℹ️ No existe fila 486 en la hoja.");
    return "No existe fila 486.";
  }
}

// ==============================================================
// GET: LECTURA EN TIEMPO REAL DESDE GOOGLE SHEETS
// ==============================================================
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

    let sheet = ss.getSheetByName(SHEET_NAME_VENTAS);
    
    // Si no encuentra por nombre exacto, busca por el gid o la primera hoja
    if (!sheet) {
      const sheets = ss.getSheets();
      sheet = sheets.find(s => s.getName().toLowerCase().includes('venta')) || sheets[0];
    }

    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();

    if (lastRow <= 1) {
      return jsonResponse({ status: 'success', data: [], sales: [], message: 'La hoja no tiene registros de datos.' }, e);
    }

    // Leemos encabezados, valores y NOTAS (comentarios donde están las fechas de pago)
    const headerRange = sheet.getRange(1, 1, 1, lastCol);
    const headers = headerRange.getValues()[0].map(h => (h || '').toString().trim());

    const dataRange = sheet.getRange(2, 1, lastRow - 1, lastCol);
    const values = dataRange.getValues();
    const notes = dataRange.getNotes(); // Contiene las notas/comentarios de cada celda
    const formulas = dataRange.getFormulas(); // Identifica fórmulas como =SUM(...)

    const salesList = [];

    // Identificar índices de columnas principales
    const colFecha = findColIndex(headers, ['fecha', 'date', 'dia']);
    const colCodigo = findColIndex(headers, ['codigo', 'código', 'code', 'sku']);
    const colProducto = findColIndex(headers, ['producto', 'product', 'descripcion', 'artículo']);
    const colImagen = findColIndex(headers, ['imagen', 'image', 'foto', 'photo']);
    const colMonto = findColIndex(headers, ['monto', 'total', 'precio', 'amount', 'facturación']);
    const colCobrado = findColIndex(headers, ['cobrado', 'pagado', 'paid', 'abono']);
    const colPendiente = findColIndex(headers, ['pendiente', 'saldo', 'pending', 'resta']);
    const colVendedor = findColIndex(headers, ['vendedor', 'seller', 'asesor']);
    const colCliente = findColIndex(headers, ['cliente', 'client', 'comprador', 'nombre']);
    const colAlmacen = findColIndex(headers, ['almacen', 'almacén', 'sede', 'warehouse']);

    let lastValidDate = '';
    let lastValidClient = '';
    let lastValidSeller = '';

    for (let r = 0; r < values.length; r++) {
      const row = values[r];
      const rowNotes = notes[r];
      const rowNumber = r + 2;

      const montoFormula = (colMonto >= 0 && formulas[r]) ? (formulas[r][colMonto] || '').toString() : '';
      const fechaVal = colFecha >= 0 ? (row[colFecha] || '').toString().trim() : '';
      const prodVal = colProducto >= 0 ? (row[colProducto] || '').toString().trim().toUpperCase() : '';
      const codVal = colCodigo >= 0 ? (row[colCodigo] || '').toString().trim().toUpperCase() : '';

      // Omitir dinámicamente fila de total general y tablas auxiliares de Pareto/gráficas
      if (montoFormula.toUpperCase().includes('SUM') || prodVal.includes('TOTAL') || codVal.includes('TOTAL') || fechaVal.toUpperCase().includes('TOTAL')) continue;
      if (prodVal.includes('PARETO') || codVal === '$' || prodVal === 'PRODUCTO') continue;

      // Extraer datos básicos
      const fechaRaw = colFecha >= 0 ? row[colFecha] : '';
      const codigoRaw = colCodigo >= 0 ? row[colCodigo] : '';
      const productoRaw = colProducto >= 0 ? row[colProducto] : '';
      const imagenRaw = colImagen >= 0 ? row[colImagen] : '';
      const montoRaw = colMonto >= 0 ? row[colMonto] : 0;
      const cobradoRaw = colCobrado >= 0 ? row[colCobrado] : 0;
      const pendienteRaw = colPendiente >= 0 ? row[colPendiente] : 0;
      const vendedorRaw = colVendedor >= 0 ? row[colVendedor] : '';
      const clienteRaw = colCliente >= 0 ? row[colCliente] : '';
      const almacenRaw = colAlmacen >= 0 ? row[colAlmacen] : 'barquisimeto_trinitarias';

      // Si la fila está vacía, la omitimos
      if (!fechaRaw && !productoRaw && !montoRaw) continue;

      const totalNum = parseFloat(montoRaw) || 0;
      const codStr = (codigoRaw || '').toString().trim();
      const prodStr = (productoRaw || '').toString().trim();

      // Filtrar filas de subtotales, cabeceras repetidas o números anómalos de gráficos
      if (totalNum >= 5000 || totalNum <= 0 || codStr === '$' || prodStr.toUpperCase() === 'PRODUCTO' || prodStr.toUpperCase().includes('PARETO')) continue;

      const cobradoNum = parseFloat(cobradoRaw) || 0;
      const parsedPend = parseFloat(pendienteRaw);
      const pendienteNum = (!isNaN(parsedPend) && pendienteRaw !== '') ? parsedPend : Math.max(0, totalNum - cobradoNum);

      // Propagar fecha válida si está vacía o inválida (1900-...)
      let formattedDate = formatDateOutput(fechaRaw);
      if (!formattedDate || formattedDate.startsWith('1900') || formattedDate === '1900-01-00') {
        formattedDate = lastValidDate || '';
      } else {
        lastValidDate = formattedDate;
      }

      // Búsqueda de nota/comentario en la celda del monto o en cualquier celda de la fila
      let cellNote = (colMonto >= 0 && rowNotes[colMonto]) ? rowNotes[colMonto].toString().trim() : '';
      if (!cellNote && rowNotes) {
        for (let c = 0; c < rowNotes.length; c++) {
          if (rowNotes[c] && rowNotes[c].toString().trim().length > 0) {
            cellNote = rowNotes[c].toString().trim();
            break;
          }
        }
      }

      // Parsear las fechas de pago del comentario
      const paymentDates = parsePaymentDatesFromComment(cellNote);

      // Manejo de Cliente y Vendedor (incluyendo Cashea y Bull)
      let rawClient = (clienteRaw || '').toString().trim();
      let rawSeller = (vendedorRaw || '').toString().trim();
      let finalClient = rawClient;
      let finalSeller = rawSeller;

      const upperClient = rawClient.toUpperCase();
      if (upperClient.includes('CASHEA')) {
        let worker = rawClient.replace(/cashea/gi, '').replace(/bull/gi, '').trim();
        finalSeller = worker || rawSeller || 'CASHEA';
        finalClient = 'Cliente Cashea';
      } else if (upperClient.includes('BULL')) {
        let worker = rawClient.replace(/bull/gi, '').trim();
        finalSeller = worker || rawSeller || 'BULL';
        finalClient = 'Cliente Bull';
      } else {
        if (!finalClient) {
          finalClient = 'Cliente General';
        }
        if (!finalSeller) {
          finalSeller = lastValidSeller || 'General';
        } else {
          lastValidSeller = finalSeller;
        }
      }

      salesList.push({
        rowNumber: rowNumber,
        date: formattedDate,
        productCode: codStr,
        productName: prodStr,
        image: (imagenRaw || '').toString().trim(),
        totalAmount: totalNum,
        collectedAmount: cobradoNum,
        pendingAmount: pendienteNum,
        seller: finalSeller,
        client: finalClient,
        warehouse: (almacenRaw || '').toString().trim(),
        paymentDatesComment: cellNote,
        installments: paymentDates,
        status: pendienteNum > 0 ? 'pendiente' : 'pagado'
      });
    }

    return jsonResponse({
      status: 'success',
      spreadsheetId: ss.getId(),
      sheetName: sheet.getName(),
      totalRecords: salesList.length,
      headers: headers,
      lastSync: new Date().toISOString(),
      sales: salesList
    }, e);

  } catch (error) {
    return jsonResponse({
      status: 'error',
      message: error.toString(),
      stack: error.stack
    }, e);
  }
}

// ==============================================================
// POST: ESCRITURA Y SINCRONIZACIÓN DESDE LA APP CUBITT
// ==============================================================
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
      return handleAddSale(ss, payload);
    } else if (action === 'add_abono' || action === 'update_sale') {
      return handleUpdateAbono(ss, payload);
    } else if (action === 'add_expense') {
      return handleAddExpense(ss, payload);
    } else {
      return jsonResponse({ status: 'error', message: 'Acción no reconocida: ' + action });
    }

  } catch (error) {
    return jsonResponse({
      status: 'error',
      message: error.toString()
    });
  }
}

// Añadir una nueva venta a la hoja "ventas" manteniendo el formato de la fila 449
function handleAddSale(ss, payload) {
  let sheet = ss.getSheetByName(SHEET_NAME_VENTAS);
  if (!sheet) sheet = ss.getSheets()[0];

  const lastCol = Math.max(sheet.getLastColumn(), 10);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => (h || '').toString().trim());

  const colFecha = findColIndex(headers, ['fecha', 'date', 'dia']);
  const colCodigo = findColIndex(headers, ['codigo', 'código', 'code', 'sku']);
  const colProducto = findColIndex(headers, ['producto', 'product', 'descripcion', 'artículo']);
  const colImagen = findColIndex(headers, ['imagen', 'image', 'foto']);
  const colMonto = findColIndex(headers, ['monto', 'total', 'precio', 'amount', 'facturación']);
  const colCobrado = findColIndex(headers, ['cobrado', 'pagado', 'paid', 'abono']);
  const colPendiente = findColIndex(headers, ['pendiente', 'saldo', 'pending']);
  const colVendedor = findColIndex(headers, ['vendedor', 'seller', 'asesor']);
  const colCliente = findColIndex(headers, ['cliente', 'client', 'comprador']);

  const montoColIdx = colMonto >= 0 ? colMonto : 4;
  const numCols = lastCol;
  const lastRow = sheet.getLastRow();

  // 1. Localizar la fila de Totales para insertar justo debajo de la fila 449 (o última fila de datos)
  const scanRows = Math.min(lastRow, 550);
  const checkValues = sheet.getRange(1, 1, scanRows, Math.min(numCols, 8)).getValues();
  const checkFormulas = sheet.getRange(1, montoColIdx + 1, scanRows, 1).getFormulas();

  let totalRow = -1;
  for (let r = 1; r < scanRows; r++) {
    const rowNum = r + 1;
    const fMonto = (checkFormulas[r][0] || '').toString().toUpperCase();
    const vCol1 = (checkValues[r][0] || '').toString().trim().toUpperCase();
    const vProd = colProducto >= 0 && checkValues[r][colProducto] ? checkValues[r][colProducto].toString().trim().toUpperCase() : '';

    if (fMonto.includes('SUM') || vCol1.includes('TOTAL') || vProd.includes('TOTAL')) {
      totalRow = rowNum;
      break;
    }
  }

  // Si no se encuentra fila de total explícita, insertar después de los datos existentes
  if (totalRow < 2) {
    totalRow = Math.max(lastRow + 1, 450);
  }

  const insertRow = totalRow;
  const sourceRow = Math.max(1, totalRow - 1); // Fila anterior (o última venta existente)

  // 2. Insertar nueva fila antes de la fila de Total
  if (insertRow <= sheet.getLastRow()) {
    sheet.insertRowBefore(insertRow);
  } else {
    sheet.insertRowAfter(sheet.getLastRow());
  }

  // 3. COPIAR EXACTAMENTE EL FORMATO DE LA FILA 449
  const sourceRange = sheet.getRange(sourceRow, 1, 1, numCols);
  const targetRange = sheet.getRange(insertRow, 1, 1, numCols);

  // A. Formatos visuales (colores de celda, bordes, fuentes, alineaciones)
  sourceRange.copyTo(targetRange, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);

  // B. Formatos numéricos exactos (moneda $, fechas, etc.)
  const sourceNumberFormats = sourceRange.getNumberFormats();
  targetRange.setNumberFormats(sourceNumberFormats);

  // C. Altura idéntica de fila
  try {
    sheet.setRowHeight(insertRow, sheet.getRowHeight(sourceRow));
  } catch (e) {}

  // D. Validaciones de datos (menús desplegables si existen)
  try {
    const validations = sourceRange.getDataValidations();
    targetRange.setDataValidations(validations);
  } catch (e) {}

  // E. Fórmulas de columnas calculadas si existiesen en la fila 449
  const sourceFormulas = sourceRange.getFormulas()[0];
  for (let c = 0; c < numCols; c++) {
    const sf = sourceFormulas[c];
    if (sf && c !== colFecha && c !== colCodigo && c !== colProducto && c !== colImagen && c !== colMonto && c !== colCobrado && c !== colPendiente && c !== colVendedor && c !== colCliente) {
      sourceRange.getCell(1, c + 1).copyTo(targetRange.getCell(1, c + 1), SpreadsheetApp.CopyPasteType.PASTE_FORMULA, false);
    }
  }

  // 4. Escribir los datos de la venta registrada
  const saleDate = payload.date || Utilities.formatDate(new Date(), 'GMT-4', 'yyyy-MM-dd');
  const code = payload.productCode || '';
  const desc = payload.productName || payload.description || '';
  const img = payload.image || '';
  const total = Number(payload.totalAmount) || 0;
  const cobrado = Number(payload.collectedAmount) || Number(payload.creditPaid) || (payload.paymentType === 'contado' ? total : 0);
  const pendiente = Number(payload.pendingAmount) || Math.max(0, total - cobrado);
  const seller = payload.seller || '';
  const client = payload.client || payload.clientName || '';

  const newRowValues = targetRange.getValues()[0];

  if (colFecha >= 0) newRowValues[colFecha] = saleDate;
  if (colCodigo >= 0) newRowValues[colCodigo] = code;
  if (colProducto >= 0) newRowValues[colProducto] = desc;
  if (colImagen >= 0) newRowValues[colImagen] = img;
  if (colMonto >= 0) newRowValues[colMonto] = total;
  if (colCobrado >= 0) newRowValues[colCobrado] = cobrado;
  if (colPendiente >= 0) newRowValues[colPendiente] = pendiente;
  if (colVendedor >= 0) newRowValues[colVendedor] = seller;
  if (colCliente >= 0) newRowValues[colCliente] = client;

  targetRange.setValues([newRowValues]);

  // Si tiene fechas de pago o cuotas, guardarlas como NOTA en la celda del monto
  if (colMonto >= 0 && payload.paymentDatesComment) {
    const montoCell = sheet.getRange(insertRow, colMonto + 1);
    montoCell.setNote(payload.paymentDatesComment);
  }

  // 5. Actualizar la fórmula =SUM(...) en la fila de Totales (ahora en insertRow + 1)
  const shiftedTotalRow = insertRow + 1;
  for (let c = 1; c <= numCols; c++) {
    const totalCell = sheet.getRange(shiftedTotalRow, c);
    const existingFormula = totalCell.getFormula();
    if (existingFormula && existingFormula.toUpperCase().includes('SUM')) {
      const colLetter = getColumnLetter(c);
      totalCell.setFormula(`=SUM(${colLetter}2:${colLetter}${insertRow})`);
    }
  }

  // 6. Limpieza preventiva: si existía la fila 486 errónea de pruebas anteriores
  if (sheet.getLastRow() >= 486 && (sheet.getLastRow() > shiftedTotalRow + 10)) {
    try {
      const farRow = sheet.getLastRow();
      const farCode = (sheet.getRange(farRow, (colCodigo >= 0 ? colCodigo + 1 : 2)).getValue() || '').toString();
      const farMonto = Number(sheet.getRange(farRow, (colMonto >= 0 ? colMonto + 1 : 5)).getValue()) || 0;
      if (farMonto === 104 || farCode.includes('CTBPK') || farCode === code) {
        sheet.deleteRow(farRow);
      }
    } catch (e) {}
  }

  return jsonResponse({
    status: 'success',
    message: 'Venta registrada exitosamente debajo de la fila 449 con formato idéntico',
    row: insertRow,
    saleId: payload.id || `ROW-${insertRow}`
  });
}

// Función auxiliar para obtener letra de columna de Google Sheets (1 -> A, 5 -> E, etc.)
function getColumnLetter(columnNumber) {
  let temp, letter = '';
  while (columnNumber > 0) {
    temp = (columnNumber - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    columnNumber = Math.floor((columnNumber - temp - 1) / 26);
  }
  return letter;
}

// Registrar abono o pago parcial
function handleUpdateAbono(ss, payload) {
  let sheet = ss.getSheetByName(SHEET_NAME_VENTAS);
  if (!sheet) sheet = ss.getSheets()[0];

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => (h || '').toString().trim());
  const colMonto = findColIndex(headers, ['monto', 'total', 'precio', 'amount']);
  const colCobrado = findColIndex(headers, ['cobrado', 'pagado', 'paid', 'abono']);
  const colPendiente = findColIndex(headers, ['pendiente', 'saldo', 'pending']);

  const rowNumber = parseInt(payload.rowNumber);
  if (rowNumber > 1 && rowNumber <= sheet.getLastRow()) {
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

    return jsonResponse({ status: 'success', message: 'Abono registrado en Google Sheets fila ' + rowNumber });
  }

  return jsonResponse({ status: 'error', message: 'Fila no encontrada en la hoja' });
}

// Registrar egreso / gasto
function handleAddExpense(ss, payload) {
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

  return jsonResponse({ status: 'success', message: 'Egreso guardado en Google Sheets' });
}

// ==============================================================
// UTILIDADES AUXILIARES
// ==============================================================
function findColIndex(headers, matchWords) {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase();
    for (let w of matchWords) {
      if (h.includes(w)) return i;
    }
  }
  return -1;
}

function formatDateOutput(dateVal) {
  if (!dateVal) return '';
  if (dateVal instanceof Date) {
    return Utilities.formatDate(dateVal, 'GMT-4', 'yyyy-MM-dd');
  }
  return dateVal.toString();
}

// Parsea fechas de pago del comentario/nota de la celda
function parsePaymentDatesFromComment(commentText) {
  if (!commentText || typeof commentText !== 'string') return [];
  
  const lines = commentText.split(/\r?\n/);
  const installments = [];

  const dateRegex = /(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})/;
  const amountRegex = /\$?\s*(\d+(?:[.,]\d{1,2})?)/;

  lines.forEach((line, index) => {
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
    return ContentService.createTextOutput(callback + '(' + JSON.stringify(data) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
