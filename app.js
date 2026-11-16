/**
 * BULLBAR SOCIAL LOUNGE - PLATAFORMA INTERACTIVA DE PEDIDOS
 * Lógica de Catálogo, Carrito, Filtros y Enrutamiento a WhatsApp
 */

document.addEventListener("DOMContentLoaded", () => {
  // Funciones para cargar configuración, categorías y productos dinámicos (LocalStorage o defaults)
  function getConfig() {
    try {
      const saved = localStorage.getItem("bullbar_config");
      return saved ? JSON.parse(saved) : (typeof BULLBAR_CONFIG !== "undefined" ? BULLBAR_CONFIG : {});
    } catch (e) {
      return typeof BULLBAR_CONFIG !== "undefined" ? BULLBAR_CONFIG : {};
    }
  }

  function getCategories() {
    try {
      const saved = localStorage.getItem("bullbar_categories");
      return saved ? JSON.parse(saved) : (typeof CATEGORIES !== "undefined" ? CATEGORIES : []);
    } catch (e) {
      return typeof CATEGORIES !== "undefined" ? CATEGORIES : [];
    }
  }

  function cleanDuplicateProducts(rawList) {
    if (!Array.isArray(rawList)) return [];
    const result = [];
    for (let i = 0; i < rawList.length; i++) {
      const item = rawList[i];
      if (!item || !item.name) continue;
      const isAutoProdId = typeof item.id === "string" && item.id.indexOf("prod-") === 0;
      const isExplicitCopy = item.name.indexOf("(Copia)") !== -1;
      if (isAutoProdId && !isExplicitCopy) {
        const otherMatch = rawList.find((other, idx) =>
          idx !== i &&
          other &&
          other.name &&
          other.name.trim().toLowerCase() === item.name.trim().toLowerCase() &&
          other.categoryId === item.categoryId
        );
        if (otherMatch) {
          otherMatch.price = item.price;
          otherMatch.image = item.image;
          otherMatch.description = item.description;
          otherMatch.badge = item.badge;
          otherMatch.available = item.available;
          continue;
        }
      }
      result.push(item);
    }
    return result;
  }

  function getProducts() {
    try {
      const fileTs = typeof BULLBAR_UPDATED_AT !== "undefined" ? Number(BULLBAR_UPDATED_AT) : 0;
      const localTs = Number(localStorage.getItem("bullbar_updated_at") || 0);
      if (fileTs > localTs && typeof PRODUCTS !== "undefined") {
        localStorage.setItem("bullbar_products", JSON.stringify(PRODUCTS));
        if (typeof CATEGORIES !== "undefined") localStorage.setItem("bullbar_categories", JSON.stringify(CATEGORIES));
        if (typeof BULLBAR_CONFIG !== "undefined") localStorage.setItem("bullbar_config", JSON.stringify(BULLBAR_CONFIG));
        localStorage.setItem("bullbar_updated_at", String(fileTs));
        return cleanDuplicateProducts(PRODUCTS);
      }
      const saved = localStorage.getItem("bullbar_products");
      const rawList = saved ? JSON.parse(saved) : (typeof PRODUCTS !== "undefined" ? PRODUCTS : []);
      return cleanDuplicateProducts(rawList);
    } catch (e) {
      return typeof PRODUCTS !== "undefined" ? PRODUCTS : [];
    }
  }

  // Estado de la aplicación
  let state = {
    activeCategory: "all",
    searchQuery: "",
    cart: loadCartFromStorage(),
    currentModalProduct: null,
    modalQuantity: 1,
    serviceType: "onsite", // "onsite" | "pickup" | "delivery"
    config: getConfig(),
    categories: getCategories(),
    products: getProducts()
  };

  // Elementos del DOM
  const productsContainer = document.getElementById("productsContainer");
  const categoriesContainer = document.getElementById("categoriesContainer");
  const searchInput = document.getElementById("searchInput");
  const searchClear = document.getElementById("searchClear");
  const floatingCartBtn = document.getElementById("floatingCartBtn");
  const cartBadge = document.getElementById("cartBadge");
  const cartBtnTotal = document.getElementById("cartBtnTotal");
  const toastContainer = document.getElementById("toastContainer");

  // Modales
  const productModal = document.getElementById("productModal");
  const closeProductModalBtn = document.getElementById("closeProductModal");
  const cartDrawerOverlay = document.getElementById("cartDrawerOverlay");
  const closeCartDrawerBtn = document.getElementById("closeCartDrawer");
  const cartItemsList = document.getElementById("cartItemsList");
  const clearCartBtn = document.getElementById("clearCartBtn");

  // Lightbox de Imagen Completa
  const imageLightboxModal = document.getElementById("imageLightboxModal");
  const lightboxImg = document.getElementById("lightboxImg");
  const lightboxTitle = document.getElementById("lightboxTitle");
  const closeLightboxBtn = document.getElementById("closeLightboxBtn");
  const modalImgWrap = document.getElementById("modalImgWrap");
  const btnZoomModalImg = document.getElementById("btnZoomModalImg");

  // Elementos de Checkout
  const subtotalAmountEl = document.getElementById("subtotalAmount");
  const totalAmountEl = document.getElementById("totalAmount");
  const clientNameInput = document.getElementById("clientName");
  const clientPhoneInput = document.getElementById("clientPhone");
  const locationFieldGroup = document.getElementById("locationFieldGroup");
  const locationLabel = document.getElementById("locationLabel");
  const locationInput = document.getElementById("locationInput");
  const paymentMethodSelect = document.getElementById("paymentMethod");
  const orderNotesInput = document.getElementById("orderNotes");
  const btnSendWhatsapp = document.getElementById("btnSendWhatsapp");

  // --- SISTEMA DE MÉTRICAS & ANALÍTICA BULLBAR ---
  function getLocalDateString(d = new Date()) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function trackAnalytics(eventType, data = {}) {
    try {
      let raw = localStorage.getItem("bullbar_analytics");
      let analytics = raw ? JSON.parse(raw) : { visits: [], clicks: [], orders: [] };
      if (!Array.isArray(analytics.visits)) analytics.visits = [];
      if (!Array.isArray(analytics.clicks)) analytics.clicks = [];
      if (!Array.isArray(analytics.orders)) analytics.orders = [];

      const now = new Date();
      const dateStr = getLocalDateString(now);
      const timestamp = Date.now();

      if (eventType === "visit") {
        analytics.visits.push({
          id: "vis_" + timestamp + "_" + Math.random().toString(36).substring(2, 6),
          timestamp,
          date: dateStr,
          device: /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ? "Móvil" : "Desktop",
          referrer: document.referrer || "Directo"
        });
        if (analytics.visits.length > 2500) analytics.visits = analytics.visits.slice(-2500);
      } else if (eventType === "click") {
        analytics.clicks.push({
          id: "clk_" + timestamp + "_" + Math.random().toString(36).substring(2, 6),
          timestamp,
          date: dateStr,
          ...data
        });
        if (analytics.clicks.length > 4000) analytics.clicks = analytics.clicks.slice(-4000);
      } else if (eventType === "order") {
        analytics.orders.push({
          orderId: data.orderId || ("BB-" + Math.floor(100000 + Math.random() * 900000)),
          timestamp,
          date: dateStr,
          time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
          ...data
        });
        if (analytics.orders.length > 1500) analytics.orders = analytics.orders.slice(-1500);
      }

      localStorage.setItem("bullbar_analytics", JSON.stringify(analytics));
    } catch (err) {
      console.warn("BullBar Analytics: no se pudo guardar evento", err);
    }
  }

  function recordPageVisit() {
    const lastVisitKey = "bullbar_last_visit_time";
    const lastTime = sessionStorage.getItem(lastVisitKey);
    const nowTime = Date.now();
    if (!lastTime || (nowTime - parseInt(lastTime, 10)) > 10 * 60 * 1000) {
      trackAnalytics("visit");
      sessionStorage.setItem(lastVisitKey, nowTime.toString());
    }
  }

  // Inicializar plataforma
  initApp();

  function initApp() {
    recordPageVisit();
    renderBrandInfo();
    renderCategories();
    renderProducts();
    updateCartUI();
    checkBusinessHours();
    setupEventListeners();
    syncLiveCatalogFromCloud();

    // Actualizar en tiempo real para todos los clientes cuando vuelven a la pestaña o cada 15 segundos
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        syncLiveCatalogFromCloud(false);
      }
    });
    setInterval(() => syncLiveCatalogFromCloud(false), 15000);
  }

  const CLOUD_MENU_ENDPOINT = "https://bullbarbqto.netlify.app/.netlify/functions/menu";
  let lastAppliedCloudTs = 0;

  async function syncLiveCatalogFromCloud(isInitial = true) {
    try {
      const res = await fetch(CLOUD_MENU_ENDPOINT + "?t=" + Date.now(), { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      if (!json || !json.ok || json.empty || !json.data) return;

      const cloudData = json.data;
      const cloudTs = Number(cloudData.updatedAt || 1);

      if (Array.isArray(cloudData.products) && cloudData.products.length > 0) {
        const shouldRender = isInitial || cloudTs !== lastAppliedCloudTs;
        lastAppliedCloudTs = cloudTs;

        state.products = cleanDuplicateProducts(cloudData.products);
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
          localStorage.setItem("bullbar_updated_at", String(cloudTs));
        } catch (e) {}

        if (shouldRender) {
          renderBrandInfo();
          renderCategories();
          renderProducts();
          checkBusinessHours();
        }
      }
    } catch (e) {
      // Modo local sin función serverless activa
    }
  }

  // Cargar datos de la marca en el encabezado
  function renderBrandInfo() {
    const cfg = state.config;
    document.getElementById("brandName").textContent = cfg.name || "BullBar";
    document.getElementById("brandTagline").textContent = cfg.tagline || "Tu Social Lounge Favorito";
    document.getElementById("brandAddress").textContent = cfg.address || "BullBar Social - Barquisimeto, Lara, Venezuela";
    if (cfg.logoImage) document.getElementById("brandLogo").src = cfg.logoImage;
    if (cfg.bannerImage) document.getElementById("brandBanner").src = cfg.bannerImage;

    const instagramLink = document.getElementById("instagramLink");
    if (instagramLink) instagramLink.href = cfg.instagramUrl || "https://www.instagram.com/bullbar_bqto";

    const googleLink = document.getElementById("googleLink");
    if (googleLink && cfg.googleBusinessUrl) googleLink.href = cfg.googleBusinessUrl;

    const brandAddressLink = document.getElementById("brandAddressLink");
    if (brandAddressLink && cfg.googleBusinessUrl) brandAddressLink.href = cfg.googleBusinessUrl;

    const footerGoogleLink = document.getElementById("footerGoogleLink");
    if (footerGoogleLink && cfg.googleBusinessUrl) footerGoogleLink.href = cfg.googleBusinessUrl;

    const directWaLink = document.getElementById("directWaLink");
    if (directWaLink) {
      directWaLink.href = `https://wa.me/${cfg.whatsappNumber || "584228888356"}?text=${encodeURIComponent("¡Hola BullBar! Quisiera consultar información sobre su menú y reservas.")}`;
    }
  }

  // Verificar si el local está abierto (Hora de Barquisimeto UTC-4 o Forzado)
  function checkBusinessHours() {
    const statusBadge = document.getElementById("statusBadge");
    if (!statusBadge) return;

    if (state.config.forceStatus === "closed") {
      statusBadge.textContent = "Cerrado Temporalmente";
      statusBadge.className = "badge-status closed";
      return;
    }
    if (state.config.forceStatus === "open") {
      statusBadge.textContent = "Abierto Ahora";
      statusBadge.className = "badge-status";
      return;
    }

    try {
      const now = new Date();
      // Ajuste de zona horaria de Venezuela (UTC-4)
      const options = { timeZone: "America/Caracas", hour: "numeric", minute: "numeric", hour12: false };
      const formatter = new Intl.DateTimeFormat([], options);
      const parts = formatter.formatToParts(now);
      const hours = parseInt(parts.find(p => p.type === "hour").value, 10);
      
      // BullBar abre usualmente a partir de las 2:00 PM (14:00) hasta tarde
      const isOpen = (hours >= 14 || hours < 2);
      if (isOpen) {
        statusBadge.textContent = "Abierto Ahora";
        statusBadge.className = "badge-status";
      } else {
        statusBadge.textContent = "Cerrado (Abre a las 2:00 PM)";
        statusBadge.className = "badge-status closed";
      }
    } catch (e) {
      statusBadge.textContent = "Abierto";
      statusBadge.className = "badge-status";
    }
  }

  // Renderizar filtros de categorías
  function renderCategories() {
    categoriesContainer.innerHTML = "";
    state.categories.forEach(cat => {
      // Contar items por categoría
      const count = cat.id === "all" 
        ? state.products.length 
        : state.products.filter(p => p.categoryId === cat.id).length;

      if (count === 0 && cat.id !== "all") return;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `category-chip ${state.activeCategory === cat.id ? "active" : ""}`;
      btn.innerHTML = `
        <span>${cat.name}</span>
        <span class="chip-count">${count}</span>
      `;
      btn.addEventListener("click", () => {
        trackAnalytics("click", {
          action: "category_click",
          categoryId: cat.id,
          categoryName: cat.name
        });
        state.activeCategory = cat.id;
        state.searchQuery = "";
        searchInput.value = "";
        searchClear.style.display = "none";
        renderCategories();
        renderProducts();
        
        // Scroll suave hacia los productos
        const topControls = document.querySelector(".sticky-controls");
        if (topControls) {
          const y = topControls.getBoundingClientRect().top + window.pageYOffset - 10;
          window.scrollTo({ top: y, behavior: "smooth" });
        }
      });
      categoriesContainer.appendChild(btn);
    });
  }

  // Filtrar y renderizar productos
  function renderProducts() {
    productsContainer.innerHTML = "";

    let filtered = state.products.filter(p => p.available);

    // Filtro por categoría
    if (state.activeCategory !== "all") {
      filtered = filtered.filter(p => p.categoryId === state.activeCategory);
    }

    // Filtro por búsqueda
    if (state.searchQuery.trim() !== "") {
      const q = state.searchQuery.toLowerCase().trim();
      filtered = filtered.filter(p => 
        p.name.toLowerCase().includes(q) || 
        (p.description && p.description.toLowerCase().includes(q)) ||
        (p.categoryName && p.categoryName.toLowerCase().includes(q))
      );
    }

    if (filtered.length === 0) {
      productsContainer.innerHTML = `
        <div class="no-results">
          <svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8"></circle>
            <path d="m21 21-4.3-4.3"></path>
          </svg>
          <h3>No encontramos productos</h3>
          <p>Intenta buscando con otra palabra o selecciona otra categoría.</p>
        </div>
      `;
      return;
    }

    // Si estamos en "Todos" y sin búsqueda, organizamos con encabezados de categoría
    if (state.activeCategory === "all" && state.searchQuery.trim() === "") {
      const grouped = {};
      state.categories.forEach(cat => {
        if (cat.id === "all") return;
        const items = filtered.filter(p => p.categoryId === cat.id);
        if (items.length > 0) {
          grouped[cat.id] = { category: cat, items };
        }
      });

      Object.values(grouped).forEach(group => {
        const sectionHeader = document.createElement("div");
        sectionHeader.className = "category-section-header";
        sectionHeader.innerHTML = `
          <h2 class="category-section-title">
            ${group.category.name}
            ${group.category.badge ? `<span class="category-section-badge">${group.category.badge}</span>` : ""}
          </h2>
          <span class="category-section-count">${group.items.length} opciones</span>
        `;
        productsContainer.appendChild(sectionHeader);

        const grid = document.createElement("div");
        grid.className = "products-grid";
        group.items.forEach(product => {
          grid.appendChild(createProductCard(product));
        });
        productsContainer.appendChild(grid);
      });
    } else {
      // Vista filtrada directa
      const grid = document.createElement("div");
      grid.className = "products-grid";
      filtered.forEach(product => {
        grid.appendChild(createProductCard(product));
      });
      productsContainer.appendChild(grid);
    }
  }

  // Generador de Tarjeta de Producto
  function createProductCard(product) {
    const card = document.createElement("div");
    card.className = "product-card";
    card.innerHTML = `
      <div class="product-img-wrap">
        <img src="${product.image}" alt="${product.name}" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&w=600&q=80'">
        ${product.badge ? `<span class="product-badge-overlay">${product.badge}</span>` : ""}
      </div>
      <div class="product-card-body">
        <span class="product-category-sub">${product.categoryName}</span>
        <h3 class="product-title">${product.name}</h3>
        <p class="product-desc">${product.description || "Deliciosa opción preparada con la más alta calidad en BullBar."}</p>
        <div class="product-card-footer">
          <div class="product-price-box">
            <span class="product-price-label">Precio</span>
            <span class="product-price">$${product.price.toFixed(2)}</span>
          </div>
          <div class="card-action-btns">
            <span class="card-view-btn" title="Ver descripción y detalles">
              <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="16" x2="12" y2="12"></line>
                <line x1="12" y1="8" x2="12.01" y2="8"></line>
              </svg>
              <span>Ver más</span>
            </span>
            <button type="button" class="btn-add-quick" title="Añadir directo al pedido">
              <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                <path d="M12 5v14M5 12h14"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    `;

    // Click en botón rápido "+"
    const addQuickBtn = card.querySelector(".btn-add-quick");
    addQuickBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      addToCart(product, 1, "");
      trackAnalytics("click", {
        action: "quick_add",
        productId: product.id,
        productName: product.name,
        categoryName: product.categoryName,
        price: product.price
      });
      showToast(`¡${product.name} agregado!`);
    });

    // Click en la tarjeta abre el modal de detalle completo
    card.addEventListener("click", () => {
      trackAnalytics("click", {
        action: "view_product",
        productId: product.id,
        productName: product.name,
        categoryName: product.categoryName,
        price: product.price
      });
      openProductModal(product);
    });

    return card;
  }

  // Modal de Detalle de Producto
  function openProductModal(product) {
    if (!product) return;
    state.currentModalProduct = product;
    state.modalQuantity = 1;

    const imgEl = document.getElementById("modalProductImg");
    if (imgEl) {
      imgEl.src = product.image;
      imgEl.alt = product.name;
    }

    const catEl = document.getElementById("modalProductCategory");
    if (catEl) catEl.textContent = product.categoryName || "BULLBAR";

    const titleEl = document.getElementById("modalProductTitle");
    if (titleEl) titleEl.textContent = product.name;

    const descEl = document.getElementById("modalProductDesc");
    if (descEl) {
      descEl.textContent = product.description && product.description.trim() !== ""
        ? product.description
        : "Deliciosa opción preparada con la más alta calidad y sabor exclusivo en BullBar Social Lounge.";
    }

    const priceEl = document.getElementById("modalProductPrice");
    if (priceEl) priceEl.textContent = `$${product.price.toFixed(2)}`;

    const notesEl = document.getElementById("modalNotes");
    if (notesEl) notesEl.value = "";

    const qtyDisplay = document.getElementById("modalQuantityDisplay");
    if (qtyDisplay) qtyDisplay.textContent = "1";

    updateModalTotalPrice();

    if (productModal) {
      productModal.classList.add("active");
      document.body.style.overflow = "hidden";
    }
  }

  function closeProductModal() {
    if (productModal) {
      productModal.classList.remove("active");
      document.body.style.overflow = "";
    }
    state.currentModalProduct = null;
  }

  // Lightbox de Imagen en Pantalla Completa
  function openImageLightbox(imageUrl, title) {
    if (!imageUrl) return;
    trackAnalytics("click", {
      action: "zoom_image",
      productTitle: title || "Foto de Producto"
    });
    if (lightboxImg) lightboxImg.src = imageUrl;
    if (lightboxTitle) lightboxTitle.textContent = title || "BullBar Social Lounge";
    if (imageLightboxModal) {
      imageLightboxModal.classList.add("active");
      document.body.style.overflow = "hidden";
    }
  }

  function closeImageLightbox() {
    if (imageLightboxModal) {
      imageLightboxModal.classList.remove("active");
      // Si el modal de producto sigue abierto, mantener el scroll bloqueado; si no, restaurar
      if (!productModal || !productModal.classList.contains("active")) {
        document.body.style.overflow = "";
      }
    }
  }

  function updateModalTotalPrice() {
    if (!state.currentModalProduct) return;
    const total = state.currentModalProduct.price * state.modalQuantity;
    document.getElementById("modalAddPrice").textContent = `$${total.toFixed(2)}`;
  }

  // Carrito de compras
  function addToCart(product, quantity = 1, note = "") {
    // Buscar si ya existe el mismo producto con la misma nota
    const existingIndex = state.cart.findIndex(item => item.id === product.id && item.note === note);

    if (existingIndex > -1) {
      state.cart[existingIndex].quantity += quantity;
    } else {
      state.cart.push({
        id: product.id,
        name: product.name,
        price: product.price,
        image: product.image,
        categoryName: product.categoryName,
        quantity: quantity,
        note: note
      });
    }

    saveCartToStorage();
    updateCartUI();
  }

  function updateCartQuantity(index, delta) {
    if (state.cart[index]) {
      state.cart[index].quantity += delta;
      if (state.cart[index].quantity <= 0) {
        state.cart.splice(index, 1);
      }
      saveCartToStorage();
      updateCartUI();
    }
  }

  function removeCartItem(index) {
    if (state.cart[index]) {
      state.cart.splice(index, 1);
      saveCartToStorage();
      updateCartUI();
    }
  }

  function clearCart() {
    if (confirm("¿Estás seguro de que deseas vaciar tu carrito?")) {
      state.cart = [];
      saveCartToStorage();
      updateCartUI();
    }
  }

  function updateCartUI() {
    const totalItems = state.cart.reduce((sum, item) => sum + item.quantity, 0);
    const totalPrice = state.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    // Botón flotante
    if (totalItems > 0) {
      floatingCartBtn.classList.remove("empty");
      cartBadge.textContent = totalItems;
      cartBtnTotal.textContent = `$${totalPrice.toFixed(2)}`;
    } else {
      floatingCartBtn.classList.add("empty");
    }

    // Totales en el Drawer
    if (subtotalAmountEl) subtotalAmountEl.textContent = `$${totalPrice.toFixed(2)}`;
    if (totalAmountEl) totalAmountEl.textContent = `$${totalPrice.toFixed(2)}`;

    // Renderizar items dentro del Drawer
    renderCartDrawerItems();
  }

  function renderCartDrawerItems() {
    cartItemsList.innerHTML = "";

    if (state.cart.length === 0) {
      cartItemsList.innerHTML = `
        <div class="cart-empty-message">
          <svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
            <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <path d="M16 10a4 4 0 0 1-8 0"></path>
          </svg>
          <h4>Tu carrito está vacío</h4>
          <p>Explora el menú y agrega tus cócteles, tapas o cervezas favoritas.</p>
        </div>
      `;
      return;
    }

    state.cart.forEach((item, index) => {
      const itemEl = document.createElement("div");
      itemEl.className = "cart-item";
      itemEl.innerHTML = `
        <img class="cart-item-img" src="${item.image}" alt="${item.name}" onerror="this.src='https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&w=600&q=80'">
        <div class="cart-item-info">
          <div class="cart-item-title">${item.name}</div>
          ${item.note ? `<div class="cart-item-note">"${item.note}"</div>` : ""}
          <div class="cart-item-price">$${item.price.toFixed(2)} x ${item.quantity} = $${(item.price * item.quantity).toFixed(2)}</div>
        </div>
        <div class="cart-item-actions">
          <button type="button" class="cart-qty-btn btn-qty-minus">-</button>
          <span class="cart-qty-num">${item.quantity}</span>
          <button type="button" class="cart-qty-btn btn-qty-plus">+</button>
          <button type="button" class="btn-remove-item" title="Eliminar">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M18 6L6 18M6 6l12 12"></path>
            </svg>
          </button>
        </div>
      `;

      itemEl.querySelector(".btn-qty-minus").addEventListener("click", () => updateCartQuantity(index, -1));
      itemEl.querySelector(".btn-qty-plus").addEventListener("click", () => updateCartQuantity(index, 1));
      itemEl.querySelector(".btn-remove-item").addEventListener("click", () => removeCartItem(index));

      cartItemsList.appendChild(itemEl);
    });
  }

  // Cambio de método de entrega / consumo
  function handleServiceTypeChange(type) {
    state.serviceType = type;
    document.querySelectorAll(".service-type-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.type === type);
    });

    if (type === "onsite") {
      locationFieldGroup.style.display = "flex";
      locationLabel.textContent = "Número de Mesa o Ubicación en Local *";
      locationInput.placeholder = "Ej: Mesa 8, Terraza, Barra alta...";
      locationInput.required = true;
    } else if (type === "delivery") {
      locationFieldGroup.style.display = "flex";
      locationLabel.textContent = "Dirección de Entrega y Punto de Referencia *";
      locationInput.placeholder = "Ej: Urb. del Este, Calle 4, Edif. Los Samanes apto 2B...";
      locationInput.required = true;
    } else {
      // Pick up
      locationFieldGroup.style.display = "none";
      locationInput.required = false;
    }
  }

  // Generador y envío de Pedido por WhatsApp
  function submitOrderToWhatsApp() {
    if (state.cart.length === 0) {
      alert("Por favor agrega al menos un producto a tu carrito.");
      return;
    }

    const clientName = clientNameInput.value.trim();
    if (!clientName) {
      alert("Por favor ingresa tu nombre para identificar el pedido.");
      clientNameInput.focus();
      return;
    }

    let locationDetails = locationInput.value.trim();
    if (state.serviceType !== "pickup" && !locationDetails) {
      alert(state.serviceType === "onsite" ? "Por favor especifica tu número de mesa o ubicación." : "Por favor especifica tu dirección de entrega.");
      locationInput.focus();
      return;
    }

    const clientPhone = clientPhoneInput.value.trim();
    const paymentMethodText = paymentMethodSelect.options[paymentMethodSelect.selectedIndex].text;
    const additionalNotes = orderNotesInput.value.trim();
    const totalPrice = state.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    let modalLabel = "Consumo en Local (Mesa)";
    if (state.serviceType === "pickup") modalLabel = "Para Retirar (Pick-Up)";
    if (state.serviceType === "delivery") modalLabel = "Delivery a Domicilio";

    // Formatear texto para WhatsApp con diseño limpio y profesional
    let message = `🍹 *¡HOLA BULLBAR! QUIERO HACER UN PEDIDO* 🍹\n`;
    message += `─────────────────────────\n`;
    message += `👤 *Cliente:* ${clientName}\n`;
    if (clientPhone) message += `📞 *Teléfono:* ${clientPhone}\n`;
    message += `📍 *Modalidad:* ${modalLabel}\n`;
    if (state.serviceType !== "pickup") {
      message += `📌 *${state.serviceType === 'onsite' ? 'Mesa / Ubicación' : 'Dirección'}:* ${locationDetails}\n`;
    }
    message += `💳 *Método de Pago:* ${paymentMethodText}\n`;
    message += `─────────────────────────\n\n`;
    message += `🛒 *DETALLE DEL PEDIDO:*\n`;

    state.cart.forEach((item, i) => {
      message += `▫️ *${item.quantity}x* ${item.name} ($${item.price.toFixed(2)} c/u) = *$${(item.price * item.quantity).toFixed(2)}*\n`;
      if (item.note) {
        message += `   ↳ _Nota: ${item.note}_\n`;
      }
    });

    message += `\n─────────────────────────\n`;
    message += `💰 *TOTAL A PAGAR: $${totalPrice.toFixed(2)} USD*\n`;
    message += `─────────────────────────\n`;

    if (additionalNotes) {
      message += `📝 *Comentarios adicionales:* ${additionalNotes}\n\n`;
    }

    message += `✨ _Enviado desde el Menú Digital Oficial de BullBar_`;

    // Registrar pedido concretado en analítica
    const orderId = "BB-" + Math.floor(100000 + Math.random() * 900000);
    const orderRecord = {
      orderId: orderId,
      clientName: clientName,
      clientPhone: clientPhone || "No especificado",
      serviceType: state.serviceType,
      serviceLabel: modalLabel,
      location: state.serviceType !== "pickup" ? locationDetails : "Para Retirar en Barra",
      paymentMethod: paymentMethodText,
      items: state.cart.map(item => ({
        id: item.id,
        name: item.name,
        categoryName: item.categoryName || "",
        price: item.price,
        quantity: item.quantity,
        note: item.note || "",
        subtotal: parseFloat((item.price * item.quantity).toFixed(2))
      })),
      itemCount: state.cart.reduce((sum, item) => sum + item.quantity, 0),
      total: parseFloat(totalPrice.toFixed(2)),
      notes: additionalNotes || "",
      status: "completed"
    };
    trackAnalytics("order", orderRecord);

    // Abrir enlace oficial de WhatsApp
    const encodedMsg = encodeURIComponent(message);
    const targetPhone = state.config.whatsappNumber || "584228888356";
    const waUrl = `https://api.whatsapp.com/send?phone=${targetPhone}&text=${encodedMsg}`;

    window.open(waUrl, "_blank");

    // Limpiar carrito o mantener si el usuario desea
    showToast("¡Pedido generado! Abriendo WhatsApp...");
    setTimeout(() => {
      cartDrawerOverlay.classList.remove("active");
    }, 800);
  }

  // Notificación tipo Toast
  function showToast(message) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerHTML = `
      <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
        <path d="M20 6L9 17l-5-5"></path>
      </svg>
      <span>${message}</span>
    `;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 3000);
  }

  // Guardar y cargar carrito en LocalStorage
  function saveCartToStorage() {
    try {
      localStorage.setItem("bullbar_cart", JSON.stringify(state.cart));
    } catch (e) {}
  }

  function loadCartFromStorage() {
    try {
      const data = localStorage.getItem("bullbar_cart");
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  // Listeners de Eventos
  function setupEventListeners() {
    // Sincronizar automáticamente si se edita el menú desde el panel administrativo en otra pestaña
    window.addEventListener("storage", (e) => {
      if (e.key === "bullbar_products" || e.key === "bullbar_categories" || e.key === "bullbar_config") {
        state.config = getConfig();
        state.categories = getCategories();
        state.products = getProducts();
        renderBrandInfo();
        renderCategories();
        renderProducts();
        checkBusinessHours();
      }
    });

    // Buscador
    searchInput.addEventListener("input", (e) => {
      state.searchQuery = e.target.value;
      searchClear.style.display = state.searchQuery ? "block" : "none";
      renderProducts();
    });

    searchClear.addEventListener("click", () => {
      state.searchQuery = "";
      searchInput.value = "";
      searchClear.style.display = "none";
      renderProducts();
      searchInput.focus();
    });

    // Abrir Drawer de Carrito
    floatingCartBtn.addEventListener("click", () => {
      cartDrawerOverlay.classList.add("active");
    });

    closeCartDrawerBtn.addEventListener("click", () => {
      cartDrawerOverlay.classList.remove("active");
    });

    cartDrawerOverlay.addEventListener("click", (e) => {
      if (e.target === cartDrawerOverlay) {
        cartDrawerOverlay.classList.remove("active");
      }
    });

    clearCartBtn.addEventListener("click", clearCart);

    // Controles dentro del Modal de Detalle
    closeProductModalBtn.addEventListener("click", closeProductModal);
    productModal.addEventListener("click", (e) => {
      if (e.target === productModal) closeProductModal();
    });

    document.getElementById("modalQtyMinus").addEventListener("click", () => {
      if (state.modalQuantity > 1) {
        state.modalQuantity--;
        document.getElementById("modalQuantityDisplay").textContent = state.modalQuantity;
        updateModalTotalPrice();
      }
    });

    document.getElementById("modalQtyPlus").addEventListener("click", () => {
      state.modalQuantity++;
      document.getElementById("modalQuantityDisplay").textContent = state.modalQuantity;
      updateModalTotalPrice();
    });

    document.getElementById("btnModalAddToCart").addEventListener("click", () => {
      if (state.currentModalProduct) {
        const note = document.getElementById("modalNotes").value.trim();
        trackAnalytics("click", {
          action: "modal_add",
          productId: state.currentModalProduct.id,
          productName: state.currentModalProduct.name,
          categoryName: state.currentModalProduct.categoryName,
          quantity: state.modalQuantity,
          price: state.currentModalProduct.price,
          total: parseFloat((state.currentModalProduct.price * state.modalQuantity).toFixed(2))
        });
        addToCart(state.currentModalProduct, state.modalQuantity, note);
        showToast(`¡${state.currentModalProduct.name} agregado al pedido!`);
        closeProductModal();
      }
    });

    // Tracking de enlaces a redes sociales y atención
    const igEl = document.getElementById("instagramLink");
    if (igEl) igEl.addEventListener("click", () => trackAnalytics("click", { action: "social_click", target: "Instagram" }));
    const gEl = document.getElementById("googleLink");
    if (gEl) gEl.addEventListener("click", () => trackAnalytics("click", { action: "social_click", target: "Google Maps" }));
    const addrEl = document.getElementById("brandAddressLink");
    if (addrEl) addrEl.addEventListener("click", () => trackAnalytics("click", { action: "social_click", target: "Google Maps Dirección" }));
    const waDirectEl = document.getElementById("directWaLink");
    if (waDirectEl) waDirectEl.addEventListener("click", () => trackAnalytics("click", { action: "social_click", target: "WhatsApp Atención Directa" }));

    // Botones de tipo de servicio (Mesa / Llevar / Delivery)
    document.querySelectorAll(".service-type-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        handleServiceTypeChange(btn.dataset.type);
      });
    });

    // Abrir Lightbox al hacer clic en la foto del producto dentro del modal
    if (modalImgWrap) {
      modalImgWrap.addEventListener("click", () => {
        if (state.currentModalProduct) {
          openImageLightbox(state.currentModalProduct.image, state.currentModalProduct.name);
        }
      });
    }

    if (btnZoomModalImg) {
      btnZoomModalImg.addEventListener("click", (e) => {
        e.stopPropagation();
        if (state.currentModalProduct) {
          openImageLightbox(state.currentModalProduct.image, state.currentModalProduct.name);
        }
      });
    }

    // Cerrar Lightbox
    if (closeLightboxBtn) {
      closeLightboxBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        closeImageLightbox();
      });
    }

    if (imageLightboxModal) {
      imageLightboxModal.addEventListener("click", (e) => {
        if (e.target === imageLightboxModal || e.target.classList.contains("lightbox-container") || e.target.classList.contains("lightbox-img-wrapper")) {
          closeImageLightbox();
        }
      });
    }

    // Botón Final de Enviar a WhatsApp
    btnSendWhatsapp.addEventListener("click", (e) => {
      e.preventDefault();
      submitOrderToWhatsApp();
    });

    // Cerrar modales con tecla Escape (priorizando lightbox si está activo)
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (imageLightboxModal && imageLightboxModal.classList.contains("active")) {
          closeImageLightbox();
          return;
        }
        closeProductModal();
        cartDrawerOverlay.classList.remove("active");
      }
    });
  }
});
