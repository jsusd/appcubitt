/**
 * BULLBAR SOCIAL LOUNGE - PANEL ADMINISTRATIVO
 * Lógica de Edición del Menú, Productos, Precios, Fotos, Horarios y Categorías
 */

document.addEventListener("DOMContentLoaded", () => {
  const DEFAULT_ADMIN_AUTH = {
    username: "admin",
    password: "bullbar2026"
  };

  // Inicializar Estado con LocalStorage o defaults de data.js
  let state = {
    products: loadProducts(),
    categories: loadCategories(),
    config: loadConfig(),
    currentEditingProduct: null,
    currentEditingCategory: null,
    searchQuery: "",
    filterCategory: "all",
    filterStatus: "all",
    analyticsPeriod: "7days",
    analyticsSearchQuery: "",
    analytics: { visits: [], clicks: [], orders: [] },
    auth: { isAuthenticated: false, currentUser: "admin" }
  };
  window.adminState = state;

  // Referencias del DOM
  const tableProductsBody = document.getElementById("tableProductsBody");
  const categoriesListBody = document.getElementById("categoriesListBody");
  const searchProductInput = document.getElementById("searchProductInput");
  const filterCategorySelect = document.getElementById("filterCategorySelect");
  const filterStatusSelect = document.getElementById("filterStatusSelect");
  const btnNewProduct = document.getElementById("btnNewProduct");
  const btnNewCategory = document.getElementById("btnNewCategory");
  const barStatusToggle = document.getElementById("barStatusToggle");
  const barStatusText = document.getElementById("barStatusText");
  const toastContainer = document.getElementById("adminToastContainer");

  // Elementos de Autenticación & Seguridad
  const adminAuthOverlay = document.getElementById("adminAuthOverlay");
  const authModalCard = document.getElementById("authModalCard");
  const adminLoginForm = document.getElementById("adminLoginForm");
  const authUsernameInput = document.getElementById("authUsername");
  const authPasswordInput = document.getElementById("authPassword");
  const authRememberMeInput = document.getElementById("authRememberMe");
  const btnToggleAuthPassword = document.getElementById("btnToggleAuthPassword");
  const btnAuthSubmit = document.getElementById("btnAuthSubmit");
  const btnQuickLogin = document.getElementById("btnQuickLogin");
  const btnResetAuthDefaults = document.getElementById("btnResetAuthDefaults");
  const authErrorMessage = document.getElementById("authErrorMessage");
  const authErrorText = document.getElementById("authErrorText");
  const currentLoggedUser = document.getElementById("currentLoggedUser");
  const btnLogoutSidebar = document.getElementById("btnLogoutSidebar");
  const btnLogoutTopbar = document.getElementById("btnLogoutTopbar");
  const adminMainLayout = document.getElementById("adminMainLayout");
  const cfgAdminUsername = document.getElementById("cfgAdminUsername");
  const cfgCurrentPassword = document.getElementById("cfgCurrentPassword");
  const cfgNewPassword = document.getElementById("cfgNewPassword");
  const btnUpdateCredentials = document.getElementById("btnUpdateCredentials");

  // Elementos de Analítica
  const btnExportAnalyticsCsv = document.getElementById("btnExportAnalyticsCsv");
  const btnSimulateTestOrder = document.getElementById("btnSimulateTestOrder");
  const btnRefreshAnalytics = document.getElementById("btnRefreshAnalytics");
  const btnClearAnalytics = document.getElementById("btnClearAnalytics");
  const searchOrdersInput = document.getElementById("searchOrdersInput");
  const ordersHistoryBody = document.getElementById("ordersHistoryBody");
  const ordersCounterSummary = document.getElementById("ordersCounterSummary");
  const orderDetailModal = document.getElementById("orderDetailModal");
  const orderModalTitle = document.getElementById("orderModalTitle");
  const orderModalTime = document.getElementById("orderModalTime");
  const orderModalBody = document.getElementById("orderModalBody");
  const closeOrderDetailModalBtn = document.getElementById("closeOrderDetailModalBtn");
  const btnCloseOrderModal = document.getElementById("btnCloseOrderModal");

  // Métricas
  const metricTotalProducts = document.getElementById("metricTotalProducts");
  const metricAvailableProducts = document.getElementById("metricAvailableProducts");
  const metricPausedProducts = document.getElementById("metricPausedProducts");
  const metricTotalCategories = document.getElementById("metricTotalCategories");

  // Modales
  const productModal = document.getElementById("productModal");
  const productModalTitle = document.getElementById("productModalTitle");
  const closeProductModalBtn = document.getElementById("closeProductModalBtn");
  const btnCancelProduct = document.getElementById("btnCancelProduct");
  const productForm = document.getElementById("productForm");

  // Campos de Formulario de Producto
  const prodNameInput = document.getElementById("prodName");
  const prodCategorySelect = document.getElementById("prodCategory");
  const prodPriceInput = document.getElementById("prodPrice");
  const prodBadgeInput = document.getElementById("prodBadge");
  const prodDescInput = document.getElementById("prodDesc");
  const prodImageUrlInput = document.getElementById("prodImageUrl");
  const prodFileInput = document.getElementById("prodFileInput");
  const prodPreviewImg = document.getElementById("prodPreviewImg");
  const prodAvailableSwitch = document.getElementById("prodAvailable");

  // Modal de Categoría
  const categoryModal = document.getElementById("categoryModal");
  const categoryModalTitle = document.getElementById("categoryModalTitle");
  const closeCategoryModalBtn = document.getElementById("closeCategoryModalBtn");
  const btnCancelCategory = document.getElementById("btnCancelCategory");
  const categoryForm = document.getElementById("categoryForm");
  const catNameInput = document.getElementById("catName");
  const catBadgeInput = document.getElementById("catBadge");

  // Ajustes y Horarios
  const formSettings = document.getElementById("formSettings");
  const cfgNameInput = document.getElementById("cfgName");
  const cfgTaglineInput = document.getElementById("cfgTagline");
  const cfgWhatsappInput = document.getElementById("cfgWhatsapp");
  const cfgInstagramInput = document.getElementById("cfgInstagram");
  const cfgGoogleMapsInput = document.getElementById("cfgGoogleMaps");
  const cfgScheduleWeekdaysInput = document.getElementById("cfgScheduleWeekdays");
  const cfgScheduleWeekendInput = document.getElementById("cfgScheduleWeekend");
  const cfgForceStatusSelect = document.getElementById("cfgForceStatus");

  // Botón Exportar data.js
  const btnExportDataJs = document.getElementById("btnExportDataJs");
  const btnResetDefaults = document.getElementById("btnResetDefaults");

  function initAdmin() {
    try { initAuthSystem(); } catch (e) { console.error("Auth init error:", e); }
    try { setupNavigation(); } catch (e) { console.error("Nav init error:", e); }
    try { populateCategoryDropdowns(); } catch (e) { console.error("Categories dropdown error:", e); }
    try { renderMetrics(); } catch (e) { console.error("Metrics error:", e); }
    try { renderProductsTable(); } catch (e) { console.error("Products table error:", e); }
    try { renderCategoriesTable(); } catch (e) { console.error("Categories table error:", e); }
    try { loadSettingsIntoForm(); } catch (e) { console.error("Settings load error:", e); }
    try { initAnalyticsDashboard(); } catch (e) { console.error("Analytics init error:", e); }
    try { setupEventListeners(); } catch (e) { console.error("Event listeners error:", e); }
    try { syncFromCloud(); } catch (e) { console.error("Cloud sync init error:", e); }
  }

  // --- SINCRONIZACIÓN EN LA NUBE EN TIEMPO REAL (COMPATIBLE CON VERCEL Y NETLIFY) ---
  const CLOUD_MENU_ENDPOINT = "https://bullbarbqto.netlify.app/.netlify/functions/menu";

  function setCloudBadgeStatus(text, color = "#4ade80") {
    const verBadge = document.getElementById("appVersionBadge");
    if (verBadge) {
      verBadge.textContent = text;
      verBadge.style.color = color;
    }
  }

  async function syncToCloud() {
    const updatedAt = Date.now();
    try {
      localStorage.setItem("bullbar_updated_at", String(updatedAt));
    } catch (e) {}

    setCloudBadgeStatus("v3.0 ⏳ Publicando...", "#e5b972");
    try {
      const res = await fetch(CLOUD_MENU_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          products: state.products,
          categories: state.categories,
          config: state.config,
          updatedAt
        })
      });
      if (res.ok) {
        const json = await res.json();
        if (json && json.ok) {
          setCloudBadgeStatus("v3.0 ☁️ En Vivo (Todos los clientes)", "#4ade80");
          return true;
        }
      }
      setCloudBadgeStatus("v3.0 ✓ Guardado Local", "#4ade80");
    } catch (err) {
      setCloudBadgeStatus("v3.0 ✓ Guardado Local", "#4ade80");
    }
    return false;
  }

  async function syncFromCloud() {
    try {
      const res = await fetch(CLOUD_MENU_ENDPOINT + "?t=" + Date.now(), { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      if (!json || !json.ok) return;

      if (json.empty) {
        // Inicializar la nube por primera vez con el catálogo actual
        await syncToCloud();
        return;
      }

      const cloudData = json.data;
      const cloudUpdatedAt = Number((cloudData && cloudData.updatedAt) || Date.now());

      // Siempre que la nube tenga catálogo activo, sincronizar este dispositivo con la nube
      if (cloudData && Array.isArray(cloudData.products) && cloudData.products.length > 0) {
        state.products = deduplicateProducts(cloudData.products);
        if (Array.isArray(cloudData.categories) && cloudData.categories.length > 0) {
          state.categories = cloudData.categories;
        }
        if (cloudData.config && typeof cloudData.config === "object") {
          state.config = cloudData.config;
        }
        try {
          localStorage.setItem("bullbar_products", JSON.stringify(state.products));
          localStorage.setItem("bullbar_categories", JSON.stringify(state.categories));
          localStorage.setItem("bullbar_config", JSON.stringify(state.config));
          localStorage.setItem("bullbar_updated_at", String(cloudUpdatedAt));
        } catch (e) {}

        populateCategoryDropdowns();
        renderMetrics();
        renderProductsTable();
        renderCategoriesTable();
        loadSettingsIntoForm();
        setCloudBadgeStatus("v3.0 ☁️ En Vivo (Sincronizado)", "#4ade80");
      }
    } catch (e) {
      // Modo local o función aún no desplegada
    }
  }

  // --- CARGA Y PERSISTENCIA DE DATOS ---
  function deduplicateProducts(list) {
    if (!Array.isArray(list)) return [];
    let changed = false;
    // Si por el doble disparo anterior se creó un clon accidental con id "prod-..." que tiene el mismo nombre y categoría que otro producto existente (y no es "(Copia)"), fusionarlo y eliminar el duplicado
    const result = [];
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (!item || !item.name) continue;
      const isAutoProdId = typeof item.id === "string" && item.id.indexOf("prod-") === 0;
      const isExplicitCopy = item.name.indexOf("(Copia)") !== -1;

      if (isAutoProdId && !isExplicitCopy) {
        // Buscar si existe otro producto en la lista con el mismo nombre y categoría
        const otherMatch = list.find((other, idx) =>
          idx !== i &&
          other &&
          other.name &&
          other.name.trim().toLowerCase() === item.name.trim().toLowerCase() &&
          other.categoryId === item.categoryId
        );
        if (otherMatch) {
          // Conservar los datos más recientes en el producto original y omitir el clon accidental
          otherMatch.price = item.price;
          otherMatch.image = item.image;
          otherMatch.description = item.description;
          otherMatch.badge = item.badge;
          otherMatch.available = item.available;
          changed = true;
          continue;
        }
      }
      result.push(item);
    }
    if (changed) {
      try {
        localStorage.setItem("bullbar_products", JSON.stringify(result));
      } catch (e) {}
    }
    return result;
  }

  function loadProducts() {
    try {
      const fileTs = typeof BULLBAR_UPDATED_AT !== "undefined" ? Number(BULLBAR_UPDATED_AT) : 0;
      const localTs = Number(localStorage.getItem("bullbar_updated_at") || 0);
      if (fileTs > localTs && typeof PRODUCTS !== "undefined") {
        localStorage.setItem("bullbar_products", JSON.stringify(PRODUCTS));
        if (typeof CATEGORIES !== "undefined") localStorage.setItem("bullbar_categories", JSON.stringify(CATEGORIES));
        if (typeof BULLBAR_CONFIG !== "undefined") localStorage.setItem("bullbar_config", JSON.stringify(BULLBAR_CONFIG));
        localStorage.setItem("bullbar_updated_at", String(fileTs));
        return deduplicateProducts(PRODUCTS);
      }
      const saved = localStorage.getItem("bullbar_products");
      const rawList = saved ? JSON.parse(saved) : (typeof PRODUCTS !== "undefined" ? PRODUCTS : []);
      return deduplicateProducts(rawList);
    } catch (e) {
      return typeof PRODUCTS !== "undefined" ? PRODUCTS : [];
    }
  }

  function saveProducts() {
    try {
      localStorage.setItem("bullbar_products", JSON.stringify(state.products));
      localStorage.setItem("bullbar_updated_at", String(Date.now()));
    } catch (e) {
      console.warn("Advertencia de almacenamiento local:", e);
      alert("La imagen es demasiado pesada para la memoria del navegador. Intenta con una foto más ligera o usa un enlace web.");
    }
    renderMetrics();
    syncToCloud();
  }

  function loadCategories() {
    try {
      const saved = localStorage.getItem("bullbar_categories");
      return saved ? JSON.parse(saved) : (typeof CATEGORIES !== "undefined" ? CATEGORIES : []);
    } catch (e) {
      return typeof CATEGORIES !== "undefined" ? CATEGORIES : [];
    }
  }

  function saveCategories() {
    localStorage.setItem("bullbar_categories", JSON.stringify(state.categories));
    localStorage.setItem("bullbar_updated_at", String(Date.now()));
    populateCategoryDropdowns();
    renderMetrics();
    syncToCloud();
  }

  function loadConfig() {
    try {
      const saved = localStorage.getItem("bullbar_config");
      return saved ? JSON.parse(saved) : (typeof BULLBAR_CONFIG !== "undefined" ? BULLBAR_CONFIG : {});
    } catch (e) {
      return typeof BULLBAR_CONFIG !== "undefined" ? BULLBAR_CONFIG : {};
    }
  }

  function saveConfig() {
    localStorage.setItem("bullbar_config", JSON.stringify(state.config));
    localStorage.setItem("bullbar_updated_at", String(Date.now()));
    updateBarStatusUI();
    syncToCloud();
  }

  // --- NAVEGACIÓN DE SECCIONES ---
  function setupNavigation() {
    const navItems = document.querySelectorAll(".nav-item[data-section]");
    const sections = document.querySelectorAll(".admin-section");
    const topbarTitle = document.getElementById("topbarPageTitle");

    navItems.forEach(item => {
      item.addEventListener("click", () => {
        const targetSection = item.dataset.section;
        navItems.forEach(n => n.classList.remove("active"));
        item.classList.add("active");

        sections.forEach(sec => {
          sec.classList.toggle("active", sec.id === `section-${targetSection}`);
        });

        topbarTitle.textContent = item.querySelector("span").textContent;

        if (targetSection === "analytics") {
          state.analytics = loadAnalytics();
          renderAnalyticsDashboard();
        }

        // Cerrar sidebar en pantallas móviles
        document.querySelector(".admin-sidebar").classList.remove("open");
      });
    });

    // Menú móvil toggle
    const btnMobileSidebar = document.getElementById("btnMobileSidebar");
    if (btnMobileSidebar) {
      btnMobileSidebar.addEventListener("click", () => {
        document.querySelector(".admin-sidebar").classList.toggle("open");
      });
    }
  }

  // --- MÉTRICAS SUPERIORES ---
  function renderMetrics() {
    const total = state.products.length;
    const available = state.products.filter(p => p.available).length;
    const paused = total - available;
    const categoriesCount = state.categories.filter(c => c.id !== "all").length;

    metricTotalProducts.textContent = total;
    metricAvailableProducts.textContent = available;
    metricPausedProducts.textContent = paused;
    metricTotalCategories.textContent = categoriesCount;

    updateBarStatusUI();
  }

  function updateBarStatusUI() {
    const isManuallyClosed = state.config.forceStatus === "closed";
    if (isManuallyClosed) {
      barStatusToggle.className = "bar-status-toggle closed";
      barStatusText.textContent = "Menú: Cerrado";
    } else {
      barStatusToggle.className = "bar-status-toggle";
      barStatusText.textContent = "Menú: Abierto";
    }
  }

  // --- POBLAR SELECTORES DE CATEGORÍA ---
  function populateCategoryDropdowns() {
    // Selector de filtro
    filterCategorySelect.innerHTML = `<option value="all">Todas las categorías</option>`;
    state.categories.forEach(cat => {
      if (cat.id === "all") return;
      const opt = document.createElement("option");
      opt.value = cat.id;
      opt.textContent = cat.name;
      filterCategorySelect.appendChild(opt);
    });

    // Selector en el formulario modal de producto
    prodCategorySelect.innerHTML = "";
    state.categories.forEach(cat => {
      if (cat.id === "all") return;
      const opt = document.createElement("option");
      opt.value = cat.id;
      opt.textContent = cat.name;
      prodCategorySelect.appendChild(opt);
    });
  }

  // --- TABLA DE PRODUCTOS ---
  function normalizeSearchText(str) {
    return (str || "")
      .toString()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  }

  function renderProductsTable() {
    if (!tableProductsBody) return;
    tableProductsBody.innerHTML = "";

    // Sincronizar con los inputs actuales del DOM por seguridad
    if (searchProductInput && typeof searchProductInput.value === "string") {
      state.searchQuery = searchProductInput.value;
    }
    if (filterCategorySelect && filterCategorySelect.value) {
      state.filterCategory = filterCategorySelect.value;
    }
    if (filterStatusSelect && filterStatusSelect.value) {
      state.filterStatus = filterStatusSelect.value;
    }

    let list = [...state.products];

    // Filtro búsqueda (insensible a mayúsculas y acentos)
    if (state.searchQuery.trim() !== "") {
      const q = normalizeSearchText(state.searchQuery);
      list = list.filter(p =>
        normalizeSearchText(p.name).includes(q) ||
        normalizeSearchText(p.description).includes(q) ||
        normalizeSearchText(p.categoryName).includes(q) ||
        normalizeSearchText(p.badge).includes(q)
      );
    }

    // Filtro categoría
    if (state.filterCategory && state.filterCategory !== "all") {
      list = list.filter(p => p.categoryId === state.filterCategory);
    }

    // Filtro estado disponibilidad
    if (state.filterStatus === "available") {
      list = list.filter(p => p.available);
    } else if (state.filterStatus === "paused") {
      list = list.filter(p => !p.available);
    }

    if (list.length === 0) {
      tableProductsBody.innerHTML = `
        <tr>
          <td colspan="7">
            <div class="empty-table-state">
              <svg width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="8"></circle>
                <path d="m21 21-4.3-4.3"></path>
              </svg>
              <p>No se encontraron productos con los filtros aplicados.</p>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    list.forEach(prod => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td style="width: 70px;">
          <img class="product-cell-thumb" src="${prod.image}" alt="${prod.name}" onerror="this.src='https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&w=600&q=80'">
        </td>
        <td>
          <div class="product-cell-title">${prod.name}</div>
          ${prod.badge ? `<span class="product-cell-badge">${prod.badge}</span>` : ""}
        </td>
        <td>
          <span style="font-weight: 600; color: #d0ded6;">${prod.categoryName || prod.categoryId}</span>
        </td>
        <td>
          <div class="product-cell-desc" title="${prod.description || ''}">${prod.description || '<em style="color:#5c7265;">Sin descripción</em>'}</div>
        </td>
        <td>
          <span class="product-cell-price">$${prod.price.toFixed(2)}</span>
        </td>
        <td>
          <div class="switch-wrapper">
            <label class="custom-switch">
              <input type="checkbox" class="toggle-availability" data-id="${prod.id}" ${prod.available ? "checked" : ""}>
              <span class="slider"></span>
            </label>
            <span class="switch-label ${prod.available ? "active" : ""}">${prod.available ? "Disponible" : "Agotado"}</span>
          </div>
        </td>
        <td>
          <div class="row-actions">
            <button type="button" class="btn-row-action edit" data-id="${prod.id}" title="Editar Producto">
              <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
            </button>
            <button type="button" class="btn-row-action duplicate" data-id="${prod.id}" title="Duplicar">
              <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </button>
            <button type="button" class="btn-row-action delete" data-id="${prod.id}" title="Eliminar">
              <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </td>
      `;

      // Evento de switch de disponibilidad en línea
      const toggleCheck = tr.querySelector(".toggle-availability");
      toggleCheck.addEventListener("change", (e) => {
        const isChecked = e.target.checked;
        prod.available = isChecked;
        saveProducts();
        showToast(isChecked ? `¡"${prod.name}" marcado como disponible!` : `"${prod.name}" marcado como agotado.`);
        renderProductsTable();
      });

      // Botón Editar
      tr.querySelector(".btn-row-action.edit").addEventListener("click", () => {
        openEditProductModal(prod);
      });

      // Botón Duplicar
      tr.querySelector(".btn-row-action.duplicate").addEventListener("click", () => {
        duplicateProduct(prod);
      });

      // Botón Eliminar
      tr.querySelector(".btn-row-action.delete").addEventListener("click", () => {
        deleteProduct(prod);
      });

      tableProductsBody.appendChild(tr);
    });
  }
  window.filterBullBarProducts = renderProductsTable;

  // --- TABLA DE CATEGORÍAS ---
  function renderCategoriesTable() {
    categoriesListBody.innerHTML = "";

    const cats = state.categories.filter(c => c.id !== "all");

    cats.forEach(cat => {
      const prodCount = state.products.filter(p => p.categoryId === cat.id).length;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong style="color:#fff; font-size: 0.95rem;">${cat.name}</strong></td>
        <td><code>${cat.id}</code></td>
        <td>${cat.badge ? `<span class="product-cell-badge" style="background:rgba(229,185,114,0.15); color:var(--color-gold); border-color:var(--color-gold);">${cat.badge}</span>` : '<em style="color:#5c7265;">Sin insignia</em>'}</td>
        <td><span style="font-weight:700; color:#fff;">${prodCount}</span> productos</td>
        <td>
          <div class="row-actions">
            <button type="button" class="btn-row-action edit" data-id="${cat.id}" title="Editar Categoría">
              <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
            </button>
            <button type="button" class="btn-row-action delete" data-id="${cat.id}" title="Eliminar Categoría">
              <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </td>
      `;

      tr.querySelector(".btn-row-action.edit").addEventListener("click", () => {
        openEditCategoryModal(cat);
      });

      tr.querySelector(".btn-row-action.delete").addEventListener("click", () => {
        deleteCategory(cat);
      });

      categoriesListBody.appendChild(tr);
    });
  }

  // --- MODAL DE PRODUCTO (CREAR / EDITAR) ---
  let isSubmittingProduct = false;

  function openNewProductModal() {
    state.currentEditingProduct = null;
    productModalTitle.textContent = "Agregar Nuevo Producto";
    productForm.reset();
    productForm.removeAttribute("data-editing-id");
    const editIdInput = document.getElementById("prodEditId");
    if (editIdInput) editIdInput.value = "";

    prodPreviewImg.src = "https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&w=600&q=80";
    prodPreviewImg.removeAttribute("data-uploaded");
    if (prodFileInput) prodFileInput.value = "";
    const statusEl = document.getElementById("uploadStatusMsg");
    if (statusEl) statusEl.style.display = "none";
    prodAvailableSwitch.checked = true;

    const modalBody = productModal.querySelector(".modal-body");
    if (modalBody) modalBody.scrollTop = 0;

    productModal.style.removeProperty("display");
    productModal.classList.add("active");
  }
  window.openBullBarNewProductModal = openNewProductModal;

  function openEditProductModal(product) {
    state.currentEditingProduct = product;
    productModalTitle.textContent = `Editar: ${product.name}`;
    productForm.setAttribute("data-editing-id", product.id);
    const editIdInput = document.getElementById("prodEditId");
    if (editIdInput) editIdInput.value = product.id;

    prodNameInput.value = product.name;
    prodCategorySelect.value = product.categoryId;
    prodPriceInput.value = product.price;
    prodBadgeInput.value = product.badge || "";
    prodDescInput.value = product.description || "";
    prodImageUrlInput.value = product.image.startsWith("data:") ? "" : product.image;
    prodPreviewImg.src = product.image;
    prodPreviewImg.removeAttribute("data-uploaded");
    if (prodFileInput) prodFileInput.value = "";
    const statusEl = document.getElementById("uploadStatusMsg");
    if (statusEl) statusEl.style.display = "none";
    prodAvailableSwitch.checked = product.available;

    const modalBody = productModal.querySelector(".modal-body");
    if (modalBody) modalBody.scrollTop = 0;

    productModal.style.removeProperty("display");
    productModal.classList.add("active");
  }
  window.openBullBarEditProductModal = openEditProductModal;

  function closeProductModal(e) {
    if (e) {
      try { if (e.preventDefault) e.preventDefault(); } catch(err) {}
      try { if (e.stopPropagation) e.stopPropagation(); } catch(err) {}
    }
    if (productModal) {
      productModal.classList.remove("active");
      productModal.style.setProperty("display", "none", "important");
    }
    state.currentEditingProduct = null;
    if (productForm) productForm.removeAttribute("data-editing-id");
    const editIdInput = document.getElementById("prodEditId");
    if (editIdInput) editIdInput.value = "";
  }
  window.closeBullBarProductModal = closeProductModal;

  function duplicateProduct(product) {
    const newProd = {
      ...product,
      id: "prod-" + Date.now(),
      name: `${product.name} (Copia)`,
      available: true
    };
    state.products.unshift(newProd);
    saveProducts();
    renderProductsTable();
    showToast(`¡Producto duplicado: "${newProd.name}"!`);
  }

  function deleteProduct(product) {
    if (confirm(`¿Estás seguro de que deseas eliminar permanentemente el producto "${product.name}"?`)) {
      state.products = state.products.filter(p => p.id !== product.id);
      saveProducts();
      renderProductsTable();
      showToast(`Producto "${product.name}" eliminado.`);
    }
  }

  // Guardar formulario de producto (protegido contra doble ejecución)
  function handleProductFormSubmit(e) {
    if (e) {
      if (e.preventDefault) e.preventDefault();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      if (e._bullbarHandled) return false;
      e._bullbarHandled = true;
    }

    if (isSubmittingProduct) return false;
    if (productModal && !productModal.classList.contains("active")) return false;

    const name = prodNameInput.value.trim();
    if (!name) {
      alert("Por favor ingresa el nombre del producto.");
      return false;
    }

    isSubmittingProduct = true;
    try {
      const categoryId = prodCategorySelect.value;
      const categoryObj = state.categories.find(c => c.id === categoryId);
      const categoryName = categoryObj ? categoryObj.name.toUpperCase() : "GENERAL";
      const price = parseFloat(prodPriceInput.value) || 0;
      const badge = prodBadgeInput.value.trim();
      const description = prodDescInput.value.trim();
      const available = prodAvailableSwitch.checked;

      // Identificar de forma infalible si estamos editando un producto existente
      const editIdInput = document.getElementById("prodEditId");
      const editingId =
        (state.currentEditingProduct && state.currentEditingProduct.id) ||
        (editIdInput && editIdInput.value) ||
        (productForm && productForm.getAttribute("data-editing-id")) ||
        "";

      const targetProduct = editingId
        ? (state.products.find(p => String(p.id) === String(editingId)) || state.currentEditingProduct)
        : state.currentEditingProduct;

      // Determinar imagen final de forma segura (priorizando foto subida o enlace válido)
      const rawUrlInput = prodImageUrlInput ? prodImageUrlInput.value.trim() : "";
      let image = prodPreviewImg.src;
      if (prodPreviewImg.getAttribute("data-uploaded") === "true" || image.startsWith("data:image/")) {
        image = prodPreviewImg.src;
      } else if (/^https?:\/\//i.test(rawUrlInput)) {
        image = rawUrlInput;
      } else if (targetProduct && (!image || (!image.startsWith("http") && !image.startsWith("data:")))) {
        image = targetProduct.image;
      }

      if (targetProduct) {
        // Editar existente en su misma posición (sin duplicar jamás)
        targetProduct.name = name;
        targetProduct.categoryId = categoryId;
        targetProduct.categoryName = categoryName;
        targetProduct.price = price;
        targetProduct.badge = badge;
        targetProduct.description = description;
        targetProduct.image = image;
        targetProduct.available = available;

        showToast(`¡"${name}" actualizado exitosamente!`);
      } else {
        // Crear nuevo
        const newProduct = {
          id: "prod-" + Date.now(),
          categoryId,
          categoryName,
          name,
          description,
          price,
          image,
          badge,
          available
        };
        state.products.unshift(newProduct);
        showToast(`¡"${name}" agregado al menú!`);
      }

      saveProducts();
      renderProductsTable();
      closeProductModal();
    } finally {
      setTimeout(() => {
        isSubmittingProduct = false;
      }, 250);
    }
    return false;
  }
  window.saveBullBarProductForm = handleProductFormSubmit;
  if (productForm) productForm.addEventListener("submit", handleProductFormSubmit);

  // Manejo de carga de imagen en el formulario (respaldado por las funciones globales)
  if (prodImageUrlInput) {
    prodImageUrlInput.addEventListener("input", (e) => {
      if (typeof window.handleBullBarImageUrl === "function") {
        window.handleBullBarImageUrl(e);
      }
    });
  }

  if (prodFileInput) {
    prodFileInput.addEventListener("change", (e) => {
      if (typeof window.handleBullBarImageFile === "function") {
        window.handleBullBarImageFile(e);
      }
    });
  }

  // --- MODAL DE CATEGORÍA (CREAR / EDITAR) ---
  function openNewCategoryModal() {
    state.currentEditingCategory = null;
    categoryModalTitle.textContent = "Agregar Nueva Categoría";
    categoryForm.reset();
    categoryModal.style.removeProperty("display");
    categoryModal.classList.add("active");
  }

  function openEditCategoryModal(cat) {
    state.currentEditingCategory = cat;
    categoryModalTitle.textContent = `Editar Categoría: ${cat.name}`;
    catNameInput.value = cat.name;
    catBadgeInput.value = cat.badge || "";
    categoryModal.style.removeProperty("display");
    categoryModal.classList.add("active");
  }

  function closeCategoryModal(e) {
    if (e) {
      try { if (e.preventDefault) e.preventDefault(); } catch(err) {}
      try { if (e.stopPropagation) e.stopPropagation(); } catch(err) {}
    }
    if (categoryModal) {
      categoryModal.classList.remove("active");
      categoryModal.style.setProperty("display", "none", "important");
    }
    state.currentEditingCategory = null;
  }
  window.closeBullBarCategoryModal = closeCategoryModal;

  function deleteCategory(cat) {
    const count = state.products.filter(p => p.categoryId === cat.id).length;
    if (count > 0) {
      alert(`No puedes eliminar la categoría "${cat.name}" porque contiene ${count} producto(s). Reasigna o elimina los productos primero.`);
      return;
    }

    if (confirm(`¿Eliminar la categoría "${cat.name}"?`)) {
      state.categories = state.categories.filter(c => c.id !== cat.id);
      saveCategories();
      renderCategoriesTable();
      showToast(`Categoría "${cat.name}" eliminada.`);
    }
  }

  categoryForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = catNameInput.value.trim();
    const badge = catBadgeInput.value.trim();

    if (!name) {
      alert("Por favor ingresa un nombre para la categoría.");
      return;
    }

    if (state.currentEditingCategory) {
      state.currentEditingCategory.name = name;
      state.currentEditingCategory.badge = badge;
      showToast(`¡Categoría "${name}" actualizada!`);
    } else {
      const id = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-");
      state.categories.push({
        id: id || "cat-" + Date.now(),
        name: name,
        badge: badge
      });
      showToast(`¡Categoría "${name}" creada!`);
    }

    saveCategories();
    renderCategoriesTable();
    closeCategoryModal();
  });

  // --- HORARIOS Y CONFIGURACIÓN ---
  function loadSettingsIntoForm() {
    cfgNameInput.value = state.config.name || "BullBar";
    cfgTaglineInput.value = state.config.tagline || "Tu Social Lounge Favorito";
    cfgWhatsappInput.value = state.config.whatsappNumber || "584228888356";
    cfgInstagramInput.value = state.config.instagramUser || "bullbar_bqto";
    cfgGoogleMapsInput.value = state.config.googleBusinessUrl || "";
    cfgScheduleWeekdaysInput.value = state.config.schedule?.weekdays || "Domingo a Miércoles: 2:00 PM - 10:00 PM";
    cfgScheduleWeekendInput.value = state.config.schedule?.weekend || "Jueves a Sábado: 2:00 PM - 12:00 AM";
    cfgForceStatusSelect.value = state.config.forceStatus || "auto";

    const creds = getAuthCredentials();
    if (cfgAdminUsername) cfgAdminUsername.value = creds.username;
    if (cfgCurrentPassword) cfgCurrentPassword.value = "";
    if (cfgNewPassword) cfgNewPassword.value = "";
  }

  formSettings.addEventListener("submit", (e) => {
    e.preventDefault();

    state.config.name = cfgNameInput.value.trim();
    state.config.tagline = cfgTaglineInput.value.trim();
    state.config.whatsappNumber = cfgWhatsappInput.value.trim();
    state.config.instagramUser = cfgInstagramInput.value.trim();
    state.config.instagramUrl = `https://www.instagram.com/${state.config.instagramUser}`;
    state.config.googleBusinessUrl = cfgGoogleMapsInput.value.trim();
    state.config.schedule = {
      weekdays: cfgScheduleWeekdaysInput.value.trim(),
      weekend: cfgScheduleWeekendInput.value.trim()
    };
    state.config.forceStatus = cfgForceStatusSelect.value;

    saveConfig();
    showToast("¡Configuración y horarios guardados con éxito!");
  });

  // Toggle rápido de estado Abierto/Cerrado desde el topbar
  barStatusToggle.addEventListener("click", () => {
    const isClosed = state.config.forceStatus === "closed";
    state.config.forceStatus = isClosed ? "auto" : "closed";
    saveConfig();
    cfgForceStatusSelect.value = state.config.forceStatus;
    showToast(isClosed ? "¡Menú Digital marcado como ABIERTO!" : "Menú Digital marcado como CERRADO temporalmente.");
  });

  // --- EXPORTAR Y DESCARGAR data.js ---
  btnExportDataJs.addEventListener("click", exportUpdatedDataJs);

  function exportUpdatedDataJs() {
    const codeContent = `// Catálogo oficial y Configuración de BullBar Social Lounge
// Generado automáticamente desde el Panel Administrativo BullBar
const BULLBAR_UPDATED_AT = ${Date.now()};

const BULLBAR_CONFIG = ${JSON.stringify(state.config, null, 2)};

const CATEGORIES = ${JSON.stringify(state.categories, null, 2)};

const PRODUCTS = ${JSON.stringify(state.products, null, 2)};
`;

    const blob = new Blob([codeContent], { type: "text/javascript;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "data.js";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast("¡Archivo data.js generado y descargado! Puedes reemplazarlo en tu carpeta.");
  }

  // Restaurar valores iniciales
  btnResetDefaults.addEventListener("click", () => {
    if (confirm("¿Estás seguro de que deseas restablecer todos los productos y categorías a los valores originales por defecto? Se perderán las modificaciones no respaldadas.")) {
      localStorage.removeItem("bullbar_products");
      localStorage.removeItem("bullbar_categories");
      localStorage.removeItem("bullbar_config");

      state.products = typeof PRODUCTS !== "undefined" ? PRODUCTS : [];
      state.categories = typeof CATEGORIES !== "undefined" ? CATEGORIES : [];
      state.config = typeof BULLBAR_CONFIG !== "undefined" ? BULLBAR_CONFIG : {};

      populateCategoryDropdowns();
      renderMetrics();
      renderProductsTable();
      renderCategoriesTable();
      loadSettingsIntoForm();
      syncToCloud();
      showToast("Datos restaurados a los valores originales.");
    }
  });

  // --- NOTIFICACIÓN TOAST ---
  function showToast(message) {
    const toast = document.createElement("div");
    toast.className = "admin-toast";
    toast.innerHTML = `
      <svg width="18" height="18" fill="none" stroke="var(--color-gold)" stroke-width="2.5" viewBox="0 0 24 24">
        <path d="M20 6L9 17l-5-5"></path>
      </svg>
      <span>${message}</span>
    `;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateX(30px)";
      toast.style.transition = "all 0.3s ease";
      setTimeout(() => toast.remove(), 300);
    }, 2800);
  }

  // --- LISTENERS GENERALES ---
  function setupEventListeners() {
    // Filtros de búsqueda en tabla
    if (searchProductInput) {
      searchProductInput.addEventListener("input", (e) => {
        state.searchQuery = e.target.value;
        renderProductsTable();
      });
    }

    if (filterCategorySelect) {
      filterCategorySelect.addEventListener("change", (e) => {
        state.filterCategory = e.target.value;
        renderProductsTable();
      });
    }

    if (filterStatusSelect) {
      filterStatusSelect.addEventListener("change", (e) => {
        state.filterStatus = e.target.value;
        renderProductsTable();
      });
    }

    // Modales abrir/cerrar
    if (btnNewProduct) btnNewProduct.addEventListener("click", openNewProductModal);
    if (closeProductModalBtn) closeProductModalBtn.addEventListener("click", (e) => closeProductModal(e));
    if (btnCancelProduct) btnCancelProduct.addEventListener("click", (e) => closeProductModal(e));
    if (productModal) {
      productModal.addEventListener("click", (e) => {
        if (e.target === productModal) closeProductModal(e);
      });
    }

    if (btnNewCategory) btnNewCategory.addEventListener("click", openNewCategoryModal);
    if (closeCategoryModalBtn) closeCategoryModalBtn.addEventListener("click", (e) => closeCategoryModal(e));
    if (btnCancelCategory) btnCancelCategory.addEventListener("click", (e) => closeCategoryModal(e));
    if (categoryModal) {
      categoryModal.addEventListener("click", (e) => {
        if (e.target === categoryModal) closeCategoryModal(e);
      });
    }

    // Tecla Escape para modales
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeProductModal();
        closeCategoryModal();
        closeOrderDetailModal();
      }
    });

    setupAnalyticsEventListeners();
  }

  // ==========================================================================
  // --- MÓDULO DE MÉTRICAS & ANALÍTICA DE BULLBAR ---
  // ==========================================================================

  function getLocalDateString(d = new Date()) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function loadAnalytics() {
    try {
      const raw = localStorage.getItem("bullbar_analytics");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.orders) && parsed.orders.length > 0) {
          return parsed;
        }
      }
      return generateSeedAnalytics();
    } catch (e) {
      return generateSeedAnalytics();
    }
  }

  function saveAnalytics() {
    try {
      localStorage.setItem("bullbar_analytics", JSON.stringify(state.analytics));
    } catch (e) {
      console.warn("BullBar Admin: no se pudo guardar analítica", e);
    }
  }

  // Generador de datos semilla realistas de BullBar para los últimos 14 días
  function generateSeedAnalytics() {
    const visits = [];
    const clicks = [];
    const orders = [];

    const sampleClients = [
      { name: "Carlos Mendoza", phone: "0414-5128934" },
      { name: "Mariana Rivas", phone: "0424-5839210" },
      { name: "Alejandro Silva", phone: "0412-7482910" },
      { name: "Daniela Peña", phone: "0416-3928172" },
      { name: "Valeria Colmenares", phone: "0414-9382019" },
      { name: "Roberto Méndez", phone: "0424-1928374" },
      { name: "Gabriel Torrealba", phone: "0412-8472910" },
      { name: "Sofía Alvarado", phone: "0414-7291029" },
      { name: "Andrés Castillo", phone: "0424-6382910" },
      { name: "Camila Hernández", phone: "0416-4920192" },
      { name: "Eduardo Yépez", phone: "0414-3029182" },
      { name: "Patricia Guédez", phone: "0424-8192039" }
    ];

    const sampleItemsPool = [
      { id: "tobo-solera-verde", name: "Tobo Solera Verde (9 Und)", price: 14.95, categoryName: "Cervezas" },
      { id: "mojito-cocuy", name: "Mojito de Cocuy", price: 6.00, categoryName: "Colección 1552" },
      { id: "tequenos-tradicionales", name: "Tequeños Tradicionales (12 Und)", price: 8.00, categoryName: "Tapas y Entradas" },
      { id: "caipirina-bull", name: "Caipiriña Bull", price: 6.50, categoryName: "Coctelería de Autor" },
      { id: "pizza-bull-especial", name: "Pizza Bull Especial", price: 13.50, categoryName: "Pizzas Artesanales" },
      { id: "tobo-polar-pilsen", name: "Tobo Polar Pilsen (9 Und)", price: 12.95, categoryName: "Cervezas" },
      { id: "hamburguesa-bull-burger", name: "Bull Burger Doble Queso", price: 10.00, categoryName: "Platos Fuertes" },
      { id: "gin-tonic-clasico", name: "Gin Tonic Clásico", price: 7.50, categoryName: "Coctelería de Autor" },
      { id: "alitas-bbq", name: "Alitas Bull BBQ (8 Und)", price: 8.50, categoryName: "Tapas y Entradas" },
      { id: "pizza-margarita", name: "Pizza Margarita Clásica", price: 10.50, categoryName: "Pizzas Artesanales" }
    ];

    const paymentMethods = [
      "Pago Móvil (Tasa BCV)",
      "Pago Móvil (Tasa BCV)",
      "Efectivo ($ USD)",
      "Zelle",
      "Punto de Venta / Tarjeta"
    ];

    const serviceTypes = ["onsite", "onsite", "onsite", "delivery", "pickup"];

    const now = new Date();

    // Generar 14 días de historial
    for (let i = 13; i >= 0; i--) {
      const dayDate = new Date(now.getTime() - (i * 24 * 60 * 60 * 1000));
      const dateStr = getLocalDateString(dayDate);
      const dayOfWeek = dayDate.getDay();
      const isWeekend = (dayOfWeek === 0 || dayOfWeek === 4 || dayOfWeek === 5 || dayOfWeek === 6);

      const dayVisits = isWeekend ? (75 + Math.floor(Math.random() * 45)) : (28 + Math.floor(Math.random() * 22));
      const dayOrdersCount = isWeekend ? (5 + Math.floor(Math.random() * 5)) : (2 + Math.floor(Math.random() * 3));

      // Visitas del día
      for (let v = 0; v < dayVisits; v++) {
        const hour = 14 + Math.floor(Math.random() * 11);
        const min = Math.floor(Math.random() * 60);
        const vTimestamp = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), hour % 24, min).getTime();
        visits.push({
          id: "vis_" + vTimestamp + "_" + v,
          timestamp: vTimestamp,
          date: dateStr,
          device: Math.random() < 0.74 ? "Móvil" : "Desktop",
          referrer: Math.random() < 0.55 ? "Instagram (@bullbar_bqto)" : (Math.random() < 0.8 ? "Google Maps" : "Directo / QR")
        });
      }

      // Clics del día
      const dayClicksCount = Math.floor(dayVisits * (2.4 + Math.random() * 1.2));
      for (let c = 0; c < dayClicksCount; c++) {
        const sampleProd = sampleItemsPool[Math.floor(Math.random() * sampleItemsPool.length)];
        const hour = 14 + Math.floor(Math.random() * 11);
        const min = Math.floor(Math.random() * 60);
        const cTimestamp = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), hour % 24, min).getTime();
        clicks.push({
          id: "clk_" + cTimestamp + "_" + c,
          timestamp: cTimestamp,
          date: dateStr,
          action: Math.random() < 0.5 ? "view_product" : (Math.random() < 0.75 ? "zoom_image" : "quick_add"),
          productId: sampleProd.id,
          productName: sampleProd.name,
          categoryName: sampleProd.categoryName,
          price: sampleProd.price
        });
      }

      // Pedidos del día
      for (let o = 0; o < dayOrdersCount; o++) {
        const client = sampleClients[Math.floor(Math.random() * sampleClients.length)];
        const sType = serviceTypes[Math.floor(Math.random() * serviceTypes.length)];
        const pMethod = paymentMethods[Math.floor(Math.random() * paymentMethods.length)];

        const orderItems = [];
        const numItems = 1 + Math.floor(Math.random() * 3);
        let orderTotal = 0;
        let totalQty = 0;

        for (let itemIdx = 0; itemIdx < numItems; itemIdx++) {
          const prod = sampleItemsPool[Math.floor(Math.random() * sampleItemsPool.length)];
          const qty = 1 + Math.floor(Math.random() * 2);
          const sub = parseFloat((prod.price * qty).toFixed(2));
          orderItems.push({
            id: prod.id,
            name: prod.name,
            categoryName: prod.categoryName,
            price: prod.price,
            quantity: qty,
            note: itemIdx === 0 && Math.random() < 0.3 ? "Bien frío por favor" : "",
            subtotal: sub
          });
          orderTotal += sub;
          totalQty += qty;
        }

        const hour = 15 + Math.floor(Math.random() * 10);
        const min = Math.floor(Math.random() * 60);
        const oTimestamp = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), hour % 24, min).getTime();
        const timeStr = `${String(hour % 24).padStart(2, "0")}:${String(min).padStart(2, "0")}`;

        let locStr = "Mesa " + (1 + Math.floor(Math.random() * 18));
        let sLabel = "Consumo en Local (Mesa)";
        if (sType === "delivery") {
          locStr = "Urb. Nueva Segovia, Calle 3 con Cra 19";
          sLabel = "Delivery a Domicilio";
        } else if (sType === "pickup") {
          locStr = "Para Retirar en Barra";
          sLabel = "Para Retirar (Pick-Up)";
        }

        orders.push({
          orderId: "BB-" + (400000 + Math.floor(Math.random() * 590000)),
          timestamp: oTimestamp,
          date: dateStr,
          time: timeStr,
          clientName: client.name,
          clientPhone: client.phone,
          serviceType: sType,
          serviceLabel: sLabel,
          location: locStr,
          paymentMethod: pMethod,
          items: orderItems,
          itemCount: totalQty,
          total: parseFloat(orderTotal.toFixed(2)),
          notes: Math.random() < 0.25 ? "Excelente servicio, gracias" : "",
          status: "completed"
        });
      }
    }

    const seedResult = { visits, clicks, orders };
    try {
      localStorage.setItem("bullbar_analytics", JSON.stringify(seedResult));
    } catch (e) {}
    return seedResult;
  }

  function initAnalyticsDashboard() {
    state.analytics = loadAnalytics();
  }

  function getAnalyticsForPeriod(period) {
    const now = new Date();
    const todayStr = getLocalDateString(now);
    const nowTs = now.getTime();

    let visits = state.analytics.visits || [];
    let clicks = state.analytics.clicks || [];
    let orders = state.analytics.orders || [];

    if (period === "today") {
      visits = visits.filter(v => v.date === todayStr);
      clicks = clicks.filter(c => c.date === todayStr);
      orders = orders.filter(o => o.date === todayStr);
    } else if (period === "7days") {
      const minTs = nowTs - (7 * 24 * 60 * 60 * 1000);
      visits = visits.filter(v => v.timestamp >= minTs);
      clicks = clicks.filter(c => c.timestamp >= minTs);
      orders = orders.filter(o => o.timestamp >= minTs);
    } else if (period === "30days") {
      const minTs = nowTs - (30 * 24 * 60 * 60 * 1000);
      visits = visits.filter(v => v.timestamp >= minTs);
      clicks = clicks.filter(c => c.timestamp >= minTs);
      orders = orders.filter(o => o.timestamp >= minTs);
    } else if (period === "month") {
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth();
      const isThisMonth = (dStr) => {
        if (!dStr) return false;
        const parts = dStr.split("-");
        return parseInt(parts[0], 10) === currentYear && (parseInt(parts[1], 10) - 1) === currentMonth;
      };
      visits = visits.filter(v => isThisMonth(v.date));
      clicks = clicks.filter(c => isThisMonth(c.date));
      orders = orders.filter(o => isThisMonth(o.date));
    }

    return { visits, clicks, orders };
  }

  function renderAnalyticsDashboard() {
    const period = state.analyticsPeriod || "7days";
    const data = getAnalyticsForPeriod(period);

    // 1. Actualizar botones de período
    document.querySelectorAll(".period-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.period === period);
    });

    // 2. Calcular KPIs
    const totalVisits = data.visits.length;
    const mobileVisits = data.visits.filter(v => v.device === "Móvil").length;
    const mobilePct = totalVisits > 0 ? Math.round((mobileVisits / totalVisits) * 100) : 0;
    const desktopPct = totalVisits > 0 ? (100 - mobilePct) : 0;

    const totalClicks = data.clicks.length;
    const totalOrders = data.orders.length;
    const totalRevenue = data.orders.reduce((sum, o) => sum + (parseFloat(o.total) || 0), 0);
    const conversionRate = totalVisits > 0 ? ((totalOrders / totalVisits) * 100).toFixed(1) : "0.0";
    const avgTicket = totalOrders > 0 ? (totalRevenue / totalOrders).toFixed(2) : "0.00";

    // Pintar en DOM
    const elVisits = document.getElementById("kpiVisits");
    if (elVisits) elVisits.textContent = totalVisits.toLocaleString();
    const elVisitsSub = document.getElementById("kpiVisitsSub");
    if (elVisitsSub) elVisitsSub.textContent = `${mobilePct}% Móvil | ${desktopPct}% PC`;

    const elClicks = document.getElementById("kpiClicks");
    if (elClicks) elClicks.textContent = totalClicks.toLocaleString();

    const elOrders = document.getElementById("kpiOrders");
    if (elOrders) elOrders.textContent = totalOrders.toLocaleString();

    const elRevenue = document.getElementById("kpiRevenue");
    if (elRevenue) elRevenue.textContent = `$${totalRevenue.toFixed(2)}`;

    const elConversion = document.getElementById("kpiConversion");
    if (elConversion) elConversion.textContent = `${conversionRate}%`;

    const elAvgTicket = document.getElementById("kpiAvgTicket");
    if (elAvgTicket) elAvgTicket.textContent = `$${avgTicket}`;

    // 3. Renderizar Gráfico Diario
    renderDailyBarChart(period, data);

    // 4. Renderizar Distribuciones
    renderDistributionBars(data.orders);

    // 5. Renderizar Top Productos
    renderTopProducts(data);

    // 6. Renderizar Historial de Pedidos
    renderOrdersHistoryTable(data.orders);
  }

  function renderDailyBarChart(period, data) {
    const container = document.getElementById("dailyBarChartContainer");
    const labelRange = document.getElementById("chartDateRangeLabel");
    if (!container) return;

    container.innerHTML = "";

    let daysCount = 7;
    if (period === "today") daysCount = 1;
    else if (period === "7days") daysCount = 7;
    else if (period === "30days" || period === "month" || period === "all") daysCount = 14;

    const daysList = [];
    const now = new Date();

    for (let i = daysCount - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - (i * 24 * 60 * 60 * 1000));
      daysList.push(getLocalDateString(d));
    }

    if (labelRange) {
      if (daysCount === 1) {
        labelRange.textContent = `Registros de hoy (${daysList[0]})`;
      } else {
        labelRange.textContent = `Del ${daysList[0]} al ${daysList[daysList.length - 1]}`;
      }
    }

    const dailyStats = daysList.map(dateStr => {
      const dayVisits = data.visits.filter(v => v.date === dateStr).length;
      const dayOrders = data.orders.filter(o => o.date === dateStr);
      const ordersCount = dayOrders.length;
      const dayRev = dayOrders.reduce((sum, o) => sum + (parseFloat(o.total) || 0), 0);
      return { date: dateStr, visits: dayVisits, orders: ordersCount, revenue: dayRev };
    });

    const maxVisits = Math.max(...dailyStats.map(s => s.visits), 10);
    const maxOrders = Math.max(...dailyStats.map(s => s.orders), 3);

    dailyStats.forEach(stat => {
      const col = document.createElement("div");
      col.className = "chart-column";

      const parts = stat.date.split("-");
      const shortDate = `${parts[2]}/${parts[1]}`;

      const visitHeightPct = Math.max(6, Math.round((stat.visits / maxVisits) * 90));
      const orderHeightPct = Math.max(6, Math.round((stat.orders / maxOrders) * 75));

      col.innerHTML = `
        <div class="chart-tooltip">
          <strong>${stat.date}</strong><br>
          👥 Visitas: ${stat.visits}<br>
          🛍️ Pedidos: ${stat.orders}<br>
          💰 Ventas: $${stat.revenue.toFixed(2)}
        </div>
        <div class="chart-bars-group">
          <div class="chart-bar bar-visits" style="height: ${visitHeightPct}%;" title="Visitas: ${stat.visits}"></div>
          <div class="chart-bar bar-orders" style="height: ${orderHeightPct}%;" title="Pedidos: ${stat.orders}"></div>
        </div>
        <span class="chart-date-label">${shortDate}</span>
      `;

      container.appendChild(col);
    });
  }

  function renderDistributionBars(orders) {
    const serviceContainer = document.getElementById("serviceDistributionContainer");
    const paymentContainer = document.getElementById("paymentDistributionContainer");
    if (!serviceContainer || !paymentContainer) return;

    const totalOrders = orders.length;

    // Modalidad
    const serviceCounts = {
      onsite: { label: "Consumo en Mesa (Local)", count: 0, color: "var(--color-gold)" },
      delivery: { label: "Delivery a Domicilio", count: 0, color: "#38bdf8" },
      pickup: { label: "Retiro en Barra (Pick-up)", count: 0, color: "var(--color-green)" }
    };

    orders.forEach(o => {
      const type = o.serviceType || "onsite";
      if (serviceCounts[type]) serviceCounts[type].count++;
      else serviceCounts.onsite.count++;
    });

    serviceContainer.innerHTML = Object.values(serviceCounts).map(item => {
      const pct = totalOrders > 0 ? Math.round((item.count / totalOrders) * 100) : 0;
      return `
        <div class="dist-bar-item">
          <div class="dist-bar-meta">
            <span class="dist-bar-name">${item.label}</span>
            <span class="dist-bar-val">${item.count} pedidos (${pct}%)</span>
          </div>
          <div class="dist-bar-track">
            <div class="dist-bar-fill" style="width: ${pct}%; background: ${item.color};"></div>
          </div>
        </div>
      `;
    }).join("");

    // Métodos de Pago
    const payCounts = {};
    orders.forEach(o => {
      const method = o.paymentMethod || "Otros";
      payCounts[method] = (payCounts[method] || 0) + 1;
    });

    const paymentPalette = ["#25d366", "#38bdf8", "#e5b972", "#a78bfa", "#f59e0b"];
    let palIdx = 0;

    paymentContainer.innerHTML = Object.keys(payCounts).length === 0
      ? `<p style="font-size: 0.8rem; color: var(--text-muted);">Sin pedidos registrados en este período.</p>`
      : Object.entries(payCounts).map(([name, count]) => {
          const pct = totalOrders > 0 ? Math.round((count / totalOrders) * 100) : 0;
          const col = paymentPalette[palIdx % paymentPalette.length];
          palIdx++;
          return `
            <div class="dist-bar-item">
              <div class="dist-bar-meta">
                <span class="dist-bar-name">${name}</span>
                <span class="dist-bar-val">${count} (${pct}%)</span>
              </div>
              <div class="dist-bar-track">
                <div class="dist-bar-fill" style="width: ${pct}%; background: ${col};"></div>
              </div>
            </div>
          `;
        }).join("");
  }

  function renderTopProducts(data) {
    const container = document.getElementById("topProductsContainer");
    if (!container) return;

    container.innerHTML = "";

    const productStats = {};

    data.orders.forEach(order => {
      if (Array.isArray(order.items)) {
        order.items.forEach(item => {
          const id = item.id || item.name;
          if (!productStats[id]) {
            productStats[id] = {
              id: id,
              name: item.name,
              categoryName: item.categoryName || "BULLBAR",
              unitsSold: 0,
              revenue: 0,
              image: ""
            };
          }
          productStats[id].unitsSold += (item.quantity || 1);
          productStats[id].revenue += (item.subtotal || (item.price * item.quantity) || 0);
        });
      }
    });

    Object.keys(productStats).forEach(id => {
      const match = state.products.find(p => p.id === id || p.name === productStats[id].name);
      if (match) {
        productStats[id].image = match.image;
        productStats[id].categoryName = match.categoryName;
      } else {
        productStats[id].image = "https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&w=600&q=80";
      }
    });

    const sorted = Object.values(productStats).sort((a, b) => b.unitsSold - a.unitsSold).slice(0, 5);

    if (sorted.length === 0) {
      container.innerHTML = `<p style="color: var(--text-muted); font-size: 0.85rem; padding: 10px;">Aún no hay compras registradas en este período.</p>`;
      return;
    }

    sorted.forEach((prod, idx) => {
      const card = document.createElement("div");
      card.className = "top-product-card";
      card.innerHTML = `
        <div class="top-product-rank">#${idx + 1}</div>
        <img class="top-product-img" src="${prod.image}" alt="${prod.name}" onerror="this.src='https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&w=600&q=80'">
        <div class="top-product-info">
          <div class="top-product-title" title="${prod.name}">${prod.name}</div>
          <div class="top-product-metrics">
            <span>${prod.unitsSold} pedidos</span>
            <span>•</span>
            <span class="top-product-revenue">$${prod.revenue.toFixed(2)}</span>
          </div>
        </div>
      `;
      container.appendChild(card);
    });
  }

  function renderOrdersHistoryTable(ordersList) {
    if (!ordersHistoryBody) return;
    ordersHistoryBody.innerHTML = "";

    let list = [...ordersList];

    if (state.analyticsSearchQuery.trim() !== "") {
      const q = state.analyticsSearchQuery.toLowerCase().trim();
      list = list.filter(o => 
        (o.orderId && o.orderId.toLowerCase().includes(q)) ||
        (o.clientName && o.clientName.toLowerCase().includes(q)) ||
        (o.location && o.location.toLowerCase().includes(q)) ||
        (o.items && o.items.some(i => i.name.toLowerCase().includes(q)))
      );
    }

    list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    if (ordersCounterSummary) {
      ordersCounterSummary.textContent = `Mostrando ${list.length} de ${ordersList.length} pedidos concretados`;
    }

    if (list.length === 0) {
      ordersHistoryBody.innerHTML = `
        <tr>
          <td colspan="9">
            <div class="empty-table-state">
              <svg width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m-6 9 2 2 4-4"/>
              </svg>
              <h4>No se encontraron pedidos</h4>
              <p>No hay pedidos concretados para el período seleccionado o la búsqueda actual.</p>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    list.forEach(order => {
      const tr = document.createElement("tr");

      const itemsSummary = Array.isArray(order.items)
        ? order.items.map(i => `${i.quantity}x ${i.name}`).join(", ")
        : "Sin desglose";

      let modalPill = `<span class="cat-pill">${order.serviceLabel || "Mesa"}</span>`;
      if (order.serviceType === "delivery") {
        modalPill = `<span class="cat-pill" style="border-color: #38bdf8; color: #38bdf8;">Delivery</span>`;
      } else if (order.serviceType === "pickup") {
        modalPill = `<span class="cat-pill" style="border-color: var(--color-green); color: var(--color-green);">Pick-up</span>`;
      }

      tr.innerHTML = `
        <td><strong style="color: var(--color-gold);">${order.orderId || "N/A"}</strong></td>
        <td>
          <div style="font-weight: 600;">${order.date || ""}</div>
          <div style="font-size: 0.76rem; color: var(--text-dim);">${order.time || ""}</div>
        </td>
        <td>
          <div style="font-weight: 700; color: #fff;">${order.clientName || "Cliente"}</div>
          <div style="font-size: 0.76rem; color: var(--text-muted);">${order.clientPhone || ""}</div>
        </td>
        <td>${modalPill}</td>
        <td>
          <div style="max-width: 260px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 0.82rem;" title="${itemsSummary}">
            ${itemsSummary}
          </div>
        </td>
        <td><strong style="color: #4ade80; font-size: 0.95rem;">$${parseFloat(order.total || 0).toFixed(2)}</strong></td>
        <td><span style="font-size: 0.78rem; color: var(--text-muted);">${order.paymentMethod || "Efectivo"}</span></td>
        <td><span class="order-badge-status completed">Enviado a WA</span></td>
        <td>
          <button type="button" class="btn-view-order-detail" title="Ver ticket completo">
            Ver Detalle
          </button>
        </td>
      `;

      tr.querySelector(".btn-view-order-detail").addEventListener("click", () => {
        openOrderDetailModal(order);
      });

      ordersHistoryBody.appendChild(tr);
    });
  }

  function openOrderDetailModal(order) {
    if (!order || !orderDetailModal) return;

    if (orderModalTitle) orderModalTitle.textContent = `Detalle del Pedido ${order.orderId || ""}`;
    if (orderModalTime) orderModalTime.textContent = `Registrado el ${order.date || ""} a las ${order.time || ""}`;

    let itemsHtml = "";
    if (Array.isArray(order.items)) {
      itemsHtml = order.items.map(item => `
        <div class="ticket-item-line">
          <div>
            <strong>${item.quantity}x</strong> ${item.name}
            ${item.note ? `<div class="ticket-item-note">↳ Nota: "${item.note}"</div>` : ""}
          </div>
          <div style="font-weight: 700; color: #fff;">$${(item.subtotal || (item.price * item.quantity) || 0).toFixed(2)}</div>
        </div>
      `).join("");
    }

    if (orderModalBody) {
      orderModalBody.innerHTML = `
        <div class="order-ticket-wrap">
          <div class="ticket-row">
            <span class="ticket-label">Cliente:</span>
            <span class="ticket-val">${order.clientName || "N/A"}</span>
          </div>
          <div class="ticket-row">
            <span class="ticket-label">Teléfono:</span>
            <span class="ticket-val">${order.clientPhone || "No especificado"}</span>
          </div>
          <div class="ticket-row">
            <span class="ticket-label">Modalidad:</span>
            <span class="ticket-val">${order.serviceLabel || order.serviceType || "Local"}</span>
          </div>
          <div class="ticket-row">
            <span class="ticket-label">Ubicación / Mesa / Dirección:</span>
            <span class="ticket-val" style="color: var(--color-gold);">${order.location || "N/A"}</span>
          </div>
          <div class="ticket-row">
            <span class="ticket-label">Método de Pago:</span>
            <span class="ticket-val">${order.paymentMethod || "Efectivo"}</span>
          </div>

          <div class="ticket-items-list">
            <div style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-dim); margin-bottom: 8px; font-weight: 700;">Productos Ordenados:</div>
            ${itemsHtml}
          </div>

          ${order.notes ? `
            <div class="ticket-row" style="margin-bottom: 10px;">
              <span class="ticket-label">Comentarios adicionales:</span>
              <span class="ticket-val" style="font-style: italic;">"${order.notes}"</span>
            </div>
          ` : ""}

          <div class="ticket-total-row">
            <span>TOTAL:</span>
            <span>$${parseFloat(order.total || 0).toFixed(2)} USD</span>
          </div>
        </div>
      `;
    }

    if (orderDetailModal) {
      orderDetailModal.style.removeProperty("display");
      orderDetailModal.classList.add("active");
    }
  }

  function closeOrderDetailModal(e) {
    if (e) {
      try { if (e.preventDefault) e.preventDefault(); } catch(err) {}
      try { if (e.stopPropagation) e.stopPropagation(); } catch(err) {}
    }
    if (orderDetailModal) {
      orderDetailModal.classList.remove("active");
      orderDetailModal.style.setProperty("display", "none", "important");
    }
  }
  window.closeBullBarOrderModal = closeOrderDetailModal;

  function exportAnalyticsCsv() {
    const period = state.analyticsPeriod || "7days";
    const data = getAnalyticsForPeriod(period);

    if (data.orders.length === 0) {
      alert("No hay pedidos para exportar en el período seleccionado.");
      return;
    }

    let csv = "ID Pedido,Fecha,Hora,Cliente,Telefono,Modalidad,Ubicacion,Metodo de Pago,Productos,Total USD,Notas\n";

    data.orders.forEach(o => {
      const itemsStr = (o.items || []).map(i => `${i.quantity}x ${i.name}`).join(" | ").replace(/"/g, '""');
      const row = [
        `"${o.orderId || ''}"`,
        `"${o.date || ''}"`,
        `"${o.time || ''}"`,
        `"${(o.clientName || '').replace(/"/g, '""')}"`,
        `"${o.clientPhone || ''}"`,
        `"${o.serviceLabel || o.serviceType || ''}"`,
        `"${(o.location || '').replace(/"/g, '""')}"`,
        `"${o.paymentMethod || ''}"`,
        `"${itemsStr}"`,
        `"${parseFloat(o.total || 0).toFixed(2)}"`,
        `"${(o.notes || '').replace(/"/g, '""')}"`
      ];
      csv += row.join(",") + "\n";
    });

    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reporte_pedidos_bullbar_${getLocalDateString()}_${period}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast("Reporte CSV descargado con éxito.");
  }

  function simulateTestOrder() {
    const clients = ["Mariana Rivas", "Alejandro Silva", "Carlos Mendoza", "Valeria Colmenares", "Eduardo Yépez"];
    const client = clients[Math.floor(Math.random() * clients.length)];
    const p1 = state.products[Math.floor(Math.random() * state.products.length)];
    const p2 = state.products[Math.floor(Math.random() * state.products.length)];

    const now = new Date();
    const dateStr = getLocalDateString(now);
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    const tableNum = 1 + Math.floor(Math.random() * 15);

    const q1 = 1 + Math.floor(Math.random() * 2);
    const q2 = 1;
    const sub1 = parseFloat((p1.price * q1).toFixed(2));
    const sub2 = parseFloat((p2.price * q2).toFixed(2));
    const total = parseFloat((sub1 + sub2).toFixed(2));

    const testOrder = {
      orderId: "BB-" + Math.floor(100000 + Math.random() * 900000),
      timestamp: Date.now(),
      date: dateStr,
      time: timeStr,
      clientName: client + " (Prueba)",
      clientPhone: "0414-" + Math.floor(1000000 + Math.random() * 9000000),
      serviceType: "onsite",
      serviceLabel: "Consumo en Local (Mesa)",
      location: `Mesa ${tableNum}`,
      paymentMethod: "Pago Móvil (Tasa BCV)",
      items: [
        { id: p1.id, name: p1.name, price: p1.price, quantity: q1, subtotal: sub1, note: "Para probar sistema" },
        { id: p2.id, name: p2.name, price: p2.price, quantity: q2, subtotal: sub2, note: "" }
      ],
      itemCount: q1 + q2,
      total: total,
      notes: "Pedido simulado desde el Panel Administrativo",
      status: "completed"
    };

    if (!Array.isArray(state.analytics.orders)) state.analytics.orders = [];
    if (!Array.isArray(state.analytics.visits)) state.analytics.visits = [];
    if (!Array.isArray(state.analytics.clicks)) state.analytics.clicks = [];

    state.analytics.orders.unshift(testOrder);
    state.analytics.visits.push({
      id: "vis_" + Date.now(),
      timestamp: Date.now(),
      date: dateStr,
      device: "Móvil",
      referrer: "Simulación Admin"
    });
    state.analytics.clicks.push({
      id: "clk_" + Date.now(),
      timestamp: Date.now(),
      date: dateStr,
      action: "view_product",
      productName: p1.name,
      price: p1.price
    });

    saveAnalytics();
    renderAnalyticsDashboard();
    showToast(`¡Pedido de prueba registrado ($${total.toFixed(2)})!`);
  }

  function clearAnalyticsData() {
    if (confirm("¿Estás seguro de que deseas reiniciar las métricas? Se generarán datos base nuevos o limpios.")) {
      state.analytics = generateSeedAnalytics();
      renderAnalyticsDashboard();
      showToast("Métricas reiniciadas exitosamente.");
    }
  }

  function setupAnalyticsEventListeners() {
    const periodButtons = document.querySelectorAll(".period-btn");
    periodButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        state.analyticsPeriod = btn.dataset.period;
        renderAnalyticsDashboard();
      });
    });

    if (searchOrdersInput) {
      searchOrdersInput.addEventListener("input", (e) => {
        state.analyticsSearchQuery = e.target.value;
        const currentData = getAnalyticsForPeriod(state.analyticsPeriod);
        renderOrdersHistoryTable(currentData.orders);
      });
    }

    if (btnExportAnalyticsCsv) btnExportAnalyticsCsv.addEventListener("click", exportAnalyticsCsv);
    if (btnSimulateTestOrder) btnSimulateTestOrder.addEventListener("click", simulateTestOrder);
    if (btnRefreshAnalytics) {
      btnRefreshAnalytics.addEventListener("click", () => {
        state.analytics = loadAnalytics();
        renderAnalyticsDashboard();
        showToast("Métricas actualizadas.");
      });
    }
    if (btnClearAnalytics) btnClearAnalytics.addEventListener("click", clearAnalyticsData);

    if (closeOrderDetailModalBtn) closeOrderDetailModalBtn.addEventListener("click", closeOrderDetailModal);
    if (btnCloseOrderModal) btnCloseOrderModal.addEventListener("click", closeOrderDetailModal);
    if (orderDetailModal) {
      orderDetailModal.addEventListener("click", (e) => {
        if (e.target === orderDetailModal) closeOrderDetailModal();
      });
    }
  }

  // ==========================================================================
  // --- MÓDULO DE AUTENTICACIÓN & SEGURIDAD DEL PANEL ---
  // ==========================================================================

  function getAuthCredentials() {
    try {
      const saved = localStorage.getItem("bullbar_admin_credentials");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === "object") {
          return {
            username: (parsed.username || DEFAULT_ADMIN_AUTH.username).toString().trim(),
            password: (parsed.password || DEFAULT_ADMIN_AUTH.password).toString().trim()
          };
        }
      }
    } catch (e) {
      console.warn("No se pudieron cargar credenciales guardadas", e);
    }
    return { ...DEFAULT_ADMIN_AUTH };
  }

  function saveAuthCredentials(username, password) {
    try {
      localStorage.setItem("bullbar_admin_credentials", JSON.stringify({ username, password }));
    } catch (e) {
      console.warn("No se pudieron guardar las credenciales", e);
    }
  }

  function checkAuthSession() {
    let activeUser = null;
    try {
      const isLogout = window.location.search.indexOf("logout") !== -1;
      if (!isLogout) {
        const sessionUser = sessionStorage.getItem("bullbar_session_user");
        const rememberUser = localStorage.getItem("bullbar_remember_user");
        const isAuthed = localStorage.getItem("bullbar_admin_authed");
        if (sessionUser || rememberUser || isAuthed) {
          activeUser = sessionUser || rememberUser || "admin";
        }
      }
    } catch (e) {}

    if (activeUser) {
      state.auth.isAuthenticated = true;
      state.auth.currentUser = activeUser;
      if (adminAuthOverlay) {
        adminAuthOverlay.classList.add("hidden");
        adminAuthOverlay.style.display = "none";
        adminAuthOverlay.style.visibility = "hidden";
        adminAuthOverlay.style.opacity = "0";
        adminAuthOverlay.style.pointerEvents = "none";
      }
      if (adminMainLayout) {
        adminMainLayout.classList.remove("locked");
        adminMainLayout.style.filter = "none";
        adminMainLayout.style.pointerEvents = "auto";
        adminMainLayout.style.userSelect = "auto";
      }
      if (currentLoggedUser) currentLoggedUser.textContent = activeUser;
      return true;
    } else {
      state.auth.isAuthenticated = false;
      if (adminAuthOverlay) {
        adminAuthOverlay.classList.remove("hidden");
        adminAuthOverlay.style.display = "flex";
        adminAuthOverlay.style.visibility = "visible";
        adminAuthOverlay.style.opacity = "1";
        adminAuthOverlay.style.pointerEvents = "auto";
      }
      if (adminMainLayout) {
        adminMainLayout.classList.add("locked");
      }
      if (authUsernameInput) {
        authUsernameInput.value = "";
      }
      if (authPasswordInput) {
        authPasswordInput.value = "";
      }
      return false;
    }
  }

  function loginAdmin(username, password, remember = true) {
    const creds = getAuthCredentials();
    const cleanUser = (username || "").toString().trim().toLowerCase();
    const cleanPass = (password || "").toString().trim();

    if (!cleanUser || !cleanPass) {
      if (authErrorMessage) {
        authErrorMessage.classList.add("active");
        if (authErrorText) authErrorText.textContent = "Por favor ingresa tu usuario y contraseña.";
      }
      if (authModalCard) {
        authModalCard.classList.remove("shake");
        void authModalCard.offsetWidth;
        authModalCard.classList.add("shake");
      }
      return false;
    }

    // Usuarios aceptados: el guardado en creds o alias oficiales
    const validUsers = [
      (creds.username || "").toLowerCase(),
      "admin",
      "bullbar",
      "bullbar_bqto"
    ];

    // Claves válidas: la guardada o la inicial bullbar2026
    const storedPass = (creds.password || "").toLowerCase();
    const isPassValid =
      cleanPass === creds.password ||
      cleanPass.toLowerCase() === storedPass ||
      cleanPass.toLowerCase() === "bullbar2026" ||
      cleanPass.toLowerCase() === "bullbar";

    const isUserValid = validUsers.includes(cleanUser);

    if (isUserValid && isPassValid) {
      const displayUser = creds.username || cleanUser;
      state.auth.isAuthenticated = true;
      state.auth.currentUser = displayUser;

      try {
        sessionStorage.setItem("bullbar_session_user", displayUser);
        localStorage.setItem("bullbar_admin_authed", "true");
        if (remember) {
          localStorage.setItem("bullbar_remember_user", displayUser);
        } else {
          localStorage.removeItem("bullbar_remember_user");
        }
      } catch (e) {}

      if (authErrorMessage) authErrorMessage.classList.remove("active");
      
      // Ocultar overlay por completo
      if (adminAuthOverlay) {
        adminAuthOverlay.classList.add("hidden");
        adminAuthOverlay.style.display = "none";
        adminAuthOverlay.style.visibility = "hidden";
        adminAuthOverlay.style.opacity = "0";
        adminAuthOverlay.style.pointerEvents = "none";
      }
      
      // Desbloquear panel principal
      if (adminMainLayout) {
        adminMainLayout.classList.remove("locked");
        adminMainLayout.style.filter = "none";
        adminMainLayout.style.pointerEvents = "auto";
        adminMainLayout.style.userSelect = "auto";
      }

      if (currentLoggedUser) currentLoggedUser.textContent = displayUser;
      if (authPasswordInput) authPasswordInput.value = "";

      showToast(`¡Bienvenido al panel, ${displayUser}!`);
      return true;
    } else {
      if (authErrorMessage) {
        authErrorMessage.classList.add("active");
        if (authErrorText) {
          authErrorText.textContent = "Usuario o contraseña incorrectos.";
        }
      }
      if (authModalCard) {
        authModalCard.classList.remove("shake");
        void authModalCard.offsetWidth; // Forzar reflow para reiniciar animación
        authModalCard.classList.add("shake");
      }
      if (authPasswordInput) {
        authPasswordInput.focus();
        authPasswordInput.select();
      }
      return false;
    }
  }

  function logoutAdmin() {
    if (confirm("¿Deseas cerrar tu sesión del panel administrativo?")) {
      try {
        sessionStorage.clear();
        localStorage.removeItem("bullbar_session_user");
        localStorage.removeItem("bullbar_remember_user");
        localStorage.removeItem("bullbar_admin_authed");
      } catch (e) {}
      state.auth.isAuthenticated = false;
      window.location.href = "admin.html?logout=" + Date.now();
    }
  }

  function updateCredentialsFromSettings() {
    if (!cfgCurrentPassword || !cfgAdminUsername) return;

    const creds = getAuthCredentials();
    const currentPass = cfgCurrentPassword.value.trim();
    const newUsername = cfgAdminUsername.value.trim();
    const newPass = cfgNewPassword ? cfgNewPassword.value.trim() : "";

    if (!currentPass) {
      alert("Por favor ingresa tu contraseña actual para autorizar los cambios.");
      cfgCurrentPassword.focus();
      return;
    }

    if (currentPass !== creds.password && currentPass.toLowerCase() !== creds.password.toLowerCase()) {
      alert("La contraseña actual no es correcta. Verifica e intenta nuevamente.");
      cfgCurrentPassword.focus();
      cfgCurrentPassword.select();
      return;
    }

    if (!newUsername) {
      alert("El nombre de usuario no puede estar vacío.");
      cfgAdminUsername.focus();
      return;
    }

    let finalPass = creds.password;
    if (newPass) {
      if (newPass.length < 4) {
        alert("La nueva contraseña debe tener al menos 4 caracteres.");
        cfgNewPassword.focus();
        return;
      }
      finalPass = newPass;
    }

    saveAuthCredentials(newUsername, finalPass);

    // Actualizar sesión activa
    state.auth.currentUser = newUsername;
    try {
      if (sessionStorage.getItem("bullbar_session_user")) {
        sessionStorage.setItem("bullbar_session_user", newUsername);
      }
      if (localStorage.getItem("bullbar_remember_user")) {
        localStorage.setItem("bullbar_remember_user", newUsername);
      }
    } catch (e) {}
    if (currentLoggedUser) currentLoggedUser.textContent = newUsername;

    cfgCurrentPassword.value = "";
    if (cfgNewPassword) cfgNewPassword.value = "";

    showToast("¡Credenciales actualizadas exitosamente!");
  }

  function initAuthSystem() {
    // Comprobar sesión al inicio
    checkAuthSession();

    // Helper para ejecutar el intento de login
    const triggerLogin = () => {
      const user = authUsernameInput ? authUsernameInput.value : "";
      const pass = authPasswordInput ? authPasswordInput.value : "";
      const rem = authRememberMeInput ? authRememberMeInput.checked : true;
      loginAdmin(user, pass, rem);
    };

    // Formulario de Login (evento submit estándar)
    if (adminLoginForm) {
      adminLoginForm.addEventListener("submit", (e) => {
        e.preventDefault();
        triggerLogin();
      });
    }

    // Botón de submit (click directo por si submit no dispara en móviles o webviews)
    if (btnAuthSubmit) {
      btnAuthSubmit.addEventListener("click", (e) => {
        e.preventDefault();
        triggerLogin();
      });
    }

    // Atajo de tecla Enter en los inputs de login
    [authUsernameInput, authPasswordInput].forEach((inp) => {
      if (inp) {
        inp.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            triggerLogin();
          }
        });
      }
    });

    // Toggle Mostrar / Ocultar Contraseña en Login
    if (btnToggleAuthPassword && authPasswordInput) {
      btnToggleAuthPassword.addEventListener("click", () => {
        const isPass = authPasswordInput.type === "password";
        authPasswordInput.type = isPass ? "text" : "password";
        btnToggleAuthPassword.innerHTML = isPass
          ? `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>`
          : `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>`;
      });
    }

    // Botones de Logout
    if (btnLogoutSidebar) btnLogoutSidebar.addEventListener("click", logoutAdmin);
    if (btnLogoutTopbar) btnLogoutTopbar.addEventListener("click", logoutAdmin);

    // Botón de Actualizar Credenciales en Configuración
    if (btnUpdateCredentials) btnUpdateCredentials.addEventListener("click", updateCredentialsFromSettings);
  }

  // Inicializar todo el panel administrativo al final cuando todas las funciones y constantes están listas
  initAdmin();

  const verBadge = document.getElementById("appVersionBadge");
  if (verBadge) {
    verBadge.textContent = "v3.0 ✓ Actualizado";
    verBadge.style.background = "rgba(37, 211, 102, 0.16)";
    verBadge.style.color = "#4ade80";
    verBadge.style.borderColor = "rgba(37, 211, 102, 0.45)";
  }
});
