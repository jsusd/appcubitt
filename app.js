/**
 * Cubitt Sales Registration & Point of Sale Application
 * Handles product lookup, sales calculations, credit management (Cashea Bull, Cashea T-Mania, JP),
 * multiple payment methods (Panamá, Binance, PayPal, Zinli), additional customizable commissions,
 * Accounts Payable (Cuentas por Pagar CXP), reconciliation, receipts & history.
 */

// Global State
const state = {
  products: [],
  selectedProduct: null,
  cart: [],
  sales: [],
  payables: [],
  clients: [],
  sellers: [],
  editingSale: null,
  creditSubtype: 'cashea_bull', // 'cashea_bull', 'cashea_tmania', 'jp'
  activeTab: 'pos', // 'pos', 'history', 'credits', 'payables', 'catalog', 'clients'
  posPlatform: 'ninguna', // 'ninguna', 'mercadolibre', 'facebook_marketplace'
  posSaleItems: [], // Multi-product items in current POS sale: [{ code, description, category, image, quantity, unitPrice, mayor, subtotal }]
  historyFilterPlatform: 'all', // 'all', 'ninguna', 'mercadolibre', 'facebook_marketplace', 'online_all'
  historyFilterType: 'all', // 'all', 'contado', 'cashea_bull', 'cashea_tmania', 'jp'
  historyFilterCreditStatus: 'all', // 'all', 'pendiente', 'pagado'
  historyFilterDate: 'all', // 'all', 'today', 'week', 'month'
  historySearchQuery: '',
  cxpFilterStatus: 'all', // 'all', 'pendiente', 'conciliado'
  cxpFilterCat: 'all', // 'all', 'CASHEA', 'IVA', 'TMANIA', 'ADICIONAL'
  cxpSearchQuery: '',
  catalogSearchQuery: '',
  catalogCategoryFilter: 'all',
  catalogStatusFilter: 'all',
  clientFilterStatus: 'all', // 'all', 'debt', 'clear'
  clientSearchQuery: '',
  currentProfileClientId: null,
  sellerTabFilter: 'all', // 'all', 'active', 'inactive'
  sellerTabSearchQuery: '',
  orderMode: 'inmediata', // 'inmediata', 'bajo_pedido'
  ordersFilterStatus: 'all', // 'all', 'PENDIENTE_COMPRA', 'EN_CAMINO', 'LISTO_ENTREGA', 'ENTREGADO'
  ordersSearchQuery: '',
  users: [],
  usersFilterRole: 'all', // 'all', 'gerencia', 'inversor', 'vendedor'
  usersFilterStatus: 'all', // 'all', 'ACTIVO', 'INACTIVO'
  usersSearchQuery: '',
  revealedUserPasswords: {},
  currentUser: null,
  goalsSearchQuery: '',
  // Inventory & Invoices State
  invoices: [],
  inventoryMovements: [],
  inventorySubTab: 'stock', // 'stock', 'invoices', 'movements'
  inventoryFilterCategory: 'all',
  inventoryFilterStockStatus: 'all', // 'all', 'disponible', 'bajo', 'agotado'
  inventorySearchQuery: '',
  invoicesSearchQuery: '',
  currentUploadedInvoicePhoto: null
};
window.state = state;

// ==========================================================================
// STORAGE QUOTA PROTECTION & SELF-HEALING UTILITIES
// ==========================================================================
function cleanupStorageQuota() {
  try {
    // 1. Sanitize invoices in localStorage: trim oversized base64 images (> 80KB)
    const rawInvoices = localStorage.getItem('cubitt_invoices_v1');
    if (rawInvoices) {
      try {
        const invoices = JSON.parse(rawInvoices);
        let modified = false;
        invoices.forEach(inv => {
          if (inv.photoData && inv.photoData.length > 80000) {
            inv.photoData = null; // Free up megabytes of browser storage
            modified = true;
          }
        });
        if (modified) {
          localStorage.setItem('cubitt_invoices_v1', JSON.stringify(invoices));
          console.log('[Storage] Sanitized large invoice photos to restore quota.');
        }
      } catch (e) {
        console.warn('[Storage] Could not parse invoices during cleanup:', e);
      }
    }

    // 2. Remove any temporary or legacy cache keys
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('temp_') || k.startsWith('ocr_cache_') || k.includes('debug'))) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch (err) {
    console.warn('[Storage] cleanupStorageQuota warning:', err);
  }
}

// Run cleanup immediately on script evaluation
cleanupStorageQuota();

function safeStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    console.warn(`[Storage] Quota exceeded while writing "${key}". Running emergency cleanup...`, e);
    cleanupStorageQuota();
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e2) {
      console.error(`[Storage] Save strictly failed for "${key}". Storage full.`, e2);
      return false;
    }
  }
}

function compressImageForStorage(dataUrl, maxDimension = 1200, quality = 0.7) {
  return new Promise((resolve) => {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) {
      resolve(dataUrl);
      return;
    }
    const img = new Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  loadProductsFromStorage();
  loadSalesFromStorage();
  loadPayablesFromStorage();
  loadSellersFromStorage();
  loadClientsFromStorage();
  loadUsersFromStorage();
  loadInvoicesFromStorage();
  loadInventoryMovementsFromStorage();
  loadSessionFromStorage();
  
  // Synchronize payables for all recorded sales (Cashea, IVA, T-Mania, and custom commissions)
  if (state.sales && state.sales.length > 0) {
    state.sales.forEach(sale => {
      syncPayablesForSale(sale);
    });
  }

  initEventListeners();
  initSaleDateInput();
  populateSellerSelects();
  applyUserRoleUI();
  renderTopStats();
  renderCatalog();
  renderHistory();
  renderCredits();
  renderPayables();
  renderClients();
  renderSellersTab();
  renderOrdersTab();
  renderGoalsTab();
  renderUsersTab();
  renderInventoryTab();
  updateInventoryBadges();
  setupAutocomplete();
  setupClientAutocomplete();
  
  // Set default credit due date to 15 days ahead
  const defaultDueDate = new Date();
  defaultDueDate.setDate(defaultDueDate.getDate() + 15);
  const dueInput = document.getElementById('creditDueDate');
  if (dueInput) {
    dueInput.value = defaultDueDate.toISOString().split('T')[0];
  }

  // Set default conciliar date
  const concDate = document.getElementById('conciliarDateInput');
  if (concDate) {
    concDate.value = new Date().toISOString().split('T')[0];
  }

  updateLiveCalculations();
});

// Initialize Date/Time input to current local time
function initSaleDateInput() {
  const dateInput = document.getElementById('saleDateInput');
  if (dateInput) {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(now.getTime() - offset)).toISOString().slice(0, 16);
    dateInput.value = localISOTime;
  }
}

function getSelectedSaleDate() {
  const dateInput = document.getElementById('saleDateInput');
  if (dateInput && dateInput.value) {
    const d = new Date(dateInput.value);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date();
}

// Storage Management - Sales
function loadSalesFromStorage() {
  try {
    const saved = localStorage.getItem('cubitt_sales_v2');
    if (saved) {
      state.sales = JSON.parse(saved);
      state.sales.forEach(s => {
        if (s.isBajoPedido === undefined) s.isBajoPedido = false;
        if (!s.orderStatus) s.orderStatus = s.isBajoPedido ? 'PENDIENTE_COMPRA' : 'ENTREGADO';
      });
    } else {
      // Pre-seed with realistic demo sales
      state.sales = [
        {
          id: 'CUB-1001',
          timestamp: new Date(Date.now() - 3600000 * 2).toISOString(),
          displayDate: formatDateTime(new Date(Date.now() - 3600000 * 2)),
          items: [
            {
              code: 'CTHR-1',
              category: 'RELOJ INTELIGENTE C/ CONEXIÓN BLUETOOTH',
              image: 'images/CTHR-1.png',
              quantity: 1,
              unitPrice: 69.00,
              mayor: 44.13,
              subtotal: 69.00
            }
          ],
          totalAmount: 69.00,
          totalMayor: 44.13,
          totalProfit: 21.42, // Deduciendo $3.45 de comisión vendedor
          paymentType: 'contado',
          paymentMethod: 'Efectivo ($ USD)',
          creditSubtype: null,
          creditSubtypeLabel: null,
          vendedor: null,
          clientName: 'María Rodríguez',
          clientPhone: '0412-5551234',
          creditDueDate: '',
          creditAbono: 0,
          creditBalance: 0,
          creditStatus: 'PAGADO',
          comisionCashea: 0,
          comisionTMania: 0,
          montoIVA: 0,
          netoTienda: 69.00,
          additionalCommissionsTotal: 3.45,
          notes: 'Garantía oficial Cubitt',
          isBajoPedido: false,
          orderStatus: 'ENTREGADO',
          orderDeliveredAt: new Date(Date.now() - 3600000 * 2).toISOString(),
          orderDeliveryNotes: 'Entrega directa en tienda',
          paymentsHistory: []
        },
        {
          id: 'CUB-1002',
          timestamp: new Date(Date.now() - 3600000 * 24).toISOString(),
          displayDate: formatDateTime(new Date(Date.now() - 3600000 * 24)),
          items: [
            {
              code: 'CT-AURA2-1',
              category: 'RELOJ INTELIGENTE C/ CONEXIÓN BLUETOOTH',
              image: 'images/CT-AURA2-1.png',
              quantity: 1,
              unitPrice: 114.00,
              mayor: 67.83,
              subtotal: 114.00
            }
          ],
          totalAmount: 114.00,
          totalMayor: 67.83,
          totalProfit: 20.80,
          paymentType: 'credito',
          paymentMethod: 'Pago Móvil / Transferencia',
          creditSubtype: 'cashea_bull',
          creditSubtypeLabel: 'Cashea Bull',
          vendedor: null,
          clientName: 'Carlos Gómez',
          clientPhone: '0414-9876543',
          creditDueDate: new Date(Date.now() + 86400000 * 14).toISOString().split('T')[0],
          creditAbono: 45.60,
          creditBalance: 68.40,
          creditStatus: 'PENDIENTE',
          comisionCashea: 3.42,
          comisionTMania: 0,
          montoIVA: 15.72,
          netoTienda: 94.86,
          additionalCommissionsTotal: 0,
          notes: 'Orden Cashea #CSH-98213',
          isBajoPedido: false,
          orderStatus: 'ENTREGADO',
          orderDeliveredAt: new Date(Date.now() - 3600000 * 24).toISOString(),
          orderDeliveryNotes: 'Entrega directa en tienda',
          paymentsHistory: [
            { date: formatDateTime(new Date(Date.now() - 3600000 * 24)), amount: 45.60, method: 'Pago Móvil / Transferencia', note: 'Inicial Cashea' }
          ]
        },
        {
          id: 'CUB-1003',
          timestamp: new Date(Date.now() - 3600000 * 5).toISOString(),
          displayDate: formatDateTime(new Date(Date.now() - 3600000 * 5)),
          items: [
            {
              code: 'CT-COF1',
              category: 'TERMO COFFEE MUG COLOR NEGRO OBSIDIANA',
              image: 'images/CT-COF1.png',
              quantity: 2,
              unitPrice: 28.00,
              mayor: 16.50,
              subtotal: 56.00
            }
          ],
          totalAmount: 56.00,
          totalMayor: 33.00,
          totalProfit: 23.00,
          paymentType: 'contado',
          paymentMethod: 'Pago Móvil / Transferencia',
          creditSubtype: null,
          creditSubtypeLabel: null,
          vendedor: 'Juan Pérez',
          clientName: 'Roberto Méndez',
          clientPhone: '0414-7778899',
          creditDueDate: '',
          creditAbono: 56.00,
          creditBalance: 0,
          creditStatus: 'PAGADO',
          comisionCashea: 0,
          comisionTMania: 0,
          montoIVA: 0,
          netoTienda: 56.00,
          additionalCommissionsTotal: 0,
          notes: 'Cliente desea color Negro Obsidiana, encargo especial sin stock',
          isBajoPedido: true,
          orderStatus: 'PENDIENTE_COMPRA',
          orderExpectedDate: new Date(Date.now() + 86400000 * 4).toISOString().split('T')[0],
          orderSupplierNotes: 'Solicitar 2 unidades al distribuidor central',
          orderDeliveredAt: null,
          orderDeliveryNotes: '',
          paymentsHistory: []
        }
      ];
      saveSalesToStorage();
    }
  } catch (e) {
    console.error('Error loading sales:', e);
    state.sales = [];
  }
}

function saveSalesToStorage() {
  try {
    localStorage.setItem('cubitt_sales_v2', JSON.stringify(state.sales));
    renderTopStats();
  } catch (e) {
    console.error('Error saving sales:', e);
  }
}

// Storage Management - Payables (CXP)
function loadPayablesFromStorage() {
  try {
    const saved = localStorage.getItem('cubitt_payables_v1');
    if (saved) {
      state.payables = JSON.parse(saved);
    } else {
      // Pre-seed demo payable matching sale CUB-1001
      state.payables = [
        {
          id: 'CXP-1001-1',
          saleId: 'CUB-1001',
          saleDate: formatDateTime(new Date(Date.now() - 3600000 * 2)),
          concept: 'Comisión Vendedor / Asesor',
          beneficiary: 'Juan Vendedor',
          type: '%',
          rate: 5,
          amount: 3.45,
          status: 'PENDIENTE',
          createdAt: new Date(Date.now() - 3600000 * 2).toISOString(),
          paidAt: null,
          paidDisplayDate: null,
          paidMethod: null,
          paidReference: null,
          paidNotes: null
        }
      ];
      savePayablesToStorage();
    }
  } catch (e) {
    console.error('Error loading payables:', e);
    state.payables = [];
  }
}

function savePayablesToStorage() {
  try {
    localStorage.setItem('cubitt_payables_v1', JSON.stringify(state.payables));
    renderTopStats();
  } catch (e) {
    console.error('Error saving payables:', e);
  }
}

// Synchronize Accounts Payable (CXP) for a sale (Cashea, IVA, T-Mania, and custom commissions)
function syncPayablesForSale(saleRecord) {
  if (!saleRecord || !saleRecord.id) return;
  const saleId = saleRecord.id;
  const saleIdNum = saleId.replace('CUB-', '');
  const saleDateStr = saleRecord.displayDate || formatDateTime(new Date(saleRecord.timestamp || Date.now()));

  const expectedPayables = [];

  // 1. Comisión Cashea (if > 0)
  if (saleRecord.comisionCashea && saleRecord.comisionCashea > 0) {
    const isBull = saleRecord.creditSubtype === 'cashea_bull';
    expectedPayables.push({
      id: `CXP-${saleIdNum}-CSH`,
      saleId: saleId,
      saleDate: saleDateStr,
      concept: isBull ? 'Comisión Cashea Bull (3%)' : 'Comisión Cashea T-Mania (8%)',
      beneficiary: 'Cashea App',
      type: '$',
      rate: saleRecord.comisionCashea,
      amount: saleRecord.comisionCashea,
      category: 'CASHEA'
    });
  }

  // 2. IVA 16% Facturación (if > 0, Cashea Bull)
  if (saleRecord.montoIVA && saleRecord.montoIVA > 0) {
    expectedPayables.push({
      id: `CXP-${saleIdNum}-IVA`,
      saleId: saleId,
      saleDate: saleDateStr,
      concept: 'IVA 16% Facturación (Cashea Bull)',
      beneficiary: 'SENIAT / Fiscal (IVA)',
      type: '$',
      rate: saleRecord.montoIVA,
      amount: saleRecord.montoIVA,
      category: 'IVA'
    });
  }

  // 3. Comisión T-Mania (if > 0)
  if (saleRecord.comisionTMania && saleRecord.comisionTMania > 0) {
    expectedPayables.push({
      id: `CXP-${saleIdNum}-TM`,
      saleId: saleId,
      saleDate: saleDateStr,
      concept: 'Comisión Aliado T-Mania (10%)',
      beneficiary: 'T-Mania',
      type: '$',
      rate: saleRecord.comisionTMania,
      amount: saleRecord.comisionTMania,
      category: 'TMANIA'
    });
  }

  // 4. Comisiones Adicionales Personalizadas ($ fijos)
  if (saleRecord.additionalCommissions && Array.isArray(saleRecord.additionalCommissions)) {
    saleRecord.additionalCommissions.forEach((c, idx) => {
      const amt = typeof c.amount === 'number' ? c.amount : (parseFloat(c.amount) || 0);
      if (amt > 0) {
        const slotNum = c.slot || (idx + 1);
        expectedPayables.push({
          id: `CXP-${saleIdNum}-COMM${slotNum}`,
          saleId: saleId,
          saleDate: saleDateStr,
          concept: c.concept || `Comisión ${slotNum}`,
          beneficiary: c.beneficiary || 'Beneficiario No Especificado',
          type: '$',
          rate: amt,
          amount: amt,
          category: 'ADICIONAL'
        });
      }
    });
  }

  // 5. Comisión MercadoLibre 12% (Plataforma MercadoLibre o legado)
  const isML = (saleRecord.plataforma === 'mercadolibre') || saleRecord.paymentType === 'contado_mercadolibre' || saleRecord.paymentMethod === 'Contado - MercadoLibre';
  const mlCommission = (saleRecord.comisionMercadoLibre !== undefined && saleRecord.comisionMercadoLibre > 0)
    ? saleRecord.comisionMercadoLibre
    : (isML ? (saleRecord.totalAmount || 0) * 0.12 : 0);

  if (mlCommission > 0) {
    expectedPayables.push({
      id: `CXP-${saleIdNum}-ML`,
      saleId: saleId,
      saleDate: saleDateStr,
      concept: 'Comisión MercadoLibre (12%)',
      beneficiary: 'MercadoLibre',
      type: '$',
      rate: mlCommission,
      amount: mlCommission,
      category: 'MERCADOLIBRE'
    });
  }

  // Update existing payables or add new ones
  expectedPayables.forEach(expected => {
    const existingIndex = state.payables.findIndex(p => p.id === expected.id);
    if (existingIndex >= 0) {
      const existing = state.payables[existingIndex];
      existing.concept = expected.concept;
      existing.beneficiary = expected.beneficiary;
      existing.amount = expected.amount;
      existing.rate = expected.rate;
      existing.saleDate = expected.saleDate;
      existing.category = expected.category;
    } else {
      state.payables.unshift({
        id: expected.id,
        saleId: expected.saleId,
        saleDate: expected.saleDate,
        concept: expected.concept,
        beneficiary: expected.beneficiary,
        type: '$',
        rate: expected.rate,
        amount: expected.amount,
        status: 'PENDIENTE',
        category: expected.category,
        createdAt: saleRecord.timestamp || new Date().toISOString(),
        paidAt: null,
        paidDisplayDate: null,
        paidMethod: null,
        paidReference: null,
        paidNotes: null
      });
    }
  });

  // Remove payables belonging to this sale that are no longer expected and are still PENDIENTE
  const expectedIds = new Set(expectedPayables.map(e => e.id));
  state.payables = state.payables.filter(p => {
    if (p.saleId !== saleId) return true;
    if (p.status === 'CONCILIADO') return true; // Keep already paid records intact
    return expectedIds.has(p.id);
  });

  savePayablesToStorage();
}

// Top Bar Stats
function renderTopStats() {
  const accessibleSales = getAccessibleSales();
  const accessiblePayables = getAccessiblePayables();

  const totalSalesCount = accessibleSales.length;
  const totalMoney = accessibleSales.reduce((acc, s) => acc + (s.totalAmount || 0), 0);
  const pendingCredit = accessibleSales
    .filter(s => s.paymentType === 'credito' && s.creditStatus === 'PENDIENTE')
    .reduce((acc, s) => acc + (s.creditBalance || 0), 0);

  const pendingCXP = accessiblePayables
    .filter(p => p.status === 'PENDIENTE')
    .reduce((acc, p) => acc + (p.amount || 0), 0);

  const pendingCXPCount = accessiblePayables.filter(p => p.status === 'PENDIENTE').length;

  const elSalesCount = document.getElementById('topTotalSalesCount');
  const elTotalMoney = document.getElementById('topTotalMoney');
  const elPendingCredit = document.getElementById('topPendingCredit');
  const elPendingCXP = document.getElementById('topPendingCXP');

  if (elSalesCount) elSalesCount.textContent = totalSalesCount;
  if (elTotalMoney) elTotalMoney.textContent = `$${totalMoney.toFixed(2)}`;
  if (elPendingCredit) elPendingCredit.textContent = `$${pendingCredit.toFixed(2)}`;
  if (elPendingCXP) elPendingCXP.textContent = `$${pendingCXP.toFixed(2)}`;

  // Update badge counters in nav
  const historyCount = document.getElementById('badgeHistoryCount');
  const creditCount = document.getElementById('badgeCreditCount');
  const payablesCount = document.getElementById('badgePayablesCount');
  const cuentasTotalBadge = document.getElementById('badgeCuentasTotal');
  const sellersBadge = document.getElementById('badgeSellersCount');
  const bajoPedidoBadge = document.getElementById('badgeBajoPedidoCount');

  if (historyCount) historyCount.textContent = totalSalesCount;
  const pCount = accessibleSales.filter(s => s.paymentType === 'credito' && s.creditStatus === 'PENDIENTE').length;
  if (creditCount) creditCount.textContent = pCount;
  if (payablesCount) payablesCount.textContent = pendingCXPCount;
  if (cuentasTotalBadge) cuentasTotalBadge.textContent = pCount + pendingCXPCount;
  if (sellersBadge) sellersBadge.textContent = state.sellers ? state.sellers.length : 0;
  if (bajoPedidoBadge) {
    const pendingOrdersCount = (accessibleSales || []).filter(s => s.isBajoPedido && s.orderStatus !== 'ENTREGADO').length;
    bajoPedidoBadge.textContent = pendingOrdersCount;
  }
  const clientsBadge = document.getElementById('badgeClientsCount');
  if (clientsBadge) clientsBadge.textContent = state.clients ? state.clients.length : 0;
  const usersBadge = document.getElementById('badgeUsersCount');
  if (usersBadge) usersBadge.textContent = state.users ? state.users.length : 0;

  updateGoalsBonusBadge();
}

// Tab Switching
function switchTab(tabName) {
  if (!tabName) return;

  // Protect users tab for gerencia only
  if (tabName === 'users' && !isGerencia()) {
    showToast('Acceso restringido: Solo Gerencia puede gestionar usuarios', 'danger');
    switchTab('pos');
    return;
  }

  state.activeTab = tabName;
  document.querySelectorAll('.nav-tab-btn[data-tab]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.toggle('active', pane.id === `tab-${tabName}`);
  });

  // Highlight active dropdowns
  const financesBtn = document.getElementById('navBtnFinances');
  if (financesBtn) {
    const isFinanceActive = (tabName === 'credits' || tabName === 'payables');
    financesBtn.classList.toggle('active', isFinanceActive);
  }
  const sellersBtn = document.getElementById('navBtnSellers');
  if (sellersBtn) {
    const isSellerActive = (tabName === 'sellers' || tabName === 'goals');
    sellersBtn.classList.toggle('active', isSellerActive);
  }
  const moreBtn = document.getElementById('navBtnMore');
  if (moreBtn) {
    const isMoreActive = (tabName === 'catalog' || tabName === 'orders' || tabName === 'users');
    moreBtn.classList.toggle('active', isMoreActive);
  }

  // Update active state inside dropdown menus
  const navItemCredits = document.getElementById('navItemCredits');
  if (navItemCredits) navItemCredits.classList.toggle('active', tabName === 'credits');
  const navItemPayables = document.getElementById('navItemPayables');
  if (navItemPayables) navItemPayables.classList.toggle('active', tabName === 'payables');
  const navItemSellersDir = document.getElementById('navItemSellersDir');
  if (navItemSellersDir) navItemSellersDir.classList.toggle('active', tabName === 'sellers');
  const navItemGoals = document.getElementById('navItemGoals');
  if (navItemGoals) navItemGoals.classList.toggle('active', tabName === 'goals');
  const navItemCatalog = document.getElementById('navItemCatalog');
  if (navItemCatalog) navItemCatalog.classList.toggle('active', tabName === 'catalog');
  const navItemOrders = document.getElementById('navItemOrders');
  if (navItemOrders) navItemOrders.classList.toggle('active', tabName === 'orders');
  const navItemUsers = document.getElementById('navItemUsers');
  if (navItemUsers) navItemUsers.classList.toggle('active', tabName === 'users');

  closeAllNavDropdowns();

  if (tabName === 'history') {
    renderHistory();
  } else if (tabName === 'credits') {
    renderCredits();
  } else if (tabName === 'payables') {
    renderPayables();
  } else if (tabName === 'catalog') {
    renderCatalog();
  } else if (tabName === 'clients') {
    renderClients();
  } else if (tabName === 'sellers') {
    renderSellersTab();
  } else if (tabName === 'orders') {
    renderOrdersTab();
  } else if (tabName === 'goals') {
    renderGoalsTab();
  } else if (tabName === 'users') {
    renderUsersTab();
  } else if (tabName === 'inventory') {
    renderInventoryTab();
  }
}

// Modalidad de Entrega (Entrega Inmediata vs Bajo Pedido)
function setOrderMode(mode) {
  state.orderMode = mode;
  const immCard = document.getElementById('modeImmediate');
  const bpCard = document.getElementById('modeBajoPedido');
  const bpPanel = document.getElementById('bajoPedidoPanel');

  if (immCard) immCard.classList.toggle('selected', mode === 'inmediata');
  if (bpCard) bpCard.classList.toggle('selected', mode === 'bajo_pedido');
  if (bpPanel) bpPanel.style.display = mode === 'bajo_pedido' ? 'block' : 'none';
}

function switchToBajoPedidoPOS() {
  switchTab('pos');
  setOrderMode('bajo_pedido');
  const searchInput = document.getElementById('productSearchInput');
  if (searchInput) searchInput.focus();
  showToast('Modo "Venta Bajo Pedido" activado en el POS', 'info');
}

// Nav Dropdowns Handlers
function toggleNavDropdown(dropdownId, event) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  const dropdown = document.getElementById(dropdownId);
  if (!dropdown) return;
  const wasOpen = dropdown.classList.contains('open');
  closeAllNavDropdowns();
  if (!wasOpen) {
    dropdown.classList.add('open');
  }
}

function closeAllNavDropdowns() {
  document.querySelectorAll('.nav-dropdown').forEach(d => d.classList.remove('open'));
}

// Autocomplete & Product Selection
function setupAutocomplete() {
  const searchInput = document.getElementById('productSearchInput');
  const dropdown = document.getElementById('autocompleteDropdown');
  const clearBtn = document.getElementById('clearSearchBtn');

  if (!searchInput || !dropdown) return;

  searchInput.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    clearBtn.classList.toggle('visible', q.length > 0);

    if (q.length === 0) {
      dropdown.classList.remove('show');
      dropdown.innerHTML = '';
      return;
    }

    const matches = state.products.filter(p => {
      const descMatch = (p.description || '').toLowerCase().includes(q);
      const codeMatch = (p.code || '').toLowerCase().includes(q);
      const catMatch = (p.category || '').toLowerCase().includes(q);
      return descMatch || codeMatch || catMatch;
    }).slice(0, 20);

    if (matches.length === 0) {
      dropdown.innerHTML = `<div class="autocomplete-empty">No se encontraron productos con "<strong>${escapeHtml(q)}</strong>"</div>`;
      dropdown.classList.add('show');
      return;
    }

    dropdown.innerHTML = matches.map(p => {
      const title = p.description || p.category || p.code;
      const cost = (p.mayor !== undefined ? p.mayor : (p.costo || 0));
      const pvp = (p.pvpActual || p.pvpTienda || 0);
      const photoCount = Array.isArray(p.images) && p.images.length > 1 ? `<span style="font-size: 0.72rem; color: #64748b; font-weight: normal; margin-left: 4px;">📷 ${p.images.length} fotos</span>` : '';
      return `
        <div class="autocomplete-item" onclick="selectProductByCode('${escapeHtml(p.code)}')">
          <img class="autocomplete-thumb" src="${p.image || 'images/placeholder.png'}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'40\\' height=\\'40\\' fill=\\'%23ccc\\' viewBox=\\'0 0 24 24\\'><rect width=\\'24\\' height=\\'24\\' fill=\\'%23eee\\'/><text x=\\'50%\\' y=\\'50%\\' dominant-baseline=\\'middle\\' text-anchor=\\'middle\\' font-size=\\'8\\'>Cubitt</text></svg>'">
          <div class="autocomplete-details">
            <div style="font-weight: 700; color: #0f172a; font-size: 0.93rem; line-height: 1.25;">
              ${escapeHtml(title)} ${photoCount}
            </div>
            <div style="display: flex; align-items: center; gap: 6px; margin-top: 2px; flex-wrap: wrap;">
              <span class="product-code-tag" style="font-size: 0.72rem; padding: 1px 6px; background: #0f172a; color: #ffffff; border-radius: 4px;">${escapeHtml(p.code)}</span>
              <span class="autocomplete-cat" style="font-size: 0.76rem; color: #64748b;">${escapeHtml(p.category)}</span>
              <span class="status-badge ${p.status.toLowerCase()}" style="font-size: 0.68rem; padding: 1px 5px;">${p.status}</span>
            </div>
          </div>
          <div style="text-align: right; flex-shrink: 0; min-width: 85px;">
            <div class="autocomplete-price" style="font-weight: 800; color: #059669; font-size: 0.98rem;">$${pvp.toFixed(2)}</div>
            <div style="font-size: 0.72rem; color: #64748b; font-weight: 500;">Costo: $${cost.toFixed(2)}</div>
          </div>
        </div>
      `;
    }).join('');

    dropdown.classList.add('show');
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = e.target.value.trim().toLowerCase();
      if (!q) return;
      const exact = state.products.find(p => p.code.toLowerCase() === q);
      if (exact) {
        selectProductByCode(exact.code);
        document.getElementById('saleQtyInput')?.focus();
        return;
      }
      const first = state.products.find(p => 
        (p.description || '').toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) || 
        p.category.toLowerCase().includes(q)
      );
      if (first) {
        selectProductByCode(first.code);
        document.getElementById('saleQtyInput')?.focus();
      }
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrapper')) {
      dropdown.classList.remove('show');
    }
  });

  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    clearBtn.classList.remove('visible');
    dropdown.classList.remove('show');
    searchInput.focus();
  });
}

function selectProductByCode(code) {
  const product = state.products.find(p => p.code.toLowerCase() === code.toLowerCase());
  if (!product) {
    showToast('Producto no encontrado', 'danger');
    return;
  }

  state.selectedProduct = product;
  const searchInput = document.getElementById('productSearchInput');
  const dropdown = document.getElementById('autocompleteDropdown');
  if (searchInput) searchInput.value = product.description ? `${product.code} - ${product.description}` : product.code;
  if (dropdown) dropdown.classList.remove('show');

  renderProductPreview(product);

  const priceInput = document.getElementById('salePriceInput');
  if (priceInput) {
    priceInput.value = (product.pvpActual || product.pvpTienda || 0).toFixed(2);
  }

  const qtyInput = document.getElementById('saleQtyInput');
  if (qtyInput) {
    qtyInput.value = 1;
  }

  updateLiveCalculations();
}

function renderProductPreview(product) {
  const container = document.getElementById('productPreviewBox');
  if (!container) return;

  if (!product) {
    container.innerHTML = `
      <div class="no-product-selected">
        <div class="no-product-icon">
          <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7"/>
          </svg>
        </div>
        <p style="font-weight: 600;">Escribe o selecciona un producto por descripción o código</p>
        <p style="font-size: 0.85rem; color: #94a3b8; margin-top: 4px;">Ejemplos: <strong>Termo Coffee Mug</strong>, <strong>CT-COF1</strong>, <strong>CTHR-1</strong></p>
      </div>
    `;
    return;
  }

  const images = Array.isArray(product.images) && product.images.length > 0 
    ? product.images.filter(Boolean) 
    : (product.image ? [product.image] : ['images/placeholder.png']);
  const mainImg = images[0] || 'images/placeholder.png';
  const statusClass = (product.status || 'DISPONIBLE').toLowerCase();
  const title = product.description || product.category || product.code;
  const pvp = (product.pvpActual || product.pvpTienda || 0);
  const cost = (product.mayor !== undefined ? product.mayor : (product.costo || 0));
  const margin = pvp - cost;

  const thumbsHtml = images.length > 1 ? `
    <div class="product-gallery-strip">
      ${images.map((im, idx) => `
        <div class="gallery-thumb-item ${idx === 0 ? 'active' : ''}" onclick="switchPreviewImage('${im}', this, ${idx})" title="Ver foto ${idx + 1}">
          <img src="${im}" alt="Foto ${idx + 1}">
        </div>
      `).join('')}
    </div>
  ` : '';

  container.innerHTML = `
    <div class="product-hero-box">
      <div style="display: flex; flex-direction: column; align-items: center; flex-shrink: 0;">
        <div class="product-image-frame" onclick="openImageLightbox('${mainImg}', '${escapeHtml(title)}', ${JSON.stringify(images).replace(/"/g, '&quot;')}, 0, '${escapeHtml(product.code)} • ${escapeHtml(product.category)}')">
          <img src="${mainImg}" alt="${escapeHtml(title)}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'120\\' height=\\'120\\' fill=\\'%23ddd\\' viewBox=\\'0 0 24 24\\'><rect width=\\'24\\' height=\\'24\\' fill=\\'%23f3f4f6\\'/><text x=\\'50%\\' y=\\'50%\\' dominant-baseline=\\'middle\\' text-anchor=\\'middle\\' font-size=\\'6\\'>Cubitt</text></svg>'">
          <span class="zoom-hint">🔍 Zoom</span>
        </div>
        ${thumbsHtml}
      </div>
      <div class="product-info-col">
        <h3 class="product-hero-title">${escapeHtml(title)}</h3>
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <span class="product-code-tag" style="font-size: 1rem; padding: 2px 8px; background: #0f172a; color: #fff; border-radius: 6px;">${escapeHtml(product.code)}</span>
          <span class="product-category-text" style="font-size: 0.82rem; color: #64748b; font-weight: 600;">${escapeHtml(product.category)}</span>
          <span class="status-badge ${statusClass}">${product.status}</span>
        </div>
        <div class="price-references-row">
          <div class="price-ref-pill">
            PVP Tienda: <strong style="color: #059669; font-size: 1rem;">$${pvp.toFixed(2)}</strong>
          </div>
          <div class="price-ref-pill">
            Costo del Producto: <strong>$${cost.toFixed(2)}</strong>
          </div>
          <div class="price-ref-pill" style="color: #059669; background: #ecfdf5; border-color: #a7f3d0;">
            Margen: <strong>+$${margin.toFixed(2)}</strong>
          </div>
        </div>
      </div>
    </div>
  `;
}

function switchPreviewImage(src, el, idx) {
  const mainImg = document.querySelector('#productPreviewBox .product-image-frame img');
  if (mainImg) mainImg.src = src;
  document.querySelectorAll('#productPreviewBox .gallery-thumb-item').forEach(thumb => thumb.classList.remove('active'));
  if (el) el.classList.add('active');
  const frame = document.querySelector('#productPreviewBox .product-image-frame');
  if (frame && state.selectedProduct) {
    const images = Array.isArray(state.selectedProduct.images) && state.selectedProduct.images.length > 0 
      ? state.selectedProduct.images.filter(Boolean) 
      : [state.selectedProduct.image];
    const title = state.selectedProduct.description || state.selectedProduct.category || state.selectedProduct.code;
    const sub = `${state.selectedProduct.code} • ${state.selectedProduct.category}`;
    frame.onclick = () => openImageLightbox(src, title, images, idx, sub);
  }
}

// ==========================================================================
// PLATAFORMAS DE VENTA (CANAL ONLINE VS TIENDA DIRECTA)
// ==========================================================================
function setSalesPlatform(platform) {
  if (platform === 'facebook') platform = 'facebook_marketplace';
  state.posPlatform = platform || 'ninguna';

  const pNone = document.getElementById('platformNone');
  const pML = document.getElementById('platformMercadoLibre');
  const pFB = document.getElementById('platformFacebook');
  const mlNotice = document.getElementById('platformMercadoLibreNotice');
  const fbNotice = document.getElementById('platformFacebookNotice');

  if (pNone) pNone.classList.toggle('selected', state.posPlatform === 'ninguna');
  if (pML) pML.classList.toggle('selected', state.posPlatform === 'mercadolibre');
  if (pFB) pFB.classList.toggle('selected', state.posPlatform === 'facebook_marketplace');

  if (mlNotice) mlNotice.style.display = (state.posPlatform === 'mercadolibre') ? 'block' : 'none';
  if (fbNotice) fbNotice.style.display = (state.posPlatform === 'facebook_marketplace') ? 'block' : 'none';

  updateLiveCalculations();
}

function getPlatformLabel(platform) {
  if (platform === 'mercadolibre') return 'MercadoLibre';
  if (platform === 'facebook_marketplace' || platform === 'facebook') return 'FB Marketplace';
  return 'Tienda / Directa';
}

function getPlatformBadge(platform) {
  if (platform === 'mercadolibre') {
    return `<span class="platform-badge platform-badge-ml">🛍️ MercadoLibre</span>`;
  }
  if (platform === 'facebook_marketplace' || platform === 'facebook') {
    return `<span class="platform-badge platform-badge-fb">🔵 FB Marketplace</span>`;
  }
  return `<span class="platform-badge platform-badge-none">🏪 Tienda</span>`;
}

// ==========================================================================
// POS MULTI-PRODUCT CART / SALE ITEMS INGESTION
// ==========================================================================
function handleAddProductToSale() {
  if (!state.selectedProduct) {
    showToast('Seleccione un producto por código o búsqueda primero', 'danger');
    document.getElementById('productSearchInput')?.focus();
    return;
  }

  const qtyInput = document.getElementById('saleQtyInput');
  const priceInput = document.getElementById('salePriceInput');
  const qty = parseInt(qtyInput?.value) || 1;
  const unitPrice = parseFloat(priceInput?.value);

  if (isNaN(unitPrice) || unitPrice < 0) {
    showToast('Ingrese un precio de venta unitario válido', 'danger');
    priceInput?.focus();
    return;
  }

  const prod = state.selectedProduct;
  const existingIdx = state.posSaleItems.findIndex(i => i.code === prod.code);
  if (existingIdx >= 0) {
    state.posSaleItems[existingIdx].quantity += qty;
    state.posSaleItems[existingIdx].unitPrice = unitPrice;
    state.posSaleItems[existingIdx].subtotal = state.posSaleItems[existingIdx].quantity * unitPrice;
    showToast(`Se agregaron ${qty} und más de ${prod.code}`, 'info');
  } else {
    state.posSaleItems.push({
      code: prod.code,
      description: prod.description || prod.category || prod.code,
      category: prod.category || '',
      image: prod.image || (Array.isArray(prod.images) ? prod.images[0] : '') || '',
      quantity: qty,
      unitPrice: unitPrice,
      mayor: prod.mayor !== undefined ? prod.mayor : (prod.costo || 0),
      subtotal: qty * unitPrice
    });
    showToast(`${qty}x ${prod.code} agregado a la venta`, 'success');
  }

  // Clear single-product inputs
  state.selectedProduct = null;
  const searchInput = document.getElementById('productSearchInput');
  if (searchInput) searchInput.value = '';
  if (qtyInput) qtyInput.value = '1';
  if (priceInput) priceInput.value = '';
  const clearBtn = document.getElementById('clearSearchBtn');
  if (clearBtn) clearBtn.classList.remove('visible');

  const previewBox = document.getElementById('productPreviewBox');
  if (previewBox) {
    previewBox.innerHTML = `
      <div class="no-product-selected">
        <div class="no-product-icon">
          <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7"/>
          </svg>
        </div>
        <p style="font-weight: 600;">Escribe o selecciona un código de producto</p>
        <p style="font-size: 0.85rem; color: #94a3b8; margin-top: 4px;">Ejemplos: <strong>CTHR-1</strong>, <strong>CT-COF1</strong>, <strong>CT-PWANC1</strong></p>
      </div>
    `;
  }

  renderPosSaleItems();
  updateLiveCalculations();
}

function renderPosSaleItems() {
  const tbody = document.getElementById('posSaleItemsTableBody');
  const tableWrap = document.getElementById('posSaleItemsTableWrap');
  const emptyNotice = document.getElementById('posSaleItemsEmptyNotice');
  const countBadge = document.getElementById('posSaleItemsCountBadge');
  const clearBtn = document.getElementById('btnPosClearItems');

  const count = state.posSaleItems.length;
  const totalUnits = state.posSaleItems.reduce((acc, item) => acc + item.quantity, 0);

  if (countBadge) {
    countBadge.textContent = count === 0 ? '0 productos' : `${count} prod. (${totalUnits} und)`;
  }

  if (count === 0) {
    if (tableWrap) tableWrap.style.display = 'none';
    if (emptyNotice) emptyNotice.style.display = 'block';
    if (clearBtn) clearBtn.style.display = 'none';
    if (tbody) tbody.innerHTML = '';
    return;
  }

  if (tableWrap) tableWrap.style.display = 'block';
  if (emptyNotice) emptyNotice.style.display = 'none';
  if (clearBtn) clearBtn.style.display = 'inline-flex';

  if (!tbody) return;

  tbody.innerHTML = state.posSaleItems.map((item, idx) => `
    <tr class="pos-sale-item-row">
      <td>
        <div style="display: flex; align-items: center; gap: 8px;">
          <img src="${item.image || 'images/placeholder.png'}" class="pos-item-thumb" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'36\\' height=\\'36\\' fill=\\'%23f1f5f9\\' viewBox=\\'0 0 24 24\\'><text x=\\'50%\\' y=\\'50%\\' dominant-baseline=\\'middle\\' text-anchor=\\'middle\\' font-size=\\'7\\'>Cubitt</text></svg>'">
          <div style="min-width: 0;">
            <div style="font-weight: 700; font-size: 0.84rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 170px;" title="${escapeHtml(item.description || item.code)}">${escapeHtml(item.description || item.code)}</div>
            <div style="font-size: 0.72rem; color: #64748b;">${escapeHtml(item.code)} • ${escapeHtml(item.category || '')}</div>
          </div>
        </div>
      </td>
      <td style="text-align: center;">
        <div style="display: inline-flex; align-items: center; gap: 4px;">
          <button type="button" class="pos-item-stepper-btn" onclick="handlePosItemQtyChange(${idx}, -1)">−</button>
          <span style="font-weight: 700; min-width: 22px; text-align: center;">${item.quantity}</span>
          <button type="button" class="pos-item-stepper-btn" onclick="handlePosItemQtyChange(${idx}, 1)">+</button>
        </div>
      </td>
      <td style="text-align: right; font-weight: 600;">
        $${item.unitPrice.toFixed(2)}
      </td>
      <td style="text-align: right; font-weight: 800; color: #0f172a;">
        $${item.subtotal.toFixed(2)}
      </td>
      <td style="text-align: center;">
        <button type="button" class="pos-item-delete-btn" onclick="removePosSaleItem(${idx})" title="Quitar producto">&times;</button>
      </td>
    </tr>
  `).join('');
}

function handlePosItemQtyChange(idx, delta) {
  if (!state.posSaleItems[idx]) return;
  const newQty = state.posSaleItems[idx].quantity + delta;
  if (newQty <= 0) {
    removePosSaleItem(idx);
    return;
  }
  state.posSaleItems[idx].quantity = newQty;
  state.posSaleItems[idx].subtotal = newQty * state.posSaleItems[idx].unitPrice;
  renderPosSaleItems();
  updateLiveCalculations();
}

function removePosSaleItem(idx) {
  if (!state.posSaleItems[idx]) return;
  state.posSaleItems.splice(idx, 1);
  renderPosSaleItems();
  updateLiveCalculations();
}

function clearPosSaleItems() {
  state.posSaleItems = [];
  renderPosSaleItems();
  updateLiveCalculations();
}

// Payment Modality and Credit Subtypes
function getSelectedPaymentType() {
  const sel = document.querySelector('.payment-type-card.selected');
  return sel ? sel.dataset.type : 'contado';
}

function setPaymentType(type) {
  if (type === 'contado_mercadolibre') {
    type = 'contado';
    setSalesPlatform('mercadolibre');
  }

  document.querySelectorAll('.payment-type-card').forEach(card => {
    card.classList.toggle('selected', card.dataset.type === type);
  });

  const contadoPanel = document.getElementById('contadoPanel');
  const creditoPanel = document.getElementById('creditoPanel');
  const condContainer = document.getElementById('conditionalPaymentPanel');

  if (type === 'contado') {
    if (contadoPanel) contadoPanel.style.display = 'block';
    if (creditoPanel) creditoPanel.style.display = 'none';
    if (condContainer) condContainer.classList.remove('credito-active');
  } else {
    if (contadoPanel) contadoPanel.style.display = 'none';
    if (creditoPanel) creditoPanel.style.display = 'block';
    if (condContainer) condContainer.classList.add('credito-active');
  }

  updateLiveCalculations();
}

function handlePaymentMethodChange() {
  updateLiveCalculations();
}

function setCreditSubtype(subtype) {
  state.creditSubtype = subtype;
  document.querySelectorAll('.credit-subtype-card').forEach(card => {
    card.classList.toggle('selected', card.dataset.subtype === subtype);
  });

  const jpFields = document.getElementById('jpFieldsWrap');
  if (jpFields) {
    jpFields.style.display = subtype === 'jp' ? 'block' : 'none';
  }

  const balanceLabel = document.getElementById('creditBalanceLabel');
  if (balanceLabel) {
    if (subtype === 'jp') {
      balanceLabel.textContent = 'Saldo Restante por Cobrar (Cliente):';
    } else {
      balanceLabel.textContent = 'Monto Financiado / Por Liquidar:';
    }
  }

  updateLiveCalculations();
}

// Additional Commissions Setup (Fixed $ USD)
function setCommType(slot, type) {
  // Maintained for compatibility
  updateLiveCalculations();
}

function getAdditionalCommissionsData() {
  const comms = [];
  let totalComms = 0;

  for (let slot = 1; slot <= 3; slot++) {
    const concept = (document.getElementById(`comm${slot}Concept`)?.value || '').trim() || `Comisión ${slot}`;
    const beneficiary = (document.getElementById(`comm${slot}Beneficiary`)?.value || '').trim();
    const valInput = parseFloat(document.getElementById(`comm${slot}Value`)?.value) || 0;

    const amount = valInput > 0 ? valInput : 0;

    if (amount > 0) {
      totalComms += amount;
      comms.push({
        slot: slot,
        concept: concept,
        beneficiary: beneficiary || 'Beneficiario No Especificado',
        type: '$',
        rate: amount,
        amount: amount
      });
    }
  }

  return { items: comms, total: totalComms };
}

// Live Calculations
function updateLiveCalculations() {
  let itemsToCalc = [];
  if (state.posSaleItems && state.posSaleItems.length > 0) {
    itemsToCalc = state.posSaleItems;
  } else if (state.selectedProduct) {
    const qty = parseInt(document.getElementById('saleQtyInput')?.value) || 1;
    const unitPrice = parseFloat(document.getElementById('salePriceInput')?.value) || (state.selectedProduct.pvpActual || state.selectedProduct.pvpTienda || 0);
    itemsToCalc = [{
      quantity: qty,
      unitPrice: unitPrice,
      mayor: state.selectedProduct.mayor !== undefined ? state.selectedProduct.mayor : (state.selectedProduct.costo || 0),
      subtotal: qty * unitPrice
    }];
  }

  const subtotal = itemsToCalc.reduce((acc, it) => acc + (it.subtotal || 0), 0);
  const mayorCost = itemsToCalc.reduce((acc, it) => acc + ((it.mayor || 0) * (it.quantity || 1)), 0);

  // Additional Commissions Calculation
  const addComms = getAdditionalCommissionsData(subtotal);

  const paymentType = getSelectedPaymentType();
  const subtype = state.creditSubtype || 'cashea_bull';

  let comisionCashea = 0;
  let comisionTMania = 0;
  let montoIVA = 0;
  let comisionMercadoLibre = 0;

  // Platform Commission: 12% if platform is MercadoLibre
  if (state.posPlatform === 'mercadolibre') {
    comisionMercadoLibre = subtotal * 0.12;
  }

  let netoTienda = subtotal - comisionMercadoLibre;

  // Platform notice live breakdown
  const mlLiveBreakdown = document.getElementById('mercadolibreLiveBreakdown');
  if (mlLiveBreakdown) {
    if (state.posPlatform === 'mercadolibre' && subtotal > 0) {
      mlLiveBreakdown.innerHTML = `PVP: <strong>$${subtotal.toFixed(2)}</strong> | Comisión ML (12%): <span style="color: #d97706; font-weight: 700;">-$${comisionMercadoLibre.toFixed(2)}</span> | Neto Tienda: <span style="color: #059669; font-weight: 800;">$${(subtotal - comisionMercadoLibre).toFixed(2)}</span>`;
    } else {
      mlLiveBreakdown.innerHTML = '';
    }
  }

  const breakdownBox = document.getElementById('creditFinancialBreakdown');

  if (paymentType === 'credito') {
    if (subtype === 'cashea_bull') {
      // Cashea Bull: 3% cashea, 16% IVA facturado dentro del PVP
      comisionCashea = subtotal * 0.03;
      const baseImponible = subtotal / 1.16;
      montoIVA = subtotal - baseImponible;
      netoTienda = subtotal - (comisionCashea + montoIVA + comisionMercadoLibre);

      if (breakdownBox) {
        breakdownBox.innerHTML = `
          <div class="financial-row">
            <span>PVP Venta Total:</span>
            <strong>$${subtotal.toFixed(2)}</strong>
          </div>
          <div class="financial-row">
            <span>Comisión Cashea (3%):</span>
            <span style="color: #ef4444; font-weight: 600;">-$${comisionCashea.toFixed(2)}</span>
          </div>
          <div class="financial-row">
            <span>IVA 16% (Facturado en PVP):</span>
            <span style="color: #ef4444; font-weight: 600;">-$${montoIVA.toFixed(2)} (Base: $${baseImponible.toFixed(2)})</span>
          </div>
          ${comisionMercadoLibre > 0 ? `
            <div class="financial-row">
              <span>Comisión MercadoLibre (12%):</span>
              <span style="color: #d97706; font-weight: 600;">-$${comisionMercadoLibre.toFixed(2)}</span>
            </div>
          ` : ''}
          <div class="financial-row highlight">
            <span>Neto a Liquidar Tienda:</span>
            <span style="color: #2563eb; font-weight: 800;">$${netoTienda.toFixed(2)}</span>
          </div>
        `;
      }
    } else if (subtype === 'cashea_tmania') {
      // Cashea T-Mania: 8% cashea, 10% T-Mania, Sin IVA
      comisionCashea = subtotal * 0.08;
      comisionTMania = subtotal * 0.10;
      netoTienda = subtotal - (comisionCashea + comisionTMania + comisionMercadoLibre);

      if (breakdownBox) {
        breakdownBox.innerHTML = `
          <div class="financial-row">
            <span>PVP Venta Total:</span>
            <strong>$${subtotal.toFixed(2)}</strong>
          </div>
          <div class="financial-row">
            <span>Comisión Cashea (8%):</span>
            <span style="color: #ef4444; font-weight: 600;">-$${comisionCashea.toFixed(2)}</span>
          </div>
          <div class="financial-row">
            <span>Comisión T-Mania (10%):</span>
            <span style="color: #ef4444; font-weight: 600;">-$${comisionTMania.toFixed(2)}</span>
          </div>
          ${comisionMercadoLibre > 0 ? `
            <div class="financial-row">
              <span>Comisión MercadoLibre (12%):</span>
              <span style="color: #d97706; font-weight: 600;">-$${comisionMercadoLibre.toFixed(2)}</span>
            </div>
          ` : ''}
          <div class="financial-row highlight">
            <span>Neto a Liquidar Tienda (82%):</span>
            <span style="color: #7c3aed; font-weight: 800;">$${netoTienda.toFixed(2)}</span>
          </div>
        `;
      }
    } else if (subtype === 'jp') {
      // JP: 0% comisiones automáticas
      netoTienda = subtotal - comisionMercadoLibre;

      if (breakdownBox) {
        breakdownBox.innerHTML = `
          <div class="financial-row">
            <span>PVP Venta Total:</span>
            <strong>$${subtotal.toFixed(2)}</strong>
          </div>
          ${comisionMercadoLibre > 0 ? `
            <div class="financial-row">
              <span>Comisión MercadoLibre (12%):</span>
              <span style="color: #d97706; font-weight: 600;">-$${comisionMercadoLibre.toFixed(2)}</span>
            </div>
          ` : ''}
          <div class="financial-row highlight">
            <span>Neto a Liquidar Tienda:</span>
            <span style="color: #059669; font-weight: 800;">$${netoTienda.toFixed(2)}</span>
          </div>
          <div class="financial-row" style="font-size: 0.78rem; color: #64748b;">
            <span>Gestión:</span>
            <span>Cobranza directa por vendedor JP</span>
          </div>
        `;
      }
    }

    const abonoInput = document.getElementById('creditInitialPayment');
    const abono = parseFloat(abonoInput ? abonoInput.value : 0) || 0;
    const balance = Math.max(0, subtotal - abono);
    const balanceEl = document.getElementById('creditBalancePreview');
    if (balanceEl) {
      balanceEl.textContent = `$${balance.toFixed(2)}`;
    }
  }

  // Net Profit after wholesale cost AND additional commissions
  const finalProfit = (netoTienda - mayorCost) - addComms.total;

  // Update Main Calc Box
  const subEl = document.getElementById('calcSubtotal');
  const profEl = document.getElementById('calcProfit');
  const totEl = document.getElementById('calcTotal');
  const mlCommRow = document.getElementById('calcPlatformCommRow');
  const mlCommTotalEl = document.getElementById('calcPlatformCommTotal');
  const addCommRow = document.getElementById('calcAdditionalCommRow');
  const addCommTotalEl = document.getElementById('calcAdditionalCommTotal');
  const btnRegisterLabel = document.getElementById('btnRegisterSaleLabel');

  if (subEl) subEl.textContent = `$${subtotal.toFixed(2)}`;
  if (totEl) totEl.textContent = `$${subtotal.toFixed(2)}`;
  if (profEl) profEl.textContent = `$${finalProfit.toFixed(2)} (${subtotal > 0 ? ((finalProfit / subtotal) * 100).toFixed(1) : 0}%)`;

  if (mlCommRow && mlCommTotalEl) {
    if (comisionMercadoLibre > 0) {
      mlCommRow.style.display = 'flex';
      mlCommTotalEl.textContent = `-$${comisionMercadoLibre.toFixed(2)}`;
    } else {
      mlCommRow.style.display = 'none';
    }
  }

  if (addCommRow && addCommTotalEl) {
    if (addComms.total > 0) {
      addCommRow.style.display = 'flex';
      addCommTotalEl.textContent = `-$${addComms.total.toFixed(2)}`;
    } else {
      addCommRow.style.display = 'none';
    }
  }

  if (btnRegisterLabel) {
    const itemCount = state.posSaleItems.length;
    if (itemCount > 1) {
      btnRegisterLabel.textContent = `⚡ Registrar Venta (${itemCount} productos)`;
    } else {
      btnRegisterLabel.textContent = `⚡ Registrar Venta`;
    }
  }
}

// Stepper Helpers
function stepQty(delta) {
  const input = document.getElementById('saleQtyInput');
  if (!input) return;
  let val = (parseInt(input.value) || 1) + delta;
  if (val < 1) val = 1;
  input.value = val;
  updateLiveCalculations();
}

// Sale ID Generator
function generateSaleId() {
  let maxId = 1000;
  if (state.sales && state.sales.length > 0) {
    state.sales.forEach(s => {
      if (s.id && typeof s.id === 'string' && s.id.startsWith('CUB-')) {
        const num = parseInt(s.id.replace('CUB-', ''), 10);
        if (!isNaN(num) && num > maxId) maxId = num;
      }
    });
  }
  return `CUB-${maxId + 1}`;
}

// Register Sale Direct
function handleRegisterSaleDirect() {
  // If no items in posSaleItems, check if a single product is currently selected
  if (state.posSaleItems.length === 0) {
    if (!state.selectedProduct) {
      showToast('Por favor seleccione al menos un producto para la venta', 'danger');
      document.getElementById('productSearchInput')?.focus();
      return;
    }

    const qty = parseInt(document.getElementById('saleQtyInput')?.value) || 1;
    const unitPrice = parseFloat(document.getElementById('salePriceInput')?.value);

    if (isNaN(unitPrice) || unitPrice < 0) {
      showToast('Ingrese un precio de venta unitario válido', 'danger');
      document.getElementById('salePriceInput')?.focus();
      return;
    }

    const prod = state.selectedProduct;
    state.posSaleItems.push({
      code: prod.code,
      description: prod.description || prod.category || prod.code,
      category: prod.category || '',
      image: prod.image || (Array.isArray(prod.images) ? prod.images[0] : '') || '',
      quantity: qty,
      unitPrice: unitPrice,
      mayor: prod.mayor !== undefined ? prod.mayor : (prod.costo || 0),
      subtotal: qty * unitPrice
    });
  }

  const items = [...state.posSaleItems];
  const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
  const mayorCost = items.reduce((sum, item) => sum + ((item.mayor || 0) * item.quantity), 0);

  const saleId = generateSaleId();
  const saleDate = getSelectedSaleDate();
  const paymentType = getSelectedPaymentType();
  const clientName = (document.getElementById('clientNameInput')?.value || '').trim();
  const clientPhone = (document.getElementById('clientPhoneInput')?.value || '').trim();
  const notes = (document.getElementById('saleNotesInput')?.value || '').trim();

  const addComms = getAdditionalCommissionsData(subtotal);

  const plataforma = state.posPlatform || 'ninguna';
  const comisionMercadoLibre = (plataforma === 'mercadolibre') ? (subtotal * 0.12) : 0;
  let netoTienda = subtotal - comisionMercadoLibre;

  let creditSubtype = null;
  let creditSubtypeLabel = null;
  let vendedor = null;
  let creditDueDate = '';
  let creditAbono = 0;
  let creditBalance = 0;
  let creditStatus = 'PAGADO';
  let comisionCashea = 0;
  let comisionTMania = 0;
  let montoIVA = 0;
  let paymentMethod = 'Efectivo ($ USD)';

  if (paymentType === 'contado') {
    const methodSelect = document.getElementById('paymentMethodSelect');
    if (methodSelect) paymentMethod = methodSelect.value;
  } else {
    creditSubtype = state.creditSubtype || 'cashea_bull';
    const initialMethodSelect = document.getElementById('creditInitialMethodSelect');
    paymentMethod = initialMethodSelect ? initialMethodSelect.value : 'Efectivo ($ USD)';

    const abonoInput = document.getElementById('creditInitialPayment');
    creditAbono = parseFloat(abonoInput ? abonoInput.value : 0) || 0;
    creditBalance = Math.max(0, subtotal - creditAbono);
    creditStatus = creditBalance <= 0 ? 'PAGADO' : 'PENDIENTE';

    if (creditSubtype === 'cashea_bull') {
      creditSubtypeLabel = 'Cashea Bull';
      comisionCashea = subtotal * 0.03;
      const base = subtotal / 1.16;
      montoIVA = subtotal - base;
      netoTienda = subtotal - (comisionCashea + montoIVA + comisionMercadoLibre);
    } else if (creditSubtype === 'cashea_tmania') {
      creditSubtypeLabel = 'Cashea T-Mania';
      comisionCashea = subtotal * 0.08;
      comisionTMania = subtotal * 0.10;
      netoTienda = subtotal - (comisionCashea + comisionTMania + comisionMercadoLibre);
    } else if (creditSubtype === 'jp') {
      creditSubtypeLabel = 'Crédito JP';
      const vendInput = document.getElementById('vendedorInput');
      const selVend = (document.getElementById('saleSellerSelect')?.value || '').trim();
      vendedor = selVend || (vendInput ? vendInput.value.trim() : '');
      if (!vendedor) {
        showToast('Para Crédito JP debe ingresar o seleccionar el Vendedor Responsable', 'danger');
        document.getElementById('saleSellerSelect')?.focus();
        return;
      }
      const dueInput = document.getElementById('creditDueDate');
      creditDueDate = dueInput ? dueInput.value : '';
      netoTienda = subtotal - comisionMercadoLibre;
    }

    if (!clientName) {
      showToast('Para ventas a crédito el Nombre del Cliente es obligatorio', 'danger');
      document.getElementById('clientNameInput')?.focus();
      return;
    }
  }

  // Obtain salesperson for the sale
  if (isVendedor()) {
    vendedor = state.currentUser.sellerName || state.currentUser.fullName || state.currentUser.username;
  } else if (!vendedor) {
    vendedor = (document.getElementById('saleSellerSelect')?.value || '').trim() || 'Tienda Principal';
  }

  const finalProfit = (netoTienda - mayorCost) - addComms.total;

  const isBajoPedido = (state.orderMode === 'bajo_pedido');
  const orderExpectedDate = isBajoPedido ? (document.getElementById('orderExpectedDate')?.value || '') : '';
  const orderSupplierNotes = isBajoPedido ? (document.getElementById('orderSupplierNotes')?.value || '').trim() : '';

  const saleRecord = {
    id: saleId,
    timestamp: saleDate.toISOString(),
    displayDate: formatDateTime(saleDate),
    items: items,
    totalAmount: subtotal,
    totalMayor: mayorCost,
    totalProfit: finalProfit,
    plataforma: plataforma,
    plataformaLabel: getPlatformLabel(plataforma),
    paymentType: paymentType,
    paymentMethod: paymentMethod,
    creditSubtype: creditSubtype,
    creditSubtypeLabel: creditSubtypeLabel,
    vendedor: vendedor,
    comisionCashea: comisionCashea,
    comisionTMania: comisionTMania,
    comisionMercadoLibre: comisionMercadoLibre,
    montoIVA: montoIVA,
    netoTienda: netoTienda,
    additionalCommissions: addComms.items,
    additionalCommissionsTotal: addComms.total,
    clientName: clientName || (paymentType.startsWith('contado') ? 'Cliente General' : ''),
    clientPhone: clientPhone,
    creditDueDate: creditDueDate,
    creditAbono: creditAbono,
    creditBalance: creditBalance,
    creditStatus: creditStatus,
    notes: notes,
    isBajoPedido: isBajoPedido,
    orderStatus: isBajoPedido ? 'PENDIENTE_COMPRA' : 'ENTREGADO',
    orderExpectedDate: orderExpectedDate,
    orderSupplierNotes: orderSupplierNotes,
    orderDeliveredAt: isBajoPedido ? null : saleDate.toISOString(),
    orderDeliveryNotes: isBajoPedido ? '' : 'Entrega directa en tienda',
    paymentsHistory: creditAbono > 0 ? [
      { date: formatDateTime(saleDate), amount: creditAbono, method: paymentMethod, note: 'Abono / Inicial' }
    ] : []
  };

  state.sales.unshift(saleRecord);
  state.sales.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  saveSalesToStorage();

  // Deduct physical inventory stock
  decrementStockForSale(saleRecord);

  // Auto-register or update client in directory (including assigned seller)
  if (clientName) {
    autoRegisterOrUpdateClient(clientName, clientPhone, vendedor);
  }

  // Generate / Synchronize CXP for Cashea, IVA, T-Mania, and custom commissions
  syncPayablesForSale(saleRecord);

  renderTopStats();
  renderClients();
  renderOrdersTab();

  if (isBajoPedido) {
    showToast(`¡Venta #${saleRecord.id} registrada en "Ventas Bajo Pedido"!`, 'info');
  } else {
    showToast(`¡Venta #${saleRecord.id} registrada con éxito!`, 'success');
  }
  showSaleTicketModal(saleRecord);
  resetPOSForm();
}

// Reset POS Form
function resetPOSForm() {
  state.selectedProduct = null;
  state.posSaleItems = [];
  renderPosSaleItems();
  setSalesPlatform('ninguna');

  document.getElementById('productSearchInput').value = '';
  document.getElementById('saleQtyInput').value = '1';
  document.getElementById('salePriceInput').value = '';
  document.getElementById('clientNameInput').value = '';
  document.getElementById('clientPhoneInput').value = '';
  document.getElementById('saleNotesInput').value = '';
  const sellerSelect = document.getElementById('saleSellerSelect');
  if (sellerSelect) sellerSelect.selectedIndex = 0;
  document.getElementById('creditInitialPayment').value = '0';
  document.getElementById('clearSearchBtn').classList.remove('visible');

  // Reset Bajo Pedido
  setOrderMode('inmediata');
  const expDate = document.getElementById('orderExpectedDate');
  if (expDate) expDate.value = '';
  const supNotes = document.getElementById('orderSupplierNotes');
  if (supNotes) supNotes.value = '';

  // Reset commission values to 0
  for (let i = 1; i <= 3; i++) {
    const valInput = document.getElementById(`comm${i}Value`);
    if (valInput) valInput.value = '0';
  }

  initSaleDateInput();
  setPaymentType('contado');

  const container = document.getElementById('productPreviewBox');
  if (container) {
    container.innerHTML = `
      <div class="no-product-selected">
        <div class="no-product-icon">
          <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7"/>
          </svg>
        </div>
        <p style="font-weight: 600;">Escribe o selecciona un código de producto</p>
        <p style="font-size: 0.85rem; color: #94a3b8; margin-top: 4px;">Ejemplos: <strong>CTHR-1</strong>, <strong>CT-COF1</strong>, <strong>CT-PWANC1</strong></p>
      </div>
    `;
  }

  updateLiveCalculations();
}

// Cart Order Management
function handleAddToCart() {
  if (!state.selectedProduct) {
    showToast('Seleccione un producto primero', 'danger');
    return;
  }

  const qty = parseInt(document.getElementById('saleQtyInput').value) || 1;
  const unitPrice = parseFloat(document.getElementById('salePriceInput').value) || 0;
  const subtotal = qty * unitPrice;

  state.cart.push({
    code: state.selectedProduct.code,
    description: state.selectedProduct.description || state.selectedProduct.category,
    category: state.selectedProduct.category,
    image: state.selectedProduct.image,
    quantity: qty,
    unitPrice: unitPrice,
    mayor: state.selectedProduct.mayor || 0,
    subtotal: subtotal
  });

  renderCart();
  showToast(`${qty}x ${state.selectedProduct.code} añadido al pedido`, 'info');
  resetPOSForm();
}

function renderCart() {
  const cartCard = document.getElementById('cartCard');
  const cartList = document.getElementById('cartItemsList');
  const cartTotalEl = document.getElementById('cartGrandTotal');
  const cartCountEl = document.getElementById('cartItemCount');

  if (!cartCard) return;

  if (state.cart.length === 0) {
    cartCard.style.display = 'none';
    return;
  }

  cartCard.style.display = 'block';
  const total = state.cart.reduce((sum, item) => sum + item.subtotal, 0);
  const units = state.cart.reduce((sum, item) => sum + item.quantity, 0);

  if (cartTotalEl) cartTotalEl.textContent = `$${total.toFixed(2)}`;
  if (cartCountEl) cartCountEl.textContent = `${units} und (${state.cart.length} productos)`;

  cartList.innerHTML = state.cart.map((item, idx) => `
    <div class="cart-item-card">
      <img class="cart-item-img" src="${item.image || 'images/placeholder.png'}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'40\\' height=\\'40\\' fill=\\'%23eee\\' viewBox=\\'0 0 24 24\\'><text x=\\'50%\\' y=\\'50%\\' dominant-baseline=\\'middle\\' text-anchor=\\'middle\\' font-size=\\'8\\'>Cubitt</text></svg>'">
      <div class="cart-item-info">
        <div class="cart-item-code">${escapeHtml(item.description || item.code)} <span style="font-weight: normal; color: #64748b;">x${item.quantity}</span></div>
        <div class="cart-item-meta">${escapeHtml(item.code)} • $${item.unitPrice.toFixed(2)} c/u</div>
      </div>
      <div class="cart-item-subtotal">$${item.subtotal.toFixed(2)}</div>
      <button class="cart-item-remove" onclick="removeCartItem(${idx})" title="Eliminar">&times;</button>
    </div>
  `).join('');
}

function removeCartItem(idx) {
  state.cart.splice(idx, 1);
  renderCart();
}

function clearCart() {
  state.cart = [];
  renderCart();
}

function handleCheckoutCart() {
  if (state.cart.length === 0) return;

  const saleId = generateSaleId();
  const saleDate = getSelectedSaleDate();
  const paymentType = getSelectedPaymentType();
  const clientName = (document.getElementById('clientNameInput').value || '').trim();
  const clientPhone = (document.getElementById('clientPhoneInput').value || '').trim();
  const notes = (document.getElementById('saleNotesInput').value || '').trim();

  const total = state.cart.reduce((sum, item) => sum + item.subtotal, 0);
  const totalMayor = state.cart.reduce((sum, item) => sum + (item.mayor * item.quantity), 0);

  const addComms = getAdditionalCommissionsData(total);

  let creditSubtype = null;
  let creditSubtypeLabel = null;
  let vendedor = null;
  let creditDueDate = '';
  let creditAbono = 0;
  let creditBalance = 0;
  let creditStatus = 'PAGADO';
  let comisionCashea = 0;
  let comisionTMania = 0;
  let montoIVA = 0;
  let comisionMercadoLibre = 0;
  let netoTienda = total;
  let paymentMethod = 'Efectivo ($ USD)';

  if (paymentType === 'contado') {
    const methodSelect = document.getElementById('paymentMethodSelect');
    if (methodSelect) paymentMethod = methodSelect.value;
  } else if (paymentType === 'contado_mercadolibre') {
    paymentMethod = 'Contado - MercadoLibre';
    comisionMercadoLibre = total * 0.12;
    netoTienda = total - comisionMercadoLibre;
    creditStatus = 'PAGADO';
  } else {
    creditSubtype = state.creditSubtype || 'cashea_bull';
    const initialMethodSelect = document.getElementById('creditInitialMethodSelect');
    paymentMethod = initialMethodSelect ? initialMethodSelect.value : 'Efectivo ($ USD)';

    const abonoInput = document.getElementById('creditInitialPayment');
    creditAbono = parseFloat(abonoInput ? abonoInput.value : 0) || 0;
    creditBalance = Math.max(0, total - creditAbono);
    creditStatus = creditBalance <= 0 ? 'PAGADO' : 'PENDIENTE';

    if (creditSubtype === 'cashea_bull') {
      creditSubtypeLabel = 'Cashea Bull';
      comisionCashea = total * 0.03;
      const base = total / 1.16;
      montoIVA = total - base;
      netoTienda = total - (comisionCashea + montoIVA);
    } else if (creditSubtype === 'cashea_tmania') {
      creditSubtypeLabel = 'Cashea T-Mania';
      comisionCashea = total * 0.08;
      comisionTMania = total * 0.10;
      netoTienda = total - (comisionCashea + comisionTMania);
    } else if (creditSubtype === 'jp') {
      creditSubtypeLabel = 'Crédito JP';
      const vendInput = document.getElementById('vendedorInput');
      const selVend = (document.getElementById('saleSellerSelect')?.value || '').trim();
      vendedor = selVend || (vendInput ? vendInput.value.trim() : '');
      if (!vendedor) {
        showToast('Para Crédito JP debe ingresar o seleccionar el Vendedor Responsable', 'danger');
        document.getElementById('saleSellerSelect')?.focus();
        return;
      }
      const dueInput = document.getElementById('creditDueDate');
      creditDueDate = dueInput ? dueInput.value : '';
      netoTienda = total;
    }

    if (!clientName) {
      showToast('Ingrese el nombre del cliente para crédito', 'danger');
      document.getElementById('clientNameInput').focus();
      return;
    }
  }

  // Obtain salesperson for the sale
  if (isVendedor()) {
    vendedor = state.currentUser.sellerName || state.currentUser.fullName || state.currentUser.username;
  } else if (!vendedor) {
    vendedor = (document.getElementById('saleSellerSelect')?.value || '').trim() || 'Tienda Principal';
  }

  const finalProfit = (netoTienda - totalMayor) - addComms.total;
  const isBajoPedido = (state.orderMode === 'bajo_pedido');
  const orderExpectedDate = isBajoPedido ? (document.getElementById('orderExpectedDate')?.value || '') : '';
  const orderSupplierNotes = isBajoPedido ? (document.getElementById('orderSupplierNotes')?.value || '').trim() : '';

  const saleRecord = {
    id: saleId,
    timestamp: saleDate.toISOString(),
    displayDate: formatDateTime(saleDate),
    items: [...state.cart],
    totalAmount: total,
    totalMayor: totalMayor,
    totalProfit: finalProfit,
    plataforma: state.posPlatform || 'ninguna',
    plataformaLabel: getPlatformLabel(state.posPlatform || 'ninguna'),
    paymentType: paymentType,
    paymentMethod: paymentMethod,
    creditSubtype: creditSubtype,
    creditSubtypeLabel: creditSubtypeLabel,
    vendedor: vendedor,
    comisionCashea: comisionCashea,
    comisionTMania: comisionTMania,
    comisionMercadoLibre: comisionMercadoLibre,
    montoIVA: montoIVA,
    netoTienda: netoTienda,
    additionalCommissions: addComms.items,
    additionalCommissionsTotal: addComms.total,
    clientName: clientName || (paymentType.startsWith('contado') ? 'Cliente General' : ''),
    clientPhone: clientPhone,
    creditDueDate: creditDueDate,
    creditAbono: creditAbono,
    creditBalance: creditBalance,
    creditStatus: creditStatus,
    notes: notes,
    isBajoPedido: isBajoPedido,
    orderStatus: isBajoPedido ? 'PENDIENTE_COMPRA' : 'ENTREGADO',
    orderExpectedDate: orderExpectedDate,
    orderSupplierNotes: orderSupplierNotes,
    orderDeliveredAt: isBajoPedido ? null : saleDate.toISOString(),
    orderDeliveryNotes: isBajoPedido ? '' : 'Entrega directa en tienda',
    paymentsHistory: creditAbono > 0 ? [
      { date: formatDateTime(saleDate), amount: creditAbono, method: paymentMethod, note: 'Inicial / Abono' }
    ] : []
  };

  state.sales.unshift(saleRecord);
  state.sales.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  saveSalesToStorage();

  // Deduct physical inventory stock
  decrementStockForSale(saleRecord);

  // Auto-register or update client in directory (including assigned seller)
  if (clientName) {
    autoRegisterOrUpdateClient(clientName, clientPhone, vendedor);
  }

  // Generate / Synchronize CXP for Cashea, IVA, T-Mania, and custom commissions
  syncPayablesForSale(saleRecord);
  clearCart();

  renderTopStats();
  renderClients();
  renderOrdersTab();

  if (isBajoPedido) {
    showToast(`¡Venta con Carrito #${saleRecord.id} registrada en "Ventas Bajo Pedido"!`, 'info');
  } else {
    showToast(`¡Venta #${saleRecord.id} completada!`, 'success');
  }
  showSaleTicketModal(saleRecord);
  resetPOSForm();
}

// Render Sales History
function renderHistory() {
  const tbody = document.getElementById('salesHistoryTableBody');
  const emptyState = document.getElementById('historyEmptyState');
  if (!tbody) return;

  let filtered = [...getAccessibleSales()];

  if (state.historyFilterType !== 'all') {
    if (state.historyFilterType === 'contado') {
      filtered = filtered.filter(s => s.paymentType === 'contado' && s.paymentMethod !== 'Contado - MercadoLibre');
    } else if (state.historyFilterType === 'contado_mercadolibre') {
      filtered = filtered.filter(s => s.paymentType === 'contado_mercadolibre' || s.paymentMethod === 'Contado - MercadoLibre');
    } else {
      filtered = filtered.filter(s => s.paymentType === 'credito' && s.creditSubtype === state.historyFilterType);
    }
  }

  // Filter by Platform (Online vs Physical Store)
  if (state.historyFilterPlatform && state.historyFilterPlatform !== 'all') {
    if (state.historyFilterPlatform === 'online_all') {
      filtered = filtered.filter(s => {
        const p = s.plataforma || (s.paymentType === 'contado_mercadolibre' || s.paymentMethod === 'Contado - MercadoLibre' ? 'mercadolibre' : 'ninguna');
        return p === 'mercadolibre' || p === 'facebook_marketplace' || p === 'facebook';
      });
    } else if (state.historyFilterPlatform === 'ninguna') {
      filtered = filtered.filter(s => {
        const p = s.plataforma || (s.paymentType === 'contado_mercadolibre' || s.paymentMethod === 'Contado - MercadoLibre' ? 'mercadolibre' : 'ninguna');
        return p === 'ninguna' || !p;
      });
    } else {
      filtered = filtered.filter(s => {
        const p = s.plataforma || (s.paymentType === 'contado_mercadolibre' || s.paymentMethod === 'Contado - MercadoLibre' ? 'mercadolibre' : 'ninguna');
        return p === state.historyFilterPlatform;
      });
    }
  }

  const now = new Date();
  if (state.historyFilterDate === 'today') {
    const todayStr = now.toISOString().split('T')[0];
    filtered = filtered.filter(s => s.timestamp.startsWith(todayStr));
  } else if (state.historyFilterDate === 'week') {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    filtered = filtered.filter(s => new Date(s.timestamp) >= oneWeekAgo);
  } else if (state.historyFilterDate === 'month') {
    const oneMonthAgo = new Date();
    oneMonthAgo.setDate(oneMonthAgo.getDate() - 30);
    filtered = filtered.filter(s => new Date(s.timestamp) >= oneMonthAgo);
  }

  if (state.historySearchQuery) {
    const q = state.historySearchQuery.toLowerCase();
    filtered = filtered.filter(s => {
      const matchId = s.id.toLowerCase().includes(q);
      const matchClient = (s.clientName || '').toLowerCase().includes(q);
      const matchVend = (s.vendedor || '').toLowerCase().includes(q);
      const matchItem = s.items.some(i => i.code.toLowerCase().includes(q));
      return matchId || matchClient || matchVend || matchItem;
    });
  }

  renderHistoryMetrics(filtered);

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  tbody.innerHTML = filtered.map(sale => {
    const isCredit = sale.paymentType === 'credito';
    const isML = (sale.plataforma === 'mercadolibre') || sale.paymentType === 'contado_mercadolibre' || sale.paymentMethod === 'Contado - MercadoLibre';
    const platform = sale.plataforma || (isML ? 'mercadolibre' : 'ninguna');
    const platformBadge = getPlatformBadge(platform);
    const isPaid = sale.creditStatus === 'PAGADO';
    const itemsPreview = sale.items.map(i => `${i.code} (x${i.quantity})`).join(', ');
    const firstImg = sale.items[0]?.image || 'images/placeholder.png';

    let modalityBadge = '';
    if (!isCredit) {
      modalityBadge = `<span class="status-badge" style="background: #ecfdf5; color: #047857;">Contado</span>`;
    } else if (sale.creditSubtype === 'cashea_bull') {
      modalityBadge = `<span class="status-badge" style="background: #dbeafe; color: #1d4ed8;">Cashea Bull</span>`;
    } else if (sale.creditSubtype === 'cashea_tmania') {
      modalityBadge = `<span class="status-badge" style="background: #f3e8ff; color: #7e22ce;">Cashea T-Mania</span>`;
    } else {
      modalityBadge = `<span class="status-badge" style="background: #dcfce7; color: #15803d;">Crédito JP</span>`;
    }

    const mlComm = sale.comisionMercadoLibre !== undefined ? sale.comisionMercadoLibre : (platform === 'mercadolibre' ? (sale.totalAmount || 0) * 0.12 : 0);

    return `
      <tr>
        <td>
          <div style="font-weight: 700;">#${escapeHtml(sale.id)}</div>
          <div style="font-size: 0.75rem; color: #64748b;">${escapeHtml(sale.displayDate)}</div>
        </td>
        <td>
          <div style="display: flex; align-items: center; gap: 8px;">
            <img src="${firstImg}" style="width: 32px; height: 32px; object-fit: contain; background: #f8fafc; border-radius: 4px; border: 1px solid #e2e8f0;">
            <div>
              <div style="font-weight: 600; font-size: 0.88rem;">${escapeHtml(itemsPreview)}</div>
              <div style="font-size: 0.75rem; color: #64748b;">${sale.items.length} producto(s)</div>
            </div>
          </div>
        </td>
        <td>
          <div style="font-weight: 600;">${escapeHtml(sale.clientName || 'General')}</div>
          ${sale.vendedor ? `<div style="font-size: 0.75rem; color: #059669;">👤 Vend: ${escapeHtml(sale.vendedor)}</div>` : ''}
          ${sale.clientPhone ? `<div style="font-size: 0.75rem; color: #2563eb;">📱 ${escapeHtml(sale.clientPhone)}</div>` : ''}
        </td>
        <td>
          ${platformBadge}
        </td>
        <td>
          ${modalityBadge}
          <div style="font-size: 0.72rem; color: #64748b; margin-top: 2px;">${escapeHtml(sale.paymentMethod || '')}</div>
          ${isCredit ? `
            <div style="font-size: 0.74rem; margin-top: 2px;">
              ${isPaid ? '<span style="color: #10b981; font-weight: 700;">● Saldado</span>' : `<span style="color: #ef4444; font-weight: 700;">● Debe: $${sale.creditBalance.toFixed(2)}</span>`}
            </div>
          ` : ''}
        </td>
        <td>
          <div style="font-weight: 800; font-size: 1rem; color: #0f172a;">$${sale.totalAmount.toFixed(2)}</div>
          <div style="font-size: 0.72rem; color: #059669; font-weight: 600;">Ganancia Real: +$${(sale.totalProfit || 0).toFixed(2)}</div>
          ${mlComm > 0 ? `<div style="font-size: 0.7rem; color: #b45309; font-weight: 600;">CXP MercadoLibre: -$${mlComm.toFixed(2)}</div>` : ''}
          ${sale.additionalCommissionsTotal > 0 ? `<div style="font-size: 0.7rem; color: #b91c1c;">CXP Comis: -$${sale.additionalCommissionsTotal.toFixed(2)}</div>` : ''}
        </td>
        <td>
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-outline btn-sm" onclick="openEditSaleModal('${sale.id}')" title="Modificar Transacción">✏️ Editar</button>
            <button class="btn btn-outline btn-sm" onclick="viewTicketById('${sale.id}')" title="Ver Ticket">🖨️ Ticket</button>
            ${isCredit && !isPaid ? `
              <button class="btn btn-success btn-sm" onclick="openAbonoModal('${sale.id}')" title="Registrar Abono">💵 Abonar</button>
            ` : ''}
            <button class="btn btn-outline btn-sm" onclick="deleteSaleById('${sale.id}')" style="color: #ef4444; border-color: #fee2e2;" title="Eliminar Venta">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderHistoryMetrics(salesList) {
  const totalAmount = salesList.reduce((acc, s) => acc + (s.totalAmount || 0), 0);
  const totalProfit = salesList.reduce((acc, s) => acc + (s.totalProfit || 0), 0);
  const totalContado = salesList.filter(s => s.paymentType === 'contado' || s.paymentType === 'contado_mercadolibre' || s.paymentMethod === 'Contado - MercadoLibre').reduce((acc, s) => acc + s.totalAmount, 0);
  const totalCreditoPendiente = salesList.filter(s => s.paymentType === 'credito' && s.creditStatus === 'PENDIENTE').reduce((acc, s) => acc + s.creditBalance, 0);

  // Online Platforms Metrics
  const onlineSales = salesList.filter(s => {
    const p = s.plataforma || (s.paymentType === 'contado_mercadolibre' || s.paymentMethod === 'Contado - MercadoLibre' ? 'mercadolibre' : 'ninguna');
    return p === 'mercadolibre' || p === 'facebook_marketplace' || p === 'facebook';
  });
  const totalOnline = onlineSales.reduce((acc, s) => acc + (s.totalAmount || 0), 0);
  const totalML = salesList.filter(s => {
    const p = s.plataforma || (s.paymentType === 'contado_mercadolibre' || s.paymentMethod === 'Contado - MercadoLibre' ? 'mercadolibre' : 'ninguna');
    return p === 'mercadolibre';
  }).reduce((acc, s) => acc + (s.totalAmount || 0), 0);
  const totalFB = salesList.filter(s => {
    const p = s.plataforma || '';
    return p === 'facebook_marketplace' || p === 'facebook';
  }).reduce((acc, s) => acc + (s.totalAmount || 0), 0);

  const elTotal = document.getElementById('histMetricTotal');
  const elProfit = document.getElementById('histMetricProfit');
  const elContado = document.getElementById('histMetricContado');
  const elCredito = document.getElementById('histMetricCredito');
  const elOnline = document.getElementById('histMetricOnlinePlatforms');
  const elBreakdown = document.getElementById('histMetricOnlineBreakdown');

  if (elTotal) elTotal.textContent = `$${totalAmount.toFixed(2)}`;
  if (elProfit) elProfit.textContent = `$${totalProfit.toFixed(2)}`;
  if (elContado) elContado.textContent = `$${totalContado.toFixed(2)}`;
  if (elCredito) elCredito.textContent = `$${totalCreditoPendiente.toFixed(2)}`;
  if (elOnline) elOnline.textContent = `$${totalOnline.toFixed(2)}`;
  if (elBreakdown) elBreakdown.textContent = `ML: $${totalML.toFixed(2)} • FB: $${totalFB.toFixed(2)}`;
}

// Render Credits (Cuentas por Cobrar)
function renderCredits() {
  const container = document.getElementById('creditsListContainer');
  const emptyState = document.getElementById('creditsEmptyState');
  if (!container) return;

  const creditSales = getAccessibleSales().filter(s => s.paymentType === 'credito');

  if (creditSales.length === 0) {
    container.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  container.innerHTML = creditSales.map(sale => {
    const isPaid = sale.creditStatus === 'PAGADO';
    const isOverdue = sale.creditDueDate && new Date(sale.creditDueDate) < new Date() && !isPaid;
    const cleanPhone = (sale.clientPhone || '').replace(/[^0-9]/g, '');
    const waMsg = encodeURIComponent(`Hola ${sale.clientName}, un saludo cordial de Cubitt. Le recordamos su saldo pendiente de $${sale.creditBalance?.toFixed(2)} de su compra #${sale.id}. ¡Gracias!`);

    let badgeColor = '#2563eb';
    let typeName = sale.creditSubtypeLabel || 'Crédito';
    if (sale.creditSubtype === 'cashea_tmania') badgeColor = '#7c3aed';
    if (sale.creditSubtype === 'jp') badgeColor = '#059669';

    return `
      <div class="app-card" style="border-left: 5px solid ${isPaid ? '#10b981' : (isOverdue ? '#ef4444' : badgeColor)}; margin-bottom: 1rem;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 10px;">
          <div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <h3 style="font-size: 1.1rem; font-weight: 800;">${escapeHtml(sale.clientName)}</h3>
              <span class="status-badge" style="background: #f1f5f9; color: ${badgeColor}; border: 1px solid ${badgeColor};">
                ${typeName}
              </span>
              <span class="status-badge" style="${isPaid ? 'background:#dcfce7;color:#15803d;' : (isOverdue ? 'background:#fee2e2;color:#b91c1c;' : 'background:#dbeafe;color:#1d4ed8;')}">
                ${isPaid ? 'SALDADO' : (isOverdue ? 'VENCIDO' : 'PENDIENTE')}
              </span>
            </div>
            <div style="font-size: 0.82rem; color: #64748b; margin-top: 4px;">
              Venta <strong>#${sale.id}</strong> del ${sale.displayDate}
              ${sale.vendedor ? ` | Vendedor: <strong>${escapeHtml(sale.vendedor)}</strong>` : ''}
              ${sale.creditDueDate ? ` | Vence: <strong>${sale.creditDueDate}</strong>` : ''}
            </div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 0.8rem; color: #64748b;">Saldo por Cobrar:</div>
            <div style="font-size: 1.4rem; font-weight: 900; color: ${isPaid ? '#10b981' : '#ef4444'};">
              $${(sale.creditBalance || 0).toFixed(2)}
            </div>
            <div style="font-size: 0.75rem; color: #64748b;">Total: $${sale.totalAmount.toFixed(2)} | Inicial: $${(sale.creditAbono || 0).toFixed(2)}</div>
          </div>
        </div>

        <div style="margin: 12px 0; padding: 10px; background: #f8fafc; border-radius: 8px; font-size: 0.85rem;">
          <strong>Artículos:</strong> ${sale.items.map(i => `${escapeHtml(i.code)} (x${i.quantity})`).join(', ')}
        </div>

        ${sale.paymentsHistory && sale.paymentsHistory.length > 0 ? `
          <div style="margin-bottom: 12px; font-size: 0.8rem; color: #475569;">
            <strong>Historial de Pagos / Abonos:</strong>
            <ul style="margin-left: 20px; margin-top: 4px;">
              ${sale.paymentsHistory.map(p => `<li>${p.date}: <strong>+$${p.amount.toFixed(2)}</strong> (${p.method || 'Abono'}) - ${p.note || ''}</li>`).join('')}
            </ul>
          </div>
        ` : ''}

        <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px;">
          <button class="btn btn-outline btn-sm" onclick="openEditSaleModal('${sale.id}')" title="Modificar Venta">✏️ Editar Venta</button>
          ${!isPaid ? `
            <button class="btn btn-success btn-sm" onclick="openAbonoModal('${sale.id}')">💵 Registrar Abono / Saldo</button>
          ` : ''}
          ${cleanPhone ? `
            <a href="https://wa.me/${cleanPhone}?text=${waMsg}" target="_blank" class="btn btn-outline btn-sm" style="color: #25d366; border-color: #bbf7d0;">
              💬 WhatsApp
            </a>
          ` : ''}
          <button class="btn btn-outline btn-sm" onclick="viewTicketById('${sale.id}')">🖨️ Recibo</button>
        </div>
      </div>
    `;
  }).join('');
}

// Render Accounts Payable (Cuentas por Pagar CXP)
function renderPayables() {
  const tbody = document.getElementById('cxpTableBody');
  const emptyState = document.getElementById('cxpEmptyState');
  if (!tbody) return;

  let filtered = [...getAccessiblePayables()];

  // Filter status
  if (state.cxpFilterStatus !== 'all') {
    filtered = filtered.filter(p => p.status.toLowerCase() === state.cxpFilterStatus.toLowerCase());
  }

  // Filter category / origin
  if (state.cxpFilterCat && state.cxpFilterCat !== 'all') {
    filtered = filtered.filter(p => (p.category || 'ADICIONAL') === state.cxpFilterCat);
  }

  // Filter search
  if (state.cxpSearchQuery) {
    const q = state.cxpSearchQuery.toLowerCase();
    filtered = filtered.filter(p => {
      const matchId = p.id.toLowerCase().includes(q);
      const matchSale = p.saleId.toLowerCase().includes(q);
      const matchBen = (p.beneficiary || '').toLowerCase().includes(q);
      const matchConc = (p.concept || '').toLowerCase().includes(q);
      return matchId || matchSale || matchBen || matchConc;
    });
  }

  renderPayablesMetrics();

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  tbody.innerHTML = filtered.map(item => {
    const isPaid = item.status === 'CONCILIADO';
    const cat = item.category || 'ADICIONAL';

    let catBadge = '';
    if (cat === 'CASHEA') {
      catBadge = `<span class="status-badge" style="background: #dbeafe; color: #1e40af; font-size: 0.68rem; padding: 2px 6px;">CASHEA</span>`;
    } else if (cat === 'IVA') {
      catBadge = `<span class="status-badge" style="background: #fee2e2; color: #991b1b; font-size: 0.68rem; padding: 2px 6px;">IVA FISCAL</span>`;
    } else if (cat === 'TMANIA') {
      catBadge = `<span class="status-badge" style="background: #f3e8ff; color: #6b21a8; font-size: 0.68rem; padding: 2px 6px;">T-MANIA</span>`;
    } else if (cat === 'MERCADOLIBRE') {
      catBadge = `<span class="status-badge" style="background: #fef3c7; color: #92400e; font-size: 0.68rem; padding: 2px 6px; border: 1px solid #fde68a;">MERCADOLIBRE</span>`;
    } else {
      catBadge = `<span class="status-badge" style="background: #f1f5f9; color: #334155; font-size: 0.68rem; padding: 2px 6px;">COMISIÓN</span>`;
    }

    return `
      <tr>
        <td>
          <div style="font-weight: 700;">#${escapeHtml(item.id)}</div>
          <div style="font-size: 0.75rem; color: #2563eb;">Venta #${escapeHtml(item.saleId)}</div>
          <div style="font-size: 0.72rem; color: #64748b;">${escapeHtml(item.saleDate)}</div>
        </td>
        <td>
          <div style="font-weight: 700; font-size: 0.95rem;">👤 ${escapeHtml(item.beneficiary)}</div>
        </td>
        <td>
          <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 2px;">
            ${catBadge}
            <span style="font-weight: 600;">${escapeHtml(item.concept)}</span>
          </div>
          <div style="font-size: 0.75rem; color: #64748b;">Monto Fijo: $${item.amount.toFixed(2)}</div>
        </td>
        <td>
          <div style="font-weight: 800; font-size: 1.05rem; color: #b91c1c;">$${item.amount.toFixed(2)}</div>
        </td>
        <td>
          <span class="cxp-badge ${isPaid ? 'conciliado' : 'pendiente'}">
            ${isPaid ? '● CONCILIADO' : '● PENDIENTE'}
          </span>
        </td>
        <td>
          ${isPaid ? `
            <div style="font-size: 0.8rem; font-weight: 600; color: #15803d;">Pagado el ${escapeHtml(item.paidDisplayDate || '')}</div>
            <div style="font-size: 0.72rem; color: #64748b;">${escapeHtml(item.paidMethod || '')} ${item.paidReference ? `(Ref: ${escapeHtml(item.paidReference)})` : ''}</div>
          ` : `
            <div style="font-size: 0.78rem; color: #ef4444; font-style: italic;">Pendiente de liquidación</div>
          `}
        </td>
        <td>
          <div style="display: flex; gap: 6px;">
            ${!isPaid ? `
              <button class="btn btn-success btn-sm" onclick="openConciliarModal('${item.id}')">
                💳 Conciliar
              </button>
            ` : `
              <button class="btn btn-outline btn-sm" onclick="unconciliarPayable('${item.id}')" title="Reabrir / Deshacer conciliación" style="font-size: 0.75rem;">
                ↩️ Reabrir
              </button>
            `}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderPayablesMetrics() {
  const accessible = getAccessiblePayables();
  const pending = accessible.filter(p => p.status === 'PENDIENTE').reduce((acc, p) => acc + p.amount, 0);
  const paid = accessible.filter(p => p.status === 'CONCILIADO').reduce((acc, p) => acc + p.amount, 0);
  const total = accessible.reduce((acc, p) => acc + p.amount, 0);
  const pendingCount = accessible.filter(p => p.status === 'PENDIENTE').length;

  const elPending = document.getElementById('cxpMetricPending');
  const elPaid = document.getElementById('cxpMetricPaid');
  const elTotal = document.getElementById('cxpMetricTotal');
  const elCount = document.getElementById('cxpMetricPendingCount');

  if (elPending) elPending.textContent = `$${pending.toFixed(2)}`;
  if (elPaid) elPaid.textContent = `$${paid.toFixed(2)}`;
  if (elTotal) elTotal.textContent = `$${total.toFixed(2)}`;
  if (elCount) elCount.textContent = pendingCount;
}

// Conciliar Modal Logic
let currentConciliarId = null;

function openConciliarModal(cxpId) {
  const item = state.payables.find(p => p.id === cxpId);
  if (!item) return;

  currentConciliarId = cxpId;
  const modal = document.getElementById('conciliarModal');
  document.getElementById('conciliarBeneficiary').textContent = item.beneficiary;
  document.getElementById('conciliarConcept').textContent = item.concept;
  document.getElementById('conciliarSaleId').textContent = item.saleId;
  document.getElementById('conciliarAmount').textContent = `$${item.amount.toFixed(2)}`;
  document.getElementById('conciliarDateInput').value = new Date().toISOString().split('T')[0];
  document.getElementById('conciliarRefInput').value = '';

  modal.classList.add('active');
}

function closeConciliarModal() {
  const modal = document.getElementById('conciliarModal');
  if (modal) modal.classList.remove('active');
  currentConciliarId = null;
}

function handleConfirmConciliacion() {
  if (!currentConciliarId) return;
  const item = state.payables.find(p => p.id === currentConciliarId);
  if (!item) return;

  const method = document.getElementById('conciliarMethodSelect').value;
  const ref = (document.getElementById('conciliarRefInput').value || '').trim();
  const dateVal = document.getElementById('conciliarDateInput').value || new Date().toISOString().split('T')[0];

  item.status = 'CONCILIADO';
  item.paidAt = new Date().toISOString();
  item.paidDisplayDate = dateVal;
  item.paidMethod = method;
  item.paidReference = ref;

  savePayablesToStorage();
  closeConciliarModal();
  showToast(`¡Comisión #${item.id} conciliada como PAGADA!`, 'success');
  renderPayables();
}

function unconciliarPayable(cxpId) {
  const item = state.payables.find(p => p.id === cxpId);
  if (!item) return;

  if (confirm(`¿Desea reabrir la cuenta por pagar #${cxpId} y marcarla como PENDIENTE?`)) {
    item.status = 'PENDIENTE';
    item.paidAt = null;
    item.paidDisplayDate = null;
    item.paidMethod = null;
    item.paidReference = null;
    savePayablesToStorage();
    showToast(`Cuenta #${cxpId} restablecida a PENDIENTE`, 'info');
    renderPayables();
  }
}

function exportPayablesToCSV() {
  if (state.payables.length === 0) {
    showToast('No hay cuentas por pagar para exportar', 'danger');
    return;
  }

  const headers = [
    'ID CXP',
    'Venta Ref',
    'Fecha Venta',
    'Origen / Categoria',
    'Beneficiario',
    'Concepto',
    'Monto Comisión ($)',
    'Estado',
    'Fecha Pago / Conciliación',
    'Método Pago',
    'Referencia'
  ];

  const rows = state.payables.map(p => [
    `"${p.id}"`,
    `"${p.saleId}"`,
    `"${p.saleDate}"`,
    `"${p.category || 'ADICIONAL'}"`,
    `"${p.beneficiary || ''}"`,
    `"${p.concept || ''}"`,
    p.amount.toFixed(2),
    `"${p.status}"`,
    `"${p.paidDisplayDate || ''}"`,
    `"${p.paidMethod || ''}"`,
    `"${p.paidReference || ''}"`
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Cuentas_Por_Pagar_Cubitt_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Cuentas por pagar exportadas a Excel', 'success');
}

// -------------------------------------------------------------
// Transaction Modification Logic (Edición de Ventas / Pagos)
// -------------------------------------------------------------
let currentEditingSale = null;

function openEditSaleModal(saleId) {
  const sale = state.sales.find(s => s.id === saleId);
  if (!sale) return;

  if (isVendedor()) {
    const sName = (state.currentUser.sellerName || '').trim().toLowerCase();
    const fName = (state.currentUser.fullName || '').trim().toLowerCase();
    const sv = (sale.vendedor || '').trim().toLowerCase();
    if (sv && sv !== sName && sv !== fName) {
      showToast('No tienes permiso para modificar transacciones registradas por otro asesor', 'danger');
      return;
    }
  }

  currentEditingSale = JSON.parse(JSON.stringify(sale));

  const modal = document.getElementById('editSaleModal');
  if (!modal) return;

  document.getElementById('editSaleIdLabel').textContent = `#${currentEditingSale.id}`;

  // Date
  const dateInput = document.getElementById('editSaleDateInput');
  if (dateInput) {
    const d = new Date(currentEditingSale.timestamp || Date.now());
    const offset = d.getTimezoneOffset() * 60000;
    const localISO = (new Date(d.getTime() - offset)).toISOString().slice(0, 16);
    dateInput.value = localISO;
  }

  // Client info
  document.getElementById('editClientNameInput').value = currentEditingSale.clientName || '';
  document.getElementById('editClientPhoneInput').value = currentEditingSale.clientPhone || '';
  document.getElementById('editSaleNotesInput').value = currentEditingSale.notes || '';

  // Bajo Pedido support
  const isBPSelect = document.getElementById('editSaleIsBajoPedido');
  const bpStatusGroup = document.getElementById('editSaleOrderStatusGroup');
  const bpStatusSelect = document.getElementById('editSaleOrderStatus');
  if (isBPSelect) {
    isBPSelect.value = currentEditingSale.isBajoPedido ? 'true' : 'false';
  }
  if (bpStatusGroup) {
    bpStatusGroup.style.display = currentEditingSale.isBajoPedido ? 'block' : 'none';
  }
  if (bpStatusSelect) {
    bpStatusSelect.value = currentEditingSale.orderStatus || 'PENDIENTE_COMPRA';
  }

  // Payment & Platform
  const isCredit = currentEditingSale.paymentType === 'credito';
  const isLegacyML = currentEditingSale.paymentType === 'contado_mercadolibre' || currentEditingSale.paymentMethod === 'Contado - MercadoLibre';
  let curPlatform = currentEditingSale.plataforma || (isLegacyML ? 'mercadolibre' : 'ninguna');
  if (curPlatform === 'facebook') curPlatform = 'facebook_marketplace';

  const editPlatformSelect = document.getElementById('editSalePlatformSelect');
  if (editPlatformSelect) {
    editPlatformSelect.value = curPlatform;
  }

  const editPaymentTypeSelect = document.getElementById('editPaymentTypeSelect');
  if (editPaymentTypeSelect) {
    editPaymentTypeSelect.value = isCredit ? 'credito' : 'contado';
  }
  const editPaymentMethodSelect = document.getElementById('editPaymentMethodSelect');
  if (editPaymentMethodSelect) {
    editPaymentMethodSelect.value = (isLegacyML || !currentEditingSale.paymentMethod || currentEditingSale.paymentMethod === 'Contado - MercadoLibre') 
      ? 'Efectivo ($ USD)' 
      : currentEditingSale.paymentMethod;
  }

  // Credit fields wrap
  const creditFieldsWrap = document.getElementById('editCreditFieldsWrap');
  if (creditFieldsWrap) {
    creditFieldsWrap.style.display = isCredit ? 'block' : 'none';
  }
  document.getElementById('editCreditSubtypeSelect').value = currentEditingSale.creditSubtype || 'cashea_bull';
  document.getElementById('editVendedorInput').value = currentEditingSale.vendedor || '';
  const editSellerSelect = document.getElementById('editSaleSellerSelect');
  if (editSellerSelect) {
    editSellerSelect.value = currentEditingSale.vendedor || '';
    editSellerSelect.disabled = isVendedor();
  }
  document.getElementById('editCreditDueDateInput').value = currentEditingSale.creditDueDate || '';
  document.getElementById('editCreditAbonoInput').value = (currentEditingSale.creditAbono || 0).toFixed(2);

  // Additional Commissions ($ USD)
  const comms = currentEditingSale.additionalCommissions || [];
  const c1 = comms.find(c => c.slot === 1) || comms[0] || {};
  const c2 = comms.find(c => c.slot === 2) || comms[1] || {};
  const c3 = comms.find(c => c.slot === 3) || comms[2] || {};

  document.getElementById('editComm1Concept').value = c1.concept || 'Comisión Vendedor / Asesor';
  document.getElementById('editComm1Beneficiary').value = c1.beneficiary || '';
  document.getElementById('editComm1Value').value = c1.amount || 0;

  document.getElementById('editComm2Concept').value = c2.concept || 'Comisión Aliado Comercial';
  document.getElementById('editComm2Beneficiary').value = c2.beneficiary || '';
  document.getElementById('editComm2Value').value = c2.amount || 0;

  document.getElementById('editComm3Concept').value = c3.concept || 'Comisión Delivery / Mensajería';
  document.getElementById('editComm3Beneficiary').value = c3.beneficiary || '';
  document.getElementById('editComm3Value').value = c3.amount || 0;

  // Populate Add Product dropdown
  const prodSelect = document.getElementById('editProductSelect');
  if (prodSelect) {
    prodSelect.innerHTML = state.products.map(p => `
      <option value="${p.code}">${p.code} - ${p.category} ($${(p.pvpActual || p.pvpTienda || 0).toFixed(2)})</option>
    `).join('');
  }
  hideEditAddProductRow();

  renderEditSaleItems();
  updateEditModalCalculations();

  modal.classList.add('active');
}

function closeEditSaleModal() {
  const modal = document.getElementById('editSaleModal');
  if (modal) modal.classList.remove('active');
  currentEditingSale = null;
}

function handleEditSaleBajoPedidoChange() {
  const isBP = document.getElementById('editSaleIsBajoPedido')?.value === 'true';
  const group = document.getElementById('editSaleOrderStatusGroup');
  if (group) group.style.display = isBP ? 'block' : 'none';
}

function handleEditPaymentTypeChange() {
  const pType = document.getElementById('editPaymentTypeSelect').value;
  const isCredit = pType === 'credito';
  const creditFieldsWrap = document.getElementById('editCreditFieldsWrap');
  if (creditFieldsWrap) {
    creditFieldsWrap.style.display = isCredit ? 'block' : 'none';
  }
  const methodSelect = document.getElementById('editPaymentMethodSelect');
  if (pType === 'contado_mercadolibre') {
    if (methodSelect) methodSelect.value = 'Contado - MercadoLibre';
  } else if (pType === 'contado') {
    if (methodSelect && methodSelect.value === 'Contado - MercadoLibre') {
      methodSelect.value = 'Efectivo ($ USD)';
    }
  }
  updateEditModalCalculations();
}

function renderEditSaleItems() {
  const tbody = document.getElementById('editSaleItemsTableBody');
  if (!tbody || !currentEditingSale) return;

  tbody.innerHTML = currentEditingSale.items.map((item, idx) => `
    <tr>
      <td>
        <div style="font-weight: 700;">${escapeHtml(item.code)}</div>
        <div style="font-size: 0.75rem; color: #64748b;">${escapeHtml(item.category || '')}</div>
      </td>
      <td>
        <input type="number" class="form-control" style="padding: 4px 6px; font-size: 0.85rem;" value="${item.quantity}" min="1" onchange="handleEditItemQtyChange(${idx}, this.value)">
      </td>
      <td>
        <div class="currency-input-wrap">
          <span class="currency-prefix">$</span>
          <input type="number" class="form-control with-prefix" style="padding: 4px 6px; font-size: 0.85rem;" value="${item.unitPrice.toFixed(2)}" step="0.5" min="0" onchange="handleEditItemPriceChange(${idx}, this.value)">
        </div>
      </td>
      <td>
        <strong id="editItemSubtotal-${idx}">$${(item.quantity * item.unitPrice).toFixed(2)}</strong>
      </td>
      <td>
        ${currentEditingSale.items.length > 1 ? `
          <button type="button" class="btn btn-outline btn-sm" onclick="removeEditItem(${idx})" style="color: #ef4444; border-color: #fee2e2; padding: 2px 6px;" title="Eliminar">&times;</button>
        ` : ''}
      </td>
    </tr>
  `).join('');
}

function handleEditItemQtyChange(idx, val) {
  if (!currentEditingSale || !currentEditingSale.items[idx]) return;
  const q = parseInt(val) || 1;
  currentEditingSale.items[idx].quantity = q < 1 ? 1 : q;
  currentEditingSale.items[idx].subtotal = currentEditingSale.items[idx].quantity * currentEditingSale.items[idx].unitPrice;
  const subEl = document.getElementById(`editItemSubtotal-${idx}`);
  if (subEl) subEl.textContent = `$${currentEditingSale.items[idx].subtotal.toFixed(2)}`;
  updateEditModalCalculations();
}

function handleEditItemPriceChange(idx, val) {
  if (!currentEditingSale || !currentEditingSale.items[idx]) return;
  const p = parseFloat(val) || 0;
  currentEditingSale.items[idx].unitPrice = p < 0 ? 0 : p;
  currentEditingSale.items[idx].subtotal = currentEditingSale.items[idx].quantity * currentEditingSale.items[idx].unitPrice;
  const subEl = document.getElementById(`editItemSubtotal-${idx}`);
  if (subEl) subEl.textContent = `$${currentEditingSale.items[idx].subtotal.toFixed(2)}`;
  updateEditModalCalculations();
}

function removeEditItem(idx) {
  if (!currentEditingSale || currentEditingSale.items.length <= 1) return;
  currentEditingSale.items.splice(idx, 1);
  renderEditSaleItems();
  updateEditModalCalculations();
}

function showEditAddProductRow() {
  const row = document.getElementById('editAddProductRow');
  if (row) row.style.display = 'block';
}

function hideEditAddProductRow() {
  const row = document.getElementById('editAddProductRow');
  if (row) row.style.display = 'none';
}

function confirmAddProductToEdit() {
  if (!currentEditingSale) return;
  const select = document.getElementById('editProductSelect');
  const qtyInput = document.getElementById('editAddQty');
  if (!select || !qtyInput) return;

  const code = select.value;
  const qty = parseInt(qtyInput.value) || 1;
  const prod = state.products.find(p => p.code === code);
  if (!prod) return;

  const unitPrice = prod.pvpActual || prod.pvpTienda || 0;
  currentEditingSale.items.push({
    code: prod.code,
    description: prod.description || prod.category,
    category: prod.category,
    image: prod.image,
    quantity: qty,
    unitPrice: unitPrice,
    mayor: prod.mayor || 0,
    subtotal: qty * unitPrice
  });

  hideEditAddProductRow();
  renderEditSaleItems();
  updateEditModalCalculations();
}

function updateEditModalCalculations() {
  if (!currentEditingSale) return;

  const totalAmount = currentEditingSale.items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
  const totalMayor = currentEditingSale.items.reduce((sum, item) => sum + ((item.mayor || 0) * item.quantity), 0);

  const editPlatform = document.getElementById('editSalePlatformSelect')?.value || 'ninguna';
  const isML = editPlatform === 'mercadolibre';

  const paymentType = document.getElementById('editPaymentTypeSelect').value;
  const isCredit = paymentType === 'credito';
  const subtype = document.getElementById('editCreditSubtypeSelect').value;

  let comisionCashea = 0;
  let comisionTMania = 0;
  let montoIVA = 0;
  let comisionMercadoLibre = 0;

  if (isML) {
    comisionMercadoLibre = totalAmount * 0.12;
  }
  let netoTienda = totalAmount - comisionMercadoLibre;

  if (isCredit) {
    if (subtype === 'cashea_bull') {
      comisionCashea = totalAmount * 0.03;
      const base = totalAmount / 1.16;
      montoIVA = totalAmount - base;
      netoTienda = totalAmount - (comisionCashea + montoIVA + comisionMercadoLibre);
    } else if (subtype === 'cashea_tmania') {
      comisionCashea = totalAmount * 0.08;
      comisionTMania = totalAmount * 0.10;
      netoTienda = totalAmount - (comisionCashea + comisionTMania + comisionMercadoLibre);
    } else if (subtype === 'jp') {
      netoTienda = totalAmount - comisionMercadoLibre;
    }
  }

  const c1Val = parseFloat(document.getElementById('editComm1Value')?.value) || 0;
  const c2Val = parseFloat(document.getElementById('editComm2Value')?.value) || 0;
  const c3Val = parseFloat(document.getElementById('editComm3Value')?.value) || 0;
  const totalAddComms = c1Val + c2Val + c3Val;

  const finalProfit = (netoTienda - totalMayor) - totalAddComms;

  const abono = isCredit ? (parseFloat(document.getElementById('editCreditAbonoInput')?.value) || 0) : 0;
  const balance = isCredit ? Math.max(0, totalAmount - abono) : 0;

  const balanceDisplay = document.getElementById('editCreditBalanceDisplay');
  if (balanceDisplay) {
    balanceDisplay.textContent = `$${balance.toFixed(2)}`;
    balanceDisplay.style.color = balance <= 0 ? '#10b981' : '#ef4444';
    balanceDisplay.style.background = balance <= 0 ? '#dcfce7' : '#fee2e2';
  }

  const summaryBox = document.getElementById('editFinancialSummaryBox');
  if (summaryBox) {
    summaryBox.innerHTML = `
      <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
        <span>Total PVP Venta:</span>
        <strong style="font-size: 1rem;">$${totalAmount.toFixed(2)}</strong>
      </div>
      <div style="display: flex; justify-content: space-between; margin-bottom: 4px; color: #64748b;">
        <span>Costo Mayor Tienda:</span>
        <span>-$${totalMayor.toFixed(2)}</span>
      </div>
      ${comisionMercadoLibre > 0 ? `
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px; color: #b45309;">
          <span>- Comisión MercadoLibre (12%):</span>
          <strong>-$${comisionMercadoLibre.toFixed(2)} (Genera CXP)</strong>
        </div>
      ` : ''}
      ${comisionCashea > 0 ? `
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px; color: #ef4444;">
          <span>- Comisión Cashea (${subtype === 'cashea_bull' ? '3%' : '8%'}):</span>
          <strong>-$${comisionCashea.toFixed(2)} (Genera CXP)</strong>
        </div>
      ` : ''}
      ${montoIVA > 0 ? `
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px; color: #ef4444;">
          <span>- IVA 16% Facturado (Bull):</span>
          <strong>-$${montoIVA.toFixed(2)} (Genera CXP)</strong>
        </div>
      ` : ''}
      ${comisionTMania > 0 ? `
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px; color: #ef4444;">
          <span>- Comisión Aliado T-Mania (10%):</span>
          <strong>-$${comisionTMania.toFixed(2)} (Genera CXP)</strong>
        </div>
      ` : ''}
      ${totalAddComms > 0 ? `
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px; color: #b91c1c;">
          <span>- Comisiones Adicionales:</span>
          <strong>-$${totalAddComms.toFixed(2)} (Generan CXP)</strong>
        </div>
      ` : ''}
      <div style="display: flex; justify-content: space-between; margin-top: 6px; padding-top: 6px; border-top: 1px dashed #93c5fd; font-weight: 700; color: #047857; font-size: 0.95rem;">
        <span>Ganancia Neta Real Tienda:</span>
        <span>+$${finalProfit.toFixed(2)} (${totalAmount > 0 ? ((finalProfit / totalAmount) * 100).toFixed(1) : 0}%)</span>
      </div>
    `;
  }
}

function saveEditedSale() {
  if (!currentEditingSale) return;

  const dateInput = document.getElementById('editSaleDateInput');
  const clientNameInput = document.getElementById('editClientNameInput');
  const clientPhoneInput = document.getElementById('editClientPhoneInput');
  const notesInput = document.getElementById('editSaleNotesInput');
  const paymentTypeSelect = document.getElementById('editPaymentTypeSelect');
  const paymentMethodSelect = document.getElementById('editPaymentMethodSelect');
  const creditSubtypeSelect = document.getElementById('editCreditSubtypeSelect');
  const vendedorInput = document.getElementById('editVendedorInput');
  const creditDueDateInput = document.getElementById('editCreditDueDateInput');
  const creditAbonoInput = document.getElementById('editCreditAbonoInput');

  const clientName = (clientNameInput.value || '').trim();
  const paymentType = paymentTypeSelect.value;
  const isCredit = paymentType === 'credito';
  const editPlatform = document.getElementById('editSalePlatformSelect')?.value || 'ninguna';
  const isML = editPlatform === 'mercadolibre';

  if (isCredit && !clientName) {
    showToast('El nombre del cliente es obligatorio para ventas a crédito', 'danger');
    clientNameInput.focus();
    return;
  }

  const creditSubtype = isCredit ? creditSubtypeSelect.value : null;
  const editSellerSelect = document.getElementById('editSaleSellerSelect');
  const selSeller = editSellerSelect ? editSellerSelect.value.trim() : '';
  const vendedor = selSeller || (vendedorInput ? vendedorInput.value.trim() : '') || 'Tienda Principal';

  if (isCredit && creditSubtype === 'jp' && (!vendedor || vendedor === 'Tienda Principal')) {
    showToast('Debe ingresar o seleccionar el vendedor responsable para Crédito JP', 'danger');
    if (editSellerSelect) editSellerSelect.focus();
    return;
  }

  if (currentEditingSale.items.length === 0) {
    showToast('La transacción debe tener al menos 1 producto', 'danger');
    return;
  }

  const totalAmount = currentEditingSale.items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
  const totalMayor = currentEditingSale.items.reduce((sum, item) => sum + ((item.mayor || 0) * item.quantity), 0);

  let comisionCashea = 0;
  let comisionTMania = 0;
  let montoIVA = 0;
  let comisionMercadoLibre = 0;
  let creditSubtypeLabel = null;

  if (isML) {
    comisionMercadoLibre = totalAmount * 0.12;
  }
  let netoTienda = totalAmount - comisionMercadoLibre;

  if (isCredit) {
    if (creditSubtype === 'cashea_bull') {
      creditSubtypeLabel = 'Cashea Bull';
      comisionCashea = totalAmount * 0.03;
      const base = totalAmount / 1.16;
      montoIVA = totalAmount - base;
      netoTienda = totalAmount - (comisionCashea + montoIVA + comisionMercadoLibre);
    } else if (creditSubtype === 'cashea_tmania') {
      creditSubtypeLabel = 'Cashea T-Mania';
      comisionCashea = totalAmount * 0.08;
      comisionTMania = totalAmount * 0.10;
      netoTienda = totalAmount - (comisionCashea + comisionTMania + comisionMercadoLibre);
    } else if (creditSubtype === 'jp') {
      creditSubtypeLabel = 'Crédito JP';
      netoTienda = totalAmount - comisionMercadoLibre;
    }
  }

  // Gather 3 additional commissions ($ USD)
  const addComms = [];
  let totalAddComms = 0;

  for (let slot = 1; slot <= 3; slot++) {
    const conc = (document.getElementById(`editComm${slot}Concept`)?.value || '').trim() || `Comisión ${slot}`;
    const ben = (document.getElementById(`editComm${slot}Beneficiary`)?.value || '').trim();
    const val = parseFloat(document.getElementById(`editComm${slot}Value`)?.value) || 0;

    if (val > 0) {
      totalAddComms += val;
      addComms.push({
        slot: slot,
        concept: conc,
        beneficiary: ben || 'Beneficiario No Especificado',
        type: '$',
        rate: val,
        amount: val
      });
    }
  }

  const finalProfit = (netoTienda - totalMayor) - totalAddComms;

  const abono = isCredit ? (parseFloat(creditAbonoInput.value) || 0) : 0;
  const balance = isCredit ? Math.max(0, totalAmount - abono) : 0;
  const creditStatus = isCredit ? (balance <= 0 ? 'PAGADO' : 'PENDIENTE') : 'PAGADO';

  const saleDate = dateInput.value ? new Date(dateInput.value) : new Date();

  // Find index in state.sales
  const sIndex = state.sales.findIndex(s => s.id === currentEditingSale.id);
  if (sIndex < 0) return;

  const updatedSale = {
    ...state.sales[sIndex],
    timestamp: saleDate.toISOString(),
    displayDate: formatDateTime(saleDate),
    clientName: clientName || 'Cliente General',
    clientPhone: (clientPhoneInput.value || '').trim(),
    notes: (notesInput.value || '').trim(),
    plataforma: editPlatform,
    plataformaLabel: getPlatformLabel(editPlatform),
    paymentType: paymentType,
    paymentMethod: paymentMethodSelect.value,
    creditSubtype: creditSubtype,
    creditSubtypeLabel: creditSubtypeLabel,
    vendedor: vendedor,
    creditDueDate: isCredit ? (creditDueDateInput.value || '') : '',
    creditAbono: abono,
    creditBalance: balance,
    creditStatus: creditStatus,
    items: currentEditingSale.items,
    totalAmount: totalAmount,
    totalMayor: totalMayor,
    totalProfit: finalProfit,
    comisionCashea: comisionCashea,
    comisionTMania: comisionTMania,
    comisionMercadoLibre: comisionMercadoLibre,
    montoIVA: montoIVA,
    netoTienda: netoTienda,
    additionalCommissions: addComms,
    additionalCommissionsTotal: totalAddComms
  };

  // Bajo Pedido Fields
  const isBP = document.getElementById('editSaleIsBajoPedido')?.value === 'true';
  const orderStatus = isBP ? (document.getElementById('editSaleOrderStatus')?.value || 'PENDIENTE_COMPRA') : 'ENTREGADO';
  updatedSale.isBajoPedido = isBP;
  updatedSale.orderStatus = orderStatus;
  if (orderStatus === 'ENTREGADO' && !updatedSale.orderDeliveredAt) {
    updatedSale.orderDeliveredAt = new Date().toISOString();
  } else if (orderStatus !== 'ENTREGADO') {
    updatedSale.orderDeliveredAt = null;
  }

  state.sales[sIndex] = updatedSale;
  state.sales.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  saveSalesToStorage();

  // Auto-register or update client in directory (including assigned seller)
  if (clientName) {
    autoRegisterOrUpdateClient(clientName, updatedSale.clientPhone, vendedor);
  }

  // Synchronize CXP records
  syncPayablesForSale(updatedSale);

  closeEditSaleModal();
  showToast(`¡Transacción #${updatedSale.id} actualizada correctamente!`, 'success');

  renderHistory();
  renderCredits();
  renderPayables();
  renderClients();
  renderOrdersTab();
  renderTopStats();
}

// Visual Catalog View
function renderCatalog() {
  const grid = document.getElementById('catalogGrid');
  if (!grid) return;

  let filtered = [...state.products];

  if (state.catalogSearchQuery) {
    const q = state.catalogSearchQuery.toLowerCase();
    filtered = filtered.filter(p => 
      (p.description || '').toLowerCase().includes(q) ||
      (p.code || '').toLowerCase().includes(q) || 
      (p.category || '').toLowerCase().includes(q)
    );
  }

  if (state.catalogCategoryFilter !== 'all') {
    if (state.catalogCategoryFilter === 'AGUA') {
      filtered = filtered.filter(p => p.category.includes('AGUA') && !p.category.includes('CAFÉ'));
    } else if (state.catalogCategoryFilter === 'CAFE') {
      filtered = filtered.filter(p => p.category.includes('CAFÉ') || p.category.includes('COFFEE'));
    } else {
      filtered = filtered.filter(p => p.category.toLowerCase().includes(state.catalogCategoryFilter.toLowerCase()));
    }
  }

  if (state.catalogStatusFilter !== 'all') {
    filtered = filtered.filter(p => p.status.toLowerCase() === state.catalogStatusFilter.toLowerCase());
  }

  document.getElementById('catalogTotalCount').textContent = `${filtered.length} productos`;

  if (filtered.length === 0) {
    grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: #94a3b8;">No se encontraron productos con los filtros seleccionados.</div>';
    return;
  }

  grid.innerHTML = filtered.map(p => {
    const images = Array.isArray(p.images) && p.images.length > 0 ? p.images.filter(Boolean) : (p.image ? [p.image] : ['images/placeholder.png']);
    const mainImg = images[0] || 'images/placeholder.png';
    const statusClass = (p.status || 'DISPONIBLE').toLowerCase();
    const title = p.description || p.category || p.code;
    const pvp = (p.pvpActual || p.pvpTienda || 0);
    const cost = (p.mayor !== undefined ? p.mayor : (p.costo || 0));
    const margin = pvp - cost;

    const photosStripHtml = images.length > 1 ? `
      <div class="catalog-photos-strip">
        ${images.map((im, idx) => `
          <div class="catalog-photo-dot ${idx === 0 ? 'active' : ''}" onclick="event.stopPropagation(); switchCatalogCardImage('${escapeHtml(p.code)}', '${im}', this, ${idx})" title="Ver foto ${idx + 1}">
            <img src="${im}" alt="Foto ${idx + 1}">
          </div>
        `).join('')}
      </div>
    ` : '';

    return `
      <div class="catalog-card" id="catalogCard_${escapeHtml(p.code)}">
        <div class="catalog-thumb-wrap" onclick="openProductGalleryLightbox('${escapeHtml(p.code)}')">
          <img class="catalog-card-img" src="${mainImg}" alt="${escapeHtml(title)}" loading="lazy" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'100\\' height=\\'100\\' fill=\\'%23f1f5f9\\' viewBox=\\'0 0 24 24\\'><text x=\\'50%\\' y=\\'50%\\' dominant-baseline=\\'middle\\' text-anchor=\\'middle\\' font-size=\\'6\\'>Cubitt</text></svg>'">
        </div>
        ${photosStripHtml}
        <div>
          <div class="catalog-card-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
          <div class="catalog-card-meta-line">
            <span class="catalog-card-code">${escapeHtml(p.code)}</span>
            <span class="status-badge ${statusClass}">${p.status}</span>
          </div>
          <div class="catalog-card-cat">${escapeHtml(p.category)}</div>
        </div>
        <div class="catalog-price-row">
          <div>
            <div class="catalog-pvp">$${pvp.toFixed(2)}</div>
            <div class="catalog-cost" style="font-size: 0.75rem; color: #64748b; font-weight: 500;">Costo: $${cost.toFixed(2)}</div>
          </div>
          <div style="text-align: right;">
            <span style="font-size: 0.72rem; color: #059669; font-weight: 700; background: #ecfdf5; padding: 2px 6px; border-radius: 4px;">
              +$${margin.toFixed(2)}
            </span>
          </div>
        </div>
        <div class="catalog-actions-row">
          <button class="btn btn-primary btn-sm" onclick="selectFromCatalog('${escapeHtml(p.code)}')">Vender</button>
          <button class="btn btn-outline btn-sm" onclick="openEditProductModal('${escapeHtml(p.code)}')" title="Editar ficha del producto">✏️</button>
          <button class="btn btn-outline btn-sm" onclick="deleteProductByCode('${escapeHtml(p.code)}')" title="Eliminar producto" style="color: #ef4444; border-color: #fecaca;">🗑️</button>
        </div>
      </div>
    `;
  }).join('');
}

function switchCatalogCardImage(code, src, el, idx) {
  const card = document.getElementById(`catalogCard_${code}`);
  if (!card) return;
  const img = card.querySelector('.catalog-card-img');
  if (img) img.src = src;
  card.querySelectorAll('.catalog-photo-dot').forEach(d => d.classList.remove('active'));
  if (el) el.classList.add('active');
}

function openProductGalleryLightbox(code) {
  const p = state.products.find(item => item.code === code);
  if (!p) return;
  const images = Array.isArray(p.images) && p.images.length > 0 ? p.images.filter(Boolean) : (p.image ? [p.image] : ['images/placeholder.png']);
  const card = document.getElementById(`catalogCard_${code}`);
  const currentSrc = card?.querySelector('.catalog-card-img')?.src || images[0];
  let activeIdx = images.indexOf(currentSrc);
  if (activeIdx === -1) activeIdx = 0;
  const title = p.description || p.category || p.code;
  openImageLightbox(images[activeIdx], title, images, activeIdx, `${p.code} • ${p.category}`);
}

function selectFromCatalog(code) {
  selectProductByCode(code);
  switchTab('pos');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Product Management (CRUD & Storage)
function loadProductsFromStorage() {
  try {
    const saved = localStorage.getItem('cubitt_products_custom_v1');
    if (saved) {
      state.products = JSON.parse(saved);
    } else {
      state.products = typeof CUBITT_PRODUCTS !== 'undefined' ? JSON.parse(JSON.stringify(CUBITT_PRODUCTS)) : [];
    }
  } catch (e) {
    console.error('Error loading products from storage:', e);
    state.products = typeof CUBITT_PRODUCTS !== 'undefined' ? JSON.parse(JSON.stringify(CUBITT_PRODUCTS)) : [];
  }

  // Normalize all products with description, images array, and synced cost
  state.products.forEach(p => {
    if (!p.description) {
      if (p.category && p.category.includes(' - ')) {
        p.description = p.category.split(' - ')[1].trim();
      } else {
        p.description = p.category || p.code;
      }
    }
    if (!Array.isArray(p.images) || p.images.length === 0) {
      p.images = p.image ? [p.image] : ['images/placeholder.png'];
    }
    p.image = p.images[0] || 'images/placeholder.png';
    p.costo = (p.mayor !== undefined ? p.mayor : (p.costo || 0));
    p.mayor = p.costo;

    // Normalize physical stock (Starts at 0 units so it is populated exclusively from purchase invoices)
    if (p.stock === undefined || p.stock === null || isNaN(Number(p.stock))) {
      p.stock = 0;
    } else {
      p.stock = Math.max(0, parseInt(p.stock, 10));
    }
    if (p.stock <= 0) {
      p.status = 'AGOTADO';
    } else {
      p.status = 'DISPONIBLE';
    }
  });

  // Initial Zero-Stock Migration: ensure all existing stock starts strictly at 0 for clean invoice feeding
  try {
    const zeroStockInitialized = localStorage.getItem('cubitt_inventory_zero_init_v2');
    if (!zeroStockInitialized) {
      state.products.forEach(p => {
        p.stock = 0;
        p.status = 'AGOTADO';
      });
      saveProductsToStorage();
      localStorage.setItem('cubitt_inventory_zero_init_v2', 'true');
    }
  } catch (e) {
    console.error('Error applying zero stock migration:', e);
  }
}

function saveProductsToStorage() {
  try {
    localStorage.setItem('cubitt_products_custom_v1', JSON.stringify(state.products));
  } catch (e) {
    console.error('Error saving products to storage:', e);
  }
}

function resetInventoryStockToZero() {
  if (!confirm('¿Desea restablecer todo el stock físico a 0 unidades? Esta acción dejará todo el inventario en 0 para iniciar la carga limpia exclusivamente desde sus facturas de compra.')) {
    return;
  }
  state.products.forEach(p => {
    p.stock = 0;
    p.status = 'AGOTADO';
  });
  saveProductsToStorage();
  recordInventoryMovement({
    type: 'AJUSTE_MANUAL',
    productCode: 'TODOS',
    productName: 'Reinicio general de existencias a 0',
    quantity: 0,
    stockBefore: 0,
    stockAfter: 0,
    reference: 'Reinicio de Inventario a 0',
    notes: 'Reinicio solicitado para iniciar carga limpia desde primera factura'
  });
  renderInventoryTab();
  renderCatalog();
  renderTopStats();
  updateInventoryBadges();
  showToast('Stock de todos los productos restablecido a 0 unidades', 'success');
}

function resetCatalogToDefault() {
  if (confirm('¿Está seguro de restablecer el catálogo al listado original oficial de Cubitt? Se revertirán las modificaciones y productos manuales que no estén guardados en el código.')) {
    localStorage.removeItem('cubitt_products_custom_v1');
    state.products = typeof CUBITT_PRODUCTS !== 'undefined' ? JSON.parse(JSON.stringify(CUBITT_PRODUCTS)) : [];
    loadProductsFromStorage();
    renderCatalog();
    setupAutocomplete();
    showToast('Catálogo restablecido al listado oficial original de Cubitt', 'info');
  }
}

function openCreateProductModal() {
  const modal = document.getElementById('productEditModal');
  if (!modal) return;

  document.getElementById('productEditOriginalCode').value = '';
  document.getElementById('productEditModalTitle').textContent = 'Registrar Nuevo Producto';

  const descInput = document.getElementById('productEditDescription');
  if (descInput) descInput.value = '';

  const codeInput = document.getElementById('productEditCode');
  codeInput.value = '';
  codeInput.removeAttribute('readonly');

  document.getElementById('productEditStatus').value = 'DISPONIBLE';

  const catSelect = document.getElementById('productEditCategorySelect');
  catSelect.value = 'TERMO PARA CAFÉ';
  const customInput = document.getElementById('productEditCategoryCustom');
  customInput.value = '';
  customInput.style.display = 'none';

  document.getElementById('productEditPvp').value = '';
  document.getElementById('productEditMayor').value = '';

  // Clear 4 photo slots
  for (let i = 0; i < 4; i++) {
    clearProductPhotoSlot(i);
  }

  modal.classList.add('active');
  setTimeout(() => {
    if (descInput) descInput.focus();
    else codeInput.focus();
  }, 100);
}

function openEditProductModal(code) {
  const p = state.products.find(item => item.code === code);
  if (!p) {
    showToast(`Producto ${code} no encontrado`, 'danger');
    return;
  }

  const modal = document.getElementById('productEditModal');
  if (!modal) return;

  document.getElementById('productEditOriginalCode').value = p.code;
  document.getElementById('productEditModalTitle').textContent = `Ficha del Producto: ${p.code}`;

  const descInput = document.getElementById('productEditDescription');
  if (descInput) descInput.value = p.description || p.category || p.code;

  const codeInput = document.getElementById('productEditCode');
  codeInput.value = p.code;

  document.getElementById('productEditStatus').value = p.status || 'DISPONIBLE';

  const catSelect = document.getElementById('productEditCategorySelect');
  const customInput = document.getElementById('productEditCategoryCustom');

  let matched = false;
  for (let i = 0; i < catSelect.options.length; i++) {
    if (catSelect.options[i].value !== 'custom' && catSelect.options[i].value.toUpperCase() === (p.category || '').toUpperCase()) {
      catSelect.selectedIndex = i;
      matched = true;
      break;
    }
  }

  if (!matched) {
    catSelect.value = 'custom';
    customInput.value = p.category || '';
    customInput.style.display = 'block';
  } else {
    customInput.value = '';
    customInput.style.display = 'none';
  }

  document.getElementById('productEditPvp').value = (p.pvpActual || p.pvpTienda || 0);
  document.getElementById('productEditMayor').value = (p.mayor !== undefined ? p.mayor : (p.costo || 0));

  // Populate 4 photo slots
  const images = Array.isArray(p.images) && p.images.length > 0 ? p.images : (p.image ? [p.image] : []);
  for (let i = 0; i < 4; i++) {
    const url = images[i] || '';
    const preview = document.getElementById(`productPhotoPreview${i}`);
    const input = document.getElementById(`productPhotoUrl${i}`);
    const fileInput = document.getElementById(`productPhotoFile${i}`);
    if (fileInput) fileInput.value = '';
    if (input) input.value = url;
    if (preview) preview.src = url || 'images/placeholder.png';
  }

  modal.classList.add('active');
}

function closeProductEditModal() {
  const modal = document.getElementById('productEditModal');
  if (modal) modal.classList.remove('active');
}

function handleProductCategoryChange() {
  const catSelect = document.getElementById('productEditCategorySelect');
  const customInput = document.getElementById('productEditCategoryCustom');
  if (!catSelect || !customInput) return;

  if (catSelect.value === 'custom') {
    customInput.style.display = 'block';
    customInput.focus();
  } else {
    customInput.style.display = 'none';
  }
}

// 4 Photo Slots Handlers
function handleProductPhotoSlotUpload(slotIndex, fileInput) {
  if (!fileInput.files || !fileInput.files[0]) return;
  const file = fileInput.files[0];
  const reader = new FileReader();
  reader.onload = function(e) {
    const dataUrl = e.target.result;
    const preview = document.getElementById(`productPhotoPreview${slotIndex}`);
    const urlInput = document.getElementById(`productPhotoUrl${slotIndex}`);
    if (preview) preview.src = dataUrl;
    if (urlInput) urlInput.value = dataUrl;
  };
  reader.readAsDataURL(file);
}

function handleProductPhotoSlotUrlChange(slotIndex, url) {
  const preview = document.getElementById(`productPhotoPreview${slotIndex}`);
  if (preview) {
    preview.src = url.trim() ? url.trim() : 'images/placeholder.png';
  }
}

function clearProductPhotoSlot(slotIndex) {
  const preview = document.getElementById(`productPhotoPreview${slotIndex}`);
  const urlInput = document.getElementById(`productPhotoUrl${slotIndex}`);
  const fileInput = document.getElementById(`productPhotoFile${slotIndex}`);
  if (preview) preview.src = 'images/placeholder.png';
  if (urlInput) urlInput.value = '';
  if (fileInput) fileInput.value = '';
}

function saveProductFromModal() {
  const originalCode = (document.getElementById('productEditOriginalCode').value || '').trim();
  const code = (document.getElementById('productEditCode').value || '').trim().toUpperCase();

  if (!code) {
    showToast('El código del producto es obligatorio', 'danger');
    return;
  }

  const catSelect = document.getElementById('productEditCategorySelect');
  const customInput = document.getElementById('productEditCategoryCustom');
  let category = catSelect.value === 'custom' ? (customInput.value || '').trim() : catSelect.value;
  if (!category) {
    category = 'GENERAL';
  }

  let description = (document.getElementById('productEditDescription')?.value || '').trim();
  if (!description) {
    description = category !== 'custom' && category !== 'GENERAL' ? category : code;
  }

  const pvp = parseFloat(document.getElementById('productEditPvp').value);
  if (isNaN(pvp) || pvp < 0) {
    showToast('Ingrese un precio PVP válido mayor o igual a 0', 'danger');
    return;
  }

  const mayor = parseFloat(document.getElementById('productEditMayor').value) || 0;
  const status = document.getElementById('productEditStatus').value || 'DISPONIBLE';

  // Gather up to 4 photos
  const images = [];
  for (let i = 0; i < 4; i++) {
    const u = (document.getElementById(`productPhotoUrl${i}`)?.value || '').trim();
    if (u) images.push(u);
  }
  if (images.length === 0) {
    images.push('images/placeholder.png');
  }
  const mainImage = images[0];

  if (!originalCode) {
    // New product
    const exists = state.products.some(p => p.code.toUpperCase() === code);
    if (exists) {
      showToast(`Ya existe un producto con el código "${code}"`, 'danger');
      return;
    }

    const newProd = {
      code: code,
      description: description,
      category: category,
      pvpActual: pvp,
      pvpTienda: pvp,
      mayor: mayor,
      costo: mayor,
      status: status,
      image: mainImage,
      images: images
    };

    state.products.unshift(newProd);
    showToast(`¡Producto ${code} (${description}) registrado exitosamente!`, 'success');
  } else {
    // Edit existing product
    const index = state.products.findIndex(p => p.code === originalCode);
    if (index === -1) {
      showToast(`Producto original ${originalCode} no encontrado`, 'danger');
      return;
    }

    if (code !== originalCode && state.products.some(p => p.code.toUpperCase() === code)) {
      showToast(`El código "${code}" ya está en uso por otro producto`, 'danger');
      return;
    }

    state.products[index] = {
      ...state.products[index],
      code: code,
      description: description,
      category: category,
      pvpActual: pvp,
      pvpTienda: pvp,
      mayor: mayor,
      costo: mayor,
      status: status,
      image: mainImage,
      images: images
    };

    if (state.selectedProduct && state.selectedProduct.code === originalCode) {
      state.selectedProduct = state.products[index];
      renderProductPreview(state.selectedProduct);
    }

    showToast(`¡Producto ${code} actualizado exitosamente!`, 'success');
  }

  saveProductsToStorage();
  closeProductEditModal();
  renderCatalog();
  setupAutocomplete();
}

function deleteProductByCode(code) {
  if (confirm(`¿Está seguro de eliminar el producto "${code}" del catálogo? Esta acción no se puede deshacer.`)) {
    state.products = state.products.filter(p => p.code !== code);
    saveProductsToStorage();
    renderCatalog();
    setupAutocomplete();

    if (state.selectedProduct && state.selectedProduct.code === code) {
      state.selectedProduct = null;
      renderProductPreview(null);
    }

    showToast(`Producto ${code} eliminado del catálogo`, 'info');
  }
}

// Modal for Abono (Payments on Credit)
let currentAbonoSaleId = null;

function openAbonoModal(saleId) {
  const sale = state.sales.find(s => s.id === saleId);
  if (!sale) return;

  currentAbonoSaleId = saleId;
  const modal = document.getElementById('abonoModal');
  document.getElementById('abonoClientName').textContent = sale.clientName;
  document.getElementById('abonoSaleId').textContent = sale.id;
  document.getElementById('abonoBalanceDue').textContent = `$${sale.creditBalance.toFixed(2)}`;
  document.getElementById('abonoAmountInput').value = sale.creditBalance.toFixed(2);
  document.getElementById('abonoAmountInput').max = sale.creditBalance;
  document.getElementById('abonoNotesInput').value = '';

  modal.classList.add('active');
}

function closeAbonoModal() {
  const modal = document.getElementById('abonoModal');
  if (modal) modal.classList.remove('active');
  currentAbonoSaleId = null;
}

function handleSaveAbono() {
  if (!currentAbonoSaleId) return;
  const sale = state.sales.find(s => s.id === currentAbonoSaleId);
  if (!sale) return;

  const amount = parseFloat(document.getElementById('abonoAmountInput').value);
  if (isNaN(amount) || amount <= 0) {
    showToast('Ingrese un monto válido para el abono', 'danger');
    return;
  }

  const method = document.getElementById('abonoMethodSelect').value;
  const note = (document.getElementById('abonoNotesInput').value || '').trim();

  sale.creditBalance = Math.max(0, sale.creditBalance - amount);
  sale.creditAbono = (sale.creditAbono || 0) + amount;
  if (sale.creditBalance <= 0) {
    sale.creditStatus = 'PAGADO';
  }

  if (!sale.paymentsHistory) sale.paymentsHistory = [];
  sale.paymentsHistory.push({
    date: formatDateTime(new Date()),
    amount: amount,
    method: method,
    note: note || 'Abono registrado'
  });

  saveSalesToStorage();
  closeAbonoModal();
  showToast(`¡Abono de $${amount.toFixed(2)} registrado con éxito!`, 'success');
  renderHistory();
  renderCredits();
  renderClients();
  renderTopStats();
}

// Ticket Receipt Modal
function showSaleTicketModal(sale) {
  const modal = document.getElementById('ticketModal');
  const container = document.getElementById('printableTicketArea');
  if (!modal || !container) return;

  const isCredit = sale.paymentType === 'credito';
  const isML = sale.paymentType === 'contado_mercadolibre' || sale.paymentMethod === 'Contado - MercadoLibre';
  const isPaid = sale.creditStatus === 'PAGADO';

  container.innerHTML = `
    <div class="printable-ticket">
      <div class="ticket-header">
        <div class="ticket-brand">CUBITT</div>
        <div style="font-size: 0.75rem; color: #555;">Smart Devices & Lifestyle</div>
        <div style="font-size: 0.72rem; margin-top: 4px;">Comprobante Oficial de Venta</div>
      </div>

      <div class="ticket-row">
        <span>N° Venta:</span>
        <strong>#${escapeHtml(sale.id)}</strong>
      </div>
      <div class="ticket-row">
        <span>Fecha:</span>
        <span>${escapeHtml(sale.displayDate)}</span>
      </div>
      <div class="ticket-row">
        <span>Cliente:</span>
        <strong>${escapeHtml(sale.clientName || 'General')}</strong>
      </div>
      ${sale.vendedor ? `
        <div class="ticket-row">
          <span>Atendido por:</span>
          <strong>${escapeHtml(sale.vendedor)}</strong>
        </div>
      ` : ''}
      ${sale.clientPhone ? `
        <div class="ticket-row">
          <span>Teléfono:</span>
          <span>${escapeHtml(sale.clientPhone)}</span>
        </div>
      ` : ''}

      ${sale.isBajoPedido ? `
        <div style="margin: 8px 0; padding: 6px 8px; background: #fffbeb; border: 1px dashed #f59e0b; border-radius: 4px; text-align: center;">
          <div style="font-weight: 800; font-size: 0.78rem; color: #b45309;">📦 VENTA BAJO PEDIDO / POR ENCARGO</div>
          <div style="font-size: 0.72rem; color: #92400e;">Estado: <strong>${getOrderStatusLabel(sale.orderStatus)}</strong></div>
          ${sale.orderExpectedDate ? `<div style="font-size: 0.7rem; color: #78350f;">Fecha estimada: ${sale.orderExpectedDate}</div>` : ''}
          ${sale.orderDeliveredAt ? `<div style="font-size: 0.7rem; color: #15803d; font-weight: 700;">Entregado: ${formatDateTime(new Date(sale.orderDeliveredAt))}</div>` : ''}
        </div>
      ` : ''}

      <div class="ticket-divider"></div>

      <div style="font-size: 0.8rem; font-weight: bold; margin-bottom: 6px;">PRODUCTOS:</div>
      ${sale.items.map(item => `
        <div style="margin-bottom: 6px;">
          <div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 0.85rem;">
            <span>${escapeHtml(item.description || item.code)}</span>
            <span>$${item.subtotal.toFixed(2)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: #555;">
            <span>${item.quantity} und x $${item.unitPrice.toFixed(2)} (${escapeHtml(item.code)})</span>
            <span>${escapeHtml(item.category || '')}</span>
          </div>
        </div>
      `).join('')}

      <div class="ticket-divider"></div>

      <div class="ticket-row ticket-total">
        <span>TOTAL PVP:</span>
        <span>$${sale.totalAmount.toFixed(2)}</span>
      </div>

      ${(sale.plataforma && sale.plataforma !== 'ninguna') || isML ? `
        <div class="ticket-row" style="margin-top: 6px;">
          <span>Plataforma:</span>
          <strong>${escapeHtml(getPlatformLabel(sale.plataforma || (isML ? 'mercadolibre' : 'ninguna')))}</strong>
        </div>
      ` : ''}

      <div class="ticket-row" style="margin-top: 6px;">
        <span>Modalidad:</span>
        <strong style="text-transform: uppercase;">${isCredit ? (sale.creditSubtypeLabel || 'A CRÉDITO') : 'DE CONTADO'}</strong>
      </div>

      <div class="ticket-row">
        <span>Método de Pago:</span>
        <span>${escapeHtml(sale.paymentMethod || 'Efectivo')}</span>
      </div>

      ${(sale.comisionMercadoLibre > 0 || isML) ? `
        <div class="ticket-row" style="font-size: 0.75rem; color: #555;">
          <span>Comisión MercadoLibre (12%):</span>
          <span>$${((sale.comisionMercadoLibre !== undefined ? sale.comisionMercadoLibre : (sale.totalAmount * 0.12))).toFixed(2)}</span>
        </div>
        <div class="ticket-row" style="font-size: 0.75rem; color: #15803d; font-weight: 600;">
          <span>Neto Liquidado Tienda (88%):</span>
          <span>$${((sale.netoTienda !== undefined ? sale.netoTienda : (sale.totalAmount * 0.88))).toFixed(2)}</span>
        </div>
      ` : ''}

      ${isCredit ? `
        ${sale.creditSubtype === 'cashea_bull' ? `
          <div class="ticket-row" style="font-size: 0.75rem; color: #555;">
            <span>IVA 16% (Facturado en PVP):</span>
            <span>$${(sale.montoIVA || 0).toFixed(2)}</span>
          </div>
          <div class="ticket-row" style="font-size: 0.75rem; color: #555;">
            <span>Comisión Cashea (3%):</span>
            <span>$${(sale.comisionCashea || 0).toFixed(2)}</span>
          </div>
        ` : ''}

        ${sale.creditSubtype === 'cashea_tmania' ? `
          <div class="ticket-row" style="font-size: 0.75rem; color: #555;">
            <span>Comisión Cashea (8%):</span>
            <span>$${(sale.comisionCashea || 0).toFixed(2)}</span>
          </div>
          <div class="ticket-row" style="font-size: 0.75rem; color: #555;">
            <span>Comisión T-Mania (10%):</span>
            <span>$${(sale.comisionTMania || 0).toFixed(2)}</span>
          </div>
        ` : ''}

        <div class="ticket-row">
          <span>Abono / Inicial:</span>
          <span>$${(sale.creditAbono || 0).toFixed(2)}</span>
        </div>
        <div class="ticket-row" style="font-weight: bold; color: ${isPaid ? '#008000' : '#d00'};">
          <span>Saldo Restante:</span>
          <span>$${(sale.creditBalance || 0).toFixed(2)}</span>
        </div>
        ${sale.creditDueDate ? `
          <div class="ticket-row" style="font-size: 0.78rem;">
            <span>Fecha Límite:</span>
            <span>${escapeHtml(sale.creditDueDate)}</span>
          </div>
        ` : ''}
      ` : ''}

      ${sale.additionalCommissions && sale.additionalCommissions.length > 0 ? `
        <div class="ticket-divider"></div>
        <div style="font-size: 0.75rem; color: #555;">
          <strong>Comisiones Asignadas (CXP):</strong>
          ${sale.additionalCommissions.map(c => `<div>• ${escapeHtml(c.concept)}: $${c.amount.toFixed(2)} (${escapeHtml(c.beneficiary)})</div>`).join('')}
        </div>
      ` : ''}

      ${sale.notes ? `
        <div class="ticket-divider"></div>
        <div style="font-size: 0.75rem; font-style: italic;">
          <strong>Nota:</strong> ${escapeHtml(sale.notes)}
        </div>
      ` : ''}

      <div class="ticket-divider"></div>
      <div style="text-align: center; font-size: 0.75rem; color: #666; margin-top: 10px;">
        ¡Gracias por su compra!<br>
        Garantía oficial Cubitt
      </div>
    </div>
  `;

  modal.classList.add('active');
}

function viewTicketById(saleId) {
  const sale = state.sales.find(s => s.id === saleId);
  if (sale) {
    showSaleTicketModal(sale);
  }
}

function closeTicketModal() {
  const modal = document.getElementById('ticketModal');
  if (modal) modal.classList.remove('active');
}

function printTicket() {
  window.print();
}

// Lightbox Multi-Photo Gallery
let lightboxState = {
  images: [],
  currentIndex: 0,
  title: '',
  subtitle: ''
};

function openImageLightbox(src, title, imagesArray = [], activeIndex = 0, subtitle = '') {
  const modal = document.getElementById('lightboxModal');
  if (!modal) return;

  let validImages = Array.isArray(imagesArray) && imagesArray.length > 0 
    ? imagesArray.filter(Boolean) 
    : (src ? [src] : ['images/placeholder.png']);
  if (validImages.length === 0) validImages = ['images/placeholder.png'];

  const startIndex = Math.max(0, Math.min(activeIndex, validImages.length - 1));

  lightboxState = {
    images: validImages,
    currentIndex: startIndex,
    title: title || '',
    subtitle: subtitle || ''
  };

  updateLightboxView();
  modal.classList.add('active');
}

function updateLightboxView() {
  const img = document.getElementById('lightboxImg');
  const titleEl = document.getElementById('lightboxTitle');
  const subEl = document.getElementById('lightboxSubtitle');
  const counterEl = document.getElementById('lightboxCounter');
  const prevBtn = document.getElementById('lightboxPrevBtn');
  const nextBtn = document.getElementById('lightboxNextBtn');
  const strip = document.getElementById('lightboxThumbStrip');

  if (!img) return;

  const total = lightboxState.images.length;
  const current = lightboxState.currentIndex;
  const currentSrc = lightboxState.images[current] || 'images/placeholder.png';

  img.src = currentSrc;
  if (titleEl) titleEl.textContent = lightboxState.title;
  if (subEl) subEl.textContent = lightboxState.subtitle;
  if (counterEl) counterEl.textContent = total > 1 ? `Foto ${current + 1} de ${total}` : (total === 1 ? '1 foto' : '');

  if (prevBtn) prevBtn.style.display = total > 1 ? 'flex' : 'none';
  if (nextBtn) nextBtn.style.display = total > 1 ? 'flex' : 'none';

  if (strip) {
    if (total > 1) {
      strip.style.display = 'flex';
      strip.innerHTML = lightboxState.images.map((im, idx) => `
        <div class="lightbox-thumb-item ${idx === current ? 'active' : ''}" onclick="setLightboxIndex(${idx})" title="Foto ${idx + 1}">
          <img src="${im}" alt="Miniatura ${idx + 1}">
        </div>
      `).join('');
    } else {
      strip.style.display = 'none';
      strip.innerHTML = '';
    }
  }
}

function navigateLightbox(delta) {
  if (lightboxState.images.length <= 1) return;
  const total = lightboxState.images.length;
  lightboxState.currentIndex = (lightboxState.currentIndex + delta + total) % total;
  updateLightboxView();
}

function setLightboxIndex(idx) {
  if (idx >= 0 && idx < lightboxState.images.length) {
    lightboxState.currentIndex = idx;
    updateLightboxView();
  }
}

function closeLightbox() {
  const modal = document.getElementById('lightboxModal');
  if (modal) modal.classList.remove('active');
}

// Global alias for compatibility
window.openLightbox = openImageLightbox;

// Keyboard navigation for Lightbox
document.addEventListener('keydown', (e) => {
  const modal = document.getElementById('lightboxModal');
  if (modal && modal.classList.contains('active')) {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      navigateLightbox(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      navigateLightbox(1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeLightbox();
    }
  }
});

// Delete Sale
function deleteSaleById(saleId) {
  if (confirm(`¿Está seguro de eliminar el registro de venta #${saleId}? Esta acción no se puede deshacer.`)) {
    state.sales = state.sales.filter(s => s.id !== saleId);
    state.payables = state.payables.filter(p => p.saleId !== saleId);
    saveSalesToStorage();
    savePayablesToStorage();
    renderHistory();
    renderCredits();
    renderPayables();
    renderClients();
    renderTopStats();
    showToast(`Venta #${saleId} y sus cuentas asociadas eliminadas`, 'info');
  }
}

function clearAllSalesHistory() {
  if (confirm('¿Está seguro de borrar todo el historial de ventas y cuentas por pagar?')) {
    state.sales = [];
    state.payables = [];
    saveSalesToStorage();
    savePayablesToStorage();
    renderHistory();
    renderCredits();
    renderPayables();
    renderClients();
    renderTopStats();
    showToast('Historial vaciado con éxito', 'info');
  }
}

// Export Sales to CSV
function exportSalesToCSV() {
  if (state.sales.length === 0) {
    showToast('No hay ventas registradas para exportar', 'danger');
    return;
  }

  const headers = [
    'ID Venta',
    'Fecha',
    'Cliente',
    'Teléfono',
    'Plataforma',
    'Tipo de Venta',
    'Subtipo Crédito',
    'Vendedor Responsable',
    'Método de Pago',
    'Estado Crédito',
    'Total PVP ($)',
    'Comisión MercadoLibre ($)',
    'Comisión Cashea ($)',
    'Comisión T-Mania ($)',
    'IVA ($)',
    'Neto Tienda ($)',
    'Costo Mayor ($)',
    'Comisiones Adicionales CXP ($)',
    'Ganancia Neta Real ($)',
    'Abono Inicial ($)',
    'Saldo Pendiente ($)',
    'Fecha Vencimiento',
    'Detalle Artículos',
    'Notas'
  ];

  const rows = state.sales.map(s => {
    const itemsDetail = s.items.map(i => `${i.code} (x${i.quantity} @ $${i.unitPrice})`).join('; ');
    const isML = s.paymentType === 'contado_mercadolibre' || s.paymentMethod === 'Contado - MercadoLibre';
    const mlComm = s.comisionMercadoLibre !== undefined ? s.comisionMercadoLibre : (isML ? (s.totalAmount || 0) * 0.12 : 0);
    return [
      `"${s.id}"`,
      `"${s.displayDate}"`,
      `"${s.clientName || 'General'}"`,
      `"${s.clientPhone || ''}"`,
      `"${getPlatformLabel(s.plataforma || (isML ? 'mercadolibre' : 'ninguna'))}"`,
      `"${s.paymentType}"`,
      `"${s.creditSubtypeLabel || (isML ? 'Contado ML (12%)' : 'N/A')}"`,
      `"${s.vendedor || 'N/A'}"`,
      `"${s.paymentMethod || ''}"`,
      `"${s.creditStatus || ''}"`,
      (s.totalAmount || 0).toFixed(2),
      mlComm.toFixed(2),
      (s.comisionCashea || 0).toFixed(2),
      (s.comisionTMania || 0).toFixed(2),
      (s.montoIVA || 0).toFixed(2),
      (s.netoTienda || 0).toFixed(2),
      (s.totalMayor || 0).toFixed(2),
      (s.additionalCommissionsTotal || 0).toFixed(2),
      (s.totalProfit || 0).toFixed(2),
      (s.creditAbono || 0).toFixed(2),
      (s.creditBalance || 0).toFixed(2),
      `"${s.creditDueDate || ''}"`,
      `"${itemsDetail}"`,
      `"${(s.notes || '').replace(/"/g, '""')}"`
    ];
  });

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Ventas_Cubitt_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Archivo CSV generado y descargado', 'success');
}

// Toast Notifications
function showToast(message, type = 'info') {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Formatters
function formatDateTime(d) {
  const pad = n => n.toString().padStart(2, '0');
  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
  const year = d.getFullYear();
  let hours = d.getHours();
  const mins = pad(d.getMinutes());
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${day}/${month}/${year} ${hours}:${mins} ${ampm}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Storage Management - Sellers / Asesores
function loadSellersFromStorage() {
  try {
    const saved = localStorage.getItem('cubitt_sellers_v1');
    if (saved) {
      state.sellers = JSON.parse(saved);
      return;
    }
  } catch (e) {
    console.error('Error loading sellers from storage:', e);
  }

  // Pre-seed default sellers
  state.sellers = [
    {
      id: 'VEN-1001',
      name: 'Juan Pérez',
      phone: '0414-5551234',
      email: 'juan.perez@cubitt.com',
      status: 'ACTIVO',
      notes: 'Asesor principal de ventas y cobranza'
    },
    {
      id: 'VEN-1002',
      name: 'Ana Silva',
      phone: '0412-8889900',
      email: 'ana.silva@cubitt.com',
      status: 'ACTIVO',
      notes: 'Asesora de ventas y atención al cliente'
    },
    {
      id: 'VEN-1003',
      name: 'Pedro Gómez',
      phone: '0424-3334455',
      email: 'pedro.gomez@cubitt.com',
      status: 'ACTIVO',
      notes: 'Vendedor y gestión de cobranza créditos JP'
    }
  ];

  // Auto-discover any sellers from existing sales
  if (state.sales && state.sales.length > 0) {
    state.sales.forEach(s => {
      if (s.vendedor && s.vendedor.trim() && s.vendedor !== 'Tienda Principal' && s.vendedor !== 'N/A') {
        const vName = s.vendedor.trim();
        const exists = state.sellers.some(v => v.name.toLowerCase() === vName.toLowerCase());
        if (!exists) {
          state.sellers.push({
            id: 'VEN-' + Math.floor(1000 + Math.random() * 9000),
            name: vName,
            phone: '',
            email: '',
            status: 'ACTIVO',
            notes: 'Descubierto desde ventas históricas'
          });
        }
      }
    });
  }

  saveSellersToStorage();
}

function saveSellersToStorage() {
  try {
    localStorage.setItem('cubitt_sellers_v1', JSON.stringify(state.sellers));
    renderTopStats();
    renderSellersTab();
  } catch (e) {
    console.error('Error saving sellers to storage:', e);
  }
}

function populateSellerSelects() {
  const activeSellers = state.sellers.filter(s => s.status === 'ACTIVO');

  // 1. POS seller select
  const posSelect = document.getElementById('saleSellerSelect');
  if (posSelect) {
    const curVal = posSelect.value;
    posSelect.innerHTML = '<option value="">-- Seleccionar Vendedor --</option>' +
      activeSellers.map(s => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`).join('');
    if (curVal && activeSellers.some(s => s.name === curVal)) {
      posSelect.value = curVal;
    }
  }

  // 2. Client edit seller select
  const clientSelect = document.getElementById('clientEditSellerSelect');
  if (clientSelect) {
    const curVal = clientSelect.value;
    clientSelect.innerHTML = '<option value="">-- Sin Asignar (Tienda Principal) --</option>' +
      activeSellers.map(s => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`).join('');
    if (curVal && activeSellers.some(s => s.name === curVal)) {
      clientSelect.value = curVal;
    }
  }

  // 3. Edit sale seller select
  const editSelect = document.getElementById('editSaleSellerSelect');
  if (editSelect) {
    const curVal = editSelect.value;
    editSelect.innerHTML = '<option value="">-- Sin Asignar --</option>' +
      state.sellers.map(s => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)} ${s.status === 'INACTIVO' ? '(Inactivo)' : ''}</option>`).join('');
    if (curVal) {
      editSelect.value = curVal;
    }
  }

  // 4. Create user seller select
  const createUserSellerSelect = document.getElementById('createUserSellerSelect');
  if (createUserSellerSelect) {
    const curVal = createUserSellerSelect.value;
    createUserSellerSelect.innerHTML = '<option value="">-- Ninguno / Acceso Libre --</option>' +
      activeSellers.map(s => `<option value="${escapeHtml(s.name)}">👔 ${escapeHtml(s.name)}</option>`).join('');
    if (curVal && activeSellers.some(s => s.name === curVal)) {
      createUserSellerSelect.value = curVal;
    }
  }

  // 5. Edit user seller select
  const editUserSellerSelect = document.getElementById('editUserSellerSelect');
  if (editUserSellerSelect) {
    const curVal = editUserSellerSelect.value;
    editUserSellerSelect.innerHTML = '<option value="">-- Ninguno / Acceso Libre --</option>' +
      state.sellers.map(s => `<option value="${escapeHtml(s.name)}">👔 ${escapeHtml(s.name)} ${s.status === 'INACTIVO' ? '(Inactivo)' : ''}</option>`).join('');
    if (curVal) {
      editUserSellerSelect.value = curVal;
    }
  }
}

function handleSaleSellerChange() {
  const sellerSelect = document.getElementById('saleSellerSelect');
  if (!sellerSelect) return;
  const sellerName = sellerSelect.value.trim();

  // If Commission 1 is "Comisión Vendedor / Asesor" and beneficiary is empty or default, update beneficiary
  const benInput = document.getElementById('comm1Beneficiary');
  if (benInput && sellerName) {
    if (!benInput.value || benInput.value === 'Pedro Asesor' || state.sellers.some(s => s.name === benInput.value)) {
      benInput.value = sellerName;
    }
  }
}

function openCreateSellerModal() {
  const modal = document.getElementById('sellerEditModal');
  if (!modal) return;

  document.getElementById('sellerEditId').value = '';
  document.getElementById('sellerEditModalTitle').textContent = 'Registrar Nuevo Vendedor';
  document.getElementById('sellerEditName').value = '';
  document.getElementById('sellerEditPhone').value = '';
  document.getElementById('sellerEditEmail').value = '';
  document.getElementById('sellerEditStatus').value = 'ACTIVO';
  document.getElementById('sellerEditNotes').value = '';

  modal.classList.add('active');
  setTimeout(() => document.getElementById('sellerEditName').focus(), 100);
}

function openEditSellerModal(sellerId) {
  const seller = state.sellers.find(s => s.id === sellerId);
  if (!seller) return;

  const modal = document.getElementById('sellerEditModal');
  if (!modal) return;

  document.getElementById('sellerEditId').value = seller.id;
  document.getElementById('sellerEditModalTitle').textContent = `Editar Vendedor: ${seller.name}`;
  document.getElementById('sellerEditName').value = seller.name;
  document.getElementById('sellerEditPhone').value = seller.phone || '';
  document.getElementById('sellerEditEmail').value = seller.email || '';
  document.getElementById('sellerEditStatus').value = seller.status || 'ACTIVO';
  document.getElementById('sellerEditNotes').value = seller.notes || '';

  modal.classList.add('active');
}

function closeSellerEditModal() {
  const modal = document.getElementById('sellerEditModal');
  if (modal) modal.classList.remove('active');
}

function saveSellerFromModal() {
  const id = (document.getElementById('sellerEditId').value || '').trim();
  const name = (document.getElementById('sellerEditName').value || '').trim();
  const phone = (document.getElementById('sellerEditPhone').value || '').trim();
  const email = (document.getElementById('sellerEditEmail').value || '').trim();
  const status = document.getElementById('sellerEditStatus').value || 'ACTIVO';
  const notes = (document.getElementById('sellerEditNotes').value || '').trim();

  if (!name) {
    showToast('El nombre del vendedor es obligatorio', 'danger');
    return;
  }

  if (!id) {
    // New seller
    const exists = state.sellers.some(s => s.name.toLowerCase() === name.toLowerCase());
    if (exists) {
      showToast(`Ya existe un vendedor con el nombre "${name}"`, 'danger');
      return;
    }

    const newSeller = {
      id: 'VEN-' + Math.floor(1000 + Math.random() * 9000),
      name: name,
      phone: phone,
      email: email,
      status: status,
      notes: notes,
      createdAt: new Date().toISOString()
    };

    state.sellers.push(newSeller);
    showToast(`Vendedor "${name}" registrado exitosamente`, 'success');

    // Auto-select in POS or Client modal
    const posSelect = document.getElementById('saleSellerSelect');
    if (posSelect) posSelect.value = name;
    const clientSelect = document.getElementById('clientEditSellerSelect');
    if (clientSelect) clientSelect.value = name;
  } else {
    // Edit existing seller
    const idx = state.sellers.findIndex(s => s.id === id);
    if (idx !== -1) {
      const oldName = state.sellers[idx].name;
      state.sellers[idx] = {
        ...state.sellers[idx],
        name: name,
        phone: phone,
        email: email,
        status: status,
        notes: notes
      };

      if (oldName !== name) {
        state.sales.forEach(s => {
          if (s.vendedor === oldName) s.vendedor = name;
        });
        state.clients.forEach(c => {
          if (c.vendedor === oldName) c.vendedor = name;
        });
        saveSalesToStorage();
        saveClientsToStorage();
      }

      showToast(`Datos del vendedor "${name}" actualizados`, 'success');
    }
  }

  saveSellersToStorage();
  populateSellerSelects();
  closeSellerEditModal();
  renderSellersTable();
  renderClients();
}

function deleteSellerById(sellerId) {
  const seller = state.sellers.find(s => s.id === sellerId);
  if (!seller) return;

  if (confirm(`¿Está seguro de eliminar al vendedor "${seller.name}"? Sus ventas históricas se mantendrán.`)) {
    state.sellers = state.sellers.filter(s => s.id !== sellerId);
    saveSellersToStorage();
    populateSellerSelects();
    renderSellersTable();
    renderClients();
    showToast(`Vendedor "${seller.name}" eliminado`, 'info');
  }
}

function getSellerMetrics(sellerName) {
  const sNameNorm = (sellerName || '').trim().toLowerCase();
  const sales = state.sales.filter(s => (s.vendedor || '').trim().toLowerCase() === sNameNorm);
  const totalSold = sales.reduce((acc, s) => acc + (s.totalAmount || 0), 0);
  return {
    salesCount: sales.length,
    totalSold: totalSold
  };
}

function openManageSellersModal() {
  const modal = document.getElementById('sellerManageModal');
  if (!modal) return;
  renderSellersTable();
  modal.classList.add('active');
}

function closeManageSellersModal() {
  const modal = document.getElementById('sellerManageModal');
  if (modal) modal.classList.remove('active');
}

function renderSellersTable() {
  const tbody = document.getElementById('sellersTableBody');
  if (!tbody) return;

  if (state.sellers.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #94a3b8; padding: 2rem;">No hay vendedores registrados. Haz clic en "+ Registrar Vendedor".</td></tr>';
    return;
  }

  tbody.innerHTML = state.sellers.map(s => {
    const metrics = getSellerMetrics(s.name);
    const initials = s.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() || 'VE';
    const statusClass = s.status === 'ACTIVO' ? 'disponible' : 'agotado';
    const cleanPhone = (s.phone || '').replace(/\D/g, '');
    const waLink = cleanPhone ? `<a href="https://wa.me/${cleanPhone}" target="_blank" style="color: #25d366; text-decoration: none; margin-left: 4px;" title="Chatear">💬</a>` : '';

    return `
      <tr>
        <td>
          <div style="display: flex; align-items: center; gap: 10px;">
            <div class="client-avatar-circle" style="width: 38px; height: 38px; font-size: 0.95rem; background: #4f46e5;">${initials}</div>
            <div>
              <div style="font-weight: 700; color: #0f172a;">${escapeHtml(s.name)}</div>
              <div style="font-size: 0.75rem; color: #64748b;">${escapeHtml(s.notes || s.id)}</div>
            </div>
          </div>
        </td>
        <td>
          <div style="font-weight: 600; font-size: 0.85rem;">${escapeHtml(s.phone || '-')} ${waLink}</div>
          <div style="font-size: 0.75rem; color: #64748b;">${escapeHtml(s.email || '')}</div>
        </td>
        <td>
          <span class="status-badge ${statusClass}">${escapeHtml(s.status || 'ACTIVO')}</span>
        </td>
        <td>
          <div style="font-weight: 700; font-size: 0.9rem;">${metrics.salesCount} ${metrics.salesCount === 1 ? 'venta' : 'ventas'}</div>
        </td>
        <td>
          <div style="font-weight: 800; font-size: 0.95rem; color: #059669;">$${metrics.totalSold.toFixed(2)}</div>
        </td>
        <td>
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-outline btn-sm" onclick="openEditSellerModal('${s.id}')" title="Editar Vendedor">✏️</button>
            <button class="btn btn-outline btn-sm" onclick="deleteSellerById('${s.id}')" title="Eliminar Vendedor" style="color: #ef4444; border-color: #fecaca;">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Tab Sellers: Filters, Search, Rendering & Export
function setSellerTabFilter(filter) {
  state.sellerTabFilter = filter;
  document.querySelectorAll('[data-seller-tab-filter]').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.sellerTabFilter === filter);
  });
  renderSellersTab();
}

function handleSellerTabSearch(query) {
  state.sellerTabSearchQuery = query;
  renderSellersTab();
}

function renderSellersTab() {
  const tbody = document.getElementById('sellersTabTableBody');
  const emptyState = document.getElementById('sellersTabEmptyState');
  if (!tbody) return;

  // 1. Calculate & Render Metrics
  const totalCount = state.sellers ? state.sellers.length : 0;
  const activeCount = state.sellers ? state.sellers.filter(s => s.status === 'ACTIVO').length : 0;
  
  let totalSalesAssigned = 0;
  let totalBilledBySellers = 0;

  (state.sellers || []).forEach(s => {
    const m = getSellerMetrics(s.name);
    totalSalesAssigned += m.salesCount;
    totalBilledBySellers += m.totalSold;
  });

  const elTotal = document.getElementById('sellerTabMetricTotal');
  const elActive = document.getElementById('sellerTabMetricActive');
  const elSales = document.getElementById('sellerTabMetricSales');
  const elMoney = document.getElementById('sellerTabMetricMoney');

  if (elTotal) elTotal.textContent = totalCount;
  if (elActive) elActive.textContent = activeCount;
  if (elSales) elSales.textContent = totalSalesAssigned;
  if (elMoney) elMoney.textContent = `$${totalBilledBySellers.toFixed(2)}`;

  // 2. Filter list
  let filtered = (state.sellers || []).slice();

  if (state.sellerTabFilter === 'active') {
    filtered = filtered.filter(s => s.status === 'ACTIVO');
  } else if (state.sellerTabFilter === 'inactive') {
    filtered = filtered.filter(s => s.status === 'INACTIVO');
  }

  const q = (state.sellerTabSearchQuery || '').trim().toLowerCase();
  if (q) {
    filtered = filtered.filter(s => 
      (s.name || '').toLowerCase().includes(q) ||
      (s.phone || '').toLowerCase().includes(q) ||
      (s.email || '').toLowerCase().includes(q) ||
      (s.notes || '').toLowerCase().includes(q) ||
      (s.id || '').toLowerCase().includes(q)
    );
  }

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  tbody.innerHTML = filtered.map(s => {
    const metrics = getSellerMetrics(s.name);
    const initials = s.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() || 'VE';
    const statusClass = s.status === 'ACTIVO' ? 'disponible' : 'agotado';
    const cleanPhone = (s.phone || '').replace(/\D/g, '');
    const waLink = cleanPhone ? `<a href="https://wa.me/${cleanPhone}" target="_blank" style="color: #25d366; text-decoration: none; margin-left: 6px; font-size: 1.05rem;" title="Chatear en WhatsApp">💬</a>` : '';

    return `
      <tr>
        <td>
          <div style="display: flex; align-items: center; gap: 10px;">
            <div class="client-avatar-circle" style="width: 40px; height: 40px; font-size: 0.95rem; background: #4f46e5;">${initials}</div>
            <div>
              <div style="font-weight: 700; color: #0f172a; font-size: 0.95rem;">${escapeHtml(s.name)}</div>
              <div style="font-size: 0.78rem; color: #64748b;">${escapeHtml(s.notes || 'Asesor Comercial Cubitt')}</div>
            </div>
          </div>
        </td>
        <td>
          <div style="font-weight: 600; font-size: 0.88rem; display: flex; align-items: center;">
            <span>${escapeHtml(s.phone || '-')}</span>
            ${waLink}
          </div>
        </td>
        <td>
          <div style="font-size: 0.85rem; color: #475569;">${escapeHtml(s.email || '-')}</div>
        </td>
        <td>
          <span class="status-badge ${statusClass}">${escapeHtml(s.status || 'ACTIVO')}</span>
        </td>
        <td>
          <div style="font-weight: 700; color: #0f172a; font-size: 0.9rem;">${metrics.salesCount} ${metrics.salesCount === 1 ? 'venta' : 'ventas'}</div>
        </td>
        <td>
          <div style="font-weight: 800; color: #10b981; font-size: 0.95rem;">$${metrics.totalSold.toFixed(2)}</div>
        </td>
        <td>
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-outline btn-xs" onclick="openEditSellerModal('${s.id}')" title="Editar Vendedor">
              ✏️ Editar
            </button>
            <button class="btn btn-outline btn-xs" style="color: #ef4444; border-color: #fca5a5;" onclick="deleteSellerById('${s.id}')" title="Eliminar Vendedor">
              🗑️
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function exportSellersToCSV() {
  if (!state.sellers || state.sellers.length === 0) {
    showToast('No hay vendedores registrados para exportar', 'warning');
    return;
  }

  let csvContent = 'ID,Nombre,Telefono,Email,Estado,Notas / Ubicacion,Ventas Realizadas,Total Facturado USD\n';
  state.sellers.forEach(s => {
    const m = getSellerMetrics(s.name);
    const row = [
      `"${(s.id || '').replace(/"/g, '""')}"`,
      `"${(s.name || '').replace(/"/g, '""')}"`,
      `"${(s.phone || '').replace(/"/g, '""')}"`,
      `"${(s.email || '').replace(/"/g, '""')}"`,
      `"${(s.status || 'ACTIVO').replace(/"/g, '""')}"`,
      `"${(s.notes || '').replace(/"/g, '""')}"`,
      m.salesCount,
      m.totalSold.toFixed(2)
    ].join(',');
    csvContent += row + '\n';
  });

  const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `Vendedores_Cubitt_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('Directorio de Vendedores exportado a Excel exitosamente', 'success');
}

// -------------------------------------------------------------
// Ventas Bajo Pedido / Solicitudes de Compra Logic
// -------------------------------------------------------------
function getOrderStatusLabel(status) {
  switch (status) {
    case 'PENDIENTE_COMPRA': return '🟡 Pendiente por Comprar';
    case 'EN_CAMINO': return '🔵 En Camino / Proveedor';
    case 'LISTO_ENTREGA': return '🟣 Listo para Entrega';
    case 'ENTREGADO': return '✅ Entregado al Cliente';
    default: return status || 'Pendiente';
  }
}

function getOrderStatusBadgeClass(status) {
  switch (status) {
    case 'PENDIENTE_COMPRA': return 'order-por-comprar';
    case 'EN_CAMINO': return 'order-en-camino';
    case 'LISTO_ENTREGA': return 'order-listo';
    case 'ENTREGADO': return 'order-entregado';
    default: return 'order-por-comprar';
  }
}

function setOrdersFilter(status) {
  state.ordersFilterStatus = status;
  document.querySelectorAll('[data-order-filter]').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.orderFilter === status);
  });
  renderOrdersTab();
}

function handleOrdersSearch(query) {
  state.ordersSearchQuery = query;
  renderOrdersTab();
}

function renderOrdersTab() {
  const tbody = document.getElementById('ordersTableBody');
  const emptyState = document.getElementById('ordersEmptyState');
  if (!tbody) return;

  const allOrders = (getAccessibleSales() || []).filter(s => s.isBajoPedido);

  // 1. Calculate & Render Metrics
  const totalCount = allOrders.length;
  const toBuyCount = allOrders.filter(s => s.orderStatus === 'PENDIENTE_COMPRA').length;
  const inTransitCount = allOrders.filter(s => s.orderStatus === 'EN_CAMINO' || s.orderStatus === 'LISTO_ENTREGA').length;
  const deliveredCount = allOrders.filter(s => s.orderStatus === 'ENTREGADO').length;

  const elTotal = document.getElementById('ordersMetricTotal');
  const elToBuy = document.getElementById('ordersMetricToBuy');
  const elInTransit = document.getElementById('ordersMetricInTransit');
  const elDelivered = document.getElementById('ordersMetricDelivered');

  if (elTotal) elTotal.textContent = totalCount;
  if (elToBuy) elToBuy.textContent = toBuyCount;
  if (elInTransit) elInTransit.textContent = inTransitCount;
  if (elDelivered) elDelivered.textContent = deliveredCount;

  // 2. Filter orders
  let filtered = allOrders.slice();

  if (state.ordersFilterStatus !== 'all') {
    filtered = filtered.filter(s => s.orderStatus === state.ordersFilterStatus);
  }

  const q = (state.ordersSearchQuery || '').trim().toLowerCase();
  if (q) {
    filtered = filtered.filter(s => {
      const matchItems = (s.items || []).some(i => (i.code || '').toLowerCase().includes(q) || (i.category || '').toLowerCase().includes(q));
      const matchClient = (s.clientName || '').toLowerCase().includes(q) || (s.clientPhone || '').toLowerCase().includes(q);
      const matchVendedor = (s.vendedor || '').toLowerCase().includes(q);
      const matchId = (s.id || '').toLowerCase().includes(q);
      return matchItems || matchClient || matchVendedor || matchId;
    });
  }

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  tbody.innerHTML = filtered.map(sale => {
    const isDelivered = sale.orderStatus === 'ENTREGADO';
    const badgeClass = getOrderStatusBadgeClass(sale.orderStatus);
    const statusLabel = getOrderStatusLabel(sale.orderStatus);

    const cleanPhone = (sale.clientPhone || '').replace(/\D/g, '');
    const waLink = cleanPhone 
      ? `<a href="javascript:void(0)" onclick="openWhatsAppOrderNotice('${sale.id}')" style="color: #25d366; text-decoration: none; margin-left: 6px; font-size: 1.05rem;" title="Notificar cliente por WhatsApp">💬</a>` 
      : '';

    // Items summary HTML
    const itemsHtml = (sale.items || []).map(item => `
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
        <img src="${item.image || 'images/placeholder.png'}" style="width: 36px; height: 36px; border-radius: 6px; object-fit: contain; border: 1px solid #e2e8f0; background: #ffffff; cursor: pointer;" onclick="openLightbox('${item.image || 'images/placeholder.png'}', '${escapeHtml(item.description || item.code)}')">
        <div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span class="order-qty-pill">${item.quantity} und${item.quantity > 1 ? 's' : ''}</span>
            <strong style="color: #0f172a; font-size: 0.88rem;">${escapeHtml(item.description || item.code)}</strong>
          </div>
          <div style="font-size: 0.72rem; color: #64748b;">${escapeHtml(item.code)} • ${escapeHtml(item.category || '')} • $${item.unitPrice.toFixed(2)} c/u</div>
        </div>
      </div>
    `).join('');

    // Payment summary badge
    let paymentBadge = '';
    if (sale.paymentType === 'contado') {
      paymentBadge = `<span class="debt-badge clear" style="font-size: 0.72rem; padding: 2px 6px;">Pagado Contado</span>`;
    } else {
      if (sale.creditBalance > 0) {
        paymentBadge = `<span class="debt-badge debt" style="font-size: 0.72rem; padding: 2px 6px;">Resta $${sale.creditBalance.toFixed(2)}</span>`;
      } else {
        paymentBadge = `<span class="debt-badge clear" style="font-size: 0.72rem; padding: 2px 6px;">Crédito Pagado</span>`;
      }
    }

    // Actions block
    let actionsHtml = '';
    if (!isDelivered) {
      actionsHtml = `
        <div style="display: flex; flex-direction: column; gap: 5px;">
          <button class="btn btn-sm btn-primary" onclick="openDeliverOrderModal('${sale.id}')" style="background: #16a34a; border-color: #16a34a; font-weight: 700; padding: 5px 10px; font-size: 0.8rem; display: flex; align-items: center; justify-content: center; gap: 4px;" title="Marcar este producto como entregado al cliente">
            <span>📦 Marcar Entregado</span>
          </button>
          <div style="display: flex; gap: 4px; align-items: center;">
            <select class="form-control" style="font-size: 0.75rem; padding: 3px 6px; height: auto;" onchange="changeOrderStatus('${sale.id}', this.value)" title="Cambiar etapa del pedido">
              <option value="PENDIENTE_COMPRA" ${sale.orderStatus === 'PENDIENTE_COMPRA' ? 'selected' : ''}>🟡 Por Comprar</option>
              <option value="EN_CAMINO" ${sale.orderStatus === 'EN_CAMINO' ? 'selected' : ''}>🔵 En Camino</option>
              <option value="LISTO_ENTREGA" ${sale.orderStatus === 'LISTO_ENTREGA' ? 'selected' : ''}>🟣 Listo p/ Entrega</option>
              <option value="ENTREGADO">✅ Entregado</option>
            </select>
            <button class="btn btn-outline btn-xs" onclick="openWhatsAppOrderNotice('${sale.id}')" title="Notificar por WhatsApp">💬</button>
            <button class="btn btn-outline btn-xs" onclick="viewTicketById('${sale.id}')" title="Ver Recibo / Comprobante">🖨️</button>
            <button class="btn btn-outline btn-xs" onclick="openEditSaleModal('${sale.id}')" title="Editar Venta">✏️</button>
          </div>
        </div>
      `;
    } else {
      actionsHtml = `
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="font-size: 0.8rem; font-weight: 700; color: #16a34a;">✅ Entregado</span>
            <button class="btn btn-outline btn-xs" onclick="revertOrderDelivery('${sale.id}')" title="Revertir entrega a pendiente">↩️ Revertir</button>
            <button class="btn btn-outline btn-xs" onclick="viewTicketById('${sale.id}')" title="Ver Recibo">🖨️</button>
          </div>
          ${sale.orderDeliveredAt ? `<div style="font-size: 0.68rem; color: #64748b;">${formatDateTime(new Date(sale.orderDeliveredAt))}</div>` : ''}
        </div>
      `;
    }

    return `
      <tr>
        <td>
          <div style="font-weight: 700; color: #0f172a; font-size: 0.9rem;">#${escapeHtml(sale.id)}</div>
          <div style="font-size: 0.75rem; color: #64748b;">${escapeHtml(sale.displayDate || '')}</div>
          ${sale.orderExpectedDate ? `<div style="font-size: 0.72rem; color: #b45309; font-weight: 700; margin-top: 3px;">📅 Llegada: ${sale.orderExpectedDate}</div>` : ''}
        </td>
        <td>
          ${itemsHtml}
        </td>
        <td>
          <div style="font-weight: 700; color: #0f172a; font-size: 0.88rem;">${escapeHtml(sale.clientName || 'Cliente General')}</div>
          <div style="font-size: 0.78rem; color: #64748b; display: flex; align-items: center;">
            <span>${escapeHtml(sale.clientPhone || 'Sin teléfono')}</span>
            ${waLink}
          </div>
        </td>
        <td>
          <span style="font-size: 0.82rem; font-weight: 600; color: #4338ca;">👔 ${escapeHtml(sale.vendedor || 'Tienda Principal')}</span>
        </td>
        <td>
          <div style="font-weight: 800; font-size: 0.95rem; color: #0f172a;">$${(sale.totalAmount || 0).toFixed(2)}</div>
          <div style="margin-top: 2px;">${paymentBadge}</div>
        </td>
        <td>
          <span class="status-badge ${badgeClass}">${statusLabel}</span>
          ${sale.orderSupplierNotes ? `<div style="font-size: 0.7rem; color: #78350f; margin-top: 4px; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(sale.orderSupplierNotes)}">📝 ${escapeHtml(sale.orderSupplierNotes)}</div>` : ''}
        </td>
        <td>
          ${actionsHtml}
        </td>
      </tr>
    `;
  }).join('');
}

function openDeliverOrderModal(saleId) {
  const sale = state.sales.find(s => s.id === saleId);
  if (!sale) return;

  const modal = document.getElementById('deliverOrderModal');
  if (!modal) return;

  document.getElementById('deliverSaleId').value = sale.id;
  document.getElementById('deliverSaleIdText').textContent = `#${sale.id}`;
  document.getElementById('deliverClientName').textContent = sale.clientName || 'Cliente General';
  document.getElementById('deliverClientPhone').textContent = sale.clientPhone || 'Sin teléfono';

  const itemsDesc = (sale.items || []).map(i => `${i.quantity}x ${i.code} (${i.category})`).join(', ');
  document.getElementById('deliverProductName').textContent = itemsDesc || 'Producto';

  const payInfo = document.getElementById('deliverPaymentInfo');
  if (payInfo) {
    if (sale.creditBalance > 0) {
      payInfo.innerHTML = `
        <div style="color: #ef4444; font-weight: 700; font-size: 0.85rem;">⚠️ El cliente tiene un saldo pendiente de $${sale.creditBalance.toFixed(2)}</div>
        <div style="font-size: 0.74rem; color: #64748b;">Recuerda cobrar o registrar el abono al entregar.</div>
      `;
    } else {
      payInfo.innerHTML = `
        <div style="color: #16a34a; font-weight: 700; font-size: 0.85rem;">✅ Pago Completado ($${sale.totalAmount.toFixed(2)})</div>
      `;
    }
  }

  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  const localISO = (new Date(now.getTime() - offset)).toISOString().slice(0, 16);
  document.getElementById('deliverDateInput').value = localISO;
  document.getElementById('deliverNotesInput').value = 'Entregado conforme en tienda';

  modal.classList.add('active');
}

function closeDeliverOrderModal() {
  const modal = document.getElementById('deliverOrderModal');
  if (modal) modal.classList.remove('active');
}

function confirmOrderDelivery() {
  const saleId = document.getElementById('deliverSaleId').value;
  const sale = state.sales.find(s => s.id === saleId);
  if (!sale) return;

  const dateVal = document.getElementById('deliverDateInput').value;
  const notesVal = (document.getElementById('deliverNotesInput').value || '').trim();

  sale.orderStatus = 'ENTREGADO';
  sale.orderDeliveredAt = dateVal ? new Date(dateVal).toISOString() : new Date().toISOString();
  sale.orderDeliveryNotes = notesVal;

  saveSalesToStorage();
  closeDeliverOrderModal();
  renderOrdersTab();
  renderTopStats();
  renderHistory();
  showToast(`¡Pedido #${sale.id} marcado como ENTREGADO con éxito!`, 'success');
}

function changeOrderStatus(saleId, newStatus) {
  const sale = state.sales.find(s => s.id === saleId);
  if (!sale) return;

  if (newStatus === 'ENTREGADO') {
    openDeliverOrderModal(saleId);
    return;
  }

  sale.orderStatus = newStatus;
  sale.orderDeliveredAt = null;

  saveSalesToStorage();
  renderOrdersTab();
  renderTopStats();
  renderHistory();
  showToast(`Pedido #${sale.id} actualizado a: ${getOrderStatusLabel(newStatus)}`, 'info');
}

function revertOrderDelivery(saleId) {
  const sale = state.sales.find(s => s.id === saleId);
  if (!sale) return;

  if (confirm(`¿Desea revertir el estado de entrega del pedido #${sale.id} a "Listo para Entrega"?`)) {
    sale.orderStatus = 'LISTO_ENTREGA';
    sale.orderDeliveredAt = null;

    saveSalesToStorage();
    renderOrdersTab();
    renderTopStats();
    renderHistory();
    showToast(`Pedido #${sale.id} restablecido a pendiente de entrega`, 'info');
  }
}

function openWhatsAppOrderNotice(saleId) {
  const sale = state.sales.find(s => s.id === saleId);
  if (!sale || !sale.clientPhone) {
    showToast('El cliente no tiene teléfono registrado', 'warning');
    return;
  }

  const cleanPhone = sale.clientPhone.replace(/\D/g, '');
  const itemNames = (sale.items || []).map(i => `${i.quantity}x ${i.code}`).join(', ');

  let msg = '';
  if (sale.orderStatus === 'LISTO_ENTREGA') {
    msg = `Hola ${sale.clientName || ''}, te escribimos de Cubitt para informarte que tu pedido de ${itemNames} ya llegó a nuestra tienda y está listo para ser retirado. ¡Te esperamos!`;
  } else if (sale.orderStatus === 'ENTREGADO') {
    msg = `Hola ${sale.clientName || ''}, gracias por tu compra en Cubitt (${itemNames}). ¡Esperamos que disfrutes tu producto! Estamos a la orden ante cualquier duda.`;
  } else {
    msg = `Hola ${sale.clientName || ''}, te escribimos de Cubitt. Tu pedido de ${itemNames} se encuentra en proceso (${getOrderStatusLabel(sale.orderStatus)}). Te estaremos avisando tan pronto llegue a tienda.`;
  }

  const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
}

function exportProcurementListToCSV() {
  const pendingOrders = (state.sales || []).filter(s => s.isBajoPedido && s.orderStatus === 'PENDIENTE_COMPRA');
  if (pendingOrders.length === 0) {
    showToast('No hay pedidos en estado "Pendiente por Comprar" para solicitar al proveedor', 'warning');
    return;
  }

  // Aggregate by product code
  const map = {};
  pendingOrders.forEach(sale => {
    (sale.items || []).forEach(item => {
      const code = item.code || 'SIN_CODIGO';
      if (!map[code]) {
        map[code] = {
          code: code,
          description: item.description || item.category || 'Varios',
          category: item.category || 'Varios',
          totalQty: 0,
          unitMayor: item.mayor || 0,
          clients: []
        };
      }
      map[code].totalQty += (item.quantity || 1);
      const cDesc = `${sale.clientName || 'Cliente'} (${sale.id}, ${item.quantity}u)`;
      if (!map[code].clients.includes(cDesc)) {
        map[code].clients.push(cDesc);
      }
    });
  });

  let csvContent = 'Codigo Producto,Titulo / Descripcion,Categoria,Cantidad a Comprar,Costo Unitario USD,Total Costo Estimado USD,Clientes que Esperan Pedido\n';
  Object.values(map).forEach(p => {
    const totalMayorEst = p.totalQty * p.unitMayor;
    const row = [
      `"${p.code.replace(/"/g, '""')}"`,
      `"${p.description.replace(/"/g, '""')}"`,
      `"${p.category.replace(/"/g, '""')}"`,
      p.totalQty,
      p.unitMayor.toFixed(2),
      totalMayorEst.toFixed(2),
      `"${p.clients.join('; ').replace(/"/g, '""')}"`
    ].join(',');
    csvContent += row + '\n';
  });

  const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `Lista_Compras_Bajo_Pedido_Cubitt_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('Lista consolidada para compras/proveedor descargada exitosamente', 'success');
}

function exportOrdersToCSV() {
  const orders = (state.sales || []).filter(s => s.isBajoPedido);
  if (orders.length === 0) {
    showToast('No hay ventas bajo pedido registradas para exportar', 'warning');
    return;
  }

  let csvContent = 'ID Venta,Fecha Registro,Fecha Estimada Llegada,Productos Solicitados,Cantidad Total,Total USD,Modalidad Pago,Abono Pagado,Saldo Deudor,Cliente,Telefono,Vendedor,Estado Pedido,Fecha Entrega,Notas Proveedor / Entrega\n';
  orders.forEach(s => {
    const itemsSummary = (s.items || []).map(i => `${i.quantity}x ${i.code} (${i.category})`).join(' + ');
    const totalQty = (s.items || []).reduce((acc, i) => acc + (i.quantity || 1), 0);
    const row = [
      `"${s.id}"`,
      `"${s.displayDate || s.timestamp}"`,
      `"${s.orderExpectedDate || ''}"`,
      `"${itemsSummary.replace(/"/g, '""')}"`,
      totalQty,
      (s.totalAmount || 0).toFixed(2),
      `"${s.paymentType === 'contado' ? 'Contado' : (s.creditSubtypeLabel || 'Credito')}"`,
      (s.creditAbono || (s.paymentType === 'contado' ? s.totalAmount : 0)).toFixed(2),
      (s.creditBalance || 0).toFixed(2),
      `"${(s.clientName || '').replace(/"/g, '""')}"`,
      `"${(s.clientPhone || '').replace(/"/g, '""')}"`,
      `"${(s.vendedor || '').replace(/"/g, '""')}"`,
      `"${getOrderStatusLabel(s.orderStatus)}"`,
      `"${s.orderDeliveredAt ? formatDateTime(new Date(s.orderDeliveredAt)) : 'PENDIENTE'}"`,
      `"${((s.orderSupplierNotes || '') + ' ' + (s.orderDeliveryNotes || '')).trim().replace(/"/g, '""')}"`
    ].join(',');
    csvContent += row + '\n';
  });

  const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `Reporte_Ventas_Bajo_Pedido_Cubitt_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('Reporte de Ventas Bajo Pedido exportado exitosamente', 'success');
}

// Storage Management - Clients
function loadClientsFromStorage() {
  try {
    const saved = localStorage.getItem('cubitt_clients_v1');
    if (saved) {
      state.clients = JSON.parse(saved);
      return;
    }
  } catch (e) {
    console.error('Error loading clients from storage:', e);
  }

  // Pre-seed default demo clients
  state.clients = [
    {
      id: 'CLI-1001',
      name: 'María Rodríguez',
      phone: '0414-1234567',
      vendedor: 'Juan Pérez',
      idCard: 'V-18456123',
      email: 'maria.rodriguez@email.com',
      address: 'Caracas, Las Mercedes',
      notes: 'Cliente frecuente termos café',
      createdAt: new Date(Date.now() - 86400000 * 15).toISOString()
    },
    {
      id: 'CLI-1002',
      name: 'Carlos Gómez',
      phone: '0412-9876543',
      vendedor: 'Pedro Gómez',
      idCard: 'V-16789456',
      email: 'carlos.gomez@gmail.com',
      address: 'Caracas, Chacao',
      notes: 'Crédito Cashea Bull activo',
      createdAt: new Date(Date.now() - 86400000 * 7).toISOString()
    }
  ];

  // Auto-populate from any existing sales that are not 'General'
  if (state.sales && state.sales.length > 0) {
    state.sales.forEach(sale => {
      if (sale.clientName && sale.clientName.trim().toLowerCase() !== 'general' && sale.clientName.trim().toLowerCase() !== 'cliente general') {
        const found = state.clients.some(c => c.name.trim().toLowerCase() === sale.clientName.trim().toLowerCase());
        if (!found) {
          state.clients.push({
            id: 'CLI-' + Math.floor(1000 + Math.random() * 9000),
            name: sale.clientName.trim(),
            phone: sale.clientPhone ? sale.clientPhone.trim() : '',
            vendedor: sale.vendedor || '',
            idCard: '',
            email: '',
            address: '',
            notes: 'Registrado automáticamente desde ventas históricas',
            createdAt: sale.timestamp || new Date().toISOString()
          });
        }
      }
    });
  }

  saveClientsToStorage();
}

function saveClientsToStorage() {
  try {
    localStorage.setItem('cubitt_clients_v1', JSON.stringify(state.clients));
  } catch (e) {
    console.error('Error saving clients to storage:', e);
  }
}

function autoRegisterOrUpdateClient(name, phone, seller) {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed || trimmed.toLowerCase() === 'general' || trimmed.toLowerCase() === 'cliente general' || trimmed.toLowerCase() === 'consumidor final') {
    return null;
  }

  let client = state.clients.find(c => c.name.trim().toLowerCase() === trimmed.toLowerCase());
  if (client) {
    let changed = false;
    if (phone && (!client.phone || client.phone === '-')) {
      client.phone = phone.trim();
      changed = true;
    }
    if (seller && (!client.vendedor || client.vendedor === 'Sin asignar' || client.vendedor === 'Tienda Principal')) {
      client.vendedor = seller.trim();
      changed = true;
    }
    if (changed) saveClientsToStorage();
    return client;
  }

  const newClient = {
    id: 'CLI-' + Math.floor(1000 + Math.random() * 9000),
    name: trimmed,
    phone: phone ? phone.trim() : '',
    vendedor: seller ? seller.trim() : '',
    idCard: '',
    email: '',
    address: '',
    notes: 'Registrado desde venta POS',
    createdAt: new Date().toISOString()
  };

  state.clients.unshift(newClient);
  saveClientsToStorage();
  return newClient;
}

function getClientMetrics(client) {
  const normClientName = (client.name || '').trim().toLowerCase();
  const normPhone = (client.phone || '').replace(/\D/g, '');

  const clientSales = state.sales.filter(s => {
    if (!s) return false;
    const sName = (s.clientName || '').trim().toLowerCase();
    if (sName && sName === normClientName) return true;
    if (normPhone && s.clientPhone) {
      const sPhone = s.clientPhone.replace(/\D/g, '');
      if (sPhone && sPhone === normPhone) return true;
    }
    return false;
  });

  const totalPurchased = clientSales.reduce((acc, s) => acc + (s.totalAmount || 0), 0);
  const totalDebt = clientSales
    .filter(s => s.paymentType === 'credito' && (s.creditStatus === 'PENDIENTE' || (s.creditBalance && s.creditBalance > 0.01)))
    .reduce((acc, s) => acc + (s.creditBalance || 0), 0);
  const totalPaid = Math.max(0, totalPurchased - totalDebt);

  return {
    totalPurchased,
    totalDebt,
    totalPaid,
    salesCount: clientSales.length,
    salesList: clientSales
  };
}

function renderClients() {
  const tbody = document.getElementById('clientsTableBody');
  const emptyState = document.getElementById('clientsEmptyState');
  if (!tbody) return;

  // Global clients metrics calculation
  let totalPurchasedAll = 0;
  let totalDebtAll = 0;
  let debtorCount = 0;

  state.clients.forEach(c => {
    const m = getClientMetrics(c);
    totalPurchasedAll += m.totalPurchased;
    totalDebtAll += m.totalDebt;
    if (m.totalDebt > 0.01) {
      debtorCount++;
    }
  });

  const metricTotalCount = document.getElementById('clientMetricTotalCount');
  const metricDebtorsCount = document.getElementById('clientMetricDebtorsCount');
  const metricTotalDebt = document.getElementById('clientMetricTotalDebt');
  const metricTotalPurchased = document.getElementById('clientMetricTotalPurchased');
  const badgeClientsCount = document.getElementById('badgeClientsCount');

  if (metricTotalCount) metricTotalCount.textContent = state.clients.length;
  if (metricDebtorsCount) metricDebtorsCount.textContent = debtorCount;
  if (metricTotalDebt) metricTotalDebt.textContent = `$${totalDebtAll.toFixed(2)}`;
  if (metricTotalPurchased) metricTotalPurchased.textContent = `$${totalPurchasedAll.toFixed(2)}`;
  if (badgeClientsCount) badgeClientsCount.textContent = state.clients.length;

  // Filter clients
  let filtered = [...state.clients];

  if (state.clientSearchQuery) {
    const q = state.clientSearchQuery.toLowerCase();
    filtered = filtered.filter(c => 
      (c.name && c.name.toLowerCase().includes(q)) ||
      (c.phone && c.phone.toLowerCase().includes(q)) ||
      (c.vendedor && c.vendedor.toLowerCase().includes(q)) ||
      (c.idCard && c.idCard.toLowerCase().includes(q)) ||
      (c.email && c.email.toLowerCase().includes(q)) ||
      (c.notes && c.notes.toLowerCase().includes(q))
    );
  }

  if (state.clientFilterStatus === 'debt') {
    filtered = filtered.filter(c => getClientMetrics(c).totalDebt > 0.01);
  } else if (state.clientFilterStatus === 'clear') {
    filtered = filtered.filter(c => getClientMetrics(c).totalDebt <= 0.01);
  }

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  tbody.innerHTML = filtered.map(c => {
    const metrics = getClientMetrics(c);
    const initials = c.name
      .split(' ')
      .filter(w => w.length > 0)
      .slice(0, 2)
      .map(w => w[0].toUpperCase())
      .join('') || 'CL';

    const hasDebt = metrics.totalDebt > 0.01;
    const avatarClass = hasDebt ? 'client-avatar-circle debt' : 'client-avatar-circle';
    const debtBadgeHtml = hasDebt
      ? `<span class="debt-badge has-debt">⚠️ Debe $${metrics.totalDebt.toFixed(2)}</span>`
      : `<span class="debt-badge clear">✓ Al día</span>`;

    // Last sale date
    let lastDate = '-';
    if (metrics.salesList.length > 0) {
      lastDate = metrics.salesList[0].displayDate ? metrics.salesList[0].displayDate.split(' ')[0] : '-';
    }

    const cleanPhone = (c.phone || '').replace(/\D/g, '');
    const waLink = cleanPhone ? `<a href="https://wa.me/${cleanPhone}" target="_blank" style="color: #25d366; text-decoration: none; margin-left: 4px;" title="Chatear en WhatsApp">💬</a>` : '';
    const clientSeller = c.vendedor || (metrics.salesList.length > 0 && metrics.salesList[0].vendedor ? metrics.salesList[0].vendedor : 'Sin asignar');

    return `
      <tr>
        <td>
          <div style="display: flex; align-items: center; gap: 12px;">
            <div class="${avatarClass}">${initials}</div>
            <div>
              <div style="font-weight: 700; color: #0f172a; font-size: 0.92rem;">${escapeHtml(c.name)}</div>
              <div style="font-size: 0.75rem; color: #64748b;">${c.idCard ? `C.I. ${escapeHtml(c.idCard)}` : escapeHtml(c.id)}</div>
            </div>
          </div>
        </td>
        <td>
          <div style="font-weight: 600; font-size: 0.85rem; display: flex; align-items: center;">
            ${escapeHtml(c.phone || '-')} ${waLink}
          </div>
          <div style="font-size: 0.75rem; color: #64748b;">${escapeHtml(c.email || '')}</div>
        </td>
        <td>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="font-size: 1rem;">👔</span>
            <div>
              <div style="font-weight: 700; font-size: 0.85rem; color: #1e293b;">${escapeHtml(clientSeller)}</div>
              <div style="font-size: 0.72rem; color: #64748b;">Asignado</div>
            </div>
          </div>
        </td>
        <td>
          <div style="font-weight: 800; font-size: 0.95rem; color: #0f172a;">$${metrics.totalPurchased.toFixed(2)}</div>
          <div style="font-size: 0.74rem; color: #64748b;">${metrics.salesCount} ${metrics.salesCount === 1 ? 'compra' : 'compras'}</div>
        </td>
        <td>
          ${debtBadgeHtml}
        </td>
        <td>
          <div style="font-size: 0.82rem; color: #334155;">${lastDate}</div>
        </td>
        <td>
          <div style="display: flex; gap: 6px; align-items: center;">
            <button class="btn btn-outline btn-sm" onclick="openClientProfileModal('${c.id}')" title="Ver Ficha y Transacciones">
              👁️ Ficha
            </button>
            <button class="btn btn-outline btn-sm" onclick="openEditClientModal('${c.id}')" title="Editar Datos">
              ✏️
            </button>
            <button class="btn btn-outline btn-sm" onclick="deleteClientById('${c.id}')" title="Eliminar Cliente" style="color: #ef4444; border-color: #fecaca;">
              🗑️
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function openCreateClientModal() {
  const modal = document.getElementById('clientEditModal');
  if (!modal) return;

  document.getElementById('clientEditId').value = '';
  document.getElementById('clientEditModalTitle').textContent = 'Registrar Nuevo Cliente';
  document.getElementById('clientEditName').value = '';
  document.getElementById('clientEditPhone').value = '';
  document.getElementById('clientEditIdCard').value = '';
  document.getElementById('clientEditEmail').value = '';
  document.getElementById('clientEditAddress').value = '';
  document.getElementById('clientEditNotes').value = '';
  const sellerSelect = document.getElementById('clientEditSellerSelect');
  if (sellerSelect) sellerSelect.value = '';

  modal.classList.add('active');
  setTimeout(() => document.getElementById('clientEditName').focus(), 100);
}

function openEditClientModal(clientId) {
  const client = state.clients.find(c => c.id === clientId);
  if (!client) {
    showToast('Cliente no encontrado', 'danger');
    return;
  }

  const modal = document.getElementById('clientEditModal');
  if (!modal) return;

  document.getElementById('clientEditId').value = client.id;
  document.getElementById('clientEditModalTitle').textContent = `Editar Datos: ${client.name}`;
  document.getElementById('clientEditName').value = client.name || '';
  document.getElementById('clientEditPhone').value = client.phone || '';
  document.getElementById('clientEditIdCard').value = client.idCard || '';
  document.getElementById('clientEditEmail').value = client.email || '';
  document.getElementById('clientEditAddress').value = client.address || '';
  document.getElementById('clientEditNotes').value = client.notes || '';
  const sellerSelect = document.getElementById('clientEditSellerSelect');
  if (sellerSelect) sellerSelect.value = client.vendedor || '';

  modal.classList.add('active');
}

function closeClientEditModal() {
  const modal = document.getElementById('clientEditModal');
  if (modal) modal.classList.remove('active');
}

function saveClientFromModal() {
  const id = (document.getElementById('clientEditId').value || '').trim();
  const name = (document.getElementById('clientEditName').value || '').trim();
  const phone = (document.getElementById('clientEditPhone').value || '').trim();
  const idCard = (document.getElementById('clientEditIdCard').value || '').trim();
  const email = (document.getElementById('clientEditEmail').value || '').trim();
  const address = (document.getElementById('clientEditAddress').value || '').trim();
  const vendedor = (document.getElementById('clientEditSellerSelect')?.value || '').trim();
  const notes = (document.getElementById('clientEditNotes').value || '').trim();

  if (!name) {
    showToast('El nombre del cliente es obligatorio', 'danger');
    return;
  }

  if (!id) {
    // New Client
    const newClient = {
      id: 'CLI-' + Math.floor(1000 + Math.random() * 9000),
      name: name,
      phone: phone,
      vendedor: vendedor,
      idCard: idCard,
      email: email,
      address: address,
      notes: notes,
      createdAt: new Date().toISOString()
    };
    state.clients.unshift(newClient);
    showToast(`Cliente ${name} registrado con éxito`, 'success');
  } else {
    // Existing Client
    const index = state.clients.findIndex(c => c.id === id);
    if (index !== -1) {
      state.clients[index] = {
        ...state.clients[index],
        name: name,
        phone: phone,
        vendedor: vendedor,
        idCard: idCard,
        email: email,
        address: address,
        notes: notes
      };
      showToast(`Datos de ${name} actualizados`, 'success');
    }
  }

  saveClientsToStorage();
  closeClientEditModal();
  renderClients();

  // If the profile modal is currently open for this client, refresh it
  if (state.currentProfileClientId && (state.currentProfileClientId === id || !id)) {
    const targetId = id || state.clients[0].id;
    openClientProfileModal(targetId);
  }
}

function deleteClientById(clientId) {
  const client = state.clients.find(c => c.id === clientId);
  if (!client) return;

  if (confirm(`¿Está seguro de eliminar al cliente "${client.name}"? Los registros de ventas históricas se mantendrán.`)) {
    state.clients = state.clients.filter(c => c.id !== clientId);
    saveClientsToStorage();
    renderClients();
    if (state.currentProfileClientId === clientId) {
      closeClientProfileModal();
    }
    showToast(`Cliente ${client.name} eliminado`, 'info');
  }
}

function openClientProfileModal(clientId) {
  const client = state.clients.find(c => c.id === clientId);
  if (!client) {
    showToast('Cliente no encontrado', 'danger');
    return;
  }

  state.currentProfileClientId = clientId;
  const metrics = getClientMetrics(client);

  const modal = document.getElementById('clientProfileModal');
  if (!modal) return;

  const initials = client.name
    .split(' ')
    .filter(w => w.length > 0)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('') || 'CL';

  const avatar = document.getElementById('profileAvatar');
  if (avatar) {
    avatar.textContent = initials;
    avatar.className = metrics.totalDebt > 0.01 ? 'client-avatar-circle debt' : 'client-avatar-circle';
  }

  document.getElementById('profileName').textContent = client.name;
  document.getElementById('profileIdCard').textContent = client.idCard ? `C.I. / RIF: ${client.idCard}` : 'Sin C.I. registrada';

  const clientSeller = client.vendedor || (metrics.salesList.length > 0 && metrics.salesList[0].vendedor ? metrics.salesList[0].vendedor : 'Sin asignar');
  const profileSellerEl = document.getElementById('profileSellerName');
  if (profileSellerEl) profileSellerEl.textContent = clientSeller;

  const debtBadgeContainer = document.getElementById('profileDebtBadge');
  if (debtBadgeContainer) {
    if (metrics.totalDebt > 0.01) {
      debtBadgeContainer.innerHTML = `<span class="debt-badge has-debt" style="font-size: 0.95rem; padding: 6px 14px;">⚠️ Saldo Deudor: $${metrics.totalDebt.toFixed(2)}</span>`;
    } else {
      debtBadgeContainer.innerHTML = `<span class="debt-badge clear" style="font-size: 0.95rem; padding: 6px 14px;">✓ Solvente (Al Día)</span>`;
    }
  }

  document.getElementById('profilePhone').textContent = client.phone || 'No registrado';
  document.getElementById('profileTotalPurchased').textContent = `$${metrics.totalPurchased.toFixed(2)}`;
  document.getElementById('profileTotalPaid').textContent = `$${metrics.totalPaid.toFixed(2)}`;
  document.getElementById('profileTotalDebt').textContent = `$${metrics.totalDebt.toFixed(2)}`;

  document.getElementById('profileEmail').textContent = client.email || 'No registrado';
  document.getElementById('profileAddress').textContent = client.address || 'No registrada';
  document.getElementById('profileNotes').textContent = client.notes || 'Sin notas';
  document.getElementById('profileTxCount').textContent = `${metrics.salesCount} ${metrics.salesCount === 1 ? 'venta registrada' : 'ventas registradas'}`;

  // WhatsApp Button
  const waBtn = document.getElementById('profileWhatsAppBtn');
  if (waBtn) {
    const cleanPhone = (client.phone || '').replace(/\D/g, '');
    if (cleanPhone) {
      waBtn.style.display = 'inline-flex';
      const msg = encodeURIComponent(`Hola ${client.name}, le saludamos de Cubitt.`);
      waBtn.href = `https://wa.me/${cleanPhone}?text=${msg}`;
    } else {
      waBtn.style.display = 'none';
    }
  }

  // Populate Sales History Table
  const salesTbody = document.getElementById('profileSalesTableBody');
  if (salesTbody) {
    if (metrics.salesList.length === 0) {
      salesTbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #94a3b8; padding: 2rem;">Este cliente aún no registra transacciones en el sistema.</td></tr>`;
    } else {
      salesTbody.innerHTML = metrics.salesList.map(s => {
        const isCredit = s.paymentType === 'credito';
        const isPending = isCredit && (s.creditStatus === 'PENDIENTE' || (s.creditBalance && s.creditBalance > 0.01));
        const statusHtml = !isCredit 
          ? `<span class="status-badge disponible">Contado</span>`
          : (isPending 
              ? `<span class="status-badge agotado">Debe $${(s.creditBalance || 0).toFixed(2)}</span>`
              : `<span class="status-badge disponible">Crédito Solvente</span>`);

        const itemsSummary = (s.items || []).map(i => `${i.code} (x${i.quantity})`).join(', ');

        return `
          <tr>
            <td>
              <div style="font-weight: 700; color: #0f172a;">#${escapeHtml(s.id)}</div>
              <div style="font-size: 0.72rem; color: #64748b;">${escapeHtml(s.displayDate || '')}</div>
            </td>
            <td style="max-width: 180px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(itemsSummary)}">
              ${escapeHtml(itemsSummary || '-')}
            </td>
            <td>
              <span style="font-weight: 600; font-size: 0.8rem; color: #334155;">
                👔 ${escapeHtml(s.vendedor || 'Tienda')}
              </span>
            </td>
            <td>
              <span style="font-weight: 600; text-transform: uppercase; font-size: 0.75rem;">
                ${escapeHtml(s.creditSubtypeLabel || s.paymentMethod || s.paymentType)}
              </span>
            </td>
            <td>
              <span style="font-weight: 800; color: #0f172a;">$${(s.totalAmount || 0).toFixed(2)}</span>
            </td>
            <td>
              ${statusHtml}
            </td>
            <td>
              <div style="display: flex; gap: 4px;">
                <button class="btn btn-outline btn-sm" onclick="viewReceipt('${s.id}')" title="Ver Recibo" style="padding: 3px 8px; font-size: 0.75rem;">
                  🧾
                </button>
                ${isPending ? `
                  <button class="btn btn-primary btn-sm" onclick="closeClientProfileModal(); openAbonoModal('${s.id}')" title="Abonar a Crédito" style="padding: 3px 8px; font-size: 0.75rem;">
                    💵 Abonar
                  </button>
                ` : ''}
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }
  }

  modal.classList.add('active');
}

function closeClientProfileModal() {
  const modal = document.getElementById('clientProfileModal');
  if (modal) modal.classList.remove('active');
  state.currentProfileClientId = null;
}

function openEditCurrentProfileClient() {
  if (state.currentProfileClientId) {
    const id = state.currentProfileClientId;
    closeClientProfileModal();
    openEditClientModal(id);
  }
}

function exportClientsToCSV() {
  if (state.clients.length === 0) {
    showToast('No hay clientes registrados para exportar', 'danger');
    return;
  }

  const headers = [
    'ID Cliente',
    'Nombre Completo',
    'C.I. / RIF',
    'Teléfono',
    'Vendedor Asignado',
    'Email',
    'Dirección',
    'Total Comprado ($)',
    'Total Pagado ($)',
    'Saldo Deudor ($)',
    'Estado Solvencia',
    'N° Compras',
    'Fecha Registro',
    'Notas'
  ];

  const rows = state.clients.map(c => {
    const m = getClientMetrics(c);
    const solvencia = m.totalDebt > 0.01 ? 'CON DEUDA' : 'AL DIA';
    const clientSeller = c.vendedor || (m.salesList.length > 0 && m.salesList[0].vendedor ? m.salesList[0].vendedor : 'Sin asignar');
    return [
      `"${c.id}"`,
      `"${(c.name || '').replace(/"/g, '""')}"`,
      `"${c.idCard || ''}"`,
      `"${c.phone || ''}"`,
      `"${clientSeller.replace(/"/g, '""')}"`,
      `"${c.email || ''}"`,
      `"${(c.address || '').replace(/"/g, '""')}"`,
      m.totalPurchased.toFixed(2),
      m.totalPaid.toFixed(2),
      m.totalDebt.toFixed(2),
      `"${solvencia}"`,
      m.salesCount,
      `"${c.createdAt || ''}"`,
      `"${(c.notes || '').replace(/"/g, '""')}"`
    ];
  });

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Directorio_Clientes_Cubitt_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Directorio de clientes exportado a CSV con éxito', 'success');
}

function setupClientAutocomplete() {
  const input = document.getElementById('clientNameInput');
  const dropdown = document.getElementById('clientAutocompleteDropdown');
  if (!input || !dropdown) return;

  input.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (q.length < 1) {
      dropdown.classList.remove('active');
      dropdown.innerHTML = '';
      return;
    }

    const matches = state.clients.filter(c => 
      c.name.toLowerCase().includes(q) || (c.phone && c.phone.includes(q)) || (c.vendedor && c.vendedor.toLowerCase().includes(q))
    ).slice(0, 6);

    if (matches.length === 0) {
      dropdown.classList.remove('active');
      dropdown.innerHTML = '';
      return;
    }

    dropdown.innerHTML = matches.map(c => {
      const m = getClientMetrics(c);
      const debtText = m.totalDebt > 0.01 
        ? `<span style="color: #ef4444; font-size: 0.75rem; font-weight: 700;">Deuda: $${m.totalDebt.toFixed(2)}</span>` 
        : `<span style="color: #16a34a; font-size: 0.75rem;">Al día</span>`;

      return `
        <div class="autocomplete-item" onclick="selectClientForPOS('${c.id}')" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; cursor: pointer;">
          <div>
            <div style="font-weight: 700; font-size: 0.85rem; color: #0f172a;">${escapeHtml(c.name)}</div>
            <div style="font-size: 0.72rem; color: #64748b;">${escapeHtml(c.phone || 'Sin teléfono')} ${c.vendedor ? `| 👔 ${escapeHtml(c.vendedor)}` : ''} ${c.idCard ? `| C.I. ${escapeHtml(c.idCard)}` : ''}</div>
          </div>
          <div>${debtText}</div>
        </div>
      `;
    }).join('');

    dropdown.classList.add('active');
  });

  // Close when clicking outside
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && e.target !== input) {
      dropdown.classList.remove('active');
    }
  });
}

function selectClientForPOS(clientId) {
  const client = state.clients.find(c => c.id === clientId);
  if (!client) return;

  const nameInput = document.getElementById('clientNameInput');
  const phoneInput = document.getElementById('clientPhoneInput');
  const sellerSelect = document.getElementById('saleSellerSelect');
  const dropdown = document.getElementById('clientAutocompleteDropdown');

  if (nameInput) nameInput.value = client.name;
  if (phoneInput && client.phone) phoneInput.value = client.phone;
  if (sellerSelect && client.vendedor) {
    sellerSelect.value = client.vendedor;
    handleSaleSellerChange();
  }
  if (dropdown) dropdown.classList.remove('active');
}

// Event Listeners Setup
function initEventListeners() {
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tab) {
        switchTab(btn.dataset.tab);
      }
    });
  });

  // Global listener to close dropdown menus when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.nav-dropdown')) {
      closeAllNavDropdowns();
    }
  });

  const qtyInput = document.getElementById('saleQtyInput');
  const priceInput = document.getElementById('salePriceInput');
  const abonoInput = document.getElementById('creditInitialPayment');

  if (qtyInput) qtyInput.addEventListener('input', updateLiveCalculations);
  if (priceInput) priceInput.addEventListener('input', updateLiveCalculations);
  if (abonoInput) abonoInput.addEventListener('input', updateLiveCalculations);

  // Commission input listeners
  for (let i = 1; i <= 3; i++) {
    const valInput = document.getElementById(`comm${i}Value`);
    const concInput = document.getElementById(`comm${i}Concept`);
    const benInput = document.getElementById(`comm${i}Beneficiary`);

    if (valInput) valInput.addEventListener('input', updateLiveCalculations);
    if (concInput) concInput.addEventListener('input', updateLiveCalculations);
    if (benInput) benInput.addEventListener('input', updateLiveCalculations);
  }

  // History Filters
  document.querySelectorAll('[data-hist-type]').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('[data-hist-type]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.historyFilterType = chip.dataset.histType;
      renderHistory();
    });
  });

  document.querySelectorAll('[data-hist-platform]').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('[data-hist-platform]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.historyFilterPlatform = chip.dataset.histPlatform;
      renderHistory();
    });
  });

  document.querySelectorAll('[data-hist-date]').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('[data-hist-date]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.historyFilterDate = chip.dataset.histDate;
      renderHistory();
    });
  });

  const histSearch = document.getElementById('historySearchInput');
  if (histSearch) {
    histSearch.addEventListener('input', (e) => {
      state.historySearchQuery = e.target.value;
      renderHistory();
    });
  }

  // CXP Status Filters
  document.querySelectorAll('[data-cxp-status]').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('[data-cxp-status]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.cxpFilterStatus = chip.dataset.cxpStatus;
      renderPayables();
    });
  });

  // CXP Category / Origin Filters
  document.querySelectorAll('[data-cxp-cat]').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('[data-cxp-cat]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.cxpFilterCat = chip.dataset.cxpCat;
      renderPayables();
    });
  });

  const cxpSearch = document.getElementById('cxpSearchInput');
  if (cxpSearch) {
    cxpSearch.addEventListener('input', (e) => {
      state.cxpSearchQuery = e.target.value;
      renderPayables();
    });
  }

  // Catalog Filters
  const catSearch = document.getElementById('catalogSearchInput');
  if (catSearch) {
    catSearch.addEventListener('input', (e) => {
      state.catalogSearchQuery = e.target.value;
      renderCatalog();
    });
  }

  const catSelect = document.getElementById('catalogCategorySelect');
  if (catSelect) {
    catSelect.addEventListener('change', (e) => {
      state.catalogCategoryFilter = e.target.value;
      renderCatalog();
    });
  }

  const catStatusSelect = document.getElementById('catalogStatusSelect');
  if (catStatusSelect) {
    catStatusSelect.addEventListener('change', (e) => {
      state.catalogStatusFilter = e.target.value;
      renderCatalog();
    });
  }

  // Client Status Filters
  document.querySelectorAll('[data-client-filter]').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('[data-client-filter]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.clientFilterStatus = chip.dataset.clientFilter;
      renderClients();
    });
  });

  const clientSearch = document.getElementById('clientSearchInput');
  if (clientSearch) {
    clientSearch.addEventListener('input', (e) => {
      state.clientSearchQuery = e.target.value;
      renderClients();
    });
  }
}

/* ==========================================================================
   GESTIÓN DE USUARIOS Y ACCESOS (Roles: Gerencia, Inversor, Vendedor)
   ========================================================================== */

function loadUsersFromStorage() {
  try {
    const saved = localStorage.getItem('cubitt_users_v1');
    if (saved) {
      state.users = JSON.parse(saved);
      return;
    }
  } catch (e) {
    console.error('Error loading users from storage:', e);
  }

  // Pre-seed default demo users representing existing roles
  state.users = [
    {
      id: 'USR-1001',
      username: 'admin',
      password: '123',
      fullName: 'Dirección General Cubitt',
      role: 'gerencia',
      sellerName: '',
      status: 'ACTIVO',
      notes: 'Administración total de tienda y finanzas',
      createdAt: new Date(Date.now() - 3600000 * 24 * 30).toISOString(),
      createdDisplayDate: '01/09/2026 10:00 AM'
    },
    {
      id: 'USR-1002',
      username: 'inversor',
      password: '123',
      fullName: 'Grupo Inversor Cubitt',
      role: 'inversor',
      sellerName: '',
      status: 'ACTIVO',
      notes: 'Supervisión de utilidades, márgenes y finanzas',
      createdAt: new Date(Date.now() - 3600000 * 24 * 25).toISOString(),
      createdDisplayDate: '05/09/2026 03:30 PM'
    },
    {
      id: 'USR-1003',
      username: 'juan.perez',
      password: '123',
      fullName: 'Juan Pérez',
      role: 'vendedor',
      sellerName: 'Juan Pérez',
      status: 'ACTIVO',
      notes: 'Asesor principal de ventas en tienda y Cashea',
      createdAt: new Date(Date.now() - 3600000 * 24 * 20).toISOString(),
      createdDisplayDate: '10/09/2026 09:15 AM'
    },
    {
      id: 'USR-1004',
      username: 'ana.silva',
      password: '123',
      fullName: 'Ana Silva',
      role: 'vendedor',
      sellerName: 'Ana Silva',
      status: 'ACTIVO',
      notes: 'Asesora comercial y atención al cliente',
      createdAt: new Date(Date.now() - 3600000 * 24 * 15).toISOString(),
      createdDisplayDate: '15/09/2026 11:20 AM'
    },
    {
      id: 'USR-1005',
      username: 'pedro.gomez',
      password: '123',
      fullName: 'Pedro Gómez',
      role: 'vendedor',
      sellerName: 'Pedro Gómez',
      status: 'ACTIVO',
      notes: 'Ventas de piso y gestión de cobranza créditos JP',
      createdAt: new Date(Date.now() - 3600000 * 24 * 10).toISOString(),
      createdDisplayDate: '20/09/2026 02:45 PM'
    }
  ];

  saveUsersToStorage();
}

function saveUsersToStorage() {
  try {
    localStorage.setItem('cubitt_users_v1', JSON.stringify(state.users));
    renderTopStats();
  } catch (e) {
    console.error('Error saving users to storage:', e);
  }
}

function getRoleBadgeHtml(role) {
  const r = (role || 'vendedor').toLowerCase();
  if (r === 'gerencia') {
    return '<span class="role-badge gerencia">👑 Gerencia</span>';
  } else if (r === 'inversor') {
    return '<span class="role-badge inversor">💼 Inversor</span>';
  }
  return '<span class="role-badge vendedor">👔 Vendedor</span>';
}

function getUserRoleLabel(role) {
  const r = (role || 'vendedor').toLowerCase();
  if (r === 'gerencia') return 'Gerencia';
  if (r === 'inversor') return 'Inversor';
  return 'Vendedor';
}

function getUserInitials(name) {
  if (!name) return 'CU';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function handleUserRoleChange(context) {
  const roleSelect = document.getElementById(context === 'create' ? 'createUserRoleSelect' : 'editUserRoleSelect');
  const sellerSelect = document.getElementById(context === 'create' ? 'createUserSellerSelect' : 'editUserSellerSelect');
  if (!roleSelect || !sellerSelect) return;
}

function togglePasswordVisibility(inputId, iconId) {
  const input = document.getElementById(inputId);
  const icon = document.getElementById(iconId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    if (icon) icon.textContent = '🙈';
  } else {
    input.type = 'password';
    if (icon) icon.textContent = '👁️';
  }
}

function toggleTableRowPassword(userId) {
  state.revealedUserPasswords[userId] = !state.revealedUserPasswords[userId];
  const box = document.getElementById(`userPassBox_${userId}`);
  const icon = document.getElementById(`userPassIcon_${userId}`);
  const user = state.users.find(u => u.id === userId);
  if (box && user) {
    if (state.revealedUserPasswords[userId]) {
      box.textContent = user.password;
      box.style.fontFamily = 'monospace';
      box.style.letterSpacing = 'normal';
      if (icon) icon.textContent = '🙈';
    } else {
      box.textContent = '••••••••';
      box.style.letterSpacing = '2px';
      if (icon) icon.textContent = '👁️';
    }
  }
}

function copyUserPassword(password) {
  if (!navigator.clipboard) {
    showToast('Clave: ' + password, 'info');
    return;
  }
  navigator.clipboard.writeText(password).then(() => {
    showToast('Contraseña copiada al portapapeles 📋', 'success');
  }).catch(() => {
    showToast('Clave: ' + password, 'info');
  });
}

function renderUsersMetrics() {
  const users = state.users || [];
  const total = users.length;
  const active = users.filter(u => u.status === 'ACTIVO').length;
  const adminInv = users.filter(u => u.role === 'gerencia' || u.role === 'inversor').length;
  const sellers = users.filter(u => u.role === 'vendedor' || (u.sellerName && u.sellerName.trim())).length;

  const elTotal = document.getElementById('userTabMetricTotal');
  const elActive = document.getElementById('userTabMetricActive');
  const elAdminInv = document.getElementById('userTabMetricAdminInv');
  const elSellers = document.getElementById('userTabMetricSellers');

  if (elTotal) elTotal.textContent = total;
  if (elActive) elActive.textContent = active;
  if (elAdminInv) elAdminInv.textContent = adminInv;
  if (elSellers) elSellers.textContent = sellers;
}

function renderUsersTab() {
  renderUsersMetrics();
  const tbody = document.getElementById('usersTabTableBody');
  const emptyState = document.getElementById('usersTabEmptyState');
  if (!tbody) return;

  let list = [...(state.users || [])];

  // Filter by Role
  if (state.usersFilterRole && state.usersFilterRole !== 'all') {
    list = list.filter(u => (u.role || '').toLowerCase() === state.usersFilterRole.toLowerCase());
  }

  // Filter by Status
  if (state.usersFilterStatus && state.usersFilterStatus !== 'all') {
    list = list.filter(u => (u.status || 'ACTIVO').toUpperCase() === state.usersFilterStatus.toUpperCase());
  }

  // Filter by Search Query
  if (state.usersSearchQuery) {
    const q = state.usersSearchQuery.toLowerCase();
    list = list.filter(u => 
      (u.username || '').toLowerCase().includes(q) ||
      (u.fullName || '').toLowerCase().includes(q) ||
      (u.role || '').toLowerCase().includes(q) ||
      (u.sellerName || '').toLowerCase().includes(q) ||
      (u.notes || '').toLowerCase().includes(q)
    );
  }

  if (list.length === 0) {
    tbody.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  tbody.innerHTML = list.map(u => {
    const initials = getUserInitials(u.fullName || u.username);
    const isRevealed = Boolean(state.revealedUserPasswords[u.id]);
    const passDisplay = isRevealed ? escapeHtml(u.password) : '••••••••';
    const passStyle = isRevealed ? 'font-family: monospace; letter-spacing: normal;' : 'letter-spacing: 2px;';
    const eyeIcon = isRevealed ? '🙈' : '👁️';

    const sellerDisplay = u.sellerName && u.sellerName.trim()
      ? `<span style="font-weight: 600; color: #1e293b; display: inline-flex; align-items: center; gap: 4px;">👔 ${escapeHtml(u.sellerName)}</span>`
      : `<span style="color: #94a3b8; font-style: italic;">-- Sin vincular --</span>`;

    const statusClass = u.status === 'ACTIVO' ? 'status-entregado' : 'status-pendiente';
    const statusIcon = u.status === 'ACTIVO' ? '🟢' : '🔴';
    const statusText = u.status === 'ACTIVO' ? 'ACTIVO' : 'INACTIVO';

    const dateDisplay = u.createdDisplayDate || (u.createdAt ? formatDateTime(new Date(u.createdAt)) : '-');

    return `
      <tr>
        <td>
          <div style="display: flex; align-items: center; gap: 10px;">
            <div class="user-avatar-circle ${escapeHtml(u.role || 'vendedor')}">
              ${escapeHtml(initials)}
            </div>
            <div>
              <div style="font-weight: 800; color: #0f172a; font-size: 0.92rem; display: flex; align-items: center; gap: 6px;">
                <span>@${escapeHtml(u.username)}</span>
              </div>
              <div style="font-size: 0.82rem; color: #475569; font-weight: 500;">
                ${escapeHtml(u.fullName || '-')}
              </div>
              ${u.notes ? `<div style="font-size: 0.72rem; color: #94a3b8; margin-top: 2px;">💬 ${escapeHtml(u.notes)}</div>` : ''}
            </div>
          </div>
        </td>
        <td>
          ${getRoleBadgeHtml(u.role)}
        </td>
        <td>
          ${sellerDisplay}
        </td>
        <td>
          <div class="password-display-box">
            <span id="userPassBox_${u.id}" class="password-val" style="${passStyle}">${passDisplay}</span>
            <button type="button" class="password-toggle-btn" onclick="toggleTableRowPassword('${u.id}')" title="Ver / Ocultar clave">
              <span id="userPassIcon_${u.id}">${eyeIcon}</span>
            </button>
            <button type="button" class="password-toggle-btn" onclick="copyUserPassword('${escapeHtml(u.password)}')" title="Copiar clave">
              📋
            </button>
          </div>
        </td>
        <td>
          <span class="status-badge ${statusClass}" style="cursor: pointer;" onclick="toggleUserStatus('${u.id}')" title="Clic para alternar estado">
            ${statusIcon} ${statusText}
          </span>
        </td>
        <td style="font-size: 0.78rem; color: #64748b;">
          ${dateDisplay}
        </td>
        <td>
          <div style="display: flex; gap: 6px; align-items: center;">
            <button class="btn btn-outline btn-sm" onclick="openEditUserModal('${u.id}')" title="Editar datos y rol del usuario" style="padding: 4px 8px;">
              ✏️
            </button>
            <button class="btn btn-outline btn-sm" onclick="openChangePasswordModal('${u.id}')" title="Cambiar contraseña" style="padding: 4px 8px;">
              🔑
            </button>
            <button class="btn btn-outline btn-sm" onclick="toggleUserStatus('${u.id}')" title="${u.status === 'ACTIVO' ? 'Desactivar usuario' : 'Activar usuario'}" style="padding: 4px 8px;">
              ${u.status === 'ACTIVO' ? '🚫' : '✅'}
            </button>
            <button class="btn btn-outline btn-sm" onclick="deleteUserById('${u.id}')" title="Eliminar usuario" style="padding: 4px 8px; color: #ef4444;">
              🗑️
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function setUserRoleFilter(role) {
  state.usersFilterRole = role;
  document.querySelectorAll('[data-user-role]').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.userRole === role);
  });
  renderUsersTab();
}

function setUserStatusFilter(status) {
  state.usersFilterStatus = status;
  document.querySelectorAll('[data-user-status]').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.userStatus === status);
  });
  renderUsersTab();
}

function handleUserSearch(query) {
  state.usersSearchQuery = (query || '').trim();
  renderUsersTab();
}

function openCreateUserModal() {
  const modal = document.getElementById('createUserModal');
  if (!modal) return;

  // Reset fields
  const uInput = document.getElementById('createUsernameInput');
  const pInput = document.getElementById('createPasswordInput');
  const fInput = document.getElementById('createFullNameInput');
  const rSelect = document.getElementById('createUserRoleSelect');
  const sSelect = document.getElementById('createUserSellerSelect');
  const stSelect = document.getElementById('createUserStatusSelect');
  const nInput = document.getElementById('createUserNotesInput');
  const icon = document.getElementById('createPasswordIcon');

  if (uInput) uInput.value = '';
  if (pInput) {
    pInput.value = '';
    pInput.type = 'password';
  }
  if (icon) icon.textContent = '👁️';
  if (fInput) fInput.value = '';
  if (rSelect) rSelect.value = 'vendedor';
  if (stSelect) stSelect.value = 'ACTIVO';
  if (nInput) nInput.value = '';

  populateSellerSelects();
  if (sSelect) sSelect.value = '';

  modal.classList.add('active');
  if (uInput) uInput.focus();
}

function closeCreateUserModal() {
  const modal = document.getElementById('createUserModal');
  if (modal) modal.classList.remove('active');
}

function handleSaveNewUser() {
  const username = (document.getElementById('createUsernameInput')?.value || '').trim().toLowerCase();
  const password = (document.getElementById('createPasswordInput')?.value || '').trim();
  const fullName = (document.getElementById('createFullNameInput')?.value || '').trim();
  const role = (document.getElementById('createUserRoleSelect')?.value || 'vendedor').trim();
  const sellerName = (document.getElementById('createUserSellerSelect')?.value || '').trim();
  const status = (document.getElementById('createUserStatusSelect')?.value || 'ACTIVO').trim();
  const notes = (document.getElementById('createUserNotesInput')?.value || '').trim();

  if (!username) {
    showToast('Por favor ingrese un nombre de usuario', 'error');
    document.getElementById('createUsernameInput')?.focus();
    return;
  }

  // Username validation: alphanumeric, dot, underscore, hyphen
  if (!/^[a-z0-9._-]+$/.test(username)) {
    showToast('El usuario solo debe contener letras, números, puntos o guiones (sin espacios)', 'error');
    return;
  }

  // Uniqueness check
  const exists = (state.users || []).some(u => (u.username || '').toLowerCase() === username);
  if (exists) {
    showToast(`El nombre de usuario "${username}" ya está registrado. Elija otro.`, 'error');
    return;
  }

  if (!password || password.length < 3) {
    showToast('La contraseña debe tener al menos 3 caracteres', 'error');
    document.getElementById('createPasswordInput')?.focus();
    return;
  }

  if (!fullName) {
    showToast('Por favor ingrese el nombre completo del usuario', 'error');
    document.getElementById('createFullNameInput')?.focus();
    return;
  }

  const now = new Date();
  const newUser = {
    id: 'USR-' + Math.floor(1000 + Math.random() * 9000),
    username: username,
    password: password,
    fullName: fullName,
    role: role,
    sellerName: sellerName,
    status: status,
    notes: notes,
    createdAt: now.toISOString(),
    createdDisplayDate: formatDateTime(now)
  };

  state.users.unshift(newUser);
  saveUsersToStorage();
  closeCreateUserModal();
  renderUsersTab();
  showToast(`Usuario @${username} creado con éxito 🎉`, 'success');
}

function openEditUserModal(userId) {
  const user = (state.users || []).find(u => u.id === userId);
  if (!user) return;

  const modal = document.getElementById('editUserModal');
  if (!modal) return;

  populateSellerSelects();

  document.getElementById('editUserIdInput').value = user.id;
  const label = document.getElementById('editUserUsernameLabel');
  if (label) label.textContent = `@${user.username}`;

  const uInput = document.getElementById('editUsernameInput');
  const fInput = document.getElementById('editFullNameInput');
  const rSelect = document.getElementById('editUserRoleSelect');
  const sSelect = document.getElementById('editUserSellerSelect');
  const stSelect = document.getElementById('editUserStatusSelect');
  const nInput = document.getElementById('editUserNotesInput');
  const pInput = document.getElementById('editUserNewPasswordInput');
  const pIcon = document.getElementById('editPasswordIcon');

  if (uInput) uInput.value = user.username || '';
  if (fInput) fInput.value = user.fullName || '';
  if (rSelect) rSelect.value = user.role || 'vendedor';
  if (sSelect) sSelect.value = user.sellerName || '';
  if (stSelect) stSelect.value = user.status || 'ACTIVO';
  if (nInput) nInput.value = user.notes || '';
  if (pInput) {
    pInput.value = '';
    pInput.type = 'password';
  }
  if (pIcon) pIcon.textContent = '👁️';

  modal.classList.add('active');
}

function closeEditUserModal() {
  const modal = document.getElementById('editUserModal');
  if (modal) modal.classList.remove('active');
}

function handleSaveEditedUser() {
  const userId = document.getElementById('editUserIdInput')?.value;
  const user = (state.users || []).find(u => u.id === userId);
  if (!user) return;

  const username = (document.getElementById('editUsernameInput')?.value || '').trim().toLowerCase();
  const fullName = (document.getElementById('editFullNameInput')?.value || '').trim();
  const role = (document.getElementById('editUserRoleSelect')?.value || 'vendedor').trim();
  const sellerName = (document.getElementById('editUserSellerSelect')?.value || '').trim();
  const status = (document.getElementById('editUserStatusSelect')?.value || 'ACTIVO').trim();
  const notes = (document.getElementById('editUserNotesInput')?.value || '').trim();
  const newPassword = (document.getElementById('editUserNewPasswordInput')?.value || '').trim();

  if (!username) {
    showToast('El nombre de usuario no puede estar vacío', 'error');
    return;
  }

  if (!/^[a-z0-9._-]+$/.test(username)) {
    showToast('El usuario solo debe contener letras, números, puntos o guiones', 'error');
    return;
  }

  // Check unique username against OTHER users
  const conflict = (state.users || []).some(u => u.id !== userId && (u.username || '').toLowerCase() === username);
  if (conflict) {
    showToast(`El nombre de usuario "${username}" ya está en uso por otra cuenta`, 'error');
    return;
  }

  if (!fullName) {
    showToast('El nombre completo no puede estar vacío', 'error');
    return;
  }

  if (newPassword && newPassword.length < 3) {
    showToast('La nueva contraseña debe tener al menos 3 caracteres', 'error');
    return;
  }

  user.username = username;
  user.fullName = fullName;
  user.role = role;
  user.sellerName = sellerName;
  user.status = status;
  user.notes = notes;
  if (newPassword) {
    user.password = newPassword;
  }

  saveUsersToStorage();
  closeEditUserModal();
  renderUsersTab();
  showToast(`Usuario @${username} actualizado correctamente`, 'success');
}

function openChangePasswordModal(userId) {
  const user = (state.users || []).find(u => u.id === userId);
  if (!user) return;

  const modal = document.getElementById('changePasswordModal');
  if (!modal) return;

  document.getElementById('changePasswordUserIdInput').value = user.id;
  const label = document.getElementById('changePasswordUserLabel');
  if (label) label.textContent = `@${user.username} (${user.fullName})`;

  const pInput = document.getElementById('changePasswordNewInput');
  const pIcon = document.getElementById('quickChangePasswordIcon');
  if (pInput) {
    pInput.value = '';
    pInput.type = 'password';
  }
  if (pIcon) pIcon.textContent = '👁️';

  modal.classList.add('active');
  if (pInput) pInput.focus();
}

function closeChangePasswordModal() {
  const modal = document.getElementById('changePasswordModal');
  if (modal) modal.classList.remove('active');
}

function handleConfirmChangePassword() {
  const userId = document.getElementById('changePasswordUserIdInput')?.value;
  const user = (state.users || []).find(u => u.id === userId);
  if (!user) return;

  const newPassword = (document.getElementById('changePasswordNewInput')?.value || '').trim();
  if (!newPassword || newPassword.length < 3) {
    showToast('La contraseña debe tener al menos 3 caracteres', 'error');
    return;
  }

  user.password = newPassword;
  saveUsersToStorage();
  closeChangePasswordModal();
  renderUsersTab();
  showToast(`Contraseña actualizada para @${user.username}`, 'success');
}

function toggleUserStatus(userId) {
  const user = (state.users || []).find(u => u.id === userId);
  if (!user) return;

  user.status = user.status === 'ACTIVO' ? 'INACTIVO' : 'ACTIVO';
  saveUsersToStorage();
  renderUsersTab();
  showToast(`Usuario @${user.username} marcado como ${user.status}`, user.status === 'ACTIVO' ? 'success' : 'info');
}

function deleteUserById(userId) {
  const user = (state.users || []).find(u => u.id === userId);
  if (!user) return;

  // Protect against deleting the only gerencia user
  if (user.role === 'gerencia') {
    const gerenciaCount = (state.users || []).filter(u => u.role === 'gerencia').length;
    if (gerenciaCount <= 1) {
      alert('No se puede eliminar la única cuenta con rol de Gerencia. Debe existir al menos un administrador.');
      return;
    }
  }

  if (confirm(`¿Está seguro de eliminar al usuario "@${user.username}" (${user.fullName})? Esta acción no se puede deshacer.`)) {
    state.users = (state.users || []).filter(u => u.id !== userId);
    saveUsersToStorage();
    renderUsersTab();
    showToast(`Usuario @${user.username} eliminado`, 'info');
  }
}

function exportUsersToCSV() {
  const users = state.users || [];
  if (users.length === 0) {
    showToast('No hay usuarios para exportar', 'info');
    return;
  }

  const headers = ['ID', 'Usuario', 'Nombre Completo', 'Rol', 'Vendedor Asociado', 'Estado', 'Fecha Registro', 'Notas'];
  const rows = users.map(u => [
    `"${(u.id || '').replace(/"/g, '""')}"`,
    `"${(u.username || '').replace(/"/g, '""')}"`,
    `"${(u.fullName || '').replace(/"/g, '""')}"`,
    `"${(getUserRoleLabel(u.role) || '').replace(/"/g, '""')}"`,
    `"${(u.sellerName || 'Sin asignar').replace(/"/g, '""')}"`,
    `"${(u.status || 'ACTIVO').replace(/"/g, '""')}"`,
    `"${(u.createdDisplayDate || u.createdAt || '').replace(/"/g, '""')}"`,
    `"${(u.notes || '').replace(/"/g, '""')}"`
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStr = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `cubitt_usuarios_${dateStr}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Directorio de usuarios descargado en CSV', 'success');
}

/* ==========================================================================
   ROLES, SESIONES Y ACCESO (Gerencia, Inversor, Vendedor)
   ========================================================================== */

function isGerencia() {
  return Boolean(state.currentUser && state.currentUser.role === 'gerencia');
}

function isInversor() {
  return Boolean(state.currentUser && state.currentUser.role === 'inversor');
}

function isVendedor() {
  return Boolean(state.currentUser && state.currentUser.role === 'vendedor');
}

function getCurrentUserSellerName() {
  if (!state.currentUser) return '';
  return state.currentUser.sellerName || state.currentUser.fullName || state.currentUser.username || '';
}

function getAccessibleSales() {
  if (!state.currentUser) return [];
  if (state.currentUser.role === 'vendedor') {
    const sName = (state.currentUser.sellerName || '').trim().toLowerCase();
    const fName = (state.currentUser.fullName || '').trim().toLowerCase();
    const uName = (state.currentUser.username || '').trim().toLowerCase();
    return (state.sales || []).filter(s => {
      const v = (s.vendedor || '').trim().toLowerCase();
      return (sName && v === sName) || (fName && v === fName) || (uName && v === uName);
    });
  }
  return state.sales || [];
}

function getAccessiblePayables() {
  if (!state.currentUser) return [];
  if (state.currentUser.role === 'vendedor') {
    const sName = (state.currentUser.sellerName || '').trim().toLowerCase();
    const fName = (state.currentUser.fullName || '').trim().toLowerCase();
    const uName = (state.currentUser.username || '').trim().toLowerCase();

    return (state.payables || []).filter(p => {
      const ben = (p.beneficiary || '').trim().toLowerCase();
      if ((sName && ben === sName) || (fName && ben === fName) || (uName && ben === uName)) return true;
      const conc = (p.concept || '').trim().toLowerCase();
      if (sName && conc.includes(sName)) return true;
      if (fName && conc.includes(fName)) return true;

      if (p.saleId) {
        const sale = (state.sales || []).find(s => s.id === p.saleId);
        if (sale) {
          const sv = (sale.vendedor || '').trim().toLowerCase();
          if ((sName && sv === sName) || (fName && sv === fName) || (uName && sv === uName)) return true;
        }
      }
      return false;
    });
  }
  return state.payables || [];
}

function loadSessionFromStorage() {
  try {
    const saved = localStorage.getItem('cubitt_session_user_v1');
    if (saved) {
      const parsed = JSON.parse(saved);
      const user = (state.users || []).find(u => u.id === parsed.id || u.username === parsed.username);
      if (user && user.status === 'ACTIVO') {
        state.currentUser = user;
        hideLoginOverlay();
        updateHeaderUserProfile();
        return;
      }
    }
  } catch (e) {
    console.error('Error loading session from storage:', e);
  }

  // No active session or user deleted
  state.currentUser = null;
  showLoginOverlay();
}

function showLoginOverlay() {
  const overlay = document.getElementById('loginOverlay');
  if (overlay) {
    overlay.classList.remove('hidden');
    const uInput = document.getElementById('loginUsernameInput');
    const pInput = document.getElementById('loginPasswordInput');
    const errBox = document.getElementById('loginErrorMsg');
    if (uInput) uInput.value = '';
    if (pInput) pInput.value = '';
    if (errBox) {
      errBox.style.display = 'none';
      errBox.textContent = '';
    }
    setTimeout(() => {
      if (uInput) uInput.focus();
    }, 100);
  }
  const headerUser = document.getElementById('headerUserSection');
  if (headerUser) headerUser.style.display = 'none';
}

function hideLoginOverlay() {
  const overlay = document.getElementById('loginOverlay');
  if (overlay) {
    overlay.classList.add('hidden');
  }
  const headerUser = document.getElementById('headerUserSection');
  if (headerUser) headerUser.style.display = 'flex';
}

function handleLoginSubmit() {
  const uInput = document.getElementById('loginUsernameInput');
  const pInput = document.getElementById('loginPasswordInput');
  const errBox = document.getElementById('loginErrorMsg');

  const username = (uInput?.value || '').trim().toLowerCase();
  const password = (pInput?.value || '').trim();

  if (!username) {
    if (errBox) {
      errBox.textContent = 'Por favor ingresa tu nombre de usuario';
      errBox.style.display = 'block';
    }
    uInput?.focus();
    return;
  }

  if (!password) {
    if (errBox) {
      errBox.textContent = 'Por favor ingresa tu contraseña';
      errBox.style.display = 'block';
    }
    pInput?.focus();
    return;
  }

  const user = (state.users || []).find(u => (u.username || '').toLowerCase() === username);

  if (!user) {
    if (errBox) {
      errBox.textContent = `El usuario "${username}" no existe en el sistema.`;
      errBox.style.display = 'block';
    }
    return;
  }

  if (user.status !== 'ACTIVO') {
    if (errBox) {
      errBox.textContent = 'Esta cuenta se encuentra INACTIVA. Contacta a Gerencia.';
      errBox.style.display = 'block';
    }
    return;
  }

  if (user.password !== password) {
    if (errBox) {
      errBox.textContent = 'Contraseña incorrecta. Verifica e intenta nuevamente.';
      errBox.style.display = 'block';
    }
    pInput?.focus();
    return;
  }

  // Success login
  state.currentUser = user;
  try {
    localStorage.setItem('cubitt_session_user_v1', JSON.stringify({ id: user.id, username: user.username }));
  } catch (e) {
    console.error('Error saving session:', e);
  }

  hideLoginOverlay();
  applyUserRoleUI();
  renderTopStats();
  renderHistory();
  renderCredits();
  renderPayables();
  renderOrdersTab();
  renderClients();
  renderSellersTab();
  renderGoalsTab();
  renderUsersTab();

  showToast(`¡Bienvenido, ${user.fullName}! 👋 (${getUserRoleLabel(user.role)})`, 'success');
}

function quickLoginDemo(username) {
  const user = (state.users || []).find(u => (u.username || '').toLowerCase() === username.toLowerCase());
  if (!user) {
    showToast(`Usuario demo ${username} no encontrado`, 'danger');
    return;
  }

  const uInput = document.getElementById('loginUsernameInput');
  const pInput = document.getElementById('loginPasswordInput');
  if (uInput) uInput.value = user.username;
  if (pInput) pInput.value = user.password;

  handleLoginSubmit();
}

function handleLogout() {
  try {
    localStorage.removeItem('cubitt_session_user_v1');
  } catch (e) {}

  state.currentUser = null;
  showLoginOverlay();
  showToast('Has cerrado sesión correctamente', 'info');
}

function updateHeaderUserProfile() {
  const section = document.getElementById('headerUserSection');
  if (!section) return;

  if (!state.currentUser) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'flex';
  const avatar = document.getElementById('headerUserAvatar');
  const nameEl = document.getElementById('headerUserName');
  const roleEl = document.getElementById('headerUserRoleBadge');

  const role = state.currentUser.role || 'vendedor';
  const initials = getUserInitials(state.currentUser.fullName || state.currentUser.username);

  if (avatar) {
    avatar.className = `header-user-avatar ${role}`;
    avatar.textContent = initials;
  }

  if (nameEl) {
    nameEl.textContent = state.currentUser.fullName || state.currentUser.username;
  }

  if (roleEl) {
    let roleLabel = '👔 Vendedor';
    if (role === 'gerencia') roleLabel = '👑 Gerencia';
    if (role === 'inversor') roleLabel = '💼 Inversor';
    roleEl.textContent = roleLabel;
  }
}

function applyUserRoleUI() {
  if (!state.currentUser) return;

  const role = state.currentUser.role;
  const navUsers = document.getElementById('navBtnUsers');
  const navItemUsers = document.getElementById('navItemUsers');
  const navCreateSeller = document.getElementById('navItemCreateSeller');
  const sellerSelect = document.getElementById('saleSellerSelect');
  const posAdminBtns = document.getElementById('posSellerAdminButtons');
  const lockedNotice = document.getElementById('posSellerLockedNotice');
  const lockedName = document.getElementById('posSellerLockedName');

  if (role === 'vendedor') {
    // Hide Users tab
    if (navUsers) navUsers.style.display = 'none';
    if (navItemUsers) navItemUsers.style.display = 'none';
    // Hide create seller in nav
    if (navCreateSeller) navCreateSeller.style.display = 'none';
    // Lock POS seller dropdown
    const sName = state.currentUser.sellerName || state.currentUser.fullName || state.currentUser.username;
    if (sellerSelect) {
      sellerSelect.value = sName;
      sellerSelect.disabled = true;
    }
    if (posAdminBtns) posAdminBtns.style.display = 'none';
    if (lockedNotice) lockedNotice.style.display = 'inline-flex';
    if (lockedName) lockedName.textContent = sName;
  } else if (role === 'inversor') {
    // Hide users tab for investor
    if (navUsers) navUsers.style.display = 'none';
    if (navItemUsers) navItemUsers.style.display = 'none';
    if (navCreateSeller) navCreateSeller.style.display = 'flex';
    if (sellerSelect) sellerSelect.disabled = false;
    if (posAdminBtns) posAdminBtns.style.display = 'flex';
    if (lockedNotice) lockedNotice.style.display = 'none';
  } else {
    // Gerencia
    if (navUsers) navUsers.style.display = 'inline-flex';
    if (navItemUsers) navItemUsers.style.display = 'flex';
    if (navCreateSeller) navCreateSeller.style.display = 'flex';
    if (sellerSelect) sellerSelect.disabled = false;
    if (posAdminBtns) posAdminBtns.style.display = 'flex';
    if (lockedNotice) lockedNotice.style.display = 'none';
  }

  updateHeaderUserProfile();
}

/* ==========================================================================
   APARTADO DE METAS & COMISIONES (Bonos de $50 por cada $1,000)
   ========================================================================== */

function calculateSellerGoals(sellerName) {
  let sellerSales = [];
  if (!sellerName || sellerName === 'all' || sellerName === '__all__') {
    sellerSales = state.sales || [];
  } else {
    const sNameNorm = sellerName.trim().toLowerCase();
    sellerSales = (state.sales || []).filter(s => (s.vendedor || '').trim().toLowerCase() === sNameNorm);
  }

  const totalSold = sellerSales.reduce((acc, s) => acc + (s.totalAmount || 0), 0);
  const tiers = Math.floor(totalSold / 1000); // 1 each $1,000
  const bonusEarned = tiers * 50; // $50 per $1,000
  const nextTarget = (tiers + 1) * 1000;
  const progressInTier = totalSold - (tiers * 1000);
  const pct = Math.min(100, Math.floor((progressInTier / 1000) * 100));
  const remaining = nextTarget - totalSold;

  return {
    sellerName: sellerName || 'General',
    totalSold: totalSold,
    tiersAchieved: tiers,
    bonusEarned: bonusEarned,
    nextTarget: nextTarget,
    progressInTier: progressInTier,
    progressPct: pct,
    remaining: remaining,
    salesCount: sellerSales.length
  };
}

function updateGoalsBonusBadge() {
  const badge = document.getElementById('badgeGoalsBonus');
  if (!badge) return;

  if (isVendedor()) {
    const sName = getCurrentUserSellerName();
    const goals = calculateSellerGoals(sName);
    badge.textContent = `+$${goals.bonusEarned}`;
  } else {
    // For Gerencia and Inversor, sum bonuses of all sellers
    let totalAllBonuses = 0;
    const sellersList = state.sellers || [];
    sellersList.forEach(s => {
      const g = calculateSellerGoals(s.name);
      totalAllBonuses += g.bonusEarned;
    });
    badge.textContent = `+$${totalAllBonuses}`;
  }
}

function handleGoalsSearch(query) {
  state.goalsSearchQuery = (query || '').trim().toLowerCase();
  renderGoalsLeaderboard();
}

function renderGoalsTab() {
  const isVend = isVendedor();
  const sName = getCurrentUserSellerName();

  // Target calculation for hero card
  const heroGoals = isVend
    ? calculateSellerGoals(sName)
    : calculateSellerGoals('all');

  const heroTitle = document.getElementById('goalsActiveSellerTitle');
  const heroSubtitle = document.getElementById('goalsActiveSellerSubtitle');
  const elBonus = document.getElementById('goalsActiveTotalBonus');
  const elSold = document.getElementById('goalsActiveTotalSold');
  const elTiers = document.getElementById('goalsActiveTiersCount');
  const elNext = document.getElementById('goalsActiveNextTarget');
  const elRemaining = document.getElementById('goalsActiveRemaining');
  const elProgressPct = document.getElementById('goalsProgressPct');
  const elProgressBar = document.getElementById('goalsProgressBar');
  const elMilestoneLabel = document.getElementById('goalsNextMilestoneLabel');
  const milestoneContainer = document.getElementById('goalsMilestoneStepsContainer');

  if (heroTitle) {
    heroTitle.textContent = isVend
      ? `Mis Metas de Ventas (${state.currentUser.fullName || sName})`
      : 'Metas Globales de Ventas & Rendimiento';
  }

  if (heroSubtitle) {
    heroSubtitle.textContent = isVend
      ? `Tu plan individual: ganas $50 de comisión por cada $1,000 acumulados en facturación.`
      : 'Supervisión de metas de facturación de toda la tienda y comisiones generadas por asesores.';
  }

  if (elBonus) elBonus.textContent = `+$${heroGoals.bonusEarned.toFixed(2)}`;
  if (elSold) elSold.textContent = `$${heroGoals.totalSold.toFixed(2)}`;
  if (elTiers) elTiers.textContent = `${heroGoals.tiersAchieved} ${heroGoals.tiersAchieved === 1 ? 'Meta' : 'Metas'}`;
  if (elNext) elNext.textContent = `$${heroGoals.nextTarget.toFixed(2)}`;
  if (elRemaining) elRemaining.textContent = `$${heroGoals.remaining.toFixed(2)}`;
  if (elProgressPct) elProgressPct.textContent = `${heroGoals.progressPct}%`;
  if (elProgressBar) elProgressBar.style.width = `${heroGoals.progressPct}%`;
  if (elMilestoneLabel) elMilestoneLabel.textContent = `$${heroGoals.nextTarget.toFixed(2)}`;

  // Render milestone steps: 1k, 2k, 3k, 4k, 5k...
  if (milestoneContainer) {
    const maxStep = Math.max(5, heroGoals.tiersAchieved + 2);
    let stepsHtml = '';
    for (let t = 1; t <= maxStep; t++) {
      const stepTarget = t * 1000;
      const stepBonus = t * 50;
      let stepClass = 'locked';
      let icon = '🔒';
      let rewardText = `+$50 Bono`;

      if (t <= heroGoals.tiersAchieved) {
        stepClass = 'completed';
        icon = '🏆';
        rewardText = `+$${stepBonus} Ganado`;
      } else if (t === heroGoals.tiersAchieved + 1) {
        stepClass = 'in-progress';
        icon = '⏳';
        rewardText = `Faltan $${heroGoals.remaining.toFixed(0)}`;
      }

      stepsHtml += `
        <div class="milestone-step-pill ${stepClass}">
          <div style="font-size: 1.15rem; margin-bottom: 2px;">${icon}</div>
          <div class="m-amount">$${stepTarget.toLocaleString()}</div>
          <div class="m-reward">${rewardText}</div>
        </div>
      `;
    }
    milestoneContainer.innerHTML = stepsHtml;
  }

  // Render Team Card & Leaderboard
  renderGoalsLeaderboard();
  updateGoalsBonusBadge();
}

function renderGoalsLeaderboard() {
  const tbody = document.getElementById('goalsTableBody');
  const emptyState = document.getElementById('goalsEmptyState');
  if (!tbody) return;

  let sellersList = [...(state.sellers || [])];

  // If logged in as vendedor, prioritize and highlight their record
  if (isVendedor()) {
    const currentName = getCurrentUserSellerName().toLowerCase();
    sellersList = sellersList.filter(s => s.name.toLowerCase() === currentName);
  }

  // Search filter
  if (state.goalsSearchQuery) {
    sellersList = sellersList.filter(s => s.name.toLowerCase().includes(state.goalsSearchQuery));
  }

  if (sellersList.length === 0) {
    tbody.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  // Calculate metrics for each seller and sort by totalSold descending
  const ranked = sellersList.map(s => {
    return {
      seller: s,
      goals: calculateSellerGoals(s.name)
    };
  }).sort((a, b) => b.goals.totalSold - a.goals.totalSold);

  tbody.innerHTML = ranked.map((item, idx) => {
    const g = item.goals;
    const s = item.seller;
    const initials = s.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() || 'VE';
    const rankMedal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`;

    return `
      <tr>
        <td>
          <div style="display: flex; align-items: center; gap: 10px;">
            <div style="font-weight: 800; font-size: 1rem; width: 26px; text-align: center;">${rankMedal}</div>
            <div class="user-avatar-circle vendedor" style="width: 32px; height: 32px; font-size: 0.75rem;">
              ${escapeHtml(initials)}
            </div>
            <div>
              <div style="font-weight: 800; color: #0f172a; font-size: 0.92rem;">${escapeHtml(s.name)}</div>
              <div style="font-size: 0.78rem; color: #64748b;">${g.salesCount} ventas registradas</div>
            </div>
          </div>
        </td>
        <td>
          <span style="font-weight: 800; font-size: 1rem; color: #0f172a;">$${g.totalSold.toFixed(2)}</span>
        </td>
        <td>
          <span class="role-badge" style="background: rgba(16,185,129,0.1); color: #059669; font-weight: 800;">
            🏆 ${g.tiersAchieved} ${g.tiersAchieved === 1 ? 'Meta' : 'Metas'}
          </span>
        </td>
        <td>
          <span style="font-weight: 900; font-size: 1.05rem; color: #10b981;">
            +$${g.bonusEarned.toFixed(2)}
          </span>
        </td>
        <td>
          <span style="font-weight: 700; color: #2563eb;">$${g.nextTarget.toFixed(2)}</span>
        </td>
        <td>
          <span style="font-weight: 700; color: #d97706;">$${g.remaining.toFixed(2)}</span>
        </td>
        <td>
          <div style="width: 140px;">
            <div style="display: flex; justify-content: space-between; font-size: 0.72rem; font-weight: 700; margin-bottom: 2px;">
              <span>${g.progressPct}%</span>
              <span>$${g.progressInTier.toFixed(0)} / $1,000</span>
            </div>
            <div style="background: #e2e8f0; height: 8px; border-radius: 9999px; overflow: hidden;">
              <div style="background: #10b981; height: 100%; width: ${g.progressPct}%; border-radius: 9999px;"></div>
            </div>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function exportGoalsReportCSV() {
  const sellersList = state.sellers || [];
  if (sellersList.length === 0) {
    showToast('No hay datos de vendedores para exportar', 'info');
    return;
  }

  const headers = ['Vendedor', 'Total Facturado ($)', 'Metas Logradas ($1,000)', 'Bono Ganado ($50 x Meta)', 'Próxima Meta ($)', 'Faltante para Bono ($)', 'Progreso (%)'];
  const rows = sellersList.map(s => {
    const g = calculateSellerGoals(s.name);
    return [
      `"${s.name.replace(/"/g, '""')}"`,
      g.totalSold.toFixed(2),
      g.tiersAchieved,
      g.bonusEarned.toFixed(2),
      g.nextTarget.toFixed(2),
      g.remaining.toFixed(2),
      `${g.progressPct}%`
    ];
  });

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStr = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `cubitt_metas_bonos_${dateStr}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Reporte de metas y bonos descargado en CSV', 'success');
}

/* ==========================================================================
   APARTADO DE CONTROL DE INVENTARIO, FACTURAS DE INGRESO & ASISTENTE IA
   ========================================================================== */

function generateInvoicePlaceholderSVG(title, num, total) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="520" viewBox="0 0 400 520">
    <rect width="400" height="520" fill="#ffffff" stroke="#cbd5e1" stroke-width="2"/>
    <rect x="20" y="20" width="360" height="65" rx="8" fill="#1e293b"/>
    <text x="38" y="48" fill="#ffffff" font-family="sans-serif" font-size="15" font-weight="bold">DISTRIBUIDORA CUBITT LATAM</text>
    <text x="38" y="68" fill="#94a3b8" font-family="sans-serif" font-size="11">RIF: J-50493821-0 • Factura Comercial de Compra</text>
    <text x="360" y="58" fill="#10b981" font-family="sans-serif" font-size="14" font-weight="bold" text-anchor="end">${num}</text>
    <line x1="20" y1="105" x2="380" y2="105" stroke="#e2e8f0" stroke-width="2"/>
    <text x="30" y="130" fill="#475569" font-family="sans-serif" font-size="11" font-weight="bold">CONCEPTO: ${title}</text>
    <rect x="25" y="145" width="350" height="235" fill="#f8fafc" rx="6" stroke="#e2e8f0"/>
    <text x="35" y="172" fill="#64748b" font-family="sans-serif" font-size="10" font-weight="bold">PARTIDAS DE MERCANCÍA RECIBIDA</text>
    <line x1="25" y1="182" x2="375" y2="182" stroke="#cbd5e1"/>
    <text x="35" y="208" fill="#1e293b" font-family="sans-serif" font-size="11">• Lote de productos oficiales Cubitt garantizados</text>
    <text x="35" y="238" fill="#1e293b" font-family="sans-serif" font-size="11">• Control de calidad y seriales de importación</text>
    <text x="35" y="268" fill="#1e293b" font-family="sans-serif" font-size="11">• Despacho directo a almacén principal</text>
    <rect x="210" y="395" width="165" height="55" fill="#7c3aed" rx="8"/>
    <text x="222" y="417" fill="#e9d5ff" font-family="sans-serif" font-size="10" font-weight="bold">TOTAL FACTURA</text>
    <text x="222" y="440" fill="#ffffff" font-family="sans-serif" font-size="18" font-weight="bold">$${total}</text>
    <circle cx="85" cy="430" r="32" fill="none" stroke="#059669" stroke-width="2" stroke-dasharray="4,2"/>
    <text x="85" y="428" fill="#059669" font-family="sans-serif" font-size="8" font-weight="bold" text-anchor="middle">RECEPCIÓN</text>
    <text x="85" y="440" fill="#059669" font-family="sans-serif" font-size="8" font-weight="bold" text-anchor="middle">INVENTARIO</text>
  </svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

// Storage for Invoices
function loadInvoicesFromStorage() {
  try {
    const saved = localStorage.getItem('cubitt_invoices_v1');
    if (saved) {
      state.invoices = JSON.parse(saved);
      // Filter out legacy demo mock invoice so inventory starts cleanly
      state.invoices = state.invoices.filter(inv => inv.id !== 'INV-2026-7840');
    } else {
      state.invoices = [];
    }
  } catch (e) {
    console.error('Error loading invoices from storage:', e);
    state.invoices = [];
  }
}

function saveInvoicesToStorage() {
  try {
    const success = safeStorageSet('cubitt_invoices_v1', JSON.stringify(state.invoices));
    if (!success) {
      const leanInvoices = (state.invoices || []).map(inv => ({ ...inv, photoData: null }));
      safeStorageSet('cubitt_invoices_v1', JSON.stringify(leanInvoices));
    }
  } catch (e) {
    console.error('Error saving invoices to storage:', e);
  }
}

// Storage for Inventory Movements
function loadInventoryMovementsFromStorage() {
  try {
    const saved = localStorage.getItem('cubitt_inventory_movements_v1');
    if (saved) {
      state.inventoryMovements = JSON.parse(saved);
      // Filter out legacy demo movement
      state.inventoryMovements = state.inventoryMovements.filter(m => m.id !== 'MOV-INIT-001');
    } else {
      state.inventoryMovements = [];
    }
  } catch (e) {
    console.error('Error loading inventory movements from storage:', e);
    state.inventoryMovements = [];
  }
}

function saveInventoryMovementsToStorage() {
  try {
    safeStorageSet('cubitt_inventory_movements_v1', JSON.stringify(state.inventoryMovements));
  } catch (e) {
    console.error('Error saving inventory movements to storage:', e);
  }
}

function recordInventoryMovement(movement) {
  if (!movement) return;
  const movementRecord = {
    id: 'MOV-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
    timestamp: new Date().toISOString(),
    displayDate: formatDateTime(new Date()),
    type: movement.type || 'AJUSTE_MANUAL',
    productCode: movement.productCode || '',
    productName: movement.productName || '',
    quantity: movement.quantity || 0,
    stockBefore: movement.stockBefore !== undefined ? movement.stockBefore : 0,
    stockAfter: movement.stockAfter !== undefined ? movement.stockAfter : 0,
    reference: movement.reference || '',
    notes: movement.notes || '',
    user: (state.currentUser && (state.currentUser.fullName || state.currentUser.username)) || 'Sistema'
  };
  state.inventoryMovements.unshift(movementRecord);
  if (state.inventoryMovements.length > 300) {
    state.inventoryMovements = state.inventoryMovements.slice(0, 300);
  }
  saveInventoryMovementsToStorage();
}

// Stock Decrement on POS Sales
function decrementStockForSale(saleRecord) {
  if (!saleRecord || !Array.isArray(saleRecord.items)) return;
  saleRecord.items.forEach(item => {
    const prod = (state.products || []).find(p => p.code === item.code);
    if (prod) {
      const currentStock = Number(prod.stock) || 0;
      const soldQty = Number(item.quantity) || 1;
      const newStock = Math.max(0, currentStock - soldQty);
      prod.stock = newStock;
      if (newStock <= 0) {
        prod.status = 'AGOTADO';
      }
      recordInventoryMovement({
        type: 'SALIDA_VENTA',
        productCode: prod.code,
        productName: prod.description || prod.category || prod.code,
        quantity: soldQty,
        stockBefore: currentStock,
        stockAfter: newStock,
        reference: `Venta #${saleRecord.id}`,
        notes: `Cliente: ${saleRecord.clientName || 'General'} • Vendedor: ${saleRecord.vendedor || 'Tienda'}`
      });
    }
  });
  saveProductsToStorage();
  updateInventoryBadges();
}

// Subtab Navigation inside Inventory
function switchInventorySubTab(subtab) {
  state.inventorySubTab = subtab;

  const btnStock = document.getElementById('subtabInvStockBtn');
  const btnInvoices = document.getElementById('subtabInvInvoicesBtn');
  const btnMovements = document.getElementById('subtabInvMovementsBtn');

  if (btnStock) btnStock.classList.toggle('active', subtab === 'stock');
  if (btnInvoices) btnInvoices.classList.toggle('active', subtab === 'invoices');
  if (btnMovements) btnMovements.classList.toggle('active', subtab === 'movements');

  const secStock = document.getElementById('invStockSection');
  const secInvoices = document.getElementById('invInvoicesSection');
  const secMovements = document.getElementById('invMovementsSection');

  if (secStock) secStock.style.display = subtab === 'stock' ? 'block' : 'none';
  if (secInvoices) secInvoices.style.display = subtab === 'invoices' ? 'block' : 'none';
  if (secMovements) secMovements.style.display = subtab === 'movements' ? 'block' : 'none';

  if (subtab === 'stock') {
    renderInventoryStockTable();
  } else if (subtab === 'invoices') {
    renderInventoryInvoicesTable();
  } else if (subtab === 'movements') {
    renderInventoryMovementsTable();
  }
}

// Master Render for Inventory Tab
function renderInventoryTab() {
  renderInventoryMetrics();
  populateInventoryCategorySelect();
  switchInventorySubTab(state.inventorySubTab || 'stock');
}

// Calculate & Render Metric Cards
function renderInventoryMetrics() {
  const products = state.products || [];
  let totalUnits = 0;
  let costValuation = 0;
  let pvpValuation = 0;
  let lowStockCount = 0;

  products.forEach(p => {
    const stock = Number(p.stock) || 0;
    const cost = Number(p.costo || p.mayor || 0);
    const pvp = Number(p.pvp || 0);

    totalUnits += stock;
    costValuation += (stock * cost);
    pvpValuation += (stock * pvp);

    if (stock <= 3) {
      lowStockCount++;
    }
  });

  const invoicesCount = (state.invoices || []).length;

  const elUnits = document.getElementById('invMetricTotalUnits');
  const elCost = document.getElementById('invMetricCostValuation');
  const elPvp = document.getElementById('invMetricPvpValuation');
  const elInvoices = document.getElementById('invMetricInvoicesCount');
  const elLow = document.getElementById('invMetricLowStockCount');

  if (elUnits) elUnits.textContent = totalUnits.toLocaleString();
  if (elCost) elCost.textContent = `$${costValuation.toFixed(2)}`;
  if (elPvp) elPvp.textContent = `$${pvpValuation.toFixed(2)}`;
  if (elInvoices) elInvoices.textContent = invoicesCount;
  if (elLow) elLow.textContent = lowStockCount;

  updateInventoryBadges();
}

function updateInventoryBadges() {
  const totalUnits = (state.products || []).reduce((acc, p) => acc + (Number(p.stock) || 0), 0);
  const badge = document.getElementById('badgeInventoryStock');
  if (badge) {
    badge.textContent = `${totalUnits} un`;
  }
}

function populateInventoryCategorySelect() {
  const select = document.getElementById('invStockCategorySelect');
  if (!select) return;

  const currentVal = select.value || state.inventoryFilterCategory || 'all';
  const categories = Array.from(new Set((state.products || []).map(p => {
    if (!p.category) return 'Sin Categoría';
    return p.category.includes(' - ') ? p.category.split(' - ')[0].trim() : p.category.trim();
  }))).sort();

  select.innerHTML = '<option value="all">Todas las Categorías</option>' +
    categories.map(c => `<option value="${c}" ${c === currentVal ? 'selected' : ''}>${c}</option>`).join('');
}

// SECTION 1: Render Stock Table
function renderInventoryStockTable() {
  const tbody = document.getElementById('inventoryStockTableBody');
  const emptyState = document.getElementById('invStockEmptyState');
  if (!tbody) return;

  let filtered = [...(state.products || [])];

  // Search filter
  if (state.inventorySearchQuery) {
    const q = state.inventorySearchQuery.toLowerCase();
    filtered = filtered.filter(p => {
      const code = (p.code || '').toLowerCase();
      const desc = (p.description || '').toLowerCase();
      const cat = (p.category || '').toLowerCase();
      return code.includes(q) || desc.includes(q) || cat.includes(q);
    });
  }

  // Category filter
  if (state.inventoryFilterCategory && state.inventoryFilterCategory !== 'all') {
    const filterCat = state.inventoryFilterCategory.toLowerCase();
    filtered = filtered.filter(p => {
      const cat = (p.category || '').toLowerCase();
      return cat.startsWith(filterCat);
    });
  }

  // Stock status filter
  if (state.inventoryFilterStockStatus && state.inventoryFilterStockStatus !== 'all') {
    const st = state.inventoryFilterStockStatus;
    if (st === 'disponible') {
      filtered = filtered.filter(p => (Number(p.stock) || 0) > 0);
    } else if (st === 'bajo') {
      filtered = filtered.filter(p => {
        const s = Number(p.stock) || 0;
        return s > 0 && s <= 3;
      });
    } else if (st === 'agotado') {
      filtered = filtered.filter(p => (Number(p.stock) || 0) <= 0);
    }
  }

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  tbody.innerHTML = filtered.map(p => {
    const stock = Number(p.stock) || 0;
    const cost = Number(p.costo || p.mayor || 0);
    const pvp = Number(p.pvp || 0);
    const totalValuation = stock * cost;
    const margin = pvp - cost;
    const marginPct = cost > 0 ? ((margin / cost) * 100).toFixed(0) : 100;

    let stockClass = 'high';
    if (stock <= 0) stockClass = 'out';
    else if (stock <= 3) stockClass = 'low';
    else if (stock <= 5) stockClass = 'medium';

    const firstImg = (p.images && p.images[0]) || p.image || 'images/placeholder.png';

    return `
      <tr>
        <td>
          <div style="display: flex; align-items: center; gap: 10px;">
            <img src="${firstImg}" alt="${p.code}" style="width: 36px; height: 36px; border-radius: 6px; object-fit: contain; background: #f8fafc; border: 1px solid #e2e8f0; cursor: pointer;" onclick="openLightbox('${p.code}', 0)" title="Ampliar foto">
            <div>
              <div style="font-weight: 800; color: #0f172a; font-size: 0.92rem;">${p.description || p.code}</div>
              <div style="font-size: 0.76rem; color: #64748b; font-family: monospace;">${p.code}</div>
            </div>
          </div>
        </td>
        <td>
          <span style="font-size: 0.8rem; background: #f1f5f9; padding: 3px 8px; border-radius: 6px; color: #475569; font-weight: 600;">
            ${p.category || 'General'}
          </span>
        </td>
        <td style="font-weight: 700; color: #059669;">$${cost.toFixed(2)}</td>
        <td style="font-weight: 700; color: #2563eb;">$${pvp.toFixed(2)}</td>
        <td>
          <div style="font-weight: 700; color: #059669; font-size: 0.85rem;">+$${margin.toFixed(2)}</div>
          <div style="font-size: 0.72rem; color: #64748b;">${marginPct}% margen</div>
        </td>
        <td>
          <span class="stock-badge ${stockClass}">
            ${stock} un
          </span>
        </td>
        <td style="font-weight: 800; color: #0f172a;">$${totalValuation.toFixed(2)}</td>
        <td>
          ${stock > 0 ? `
            <span class="badge badge-success" style="font-size: 0.74rem;">🟢 DISPONIBLE</span>
          ` : `
            <span class="badge badge-danger" style="font-size: 0.74rem;">🔴 AGOTADO</span>
          `}
        </td>
        <td>
          <div style="display: flex; gap: 6px; flex-wrap: wrap;">
            <button type="button" class="btn btn-outline btn-xs" onclick="openQuickStockAdjustModal('${p.code}')" title="Ajustar stock físico">
              ✏️ Ajustar
            </button>
            <button type="button" class="btn btn-primary btn-xs" onclick="selectFromCatalog('${p.code}')" title="Vender en POS" style="background: #2563eb; border: none;">
              🛒 Vender
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Handlers for Stock Filters
function handleInventoryStockSearch(query) {
  state.inventorySearchQuery = query || '';
  renderInventoryStockTable();
}

function handleInventoryCategoryChange(cat) {
  state.inventoryFilterCategory = cat || 'all';
  renderInventoryStockTable();
}

function setInventoryStatusFilter(status) {
  state.inventoryFilterStockStatus = status || 'all';
  document.querySelectorAll('#tab-inventory [data-inv-status]').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.invStatus === status);
  });
  renderInventoryStockTable();
}

// SECTION 2: Render Invoices Table
function renderInventoryInvoicesTable() {
  const tbody = document.getElementById('inventoryInvoicesTableBody');
  const emptyState = document.getElementById('invInvoicesEmptyState');
  if (!tbody) return;

  let filtered = [...(state.invoices || [])];

  if (state.invoicesSearchQuery) {
    const q = state.invoicesSearchQuery.toLowerCase();
    filtered = filtered.filter(inv => {
      const num = (inv.numeroFactura || '').toLowerCase();
      const sup = (inv.proveedor || '').toLowerCase();
      const buyer = (inv.razonSocialCompra || '').toLowerCase();
      const rif = (inv.rifCompra || '').toLowerCase();
      return num.includes(q) || sup.includes(q) || buyer.includes(q) || rif.includes(q);
    });
  }

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  tbody.innerHTML = filtered.map(inv => {
    const isCredito = inv.condicionPago === 'credito';
    const cxpKey = `CXP-INV-${inv.numeroFactura || inv.id}`;
    const cxp = (state.payables || []).find(p => p.id === cxpKey || p.saleId === `FACT-${inv.numeroFactura}`);
    const isCxpPaid = cxp ? cxp.status === 'CONCILIADO' : (!isCredito);

    const photoSrc = inv.photoUrl || generateInvoicePlaceholderSVG(inv.proveedor || 'Factura Compra', inv.numeroFactura, Number(inv.totalMonto || 0).toFixed(2));
    const buyerName = inv.razonSocialCompra || 'JESUS DAVID PALMA GOLLO';

    return `
      <tr>
        <td>
          <div style="font-weight: 800; color: #1e293b; font-size: 0.92rem; display: flex; align-items: center; gap: 6px;">
            <span>🧾</span>
            <span>${escapeHtml(inv.numeroFactura || 'S/N')}</span>
          </div>
          <div style="font-size: 0.72rem; color: #64748b;">${escapeHtml(inv.id)}</div>
        </td>
        <td>
          <img src="${photoSrc}" alt="Foto Factura" class="invoice-thumb-img" onclick="openInvoiceDetailModal('${inv.id}')" title="Clic para ampliar comprobante">
        </td>
        <td>
          <div style="font-weight: 700; color: #0f172a;">${escapeHtml(inv.proveedor || 'Proveedor General')}</div>
          <div style="font-size: 0.75rem; color: #64748b;">${escapeHtml(inv.notas || 'Sin observaciones')}</div>
        </td>
        <td>
          <div style="font-weight: 700; color: #1e293b; font-size: 0.86rem;">${escapeHtml(buyerName)}</div>
          ${inv.rifCompra ? `<div style="font-size: 0.72rem; color: #2563eb; font-weight: 600;">RIF: ${escapeHtml(inv.rifCompra)}</div>` : ''}
          ${inv.dirCompra ? `<div style="font-size: 0.70rem; color: #64748b; max-width: 170px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(inv.dirCompra)}">${escapeHtml(inv.dirCompra)}</div>` : ''}
        </td>
        <td style="font-size: 0.85rem; color: #475569; font-weight: 600;">
          ${escapeHtml(inv.fecha || 'N/A')}
        </td>
        <td>
          ${isCredito ? `
            <span class="badge badge-warning" style="font-size: 0.74rem; background: #fef3c7; color: #92400e; border: 1px solid #fde68a;">
              📋 A Crédito
            </span>
            <div style="font-size: 0.72rem; color: #b45309; margin-top: 2px;">Vence: ${escapeHtml(inv.fechaVencimiento || 'N/A')}</div>
          ` : `
            <span class="badge badge-success" style="font-size: 0.74rem;">
              💵 De Contado
            </span>
          `}
        </td>
        <td style="font-weight: 800; color: #059669; font-size: 1rem;">
          $${Number(inv.totalMonto || 0).toFixed(2)}
          ${(inv.descuentoPorcentaje > 0 || inv.descuentoMontoBs > 0) ? `
            <div style="font-size: 0.70rem; color: #dc2626; font-weight: 700; background: #fee2e2; border: 1px solid #fecaca; border-radius: 4px; padding: 1px 5px; display: inline-block; margin-top: 3px;" title="Descuento en factura">
              🏷️ -${Number(inv.descuentoPorcentaje || 0).toFixed(1)}% desc
            </div>
          ` : ''}
        </td>
        <td>
          <span style="font-weight: 700; color: #1e293b; font-size: 0.85rem;">
            ${inv.totalUnits || 0} unidades
          </span>
          <div style="font-size: 0.72rem; color: #64748b;">${(inv.items || []).length} renglones</div>
        </td>
        <td>
          ${isCredito ? (
            isCxpPaid ? `
              <span class="badge badge-success" style="font-size: 0.72rem;">✅ CXP Conciliada</span>
            ` : `
              <span class="badge badge-danger" style="font-size: 0.72rem;">⏳ CXP Pendiente</span>
            `
          ) : `
            <span class="badge badge-success" style="font-size: 0.72rem;">✅ Pagada</span>
          `}
        </td>
        <td>
          <div style="display: flex; gap: 6px;">
            <button type="button" class="btn btn-outline btn-xs" onclick="openInvoiceDetailModal('${inv.id}')" title="Ver detalles y partidas">
              👁️ Ver
            </button>
            ${isGerencia() ? `
              <button type="button" class="btn btn-outline btn-xs" onclick="deleteInvoice('${inv.id}')" style="color: #dc2626; border-color: #fca5a5;" title="Eliminar factura">
                🗑️
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function handleInvoicesSearch(query) {
  state.invoicesSearchQuery = query || '';
  renderInventoryInvoicesTable();
}

// SECTION 3: Render Movements Table
function renderInventoryMovementsTable() {
  const tbody = document.getElementById('inventoryMovementsTableBody');
  const emptyState = document.getElementById('invMovementsEmptyState');
  if (!tbody) return;

  const movements = state.inventoryMovements || [];

  if (movements.length === 0) {
    tbody.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  tbody.innerHTML = movements.slice(0, 50).map(m => {
    let typeBadge = '<span class="badge badge-info" style="font-size: 0.72rem;">AJUSTE</span>';
    let qtyColor = '#0f172a';
    let qtyPrefix = '';

    if (m.type === 'ENTRADA_FACTURA') {
      typeBadge = '<span class="badge badge-success" style="font-size: 0.72rem;">📥 ENTRADA FACTURA</span>';
      qtyColor = '#059669';
      qtyPrefix = '+';
    } else if (m.type === 'SALIDA_VENTA') {
      typeBadge = '<span class="badge badge-danger" style="font-size: 0.72rem;">📤 SALIDA VENTA</span>';
      qtyColor = '#dc2626';
      qtyPrefix = '-';
    } else if (m.type === 'AJUSTE_MANUAL') {
      typeBadge = '<span class="badge badge-warning" style="font-size: 0.72rem;">✏️ AJUSTE AUDITORÍA</span>';
      qtyColor = m.quantity >= 0 ? '#059669' : '#dc2626';
      qtyPrefix = m.quantity >= 0 ? '+' : '';
    }

    return `
      <tr>
        <td style="font-size: 0.8rem; color: #475569;">
          ${m.displayDate || m.timestamp || 'N/A'}
        </td>
        <td>${typeBadge}</td>
        <td>
          <div style="font-weight: 700; color: #0f172a; font-size: 0.88rem;">${m.productName || m.productCode}</div>
          <div style="font-size: 0.72rem; color: #64748b; font-family: monospace;">${m.productCode}</div>
        </td>
        <td>
          <span style="font-weight: 800; color: ${qtyColor}; font-size: 0.95rem;">
            ${qtyPrefix}${m.quantity} un
          </span>
          <div style="font-size: 0.7rem; color: #64748b;">(De ${m.stockBefore} a ${m.stockAfter})</div>
        </td>
        <td>
          <div style="font-weight: 600; color: #1e293b; font-size: 0.82rem;">${m.reference || 'N/A'}</div>
          <div style="font-size: 0.72rem; color: #64748b;">${m.notes || ''}</div>
        </td>
        <td style="font-size: 0.82rem; font-weight: 600; color: #475569;">
          ${m.user || 'Sistema'}
        </td>
      </tr>
    `;
  }).join('');
}

// Quick Stock Adjustment Modal
function openQuickStockAdjustModal(productCode) {
  const prod = (state.products || []).find(p => p.code === productCode);
  if (!prod) {
    showToast('Producto no encontrado', 'danger');
    return;
  }

  const modal = document.getElementById('quickStockAdjustModal');
  if (!modal) return;

  document.getElementById('adjustProductCodeInput').value = prod.code;
  document.getElementById('adjustProductTitle').textContent = `${prod.description || prod.code} (${prod.code}) • Stock actual: ${prod.stock || 0} un`;
  document.getElementById('adjustStockQuantityInput').value = prod.stock || 0;

  modal.classList.add('active');
  setTimeout(() => {
    const input = document.getElementById('adjustStockQuantityInput');
    if (input) {
      input.focus();
      input.select();
    }
  }, 100);
}

function closeQuickStockAdjustModal() {
  const modal = document.getElementById('quickStockAdjustModal');
  if (modal) modal.classList.remove('active');
}

function handleConfirmStockAdjustment() {
  const code = document.getElementById('adjustProductCodeInput').value;
  const newStockVal = parseInt(document.getElementById('adjustStockQuantityInput').value, 10);
  const reason = document.getElementById('adjustStockReasonInput').value || 'Ajuste Manual';

  if (isNaN(newStockVal) || newStockVal < 0) {
    showToast('Ingrese un número de unidades válido (0 o superior)', 'danger');
    return;
  }

  const prod = (state.products || []).find(p => p.code === code);
  if (!prod) return;

  const oldStock = Number(prod.stock) || 0;
  const diff = newStockVal - oldStock;

  prod.stock = newStockVal;
  if (newStockVal <= 0) {
    prod.status = 'AGOTADO';
  } else {
    prod.status = 'DISPONIBLE';
  }

  recordInventoryMovement({
    type: 'AJUSTE_MANUAL',
    productCode: prod.code,
    productName: prod.description || prod.category || prod.code,
    quantity: diff,
    stockBefore: oldStock,
    stockAfter: newStockVal,
    reference: `Auditoría: ${reason}`,
    notes: `Modificación manual de stock por ${state.currentUser ? (state.currentUser.fullName || state.currentUser.username) : 'Usuario'}`
  });

  saveProductsToStorage();
  closeQuickStockAdjustModal();
  renderInventoryTab();
  renderCatalog();
  showToast(`Stock actualizado para ${prod.code}: ${newStockVal} unidades`, 'success');
}

// Invoice Detail Modal
function openInvoiceDetailModal(invoiceId) {
  const inv = (state.invoices || []).find(i => i.id === invoiceId);
  if (!inv) return;

  const modal = document.getElementById('invoiceDetailModal');
  const container = document.getElementById('invoiceDetailContent');
  if (!modal || !container) return;

  const isCredito = inv.condicionPago === 'credito';
  const isVES = inv.currency === 'VES' || (inv.totalBs !== undefined && inv.totalBs > 0);
  const bcvRate = inv.bcvRate || 717.68;
  const cxpKey = `CXP-INV-${inv.numeroFactura || inv.id}`;
  const cxp = (state.payables || []).find(p => p.id === cxpKey || p.saleId === `FACT-${inv.numeroFactura}`);
  const isCxpPaid = cxp ? cxp.status === 'CONCILIADO' : (!isCredito);

  const photoSrc = inv.photoUrl || generateInvoicePlaceholderSVG(inv.proveedor || 'Factura Compra', inv.numeroFactura, Number(inv.totalMonto || 0).toFixed(2));
  const buyerName = inv.razonSocialCompra || 'JESUS DAVID PALMA GOLLO';

  const hasDiscount = (inv.descuentoPorcentaje > 0 || inv.descuentoMontoBs > 0 || inv.descuentoValor > 0);
  const discountPct = Number(inv.descuentoPorcentaje || 0);
  const subtotalBrutoBs = Number(inv.subtotalBrutoBs || (inv.items || []).reduce((acc, it) => acc + ((it.quantity || 1) * (it.precioBs || (it.cost * bcvRate) || 0)), 0));
  const discountBs = Number(inv.descuentoMontoBs || (discountPct > 0 ? (subtotalBrutoBs * discountPct / 100) : 0));
  const baseImponibleBs = Number(inv.baseImponibleBs || Math.max(0, subtotalBrutoBs - discountBs));
  const ivaBs = Number(inv.ivaBs || (baseImponibleBs * 0.16));
  const totalFacturaBs = Number(inv.totalBs || (baseImponibleBs + ivaBs));
  const totalMontoUsd = Number(inv.totalMonto || 0);

  container.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 1.25rem; flex-wrap: wrap;">
      <div>
        <span class="badge badge-primary" style="margin-bottom: 4px;">FACTURA DE COMPRA</span>
        <h3 style="margin: 0; font-size: 1.35rem; font-weight: 800; color: #0f172a;">${escapeHtml(inv.numeroFactura || 'Factura sin número')}</h3>
        <div style="font-size: 0.84rem; color: #64748b;">${escapeHtml(inv.proveedor || 'Distribuidor no especificado')} ${inv.rif ? `• RIF: ${escapeHtml(inv.rif)}` : ''}</div>
      </div>
      <div style="text-align: right;">
        <div style="font-size: 0.8rem; color: #64748b;">Total Factura ($)</div>
        <div style="font-size: 1.45rem; font-weight: 800; color: #059669;">$${totalMontoUsd.toFixed(2)}</div>
        ${hasDiscount ? `
          <div style="font-size: 0.72rem; color: #dc2626; font-weight: 700; background: #fee2e2; border: 1px solid #fecaca; border-radius: 4px; padding: 2px 6px; display: inline-block; margin-top: 2px;">
            🏷️ -${discountPct.toFixed(1)}% Descuento Aplicado
          </div>
        ` : ''}
        ${isVES ? `
          <div style="font-size: 0.8rem; font-weight: 700; color: #1e40af; margin-top: 2px;">
            Total: Bs. ${totalFacturaBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        ` : ''}
      </div>
    </div>

    <!-- Razón Social de la Compra -->
    <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px 14px; margin-bottom: 1.25rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
      <div>
        <div style="font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; font-weight: 700;">🏢 Razón Social de la Compra (Cliente Receptor):</div>
        <div style="font-weight: 800; color: #0f172a; font-size: 1rem;">${escapeHtml(buyerName)}</div>
      </div>
      <div style="text-align: right;">
        ${inv.rifCompra ? `<div style="font-size: 0.8rem; color: #2563eb; font-weight: 700;">RIF: ${escapeHtml(inv.rifCompra)}</div>` : ''}
        ${inv.dirCompra ? `<div style="font-size: 0.74rem; color: #64748b;">${escapeHtml(inv.dirCompra)}</div>` : ''}
      </div>
    </div>

    <!-- Foto Adjunta -->
    <div style="background: #0f172a; border-radius: 10px; padding: 12px; text-align: center; margin-bottom: 1.25rem;">
      <div style="font-size: 0.78rem; color: #94a3b8; margin-bottom: 6px; font-weight: 600;">📷 Comprobante / Foto de la Factura:</div>
      <img src="${photoSrc}" alt="Foto Factura" style="max-height: 280px; max-width: 100%; border-radius: 6px; object-fit: contain; box-shadow: 0 4px 12px rgba(0,0,0,0.3); cursor: pointer;" onclick="window.open('${photoSrc}', '_blank')" title="Clic para abrir en pestaña nueva">
    </div>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: 1.25rem; font-size: 0.84rem;">
      <div>
        <div style="color: #64748b; font-size: 0.75rem;">Fecha Emisión</div>
        <div style="font-weight: 700; color: #1e293b;">${inv.fecha || 'N/A'}</div>
      </div>
      <div>
        <div style="color: #64748b; font-size: 0.75rem;">Moneda & Tasa</div>
        <div style="font-weight: 700; color: #1e293b;">${isVES ? `🇻🇪 Bs. (BCV ${bcvRate} Bs/$)` : '💵 Dólares (USD)'}</div>
      </div>
      <div>
        <div style="color: #64748b; font-size: 0.75rem;">Condición Pago</div>
        <div style="font-weight: 700; color: #1e293b;">${isCredito ? '📋 A Crédito' : '💵 Contado'}</div>
      </div>
      <div>
        <div style="color: #64748b; font-size: 0.75rem;">Vencimiento Crédito</div>
        <div style="font-weight: 700; color: #b45309;">${isCredito ? (inv.fechaVencimiento || 'N/A') : 'N/A (Pagado)'}</div>
      </div>
      <div>
        <div style="color: #64748b; font-size: 0.75rem;">Estado CXP</div>
        <div style="font-weight: 700; color: ${isCxpPaid ? '#059669' : '#dc2626'};">${isCxpPaid ? '✅ Conciliado' : '⏳ Pendiente de Pago'}</div>
      </div>
    </div>

    <div style="font-weight: 800; font-size: 0.92rem; color: #0f172a; margin-bottom: 8px;">📦 Partidas de Mercancía Recibida:</div>
    <div class="table-responsive">
      <table class="data-table" style="font-size: 0.82rem;">
        <thead>
          <tr>
            <th>Producto</th>
            <th>Código</th>
            <th>Cantidad</th>
            ${isVES ? '<th>Precio Catálogo (Bs.)</th>' : ''}
            <th>Costo USD Neto</th>
            ${isVES ? '<th>Subtotal (Bs.)</th>' : ''}
            <th>Subtotal ($)</th>
          </tr>
        </thead>
        <tbody>
          ${(inv.items || []).map(it => `
            <tr>
              <td style="font-weight: 700; color: #1e293b;">${it.name || it.code}</td>
              <td style="font-family: monospace; color: #64748b;">${it.code}</td>
              <td style="font-weight: 800; color: #059669;">${it.quantity} un</td>
              ${isVES ? `<td style="color: #1e40af; font-weight: 600;">Bs. ${Number(it.precioBs || (it.cost * bcvRate) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>` : ''}
              <td style="font-weight: 700; color: #059669;">$${Number(it.cost || 0).toFixed(2)}</td>
              ${isVES ? `<td style="color: #1e40af; font-weight: 700;">Bs. ${Number((it.quantity || 1) * (it.precioBs || (it.cost * bcvRate) || 0)).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>` : ''}
              <td style="font-weight: 700; color: #0f172a;">$${Number(it.subtotal || (it.quantity * it.cost) || 0).toFixed(2)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <!-- Resumen Fiscal SENIAT y Descuentos -->
    <div style="margin-top: 1rem; background: #f8fafc; border: 1.5px solid #cbd5e1; border-radius: 8px; padding: 14px 18px; display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 16px;">
      <div style="font-size: 0.82rem; color: #475569; max-width: 320px;">
        <div style="font-weight: 700; color: #0f172a; margin-bottom: 4px;">📊 Desglose Fiscal SENIAT</div>
        <div>Total unidades recibidas: <strong>${inv.totalUnits || (inv.items || []).reduce((a, b) => a + (b.quantity || 0), 0)} un</strong></div>
        <div style="margin-top: 4px; color: ${inv.descuentoAplicadoACosto !== false ? '#059669' : '#b45309'}; font-weight: 600;">
          ${hasDiscount 
            ? (inv.descuentoAplicadoACosto !== false 
                ? '✨ Costos unitarios de inventario ajustados con el descuento neto de compra.' 
                : 'ℹ️ Costos de inventario registrados a precio de catálogo bruto.') 
            : '✨ Registro a precio directo de proveedor.'}
        </div>
      </div>
      <div style="text-align: right; min-width: 270px; font-size: 0.84rem; line-height: 1.7;">
        ${isVES ? `
          <div style="display: flex; justify-content: space-between; gap: 16px; color: #64748b;">
            <span>Subtotal Bruto:</span>
            <strong>Bs. ${subtotalBrutoBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
          </div>
          ${hasDiscount ? `
            <div style="display: flex; justify-content: space-between; gap: 16px; color: #dc2626; font-weight: 700;">
              <span>Descuento en Factura (${discountPct.toFixed(1)}%):</span>
              <span>-Bs. ${discountBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div style="display: flex; justify-content: space-between; gap: 16px; color: #0f172a; font-weight: 700;">
              <span>Base Imponible (BI G 16%):</span>
              <span>Bs. ${baseImponibleBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          ` : ''}
          <div style="display: flex; justify-content: space-between; gap: 16px; color: #475569;">
            <span>IVA (16%):</span>
            <strong>Bs. ${ivaBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
          </div>
          <div style="display: flex; justify-content: space-between; gap: 16px; border-top: 1.5px dashed #cbd5e1; padding-top: 4px; margin-top: 4px; font-size: 0.95rem;">
            <span style="font-weight: 800; color: #0f172a;">TOTAL FACTURA:</span>
            <strong style="color: #1e40af; font-size: 1.15rem;">Bs. ${totalFacturaBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
          </div>
        ` : ''}
        <div style="display: flex; justify-content: space-between; gap: 16px; border-top: 1.5px solid #cbd5e1; padding-top: 6px; margin-top: 6px; font-size: 0.95rem;">
          <span style="font-weight: 800; color: #0f172a;">TOTAL CXP ($):</span>
          <strong style="color: #059669; font-size: 1.25rem;">$${totalMontoUsd.toFixed(2)}</strong>
        </div>
      </div>
    </div>

    ${inv.notas ? `
      <div style="margin-top: 10px; font-size: 0.82rem; color: #64748b;">
        <strong>Observaciones:</strong> ${inv.notas}
      </div>
    ` : ''}
  `;

  modal.classList.add('active');
}

function closeInvoiceDetailModal() {
  const modal = document.getElementById('invoiceDetailModal');
  if (modal) modal.classList.remove('active');
}

function deleteInvoice(invoiceId) {
  if (!isGerencia()) {
    showToast('Solo gerencia puede eliminar registros de facturas', 'danger');
    return;
  }
  if (!confirm('¿Está seguro de eliminar el registro de esta factura? (No se revertirá el stock automáticamente).')) {
    return;
  }

  state.invoices = (state.invoices || []).filter(i => i.id !== invoiceId);
  saveInvoicesToStorage();
  renderInventoryInvoicesTable();
  renderInventoryMetrics();
  showToast('Factura eliminada del historial', 'info');
}

// INVOICE UPLOAD & MANUAL / AI ENTRY MODULE
function switchInvoiceModalMode(mode = 'manual') {
  state.invoiceModalMode = mode;
  const isAi = mode === 'ai';

  const btnManual = document.getElementById('btnModalModeManual');
  const btnAI = document.getElementById('btnModalModeAI');
  const aiBanner = document.getElementById('aiScanBannerSection');
  const manualAttachBox = document.getElementById('manualAttachReceiptBox');
  const modalTitle = document.getElementById('invoiceModalTitle');
  const modalSubtitle = document.getElementById('invoiceModalSubtitle');
  const modalIcon = document.getElementById('invoiceModalIcon');

  if (btnManual && btnAI) {
    if (isAi) {
      btnAI.style.background = 'linear-gradient(135deg, #7c3aed, #4f46e5)';
      btnAI.style.color = '#ffffff';
      btnAI.style.boxShadow = '0 2px 8px rgba(124, 58, 237, 0.4)';
      btnManual.style.background = 'transparent';
      btnManual.style.color = '#475569';
      btnManual.style.boxShadow = 'none';
    } else {
      btnManual.style.background = '#059669';
      btnManual.style.color = '#ffffff';
      btnManual.style.boxShadow = '0 2px 8px rgba(5, 150, 105, 0.3)';
      btnAI.style.background = 'transparent';
      btnAI.style.color = '#475569';
      btnAI.style.boxShadow = 'none';
    }
  }

  if (aiBanner) aiBanner.style.display = isAi ? 'block' : 'none';
  if (manualAttachBox) manualAttachBox.style.display = isAi ? 'none' : 'flex';

  if (modalIcon) {
    modalIcon.textContent = isAi ? '🤖' : '✏️';
    modalIcon.style.background = isAi ? 'linear-gradient(135deg, #7c3aed, #2563eb)' : 'linear-gradient(135deg, #10b981, #059669)';
  }

  if (modalTitle) {
    modalTitle.textContent = isAi ? 'Carga de Factura con Asistente IA (Gemini Flash)' : 'Carga Manual de Factura de Compra';
  }
  if (modalSubtitle) {
    modalSubtitle.textContent = isAi 
      ? 'Adjunta la foto de tu factura. El Asistente IA extraerá los datos para alimentar inventario y generar CXP.'
      : 'Ingresa los datos del proveedor, número de factura y agrega los productos recibidos para alimentar inventario.';
  }

  if (!isAi) {
    setTimeout(() => {
      const numInput = document.getElementById('invoiceNumberInput');
      if (numInput && !numInput.value) numInput.focus();
    }, 150);
  }
}

function handleManualReceiptFileSelected(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    compressImageForStorage(e.target.result, 1200, 0.7).then(compressedUrl => {
      state.currentUploadedInvoicePhoto = compressedUrl;
      const label = document.getElementById('manualReceiptFileName');
      const removeBtn = document.getElementById('btnRemoveManualReceipt');
      if (label) {
        label.innerHTML = `✅ <strong>Foto adjunta:</strong> ${file.name} (respaldo archivado)`;
        label.style.color = '#059669';
      }
      if (removeBtn) removeBtn.style.display = 'inline-block';
      showToast(`Comprobante adjuntado: ${file.name}`, 'info');
    });
  };
  reader.readAsDataURL(file);
}

function removeManualReceiptFile(silent = false) {
  state.currentUploadedInvoicePhoto = null;
  const fileInput = document.getElementById('manualReceiptFileInput');
  if (fileInput) fileInput.value = '';
  const label = document.getElementById('manualReceiptFileName');
  const removeBtn = document.getElementById('btnRemoveManualReceipt');
  if (label) {
    label.textContent = 'Puedes adjuntar una foto del comprobante para mantener el registro visual archivado en la app.';
    label.style.color = '#64748b';
  }
  if (removeBtn) removeBtn.style.display = 'none';
  if (!silent) {
    showToast('Soporte fotográfico removido', 'info');
  }
}

function openInvoiceUploadModal(mode = 'manual') {
  try {
    const modal = document.getElementById('invoiceUploadModal');
    if (!modal) return;

    // Helper to safely set element value if element exists
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val;
    };

    // Reset form
    setVal('invoiceNumberInput', '');
    setVal('invoiceSupplierInput', '');
    setVal('invoiceSupplierRifInput', '');

    // Razón Social de la Compra / Cliente Receptor
    setVal('invoiceBuyerNameInput', 'JESUS DAVID PALMA GOLLO');
    setVal('invoiceBuyerRifInput', 'V-212044993');
    setVal('invoiceBuyerAddressInput', 'CALLE 3, CASA 2, SECTOR LA PROVIDENCIA');

    setVal('invoiceDateInput', new Date().toISOString().split('T')[0]);
    setVal('invoicePaymentConditionSelect', 'credito');
    
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 15);
    setVal('invoiceDueDateInput', dueDate.toISOString().split('T')[0]);
    setVal('invoiceNotesInput', '');

    setVal('invoiceCurrencySelect', 'VES');
    setVal('invoiceBcvRateInput', '717.68');
    setVal('invoiceTotalBsInput', '');

    // Reset discount
    setInvoiceDiscountType('percent');
    setVal('invoiceDiscountValueInput', '0');
    const discCheck = document.getElementById('invoiceApplyDiscountToCostCheckbox');
    if (discCheck) discCheck.checked = true;

    // Reset photo dropzone and manual receipt label silently without toast
    state.currentUploadedInvoicePhoto = null;
    const dropzone = document.getElementById('invoiceDropzone');
    if (dropzone) dropzone.classList.remove('has-image');
    const emptyView = document.getElementById('dropzoneEmptyView');
    const previewView = document.getElementById('dropzonePreviewView');
    if (emptyView) emptyView.style.display = 'block';
    if (previewView) previewView.style.display = 'none';
    removeManualReceiptFile(true);

    // Reset status box & OCR box
    const statusBox = document.getElementById('aiScanStatusBox');
    if (statusBox) statusBox.style.display = 'none';
    const ocrBox = document.getElementById('invoiceOcrResultBox');
    if (ocrBox) ocrBox.style.display = 'none';

    updateAiEngineBadge();

    handleInvoiceConditionChange();
    handleInvoiceCurrencyChange();

    // Reset item rows with 1 default row
    const tbody = document.getElementById('invoiceItemsTableBody');
    if (tbody) tbody.innerHTML = '';
    addInvoiceItemRow();

    // Set visual mode (manual or AI)
    switchInvoiceModalMode(mode);

    // Explicitly guarantee visibility
    modal.style.display = 'flex';
    modal.classList.add('active');
  } catch (err) {
    console.error('Error opening invoice modal:', err);
    showToast('Error al abrir la carga de facturas: ' + err.message, 'danger');
  }
}

function closeInvoiceUploadModal() {
  const modal = document.getElementById('invoiceUploadModal');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.remove('active');
  }
}

function handleInvoiceConditionChange() {
  const condition = document.getElementById('invoicePaymentConditionSelect').value;
  const group = document.getElementById('invoiceDueDateGroup');
  if (group) {
    group.style.display = condition === 'credito' ? 'block' : 'none';
  }
}

function handleInvoiceCurrencyChange() {
  const curSelect = document.getElementById('invoiceCurrencySelect');
  const isVES = !curSelect || curSelect.value === 'VES';
  
  const bcvGroup = document.getElementById('invoiceBcvGroup');
  const totalBsGroup = document.getElementById('invoiceTotalBsGroup');
  const thBs = document.getElementById('thInvoicePrecioBs');
  const thSubBs = document.getElementById('thInvoiceSubtotalBs');
  const summaryBsBlock = document.getElementById('invoiceBsSummaryBlock');
  const bcvNoteLabel = document.getElementById('invoiceBcvNoteLabel');
  const totalWithIvaBlock = document.getElementById('invoiceTotalWithIvaUsdBlock');

  if (bcvGroup) bcvGroup.style.display = isVES ? 'block' : 'none';
  if (totalBsGroup) totalBsGroup.style.display = isVES ? 'block' : 'none';
  if (thBs) thBs.style.display = isVES ? '' : 'none';
  if (thSubBs) thSubBs.style.display = isVES ? '' : 'none';
  if (summaryBsBlock) summaryBsBlock.style.display = isVES ? 'block' : 'none';
  if (bcvNoteLabel) bcvNoteLabel.style.display = isVES ? 'block' : 'none';
  if (totalWithIvaBlock) totalWithIvaBlock.style.display = isVES ? 'block' : 'none';

  // Update item rows
  const tbody = document.getElementById('invoiceItemsTableBody');
  if (tbody) {
    tbody.querySelectorAll('tr').forEach(tr => {
      const rowId = tr.id.replace('invRow_', '');
      const tdBs = document.getElementById(`invRowTdBs_${rowId}`);
      const tdSubBs = document.getElementById(`invRowTdSubBs_${rowId}`);
      if (tdBs) tdBs.style.display = isVES ? '' : 'none';
      if (tdSubBs) tdSubBs.style.display = isVES ? '' : 'none';
    });
  }

  updateInvoiceCalculations();
}

function handleInvoiceBcvRateChange() {
  const rateInput = document.getElementById('invoiceBcvRateInput');
  let rate = parseFloat(rateInput ? rateInput.value : 717.68);
  if (isNaN(rate) || rate <= 0) rate = 1;

  // Recalculate USD cost for all rows based on their Bs price
  const tbody = document.getElementById('invoiceItemsTableBody');
  if (tbody) {
    tbody.querySelectorAll('tr').forEach(tr => {
      const rowId = tr.id.replace('invRow_', '');
      const precioBsInput = document.getElementById(`invRowPrecioBs_${rowId}`);
      const costUsdInput = document.getElementById(`invRowCost_${rowId}`);
      if (precioBsInput && costUsdInput) {
        const pBs = parseFloat(precioBsInput.value) || 0;
        if (pBs > 0) {
          costUsdInput.value = (pBs / rate).toFixed(2);
        }
      }
    });
  }

  updateInvoiceCalculations();
}

function handleRecalculateBcv() {
  handleInvoiceBcvRateChange();
  showToast('Precios en $ recalculados con la Tasa BCV', 'info');
}

function handleInvoiceTotalBsInput() {
  updateInvoiceCalculations();
}

// Handle Photo File Upload
function handleInvoiceFileSelected(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const rawDataUrl = e.target.result;
    compressImageForStorage(rawDataUrl, 1400, 0.75).then(dataUrl => {
      state.currentUploadedInvoicePhoto = dataUrl;
      state.currentSelectedInvoicePreset = null; // Important: Clear any preset flag!

      const img = document.getElementById('invoicePhotoPreviewImg');
      const nameEl = document.getElementById('invoicePhotoFileName');
      const emptyView = document.getElementById('dropzoneEmptyView');
      const previewView = document.getElementById('dropzonePreviewView');
      const dropzone = document.getElementById('invoiceDropzone');

      if (img) img.src = dataUrl;
      if (nameEl) nameEl.textContent = file.name;
      if (emptyView) emptyView.style.display = 'none';
      if (previewView) previewView.style.display = 'flex';
      if (dropzone) dropzone.classList.add('has-image');

      const ocrBox = document.getElementById('invoiceOcrResultBox');
      if (ocrBox) ocrBox.style.display = 'none';

      showToast('Foto cargada y optimizada. Haz clic en "🤖 Escanear con Gemini Flash"', 'info');
    });
  };
  reader.readAsDataURL(file);
}

// Dynamic Invoice Rows
let nextInvoiceRowId = 1;

function addInvoiceItemRow(data = {}) {
  const tbody = document.getElementById('invoiceItemsTableBody');
  if (!tbody) return;

  const rowId = nextInvoiceRowId++;
  const products = state.products || [];
  const curSelect = document.getElementById('invoiceCurrencySelect');
  const isVES = !curSelect || curSelect.value === 'VES';
  const bcvInput = document.getElementById('invoiceBcvRateInput');
  const bcvRate = parseFloat(bcvInput ? bcvInput.value : 717.68) || 717.68;

  const tr = document.createElement('tr');
  tr.id = `invRow_${rowId}`;

  const defaultCode = data.code || (products[0] ? (products[0].code || '') : '');
  const matchedProd = products.find(p => (p.code || '').toLowerCase() === (defaultCode || '').toLowerCase()) || products[0];

  const defaultQty = data.quantity !== undefined ? data.quantity : 1;
  
  let defaultPrecioBs = 0;
  let defaultCostUsd = 0;

  if (data.precioBs !== undefined && data.precioBs > 0) {
    defaultPrecioBs = Number(data.precioBs);
    defaultCostUsd = data.cost !== undefined ? Number(data.cost) : (defaultPrecioBs / bcvRate);
  } else if (data.cost !== undefined && data.cost > 0) {
    defaultCostUsd = Number(data.cost);
    defaultPrecioBs = defaultCostUsd * bcvRate;
  } else if (matchedProd) {
    defaultCostUsd = Number(matchedProd.costo || matchedProd.mayor || 15);
    defaultPrecioBs = defaultCostUsd * bcvRate;
  } else {
    defaultCostUsd = 15;
    defaultPrecioBs = 15 * bcvRate;
  }

  const defaultSubtotalBs = (defaultQty * defaultPrecioBs).toFixed(2);
  const defaultSubtotalUsd = (defaultQty * defaultCostUsd).toFixed(2);

  let extraOption = '';
  if (defaultCode && !products.some(p => (p.code || '').toLowerCase() === defaultCode.toLowerCase())) {
    extraOption = `<option value="${defaultCode}" selected>✨ ${data.name || defaultCode} (${defaultCode}) [Detectado]</option>`;
  }

  const productOptions = products.map(p => {
    const pCode = p.code || '';
    const isSelected = pCode && (pCode.toLowerCase() === (defaultCode || '').toLowerCase());
    return `<option value="${pCode}" ${isSelected ? 'selected' : ''}>${p.description || p.category || pCode} (${pCode})</option>`;
  }).join('');

  tr.innerHTML = `
    <td>
      <select class="form-control" style="font-size: 0.82rem;" onchange="handleInvoiceProductSelect(this, ${rowId})">
        ${extraOption}${productOptions}
      </select>
    </td>
    <td>
      <input type="text" class="form-control" id="invRowCode_${rowId}" value="${defaultCode}" readonly style="font-family: monospace; font-size: 0.8rem; background: #f1f5f9;">
    </td>
    <td>
      <input type="number" class="form-control" id="invRowQty_${rowId}" min="1" step="1" value="${defaultQty}" style="font-weight: 700;" oninput="handleInvoiceRowQtyChange(${rowId})">
    </td>
    <td id="invRowTdBs_${rowId}" style="${isVES ? '' : 'display: none;'}">
      <input type="number" class="form-control" id="invRowPrecioBs_${rowId}" min="0.01" step="0.01" value="${Number(defaultPrecioBs).toFixed(2)}" style="font-weight: 700; color: #1e40af;" oninput="handleInvoiceRowPrecioBsChange(${rowId})">
    </td>
    <td>
      <input type="number" class="form-control" id="invRowCost_${rowId}" min="0.01" step="0.01" value="${Number(defaultCostUsd).toFixed(2)}" style="font-weight: 700; color: #059669;" oninput="handleInvoiceRowCostUsdChange(${rowId})">
    </td>
    <td id="invRowTdSubBs_${rowId}" style="font-weight: 700; color: #1e40af; vertical-align: middle; ${isVES ? '' : 'display: none;'}">
      Bs. <span id="invRowSubtotalBs_${rowId}">${Number(defaultSubtotalBs).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
    </td>
    <td style="font-weight: 800; color: #0f172a; vertical-align: middle;">
      $<span id="invRowSubtotal_${rowId}">${defaultSubtotalUsd}</span>
    </td>
    <td style="vertical-align: middle; text-align: center;">
      <button type="button" class="btn btn-outline btn-xs" onclick="removeInvoiceItemRow(${rowId})" style="color: #dc2626; border-color: #fca5a5; padding: 2px 6px;" title="Eliminar fila">&times;</button>
    </td>
  `;

  tbody.appendChild(tr);
  updateInvoiceCalculations();
}

function handleInvoiceRowQtyChange(rowId) {
  updateInvoiceCalculations();
}

function handleInvoiceRowPrecioBsChange(rowId) {
  const pBsInput = document.getElementById(`invRowPrecioBs_${rowId}`);
  const costInput = document.getElementById(`invRowCost_${rowId}`);
  const bcvInput = document.getElementById('invoiceBcvRateInput');
  const bcvRate = parseFloat(bcvInput ? bcvInput.value : 717.68) || 1;

  const pBs = parseFloat(pBsInput ? pBsInput.value : 0) || 0;
  if (costInput && bcvRate > 0) {
    costInput.value = (pBs / bcvRate).toFixed(2);
  }
  updateInvoiceCalculations();
}

function handleInvoiceRowCostUsdChange(rowId) {
  const pBsInput = document.getElementById(`invRowPrecioBs_${rowId}`);
  const costInput = document.getElementById(`invRowCost_${rowId}`);
  const bcvInput = document.getElementById('invoiceBcvRateInput');
  const bcvRate = parseFloat(bcvInput ? bcvInput.value : 717.68) || 1;

  const cost = parseFloat(costInput ? costInput.value : 0) || 0;
  if (pBsInput && bcvRate > 0) {
    pBsInput.value = (cost * bcvRate).toFixed(2);
  }
  updateInvoiceCalculations();
}

function handleInvoiceProductSelect(selectEl, rowId) {
  const code = selectEl.value;
  const prod = (state.products || []).find(p => p.code === code);
  const codeInput = document.getElementById(`invRowCode_${rowId}`);
  const costInput = document.getElementById(`invRowCost_${rowId}`);
  const pBsInput = document.getElementById(`invRowPrecioBs_${rowId}`);
  const bcvInput = document.getElementById('invoiceBcvRateInput');
  const bcvRate = parseFloat(bcvInput ? bcvInput.value : 717.68) || 1;

  if (codeInput) codeInput.value = code;
  if (prod) {
    const cost = Number(prod.costo || prod.mayor || 15);
    if (costInput) costInput.value = cost.toFixed(2);
    if (pBsInput) pBsInput.value = (cost * bcvRate).toFixed(2);
  }
  updateInvoiceCalculations();
}

function removeInvoiceItemRow(rowId) {
  const row = document.getElementById(`invRow_${rowId}`);
  if (row) row.remove();
  updateInvoiceCalculations();
}

let currentInvoiceDiscountType = 'percent'; // 'percent' or 'amount'

function setInvoiceDiscountType(type = 'percent') {
  currentInvoiceDiscountType = type;
  const btnPct = document.getElementById('btnDiscountTypePercent');
  const btnAmt = document.getElementById('btnDiscountTypeAmount');
  const suffix = document.getElementById('invoiceDiscountUnitSuffix');
  const input = document.getElementById('invoiceDiscountValueInput');
  const curSelect = document.getElementById('invoiceCurrencySelect');
  const isVES = !curSelect || curSelect.value === 'VES';

  if (btnPct && btnAmt) {
    if (type === 'percent') {
      btnPct.style.background = '#2563eb';
      btnPct.style.color = '#ffffff';
      btnPct.style.boxShadow = '0 1px 3px rgba(37,99,235,0.3)';
      btnAmt.style.background = 'transparent';
      btnAmt.style.color = '#475569';
      btnAmt.style.boxShadow = 'none';
      if (suffix) suffix.textContent = '%';
      if (input) {
        input.placeholder = '0';
        input.max = '100';
      }
    } else {
      btnAmt.style.background = '#2563eb';
      btnAmt.style.color = '#ffffff';
      btnAmt.style.boxShadow = '0 1px 3px rgba(37,99,235,0.3)';
      btnPct.style.background = 'transparent';
      btnPct.style.color = '#475569';
      btnPct.style.boxShadow = 'none';
      if (suffix) suffix.textContent = isVES ? 'Bs.' : '$';
      if (input) {
        input.placeholder = '0.00';
        input.removeAttribute('max');
      }
    }
  }
  updateInvoiceCalculations();
}

function applyQuickDiscount(pct) {
  setInvoiceDiscountType('percent');
  const input = document.getElementById('invoiceDiscountValueInput');
  if (input) {
    input.value = pct;
  }
  updateInvoiceCalculations();
}

function handleInvoiceDiscountChange() {
  updateInvoiceCalculations();
}

function updateInvoiceCalculations() {
  const tbody = document.getElementById('invoiceItemsTableBody');
  if (!tbody) return;

  const curSelect = document.getElementById('invoiceCurrencySelect');
  const isVES = !curSelect || curSelect.value === 'VES';
  const bcvInput = document.getElementById('invoiceBcvRateInput');
  const bcvRate = parseFloat(bcvInput ? bcvInput.value : 717.68) || 1;

  const rows = tbody.querySelectorAll('tr');
  let totalUnits = 0;
  let totalSubtotalBs = 0;
  let totalSubtotalUsd = 0;

  rows.forEach(tr => {
    const rowId = tr.id.replace('invRow_', '');
    const qtyInput = document.getElementById(`invRowQty_${rowId}`);
    const pBsInput = document.getElementById(`invRowPrecioBs_${rowId}`);
    const costInput = document.getElementById(`invRowCost_${rowId}`);
    const subtotalBsSpan = document.getElementById(`invRowSubtotalBs_${rowId}`);
    const subtotalSpan = document.getElementById(`invRowSubtotal_${rowId}`);

    const qty = parseInt(qtyInput ? qtyInput.value : 0, 10) || 0;
    const pBs = parseFloat(pBsInput ? pBsInput.value : 0) || 0;
    const cost = parseFloat(costInput ? costInput.value : 0) || 0;

    const subBs = qty * pBs;
    const subUsd = qty * cost;

    if (subtotalBsSpan) subtotalBsSpan.textContent = subBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (subtotalSpan) subtotalSpan.textContent = subUsd.toFixed(2);

    totalUnits += qty;
    totalSubtotalBs += subBs;
    totalSubtotalUsd += subUsd;
  });

  // Calculate Discount
  const discountInput = document.getElementById('invoiceDiscountValueInput');
  const discountRawVal = parseFloat(discountInput ? discountInput.value : 0) || 0;
  let discountPercent = 0;
  let discountAmountBs = 0;
  let discountAmountUsd = 0;

  if (currentInvoiceDiscountType === 'percent') {
    discountPercent = Math.min(Math.max(discountRawVal, 0), 100);
    discountAmountBs = totalSubtotalBs * (discountPercent / 100);
    discountAmountUsd = totalSubtotalUsd * (discountPercent / 100);
  } else {
    if (isVES) {
      discountAmountBs = Math.min(Math.max(discountRawVal, 0), totalSubtotalBs);
      discountPercent = totalSubtotalBs > 0 ? (discountAmountBs / totalSubtotalBs) * 100 : 0;
      discountAmountUsd = bcvRate > 0 ? (discountAmountBs / bcvRate) : 0;
    } else {
      discountAmountUsd = Math.min(Math.max(discountRawVal, 0), totalSubtotalUsd);
      discountPercent = totalSubtotalUsd > 0 ? (discountAmountUsd / totalSubtotalUsd) * 100 : 0;
      discountAmountBs = discountAmountUsd * bcvRate;
    }
  }

  // Base Imponible (Net Subtotal after discount)
  const baseImponibleBs = Math.max(0, totalSubtotalBs - discountAmountBs);
  const netSubtotalUsd = Math.max(0, totalSubtotalUsd - discountAmountUsd);

  // IVA 16% on Base Imponible
  const ivaBs = baseImponibleBs * 0.16;
  const totalBsConIva = baseImponibleBs + ivaBs;
  const totalUsdConIva = bcvRate > 0 ? (totalBsConIva / bcvRate) : (netSubtotalUsd * 1.16);

  // Check if discount affects unit inventory cost
  const applyCostCheckbox = document.getElementById('invoiceApplyDiscountToCostCheckbox');
  const applyDiscountToCost = applyCostCheckbox ? applyCostCheckbox.checked : true;
  const noteEl = document.getElementById('invoiceCostEffectNote');
  if (noteEl) {
    noteEl.style.display = (discountPercent > 0 && applyDiscountToCost) ? 'block' : 'none';
    if (discountPercent > 0 && applyDiscountToCost) {
      noteEl.textContent = `✨ Costo unitario en inventario rebajado un ${discountPercent.toFixed(2)}% (Costo neto real de compra).`;
    }
  }

  // Header helpers
  const headerSubtotalBs = document.getElementById('headerSubtotalBsLabel');
  if (headerSubtotalBs) {
    headerSubtotalBs.textContent = baseImponibleBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Update total boxes
  const unitsLabel = document.getElementById('invoiceTotalUnitsLabel');
  const amountLabel = document.getElementById('invoiceTotalAmountLabel');
  const sumSubBs = document.getElementById('invoiceSummarySubtotalBsLabel');
  const discRow = document.getElementById('invoiceDiscountSummaryRow');
  const discBsLabel = document.getElementById('invoiceSummaryDiscountBsLabel');
  const discPctLabel = document.getElementById('invoiceSummaryDiscountPercentLabel');
  const baseImpLabel = document.getElementById('invoiceSummaryBaseImponibleBsLabel');
  const sumIvaBs = document.getElementById('invoiceSummaryIvaBsLabel');
  const sumTotBs = document.getElementById('invoiceSummaryTotalBsLabel');
  const totalWithIvaUsd = document.getElementById('invoiceTotalWithIvaUsdLabel');
  const bcvApplied = document.getElementById('invoiceAppliedBcvText');

  if (unitsLabel) unitsLabel.textContent = totalUnits.toLocaleString();
  const finalValuationUsd = (applyDiscountToCost && discountPercent > 0) ? netSubtotalUsd : totalSubtotalUsd;
  if (amountLabel) amountLabel.textContent = `$${finalValuationUsd.toFixed(2)}`;

  if (sumSubBs) sumSubBs.textContent = `Bs. ${totalSubtotalBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (discRow) {
    if (discountPercent > 0 || discountAmountBs > 0) {
      discRow.style.display = 'flex';
      if (discBsLabel) discBsLabel.textContent = `-Bs. ${discountAmountBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      if (discPctLabel) discPctLabel.textContent = `${discountPercent.toFixed(2)}%`;
    } else {
      discRow.style.display = 'none';
    }
  }

  if (baseImpLabel) {
    baseImpLabel.textContent = `Bs. ${baseImponibleBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (sumIvaBs) sumIvaBs.textContent = `Bs. ${ivaBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (sumTotBs) sumTotBs.textContent = `Bs. ${totalBsConIva.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (totalWithIvaUsd) totalWithIvaUsd.textContent = `$${totalUsdConIva.toFixed(2)}`;
  if (bcvApplied) bcvApplied.textContent = `Tasa BCV: ${bcvRate.toFixed(2)} Bs/$`;
}

// Sample Invoice Presets (1-Click Demo)
function loadSampleInvoicePreset(presetKey) {
  let photoData = '';
  let invoiceData = {};

  if (presetKey === 'rower') {
    photoData = 'images/factura_rower_real.jpg';
    invoiceData = {
      num: '00004105',
      supplier: 'DISTRIBUIDORA ROWER, C.A.',
      rif: 'J-00011548-6',
      buyerName: 'JESUS DAVID PALMA GOLLO',
      buyerRif: 'V-212044993',
      buyerAddress: 'CALLE 3, CASA 2, SECTOR LA PROVIDENCIA, EDO. ARAGUA',
      date: '2026-09-11',
      currency: 'VES',
      bcvRate: 717.68,
      discountPercent: 20,
      totalBs: 287349.97,
      condition: 'credito',
      notes: 'Factura oficial SENIAT Distribuidora Rower, C.A. • 16 unidades • Descuento en Factura: 20% • REF $345.16',
      items: [
        { code: 'CTHB2400M-44', name: 'Botella Térmica 24oz Negro Mate', quantity: 1, precioBs: 10499.40, cost: 14.63 },
        { code: 'CTHB2400M-55', name: 'Botella Térmica 24oz Azul Navy', quantity: 1, precioBs: 10499.40, cost: 14.63 },
        { code: 'CTHB24-9E', name: 'Botella Térmica 24oz Special Edition', quantity: 1, precioBs: 10499.40, cost: 14.63 },
        { code: 'CT-COF1', name: 'Termo Coffee Mug Color Negro Obsidiana', quantity: 2, precioBs: 8066.52, cost: 11.24 },
        { code: 'CT-PWANC2N', name: 'Power ANC Smartwatch 2N', quantity: 1, precioBs: 24084.75, cost: 33.56 },
        { code: 'CT-PWANC4V', name: 'Power ANC Smartwatch 4V', quantity: 1, precioBs: 24084.75, cost: 33.56 },
        { code: 'CT-TOTE1NY', name: 'Bolso Tote Cubitt New York', quantity: 1, precioBs: 3710.31, cost: 5.17 },
        { code: 'CTDUF-9', name: 'Bolso Duffle Cubitt Travel', quantity: 2, precioBs: 24816.76, cost: 34.58 },
        { code: 'CTBPK-1', name: 'Mochila Backpack Cubitt Classic', quantity: 3, precioBs: 24816.77, cost: 34.58 },
        { code: 'CT-TUMBS9', name: 'Vaso Térmico Tumbler 20oz Obsidiana', quantity: 1, precioBs: 8633.47, cost: 12.03 },
        { code: 'CT-TUMBS5F', name: 'Vaso Térmico Tumbler 20oz Flamingo', quantity: 1, precioBs: 8633.47, cost: 12.03 },
        { code: 'CTCAP-5BE', name: 'Gorra Cubitt Cap Blue Edition', quantity: 1, precioBs: 6853.67, cost: 9.55 }
      ]
    };
  } else if (presetKey === 'termos') {
    photoData = generateInvoicePlaceholderSVG('Lote Botellas Térmicas Cubitt', 'FAC-2026-8812', '546.50');
    invoiceData = {
      num: 'FAC-2026-8812',
      supplier: 'Distribuidora Cubitt Latam C.A.',
      rif: 'J-50493821-0',
      buyerName: 'JESUS DAVID PALMA GOLLO',
      buyerRif: 'V-212044993',
      buyerAddress: 'CALLE 3, CASA 2, SECTOR LA PROVIDENCIA',
      currency: 'USD',
      bcvRate: 717.68,
      condition: 'credito',
      notes: 'Lote de botellas térmicas 20oz, 30oz y 40oz',
      items: [
        { code: 'BOT20', name: 'Botella Térmica 20oz', quantity: 15, cost: 11.50, precioBs: 8253.32 },
        { code: 'BOT30', name: 'Botella Térmica 30oz', quantity: 12, cost: 13.50, precioBs: 9688.68 },
        { code: 'BOT40', name: 'Botella Térmica 40oz', quantity: 14, cost: 15.14, precioBs: 10865.68 }
      ]
    };
  } else if (presetKey === 'watches') {
    photoData = generateInvoicePlaceholderSVG('Lote Smartwatches Oficial Cubitt', 'CUB-IMP-4409', '820.00');
    invoiceData = {
      num: 'CUB-IMP-4409',
      supplier: 'Smart Global Tech Corp / Cubitt Latam',
      rif: 'J-40918234-1',
      buyerName: 'JESUS DAVID PALMA GOLLO',
      buyerRif: 'V-212044993',
      buyerAddress: 'CALLE 3, CASA 2, SECTOR LA PROVIDENCIA',
      currency: 'USD',
      bcvRate: 717.68,
      condition: 'credito',
      notes: 'Importación directa de Smartwatches Viva Pro y Aura',
      items: [
        { code: 'VIVA-PRO', name: 'Smartwatch Viva Pro', quantity: 10, cost: 42.00, precioBs: 30142.56 },
        { code: 'AURA', name: 'Smartwatch Aura', quantity: 8, cost: 35.00, precioBs: 25118.80 },
        { code: 'JR', name: 'Smartwatch Jr', quantity: 6, cost: 20.00, precioBs: 14353.60 }
      ]
    };
  } else {
    // Variada
    photoData = generateInvoicePlaceholderSVG('Factura Surtida Cubitt Retail', 'INV-VE-9912', '1,280.00');
    invoiceData = {
      num: 'INV-VE-9912',
      supplier: 'Cubitt International Trading S.A.',
      rif: 'J-31902847-5',
      buyerName: 'JESUS DAVID PALMA GOLLO',
      buyerRif: 'V-212044993',
      buyerAddress: 'CALLE 3, CASA 2, SECTOR LA PROVIDENCIA',
      currency: 'USD',
      bcvRate: 717.68,
      condition: 'contado',
      notes: 'Reposición surtida: Balanza, Audífonos y Correas',
      items: [
        { code: 'BAL-PRO', name: 'Balanza Inteligente Pro', quantity: 10, cost: 18.00, precioBs: 12918.24 },
        { code: 'EAR-PRO', name: 'Cubitt Earbuds Pro', quantity: 15, cost: 20.00, precioBs: 14353.60 },
        { code: 'STRAP-20', name: 'Correa Silicona 20mm', quantity: 40, cost: 5.00, precioBs: 3588.40 },
        { code: 'VIVA-PRO', name: 'Smartwatch Viva Pro', quantity: 10, cost: 42.00, precioBs: 30142.56 }
      ]
    };
  }

  state.currentUploadedInvoicePhoto = photoData;

  const img = document.getElementById('invoicePhotoPreviewImg');
  const nameEl = document.getElementById('invoicePhotoFileName');
  const emptyView = document.getElementById('dropzoneEmptyView');
  const previewView = document.getElementById('dropzonePreviewView');
  const dropzone = document.getElementById('invoiceDropzone');

  if (img) img.src = photoData;
  if (nameEl) nameEl.textContent = presetKey === 'rower' ? 'factura_rower_real.jpg' : `factura_${presetKey}_demo.jpg`;
  if (emptyView) emptyView.style.display = 'none';
  if (previewView) previewView.style.display = 'flex';
  if (dropzone) dropzone.classList.add('has-image');

  runAIAssistantOnInvoice(invoiceData);
}

// ============================================================================
// AI ASSISTANT INVOICE SCANNING ENGINE (GEMINI VISION AI + LOCAL TESSERACT OCR)
// ============================================================================

function toggleApiKeyVisibility() {
  const input = document.getElementById('invoiceGeminiApiKeyInput');
  if (input) {
    input.type = input.type === 'password' ? 'text' : 'password';
  }
}

function saveGeminiModelChoice() {
  const sel = document.getElementById('invoiceGeminiModelSelect');
  if (sel) {
    safeStorageSet('cubitt_gemini_model', sel.value);
    updateAiEngineBadge();
    const optText = (sel.selectedIndex >= 0 && sel.options[sel.selectedIndex]) ? sel.options[sel.selectedIndex].text : sel.value;
    showToast(`Modelo establecido a ${optText}`, 'info');
  }
}

function toggleAiConfigBox() {
  const box = document.getElementById('aiConfigBox');
  if (box) {
    box.style.display = box.style.display === 'none' ? 'block' : 'none';
  }
}

function updateAiEngineBadge() {
  const badge = document.getElementById('aiEngineStatusBadge');
  const input = document.getElementById('invoiceGeminiApiKeyInput');
  const modelSel = document.getElementById('invoiceGeminiModelSelect');

  // Read saved key safely: config.js takes priority, then localStorage (NO setItem needed)
  let savedKey = '';
  try {
    savedKey = (window.CUBITT_CONFIG && window.CUBITT_CONFIG.GEMINI_API_KEY) || localStorage.getItem('cubitt_gemini_api_key') || '';
  } catch (e) {
    savedKey = (window.CUBITT_CONFIG && window.CUBITT_CONFIG.GEMINI_API_KEY) || '';
  }

  let savedModel = 'gemini-3.7-flash';
  try {
    savedModel = localStorage.getItem('cubitt_gemini_model') || (window.CUBITT_CONFIG && window.CUBITT_CONFIG.GEMINI_DEFAULT_MODEL) || 'gemini-3.7-flash';
  } catch (e) {
    savedModel = (window.CUBITT_CONFIG && window.CUBITT_CONFIG.GEMINI_DEFAULT_MODEL) || 'gemini-3.7-flash';
  }

  if (modelSel) {
    const hasOption = Array.from(modelSel.options).some(o => o.value === savedModel);
    modelSel.value = hasOption ? savedModel : 'gemini-3.7-flash';
  }

  if (savedKey) {
    if (badge) {
      const modelLabel = savedModel.includes('3.8') ? 'Gemini 3.8 Flash' : (savedModel.includes('3.7') ? 'Gemini 3.7 Flash' : 'Gemini Flash');
      badge.textContent = `✨ ${modelLabel} Conectado`;
      badge.style.background = '#10b981';
      badge.style.color = '#ffffff';
    }
    if (input) input.value = savedKey;
  } else {
    if (badge) {
      badge.textContent = '⚠️ Sin Conectar (Ingresa tu API Key)';
      badge.style.background = '#f59e0b';
      badge.style.color = '#000000';
    }
  }
}

function saveGeminiApiKey() {
  const input = document.getElementById('invoiceGeminiApiKeyInput');
  const key = (input ? input.value : '').trim();
  if (!key) {
    showToast('Ingresa una API Key válida de Google Gemini', 'warning');
    return;
  }
  safeStorageSet('cubitt_gemini_api_key', key);
  updateAiEngineBadge();
  showToast('✅ Clave de Google Gemini guardada. ¡Gemini Flash está activo y listo para escanear!', 'success');
}

function removeGeminiApiKey() {
  try {
    localStorage.removeItem('cubitt_gemini_api_key');
  } catch (e) {}
  const input = document.getElementById('invoiceGeminiApiKeyInput');
  if (input) input.value = '';
  updateAiEngineBadge();
  showToast('Clave de Gemini eliminada.', 'info');
}

// Heuristic Parser for Venezuelan Invoices (SENIAT / Distribuidores)
function parseInvoiceTextFromOCR(rawText) {
  if (!rawText) return null;
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);

  let num = '';
  let supplier = '';
  let rif = '';
  let buyerName = '';
  let buyerRif = '';
  let buyerAddress = '';
  let date = '';
  let bcvRate = 717.68;
  let totalBs = 0;
  let items = [];

  // 1. Detect RIFs (first is supplier, second is buyer)
  const rifMatches = rawText.match(/\b([JGVPEjgvpe][-\s]?\d{7,9}[-\s]?\d?)\b/g) || [];
  if (rifMatches.length > 0) {
    rif = rifMatches[0].replace(/\s+/g, '-').toUpperCase();
    if (!rif.includes('-') && rif.length >= 8) {
      rif = rif.slice(0, 1) + '-' + rif.slice(1, -1) + '-' + rif.slice(-1);
    }
  }
  if (rifMatches.length > 1) {
    buyerRif = rifMatches[1].replace(/\s+/g, '-').toUpperCase();
    if (!buyerRif.includes('-') && buyerRif.length >= 8) {
      buyerRif = buyerRif.slice(0, 1) + '-' + buyerRif.slice(1, -1) + '-' + buyerRif.slice(-1);
    }
  }

  // 2. Detect Invoice Number (Factura Nº, Control, etc.)
  const numMatch = rawText.match(/(?:FACTURA|CONTROL|FACTURA\s*N[°ºo#]|N[°ºo#]\s*FACTURA|FACTURA\s*FISCAL)[\s:.\-]*([A-Z0-9\-\/]{3,20})/i);
  if (numMatch) {
    num = numMatch[1].trim();
  } else {
    const standaloneNum = rawText.match(/\b(FV\/\d{4}\/\d{4,6}|000\d{4,6}|\d{7,8})\b/i);
    if (standaloneNum) num = standaloneNum[1];
  }

  // 3. Detect Supplier
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const l = lines[i];
    if (/(?:DISTRIBUIDORA|COMERCIALIZADORA|INVERSIONES|IMPORTADORA|CORPORACI[OÓ]N|C\.A\.|S\.A\.|S\.R\.L\.)/i.test(l)) {
      supplier = l.replace(/^(?:NOMBRE|RAZON SOCIAL|EMISOR)[\s:.\-]*/i, '').trim();
      break;
    }
  }
  if (!supplier && lines.length > 0) {
    supplier = lines[0];
  }

  // 4. Detect Buyer / Razón Social Compra
  const buyerMatch = rawText.match(/(?:RAZ[OÓ]N\s*SOCIAL|CLIENTE|NOMBRE|SE[ÑN]OR(?:ES)?)[\s:.\-]*([^\n\r]+)/i);
  if (buyerMatch) {
    buyerName = buyerMatch[1].replace(/RIF.*$/i, '').trim();
  }
  const addrMatch = rawText.match(/(?:DIRECCI[OÓ]N|DOMICILIO)[\s:.\-]*([^\n\r]+)/i);
  if (addrMatch) {
    buyerAddress = addrMatch[1].trim();
  }

  // 5. Detect Date (DD/MM/YYYY or DD-MM-YYYY)
  const dateMatch = rawText.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (dateMatch) {
    const day = dateMatch[1].padStart(2, '0');
    const month = dateMatch[2].padStart(2, '0');
    let year = dateMatch[3];
    if (year.length === 2) year = '20' + year;
    date = `${year}-${month}-${day}`;
  } else {
    date = new Date().toISOString().split('T')[0];
  }

  // 6. Detect BCV Rate / REF
  const bcvMatch = rawText.match(/(?:BCV|TASA\s*BCV|TASA|CAMBIO|REF(?:ERENCIAL)?)[\s:$]*([0-9]{1,4}(?:[.,][0-9]{1,4})?)/i);
  if (bcvMatch) {
    const cleanBcv = bcvMatch[1].replace(',', '.');
    const parsedBcv = parseFloat(cleanBcv);
    if (!isNaN(parsedBcv) && parsedBcv > 1) {
      bcvRate = parsedBcv;
    }
  }

  // 6.b. Detect Discount (DESC, DESCUENTO)
  let discountPercent = 0;
  let discountAmountBs = 0;
  const descMatch = rawText.match(/(?:DESC(?:UENTO)?)\s*(?:\(?\s*([0-9]{1,2}(?:[.,][0-9]{1,2})?)\s*%\s*\)?)?[\s:Bs.$]*[-]?([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{2})|[0-9]+(?:\.[0-9]{2}))?/i);
  if (descMatch) {
    if (descMatch[1]) {
      discountPercent = parseFloat(descMatch[1].replace(',', '.')) || 0;
    }
    if (descMatch[2]) {
      const cleanVal = descMatch[2].replace(/\./g, '').replace(',', '.');
      discountAmountBs = parseFloat(cleanVal) || 0;
    }
  }

  // 7. Detect Totals in Bs.
  const totalMatch = rawText.match(/(?:TOTAL\s*A\s*PAGAR|TOTAL\s*GENERAL|TOTAL\s*FACTURA|MONTO\s*TOTAL)[\s:Bs.$]*([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{2})|[0-9]+(?:\.[0-9]{2}))/i);
  if (totalMatch) {
    const cleanVal = totalMatch[1].replace(/\./g, '').replace(',', '.');
    totalBs = parseFloat(cleanVal) || 0;
  }

  // 8. Match products from catalog in the text
  (state.products || []).forEach(p => {
    const codeRegex = new RegExp('\\b' + p.code.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\b', 'i');
    if (codeRegex.test(rawText)) {
      const matchingLine = lines.find(l => codeRegex.test(l));
      let qty = 1;
      let pBs = 0;
      if (matchingLine) {
        const numbers = matchingLine.match(/\b\d+(?:[.,]\d+)?\b/g);
        if (numbers && numbers.length > 0) {
          const firstInt = parseInt(numbers[0], 10);
          if (firstInt > 0 && firstInt < 500) qty = firstInt;
        }
      }
      items.push({
        code: p.code,
        name: p.description || p.category || p.code,
        quantity: qty,
        precioBs: pBs > 0 ? pBs : (p.costo || 15) * bcvRate,
        cost: p.costo || (pBs > 0 ? (pBs / bcvRate) : 15)
      });
    }
  });

  return {
    num: num || ('0000' + Math.floor(Math.random() * 9000 + 1000)),
    supplier: supplier || 'Distribuidor / Proveedor Comercial',
    rif: rif || '',
    buyerName: buyerName || 'JESUS DAVID PALMA GOLLO',
    buyerRif: buyerRif || 'V-212044993',
    buyerAddress: buyerAddress || 'CALLE 3, CASA 2, SECTOR LA PROVIDENCIA',
    date: date,
    currency: 'VES',
    bcvRate: bcvRate,
    discountPercent: discountPercent,
    discountAmountBs: discountAmountBs,
    totalBs: totalBs > 0 ? totalBs : null,
    condition: 'credito',
    notes: 'Factura leída mediante escaneo OCR de imagen',
    items: items
  };
}

// Populate Extracted Invoice Data into POS Form
function populateScannedInvoiceData(data) {
  if (!data) return;

  if (data.num) document.getElementById('invoiceNumberInput').value = data.num;
  if (data.supplier) document.getElementById('invoiceSupplierInput').value = data.supplier;
  const rifInput = document.getElementById('invoiceSupplierRifInput');
  if (rifInput && data.rif) rifInput.value = data.rif;

  // Set Buyer fields
  const buyerNameInput = document.getElementById('invoiceBuyerNameInput');
  if (buyerNameInput) buyerNameInput.value = data.buyerName || 'JESUS DAVID PALMA GOLLO';
  const buyerRifInput = document.getElementById('invoiceBuyerRifInput');
  if (buyerRifInput) buyerRifInput.value = data.buyerRif || 'V-212044993';
  const buyerAddressInput = document.getElementById('invoiceBuyerAddressInput');
  if (buyerAddressInput) buyerAddressInput.value = data.buyerAddress || 'CALLE 3, CASA 2, SECTOR LA PROVIDENCIA';

  if (data.date) document.getElementById('invoiceDateInput').value = data.date;

  const curSelect = document.getElementById('invoiceCurrencySelect');
  if (curSelect) curSelect.value = data.currency || 'VES';
  const bcvInput = document.getElementById('invoiceBcvRateInput');
  if (bcvInput) bcvInput.value = (data.bcvRate || 717.68).toFixed(2);
  const totalBsInput = document.getElementById('invoiceTotalBsInput');
  if (totalBsInput && data.totalBs) {
    totalBsInput.value = Number(data.totalBs).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  if (data.condition) {
    document.getElementById('invoicePaymentConditionSelect').value = data.condition;
  }
  if (data.notes) {
    document.getElementById('invoiceNotesInput').value = data.notes;
  }

  // Set Discount if present in scanned data
  if (data.discountPercent !== undefined && data.discountPercent !== null && Number(data.discountPercent) > 0) {
    setInvoiceDiscountType('percent');
    const discountInput = document.getElementById('invoiceDiscountValueInput');
    if (discountInput) discountInput.value = data.discountPercent;
  } else if (data.discountAmountBs !== undefined && data.discountAmountBs !== null && Number(data.discountAmountBs) > 0) {
    setInvoiceDiscountType('amount');
    const discountInput = document.getElementById('invoiceDiscountValueInput');
    if (discountInput) discountInput.value = data.discountAmountBs;
  } else if (data.discount !== undefined && data.discount !== null && Number(data.discount) > 0) {
    setInvoiceDiscountType('percent');
    const discountInput = document.getElementById('invoiceDiscountValueInput');
    if (discountInput) discountInput.value = data.discount;
  } else {
    setInvoiceDiscountType('percent');
    const discountInput = document.getElementById('invoiceDiscountValueInput');
    if (discountInput) discountInput.value = '0';
  }

  handleInvoiceConditionChange();
  handleInvoiceCurrencyChange();

  // Populate dynamic items
  const tbody = document.getElementById('invoiceItemsTableBody');
  if (tbody) {
    tbody.innerHTML = '';
    const items = Array.isArray(data.items) && data.items.length > 0 ? data.items : [];

    if (items.length > 0) {
      items.forEach(it => {
        const cleanCode = (it.code || '').replace(/\s*\([A-Z0-9]+\)$/i, '').trim();
        let existing = (state.products || []).find(p => p.code.toLowerCase() === cleanCode.toLowerCase());
        if (!existing && it.name) {
          const itNameLower = it.name.toLowerCase();
          existing = (state.products || []).find(p =>
            itNameLower.includes(p.code.toLowerCase()) ||
            (p.description && itNameLower.includes(p.description.toLowerCase()))
          );
        }

        addInvoiceItemRow({
          code: existing ? existing.code : (cleanCode || (state.products[0] ? state.products[0].code : '')),
          quantity: it.quantity || 1,
          precioBs: it.precioBs,
          cost: it.cost
        });
      });
    } else {
      addInvoiceItemRow();
    }
  }

  updateInvoiceCalculations();
}

// Scan with Google Gemini Vision API (Multimodal Gemini 2.0 Flash / Gemini 1.5 Flash)
async function scanInvoiceWithGeminiVision(dataUrl, apiKey, statusText) {
  if (statusText) statusText.textContent = '🤖 Gemini Flash: Procesando foto, tablas y columnas fiscales...';

  const parts = dataUrl.split(',');
  const mimeType = (parts[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
  const base64Data = parts[1];

  const catalogContext = (state.products || []).slice(0, 100).map(p => `${p.code}: ${p.description || p.category}`).join('\n');

  const prompt = `Actúa como un asistente contable y fiscal especializado en facturas comerciales venezolanas (SENIAT, notas de entrega, distribuidores de tecnología y accesorios Cubitt, como Distribuidora Rower, C.A.).
Analiza con total minuciosidad la imagen de esta factura de compra y extrae todos sus datos reales en formato JSON exacto:
{
  "num": "número de factura o número de control visible en la foto (ej: 00003706 o 00004105)",
  "supplier": "nombre o razón social del proveedor emisor (ej: DISTRIBUIDORA ROWER, C.A.)",
  "rif": "RIF del proveedor (ej: J-00011548-6)",
  "buyerName": "razón social o nombre del comprador / cliente receptor (ej: JESUS DAVID PALMA GOLLO)",
  "buyerRif": "RIF o cédula del comprador (ej: V-212044993)",
  "buyerAddress": "dirección del comprador si está visible",
  "date": "YYYY-MM-DD",
  "currency": "VES" si está en bolívares o "USD" si está en dólares,
  "bcvRate": número flotante con la tasa de cambio oficial o referencial Bs/$ señalada en la factura (ej: 787.53 o 717.68),
  "discountPercent": número flotante con el porcentaje de descuento global en factura si existe (ej: 20.0 para DESC (20,00%), o 0 si no hay),
  "discountAmountBs": número flotante con el monto en bolívares del descuento si existe (ej: 79862.64),
  "baseImponibleBs": número flotante con la Base Imponible BI G 16% después del descuento (ej: 319450.55),
  "ivaBs": número flotante con el monto de IVA 16% (ej: 51112.09),
  "totalBs": total a pagar en bolívares con IVA si aplica (número flotante, ej: 370562.64),
  "refUsd": número flotante con el valor referencial en USD si está escrito en la factura (ej: 470.54 para REF: $ 470,54),
  "condition": "credito" o "contado",
  "notes": "resumen de observaciones o notas fiscales",
  "items": [
    {
      "code": "código del producto (utiliza preferentemente códigos de este catálogo si coinciden o se parecen: \n${catalogContext}\n)",
      "name": "descripción completa del producto según la factura",
      "quantity": número entero de piezas,
      "precioBs": número flotante con el precio unitario en Bolívares sin IVA según el renglón bruto (ej: 13238.47),
      "cost": número flotante con el costo unitario bruto en USD (divide el precioBs entre la tasa bcvRate)
    }
  ]
}
Nota especial para facturas SENIAT (como Distribuidora Rower, C.A.): Los productos se listan a precio bruto unitario de catálogo. Al final de la tabla de renglones suele haber una línea de descuento como "DESC ( 20,00 % ) -79.862,64" que se descuenta del subtotal bruto para obtener la "BI G ( 16,00 % ) 319.450,55", y sobre esa base se calcula el IVA 16% (51.112,09) dando el "TOTAL Bs. 370.562,64" con "REF: $ 470,54". Extrae siempre el "discountPercent" (ej: 20.0), el "discountAmountBs" y la tasa oficial señalada.
Responde ÚNICAMENTE con el objeto JSON válido, sin delimitadores de código markdown ni texto adicional.`;

  const preferredModel = localStorage.getItem('cubitt_gemini_model') || (window.CUBITT_CONFIG && window.CUBITT_CONFIG.GEMINI_DEFAULT_MODEL) || 'gemini-3.7-flash';
  // Try preferred model first, then intelligent fallback sequence (3.7 -> 3.8 -> 3.5)
  const allModels = ['gemini-3.7-flash', 'gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'];
  const modelsToTry = [preferredModel, ...allModels.filter(m => m !== preferredModel)];

  let lastError = null;
  let parsed = null;

  for (const model of modelsToTry) {
    try {
      if (statusText) statusText.textContent = `🤖 Consultando Google Gemini Flash (${model})...`;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                { inlineData: { mimeType: mimeType, data: base64Data } }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json'
          }
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errMsg = errorData.error ? errorData.error.message : `HTTP ${response.status}`;
        throw new Error(`Modelo ${model}: ${errMsg}`);
      }

      const jsonRes = await response.json();
      const rawText = jsonRes.candidates && jsonRes.candidates[0] && jsonRes.candidates[0].content && jsonRes.candidates[0].content.parts && jsonRes.candidates[0].content.parts[0].text;
      if (!rawText) throw new Error('No se recibió texto estructurado desde Gemini');

      let cleanJson = rawText.trim();
      if (cleanJson.startsWith('```json')) {
        cleanJson = cleanJson.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleanJson.startsWith('```')) {
        cleanJson = cleanJson.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      parsed = JSON.parse(cleanJson);
      break; // Success!
    } catch (err) {
      console.warn(`Error al consultar Gemini con ${model}:`, err);
      lastError = err;
    }
  }

  if (!parsed) {
    throw lastError || new Error('No se pudo procesar la factura con Gemini Flash');
  }

  // Show raw JSON in inspector box
  const rawBox = document.getElementById('invoiceOcrResultBox');
  const rawEl = document.getElementById('invoiceOcrRawText');
  if (rawBox && rawEl) {
    rawBox.style.display = 'block';
    rawEl.textContent = JSON.stringify(parsed, null, 2);
  }

  return parsed;
}

// Scan with Local In-Browser Tesseract OCR (Fallback Offline)
async function scanInvoiceWithTesseractOCR(dataUrl, statusText) {
  if (typeof Tesseract === 'undefined') {
    throw new Error('El motor OCR local Tesseract se está descargando o no está disponible. Verifica tu conexión a internet.');
  }

  if (statusText) statusText.textContent = '🔍 Iniciando motor OCR local en el navegador...';

  const worker = await Tesseract.createWorker('spa', 1, {
    logger: m => {
      if (m.status === 'recognizing text' && statusText) {
        const pct = Math.round((m.progress || 0) * 100);
        statusText.textContent = `🔍 Leyendo comprobante con OCR: ${pct}%...`;
      }
    }
  });

  const ret = await worker.recognize(dataUrl);
  await worker.terminate();

  const rawText = (ret && ret.data && ret.data.text) || '';
  if (!rawText.trim()) {
    throw new Error('No se detectó texto legible en la imagen adjuntada. Asegúrate de que la foto tenga buena luz y resolución.');
  }

  // Display raw OCR text
  const rawBox = document.getElementById('invoiceOcrResultBox');
  const rawEl = document.getElementById('invoiceOcrRawText');
  if (rawBox && rawEl) {
    rawBox.style.display = 'block';
    rawEl.textContent = rawText;
  }

  if (statusText) statusText.textContent = '📋 Extrayendo RIFs, Factura Nº, Tasa BCV y Razón Social...';
  const parsed = parseInvoiceTextFromOCR(rawText);
  populateScannedInvoiceData(parsed);
}

// Master AI Assistant Controller
async function runAIAssistantOnInvoice(presetData = null) {
  if (!state.currentUploadedInvoicePhoto && !presetData) {
    showToast('Por favor adjunta una foto o selecciona una factura demo para iniciar el escaneo', 'warning');
    return;
  }

  const statusBox = document.getElementById('aiScanStatusBox');
  const statusText = document.getElementById('aiScanStatusText');
  const runBtn = document.getElementById('btnRunAiAssistant');

  // Case 1: An explicit sample demo preset was clicked
  if (presetData) {
    if (statusBox) statusBox.style.display = 'flex';
    if (runBtn) runBtn.disabled = true;
    if (statusText) statusText.textContent = '📋 Cargando datos de la plantilla demo...';
    setTimeout(() => {
      populateScannedInvoiceData(presetData);
      if (runBtn) runBtn.disabled = false;
      if (statusBox) statusBox.style.display = 'none';
      showToast('Factura demo cargada correctamente', 'success');
    }, 700);
    return;
  }

  // Case 2: A REAL PHOTO was uploaded by the user!
  let geminiApiKey = (localStorage.getItem('cubitt_gemini_api_key') || (window.CUBITT_CONFIG && window.CUBITT_CONFIG.GEMINI_API_KEY) || '').trim();

  // If no API key is saved, prompt the user directly and gently guide them
  if (!geminiApiKey) {
    const keyInput = document.getElementById('invoiceGeminiApiKeyInput');
    if (keyInput) {
      keyInput.focus();
      keyInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
      keyInput.style.border = '2px solid #ec4899';
      keyInput.style.boxShadow = '0 0 14px rgba(236, 72, 153, 0.7)';
      setTimeout(() => {
        keyInput.style.border = '1px solid #6366f1';
        keyInput.style.boxShadow = 'none';
      }, 5000);
    }

    const userKey = prompt(
      '🔑 ¡Bienvenido al Asistente Gemini Flash Vision!\n\n' +
      'Para que la Inteligencia Artificial de Google lea tu factura con 100% de precisión y extraiga todos los renglones, totales y tasa BCV, ingresa tu API Key gratuita de Google Gemini:\n\n' +
      '• Puedes obtenerla GRATIS en 30 segundos en:\nhttps://aistudio.google.com/app/apikey\n\n' +
      'Pega tu API Key aquí abajo:'
    );

    if (userKey && userKey.trim()) {
      geminiApiKey = userKey.trim();
      localStorage.setItem('cubitt_gemini_api_key', geminiApiKey);
      if (keyInput) keyInput.value = geminiApiKey;
      updateAiEngineBadge();
      showToast('✅ ¡Clave de Gemini guardada con éxito! Iniciando análisis inteligente...', 'success');
    } else {
      const fallbackToOcr = confirm(
        '⚠️ No ingresaste una API Key de Gemini Flash.\n\n' +
        'El escaneo local básico (Tesseract) puede tener fallas leyendo fotos con sombras o tablas complejas.\n\n' +
        '¿Deseas intentar con el OCR Local básico de todos modos?\n' +
        '(Si presionas Cancelar, podrás pegar tu clave arriba y hacer clic en Guardar Clave).'
      );

      if (!fallbackToOcr) {
        return;
      }

      // User chose to run local OCR
      if (statusBox) statusBox.style.display = 'flex';
      if (runBtn) runBtn.disabled = true;
      try {
        await scanInvoiceWithTesseractOCR(state.currentUploadedInvoicePhoto, statusText);
        showToast('🔍 Factura procesada con OCR Local. Revisa los datos extraídos abajo.', 'info');
      } catch (err) {
        console.error('Tesseract OCR error:', err);
        showToast('Error en OCR Local: ' + (err.message || 'No se pudo leer la imagen'), 'danger');
      } finally {
        if (runBtn) runBtn.disabled = false;
        if (statusBox) statusBox.style.display = 'none';
      }
      return;
    }
  }

  // 2.A: SCAN WITH GEMINI FLASH VISION AI
  if (statusBox) statusBox.style.display = 'flex';
  if (runBtn) runBtn.disabled = true;

  try {
    if (statusText) statusText.textContent = '🤖 Gemini Flash: Leyendo foto, tablas y datos fiscales con IA...';
    const scannedData = await scanInvoiceWithGeminiVision(state.currentUploadedInvoicePhoto, geminiApiKey, statusText);
    populateScannedInvoiceData(scannedData);
    showToast('✨ ¡Factura analizada con éxito por Google Gemini Flash!', 'success');
  } catch (err) {
    console.error('Gemini Flash scan failed:', err);
    showToast('Los servidores de Google Gemini están con alta demanda en este momento. Cambiando a Modo Manual...', 'warning');
    switchInvoiceModalMode('manual');
    const numInput = document.getElementById('invoiceNumberInput');
    if (numInput) numInput.focus();
  } finally {
    if (runBtn) runBtn.disabled = false;
    if (statusBox) statusBox.style.display = 'none';
  }
}

// Confirm and Ingest Invoice & Update Stock & Create CXP
function handleSaveInvoiceAndStock() {
  const invoiceNumber = (document.getElementById('invoiceNumberInput').value || '').trim();
  const supplier = (document.getElementById('invoiceSupplierInput').value || '').trim();
  const rif = (document.getElementById('invoiceSupplierRifInput') ? document.getElementById('invoiceSupplierRifInput').value : '').trim();
  
  // Razón Social de la Compra / Cliente Receptor
  const buyerName = (document.getElementById('invoiceBuyerNameInput') ? document.getElementById('invoiceBuyerNameInput').value : '').trim() || 'JESUS DAVID PALMA GOLLO';
  const buyerRif = (document.getElementById('invoiceBuyerRifInput') ? document.getElementById('invoiceBuyerRifInput').value : '').trim() || 'V-212044993';
  const buyerAddress = (document.getElementById('invoiceBuyerAddressInput') ? document.getElementById('invoiceBuyerAddressInput').value : '').trim();

  const invoiceDate = document.getElementById('invoiceDateInput').value;
  const currency = document.getElementById('invoiceCurrencySelect') ? document.getElementById('invoiceCurrencySelect').value : 'VES';
  const bcvRate = parseFloat(document.getElementById('invoiceBcvRateInput') ? document.getElementById('invoiceBcvRateInput').value : 717.68) || 1;
  const paymentCondition = document.getElementById('invoicePaymentConditionSelect').value;
  const dueDate = document.getElementById('invoiceDueDateInput').value;
  const notes = (document.getElementById('invoiceNotesInput').value || '').trim();

  if (!invoiceNumber) {
    showToast('Por favor ingrese el número de factura', 'danger');
    document.getElementById('invoiceNumberInput').focus();
    return;
  }
  if (!supplier) {
    showToast('Por favor ingrese el nombre del proveedor', 'danger');
    document.getElementById('invoiceSupplierInput').focus();
    return;
  }
  if (!invoiceDate) {
    showToast('Por favor seleccione la fecha de emisión', 'danger');
    return;
  }

  // Collect items
  const tbody = document.getElementById('invoiceItemsTableBody');
  const rows = tbody ? tbody.querySelectorAll('tr') : [];
  if (rows.length === 0) {
    showToast('Debe incluir al menos un renglón de producto recibido', 'danger');
    return;
  }

  const items = [];
  let totalUnits = 0;
  let totalSubtotalBs = 0;
  let totalSubtotalUsd = 0;

  rows.forEach(tr => {
    const rowId = tr.id.replace('invRow_', '');
    const code = document.getElementById(`invRowCode_${rowId}`).value;
    const qty = parseInt(document.getElementById(`invRowQty_${rowId}`).value, 10) || 0;
    const precioBsInput = document.getElementById(`invRowPrecioBs_${rowId}`);
    const costInput = document.getElementById(`invRowCost_${rowId}`);

    const pBs = parseFloat(precioBsInput ? precioBsInput.value : 0) || 0;
    const cost = parseFloat(costInput ? costInput.value : 0) || 0;
    const subtotal = qty * cost;

    if (qty > 0 && code) {
      const prod = (state.products || []).find(p => p.code === code);
      items.push({
        code: code,
        name: prod ? (prod.description || prod.code) : code,
        quantity: qty,
        precioBs: pBs,
        cost: cost,
        subtotal: subtotal
      });
      totalUnits += qty;
      totalSubtotalBs += (qty * pBs);
      totalSubtotalUsd += subtotal;
    }
  });

  if (items.length === 0) {
    showToast('Agregue productos con cantidades válidas mayores a 0', 'danger');
    return;
  }

  // Calculate Discount
  const discountInput = document.getElementById('invoiceDiscountValueInput');
  const discountRawVal = parseFloat(discountInput ? discountInput.value : 0) || 0;
  let discountPercent = 0;
  let discountAmountBs = 0;
  let discountAmountUsd = 0;

  if (currentInvoiceDiscountType === 'percent') {
    discountPercent = Math.min(Math.max(discountRawVal, 0), 100);
    discountAmountBs = totalSubtotalBs * (discountPercent / 100);
    discountAmountUsd = totalSubtotalUsd * (discountPercent / 100);
  } else {
    if (currency === 'VES') {
      discountAmountBs = Math.min(Math.max(discountRawVal, 0), totalSubtotalBs);
      discountPercent = totalSubtotalBs > 0 ? (discountAmountBs / totalSubtotalBs) * 100 : 0;
      discountAmountUsd = bcvRate > 0 ? (discountAmountBs / bcvRate) : 0;
    } else {
      discountAmountUsd = Math.min(Math.max(discountRawVal, 0), totalSubtotalUsd);
      discountPercent = totalSubtotalUsd > 0 ? (discountAmountUsd / totalSubtotalUsd) * 100 : 0;
      discountAmountBs = discountAmountUsd * bcvRate;
    }
  }

  // Base Imponible y Total Factura con IVA
  const baseImponibleBs = Math.max(0, totalSubtotalBs - discountAmountBs);
  const netSubtotalUsd = Math.max(0, totalSubtotalUsd - discountAmountUsd);
  const ivaBs = baseImponibleBs * 0.16;
  const totalBsConIva = baseImponibleBs + ivaBs;
  const totalUsdConIva = bcvRate > 0 ? (totalBsConIva / bcvRate) : (netSubtotalUsd * 1.16);

  // Determinar multiplicador de costo de inventario
  const applyCostCheckbox = document.getElementById('invoiceApplyDiscountToCostCheckbox');
  const applyDiscountToCost = applyCostCheckbox ? applyCostCheckbox.checked : true;
  const discountCostMultiplier = (applyDiscountToCost && totalSubtotalBs > 0) ? (baseImponibleBs / totalSubtotalBs) : 1;

  // 1. Ingest Stock into products (updating cost in USD converted from BCV and discount)
  items.forEach(item => {
    let prod = (state.products || []).find(p => p.code === item.code);
    const unitCostUsd = Number((item.cost * discountCostMultiplier).toFixed(2));
    const unitPriceBs = Number((item.precioBs * discountCostMultiplier).toFixed(2));

    if (!prod) {
      prod = {
        code: item.code,
        description: item.name || item.code,
        category: 'ACCESORIOS',
        costo: unitCostUsd,
        mayor: unitCostUsd,
        pvpTienda: Number((unitCostUsd * 1.35).toFixed(2)),
        pvpActual: Number((unitCostUsd * 1.35).toFixed(2)),
        stock: 0,
        status: 'DISPONIBLE',
        image: 'images/default-product.png'
      };
      state.products.push(prod);
    }
    const oldStock = Number(prod.stock) || 0;
    const newStock = oldStock + item.quantity;
    prod.stock = newStock;
    prod.costo = unitCostUsd;
    prod.mayor = unitCostUsd;
    prod.status = 'DISPONIBLE';

    recordInventoryMovement({
      type: 'ENTRADA_FACTURA',
      productCode: prod.code,
      productName: prod.description || prod.code,
      quantity: item.quantity,
      stockBefore: oldStock,
      stockAfter: newStock,
      reference: `Factura #${invoiceNumber} (${supplier})`,
      notes: currency === 'VES'
        ? (discountPercent > 0
            ? `Precio Lista: Bs. ${item.precioBs.toFixed(2)} (-${discountPercent.toFixed(1)}% Desc = Bs. ${unitPriceBs.toFixed(2)}) @ Tasa BCV ${bcvRate} Bs/$ -> Costo Neto USD: $${unitCostUsd.toFixed(2)}`
            : `Precio Bs. ${item.precioBs.toFixed(2)} @ Tasa BCV ${bcvRate} Bs/$ -> Costo USD: $${unitCostUsd.toFixed(2)}`)
        : `Costo unitario directo: $${unitCostUsd.toFixed(2)}`
    });
  });
  saveProductsToStorage();

  // 2. Generate Accounts Payable (CXP) if condition is 'credito'
  if (paymentCondition === 'credito') {
    const cxpId = `CXP-INV-${invoiceNumber}`;
    const existingIdx = (state.payables || []).findIndex(p => p.id === cxpId);
    const payableRecord = {
      id: cxpId,
      saleId: `FACT-${invoiceNumber}`,
      saleDate: invoiceDate,
      concept: `Factura Proveedor #${invoiceNumber} (${supplier}) • Total a Pagar con IVA: Bs. ${totalBsConIva.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ($${totalUsdConIva.toFixed(2)} @ Tasa BCV ${bcvRate} Bs/$)`,
      beneficiary: supplier,
      type: '$',
      rate: totalUsdConIva,
      amount: totalUsdConIva,
      status: 'PENDIENTE',
      category: 'PROVEEDOR',
      notes: `Vencimiento: ${dueDate || 'N/A'}. Razón Social Compra: ${buyerName} (RIF: ${buyerRif || 'N/A'}). ${discountPercent > 0 ? `Descuento en factura: ${discountPercent.toFixed(2)}% (-Bs. ${discountAmountBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}). ` : ''}Base Imponible: Bs. ${baseImponibleBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}, IVA: Bs. ${ivaBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}.`,
      createdAt: new Date().toISOString()
    };

    if (existingIdx >= 0) {
      state.payables[existingIdx] = payableRecord;
    } else {
      state.payables.unshift(payableRecord);
    }
    savePayablesToStorage();
  }

  // 3. Save Invoice Record
  const invoiceRecord = {
    id: 'INV-' + Date.now(),
    numeroFactura: invoiceNumber,
    proveedor: supplier,
    rif: rif,
    razonSocialCompra: buyerName,
    rifCompra: buyerRif,
    dirCompra: buyerAddress,
    fecha: invoiceDate,
    currency: currency,
    bcvRate: bcvRate,
    subtotalBrutoBs: totalSubtotalBs,
    descuentoTipo: currentInvoiceDiscountType,
    descuentoValor: discountRawVal,
    descuentoPorcentaje: discountPercent,
    descuentoMontoBs: discountAmountBs,
    descuentoMontoUsd: discountAmountUsd,
    baseImponibleBs: baseImponibleBs,
    ivaBs: ivaBs,
    totalBs: totalBsConIva,
    condicionPago: paymentCondition,
    fechaVencimiento: paymentCondition === 'credito' ? dueDate : null,
    notas: notes,
    items: items,
    totalUnits: totalUnits,
    totalCostUsd: netSubtotalUsd,
    totalMonto: totalUsdConIva,
    descuentoAplicadoACosto: applyDiscountToCost,
    photoUrl: state.currentUploadedInvoicePhoto || generateInvoicePlaceholderSVG(supplier, invoiceNumber, totalUsdConIva.toFixed(2)),
    createdAt: new Date().toISOString(),
    createdBy: (state.currentUser && (state.currentUser.fullName || state.currentUser.username)) || 'Administrador'
  };

  state.invoices.unshift(invoiceRecord);
  saveInvoicesToStorage();

  closeInvoiceUploadModal();
  renderInventoryTab();
  renderCatalog();
  renderPayables();
  renderTopStats();

  showToast(`✅ Factura #${invoiceNumber} registrada: ${totalUnits} unidades ingresadas al stock en base a Tasa BCV (${bcvRate} Bs/$).`, 'success');
}

// Export Inventory Stock to CSV
function exportInventoryToCSV() {
  const products = state.products || [];
  if (products.length === 0) {
    showToast('No hay productos en el inventario para exportar', 'info');
    return;
  }

  const headers = ['Código', 'Descripción', 'Categoría', 'Costo Unit ($)', 'PVP Tienda ($)', 'Margen ($)', 'Stock Físico', 'Valor Total Stock ($)', 'Estado'];
  const rows = products.map(p => {
    const stock = Number(p.stock) || 0;
    const cost = Number(p.costo || p.mayor || 0);
    const pvp = Number(p.pvp || 0);
    const margin = pvp - cost;
    const totalVal = stock * cost;

    return [
      `"${(p.code || '').replace(/"/g, '""')}"`,
      `"${(p.description || '').replace(/"/g, '""')}"`,
      `"${(p.category || '').replace(/"/g, '""')}"`,
      cost.toFixed(2),
      pvp.toFixed(2),
      margin.toFixed(2),
      stock,
      totalVal.toFixed(2),
      stock > 0 ? 'DISPONIBLE' : 'AGOTADO'
    ];
  });

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStr = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `cubitt_inventario_stock_${dateStr}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Inventario de existencias descargado en CSV', 'success');
}




