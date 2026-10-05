/**
 * Configuracion global de la aplicacion Cubitt POS
 * Contiene la API Key de Google Gemini preconfigurada para escaneo inteligente de facturas.
 */
window.CUBITT_CONFIG = {
  // Clave oficial de Google Gemini
  GEMINI_API_KEY: 'AQ.Ab8RN6LzqX9A5nkNrrU1B-2ritm4zgA4sBzU7FgsGpzLeJmKNA',
  // Modelo por defecto: Gemini 3.7 Flash (ultra estable y rapido, con fallback a 3.8 y 3.5)
  GEMINI_DEFAULT_MODEL: 'gemini-3.7-flash',
  // Configuracion de Base de Datos Principal en Google Sheets
  GOOGLE_SHEETS_SPREADSHEET_ID: '18a86QMObmZnX611SmtSBRLVIvZJRYHnqFSr5vFCBtIw',
  GOOGLE_SHEETS_GID_VENTAS: '1352847878',
  GOOGLE_SHEETS_NAME_VENTAS: 'ventas',
  // URL del Web App de Google Apps Script (configurable en la UI)
  GOOGLE_APPS_SCRIPT_URL: ''
};
