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

    for (let r = 0; r < values.length; r++) {
      const row = values[r];
      const rowNotes = notes[r];
      const rowNumber = r + 2;

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

      // NOTA / COMENTARIO DE LA CELDA DEL MONTO (Fechas de pago / cuotas)
      const montoNote = colMonto >= 0 ? (rowNotes[colMonto] || '') : '';
      
      // Parsear las fechas de pago del comentario
      const paymentDates = parsePaymentDatesFromComment(montoNote);

      // Si la fila está vacía, la omitimos
      if (!fechaRaw && !productoRaw && !montoRaw) continue;

      const totalNum = parseFloat(montoRaw) || 0;
      const cobradoNum = parseFloat(cobradoRaw) || 0;
      const pendienteNum = pendienteRaw !== '' ? parseFloat(pendienteRaw) : Math.max(0, totalNum - cobradoNum);

      salesList.push({
        rowNumber: rowNumber,
        date: formatDateOutput(fechaRaw),
        productCode: (codigoRaw || '').toString().trim(),
        productName: (productoRaw || '').toString().trim(),
        image: (imagenRaw || '').toString().trim(),
        totalAmount: totalNum,
        collectedAmount: cobradoNum,
        pendingAmount: pendienteNum,
        seller: (vendedorRaw || '').toString().trim(),
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

// Añadir una nueva venta a la hoja "ventas"
function handleAddSale(ss, payload) {
  let sheet = ss.getSheetByName(SHEET_NAME_VENTAS);
  if (!sheet) sheet = ss.getSheets()[0];

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => (h || '').toString().trim());

  const colFecha = findColIndex(headers, ['fecha', 'date', 'dia']);
  const colCodigo = findColIndex(headers, ['codigo', 'código', 'code', 'sku']);
  const colProducto = findColIndex(headers, ['producto', 'product', 'descripcion', 'artículo']);
  const colImagen = findColIndex(headers, ['imagen', 'image', 'foto']);
  const colMonto = findColIndex(headers, ['monto', 'total', 'precio', 'amount', 'facturación']);
  const colCobrado = findColIndex(headers, ['cobrado', 'pagado', 'paid', 'abono']);
  const colPendiente = findColIndex(headers, ['pendiente', 'saldo', 'pending']);
  const colVendedor = findColIndex(headers, ['vendedor', 'seller', 'asesor']);
  const colCliente = findColIndex(headers, ['cliente', 'client', 'comprador']);

  const nextRow = sheet.getLastRow() + 1;
  const numCols = Math.max(sheet.getLastColumn(), 8);
  const newRowValues = new Array(numCols).fill('');

  const saleDate = payload.date || Utilities.formatDate(new Date(), 'GMT-4', 'yyyy-MM-dd');
  const code = payload.productCode || '';
  const desc = payload.productName || payload.description || '';
  const img = payload.image || '';
  const total = Number(payload.totalAmount) || 0;
  const cobrado = Number(payload.collectedAmount) || Number(payload.creditPaid) || (payload.paymentType === 'contado' ? total : 0);
  const pendiente = Number(payload.pendingAmount) || Math.max(0, total - cobrado);
  const seller = payload.seller || '';
  const client = payload.client || payload.clientName || '';

  if (colFecha >= 0) newRowValues[colFecha] = saleDate;
  if (colCodigo >= 0) newRowValues[colCodigo] = code;
  if (colProducto >= 0) newRowValues[colProducto] = desc;
  if (colImagen >= 0) newRowValues[colImagen] = img;
  if (colMonto >= 0) newRowValues[colMonto] = total;
  if (colCobrado >= 0) newRowValues[colCobrado] = cobrado;
  if (colPendiente >= 0) newRowValues[colPendiente] = pendiente;
  if (colVendedor >= 0) newRowValues[colVendedor] = seller;
  if (colCliente >= 0) newRowValues[colCliente] = client;

  // Escribir fila en la hoja
  sheet.getRange(nextRow, 1, 1, numCols).setValues([newRowValues]);

  // Si tiene fechas de pago o cuotas, guardarlas como NOTA en la celda del monto
  if (colMonto >= 0 && payload.paymentDatesComment) {
    const montoCell = sheet.getRange(nextRow, colMonto + 1);
    montoCell.setNote(payload.paymentDatesComment);
  }

  return jsonResponse({
    status: 'success',
    message: 'Venta registrada con éxito en Google Sheets',
    row: nextRow,
    saleId: payload.id || `ROW-${nextRow}`
  });
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
