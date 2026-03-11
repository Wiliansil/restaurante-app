// admin.js - painel administrativo
(function () {
  const channel =
    "BroadcastChannel" in window
      ? new BroadcastChannel("restaurante-channel")
      : null;

  const LS_ORDERS = "rb-orders-v1";
  const LS_PRODUCTS = "rb-products-v1";
  const LS_WAITER_CALLS = "rb-waiter-calls";

  const q = (s) => document.querySelector(s);
  const qs = (s) => Array.from(document.querySelectorAll(s));
  const fmtBRL = (v) =>
    v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  function readLS(k, def) {
    try {
      const r = localStorage.getItem(k);
      return r ? JSON.parse(r) : def;
    } catch (e) {
      return def;
    }
  }

  function writeLS(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) { }
  }

  // Buscar vendas do backend (pedidos feitos em outros dispositivos)
  async function fetchVendasFromAPI() {
    try {
      const res = await fetch(window.location.origin + '/api/vendas');
      if (!res.ok) return;
      const vendas = await res.json();
      ordersFromAPI = (vendas || []).map((v) => {
        const itens = Array.isArray(v.itens) ? v.itens : (typeof v.itens === 'string' ? JSON.parse(v.itens || '[]') : []);
        return {
          id: 'api-' + v.id,
          clientId: null,
          sessionName: v.session_name || 'Cliente',
          table: v.mesa || 'N/A',
          items: itens,
          status: 'closed',
          open: false,
          createdAt: v.criado_em,
          closedAt: v.criado_em,
          fromAPI: true,
          total: parseFloat(v.total) || 0
        };
      });
    } catch (e) {
      console.warn('fetchVendasFromAPI falhou:', e);
      ordersFromAPI = [];
    }
  }

  // Lista mesclada: localStorage + API (para exibir pedidos de todos os dispositivos)
  function getMergedOrders() {
    const lsClosedKeys = new Set(
      orders
        .filter((o) => o.status === 'closed')
        .map((o) => {
          const total = o.items ? o.items.reduce((s, i) => s + i.price * i.qty, 0) : (o.total || 0);
          return `${o.table}-${o.sessionName || ''}-${total.toFixed(2)}`;
        })
    );
    const fromAPI = ordersFromAPI.filter((v) => {
      const total = v.total || (v.items ? v.items.reduce((s, i) => s + i.price * i.qty, 0) : 0);
      const key = `${v.table}-${v.sessionName || ''}-${total.toFixed(2)}`;
      return !lsClosedKeys.has(key);
    });
    return [...orders, ...fromAPI];
  }

  // Buscar pedido por ID (localStorage ou API)
  function getOrderById(id) {
    const o = orders.find((x) => String(x.id) === String(id));
    if (o) return o;
    return ordersFromAPI.find((x) => String(x.id) === String(id)) || null;
  }

  // State
  let orders = readLS(LS_ORDERS, []);
  let ordersFromAPI = []; // Vendas do backend (GET /api/vendas) - pedidos de outros dispositivos
  let products = readLS(LS_PRODUCTS, {
    pratos: [],
    bebidas: [],
    sobremesas: [],
    porcoes: [],
  });

  // Audio Context (Web Audio API) for sounds
  let audioCtx = null;

  function initAudioCtx() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  // Lidar com a política de autoplay
  document.addEventListener("click", initAudioCtx, { once: true });
  document.addEventListener("keydown", initAudioCtx, { once: true });
  document.addEventListener("touchstart", initAudioCtx, { once: true });

  function tocarBipeGarcom() {
    if (!audioCtx) initAudioCtx();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const freq = 880; // Lá (A5)
    function playBeep(startTime) {
      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(0.5, startTime + 0.01);
      gainNode.gain.setValueAtTime(0.5, startTime + 0.11);
      gainNode.gain.linearRampToValueAtTime(0, startTime + 0.12);

      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      osc.start(startTime);
      osc.stop(startTime + 0.12);
    }

    const now = audioCtx.currentTime;
    playBeep(now);
    playBeep(now + 0.22); // 100ms de intervalo (+120ms do beep)
    playBeep(now + 0.44);
  }

  function tocarSomNovoPedido() {
    if (!audioCtx) initAudioCtx();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    function playTone(freq, start, duration) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.3, start + 0.03);
      gain.gain.setValueAtTime(0.3, start + duration - 0.03);
      gain.gain.linearRampToValueAtTime(0, start + duration);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start(start);
      osc.stop(start + duration);
    }

    const now = audioCtx.currentTime;
    playTone(523.25, now, 0.15); // Dó (C5) por 150ms
    playTone(659.25, now + 0.23, 0.15); // Mi (E5) por 150ms (+80ms intervalo) 
  }

  // Variáveis para rastrear notificações exibidas
  let lastPedidosCount = orders.reduce((sum, o) => sum + (o.items ? o.items.length : 0), 0);
  let lastPendingCallIds = new Set(readLS(LS_WAITER_CALLS, []).filter(c => c.status === "pending").map(c => c.id));

  function verificarNotificacoesAudio() {
    // Verificar novos chamados do garçom
    const pendingCalls = waiterCalls.filter(c => c.status === "pending");
    let hasNewCall = false;
    const currentPendingIds = new Set();

    pendingCalls.forEach(call => {
      currentPendingIds.add(call.id);
      if (!lastPendingCallIds.has(call.id)) {
        hasNewCall = true;
      }
    });

    if (hasNewCall) {
      tocarBipeGarcom();
    }
    lastPendingCallIds = currentPendingIds;

    // Verificar novos pedidos detectados via badge de notificação ou total de items
    const hasOrderNotification = orders.some(o => o.tem_notificacao);
    const currentItemsCount = orders.reduce((sum, o) => sum + (o.items ? o.items.length : 0), 0);

    if (hasOrderNotification || currentItemsCount > lastPedidosCount) {
      // Garantir que tocamos somente se o número de itens subiu ou a flag é explicitamente true
      // Limpeza de flag na comanda já previne duplos toques de um mesmo evento lido
      tocarSomNovoPedido();
    }
    lastPedidosCount = currentItemsCount;
  }

  // Dados iniciais fictícios para teste (se estiver vazio)
  const defaultDummies = {
    pratos: [
      {
        id: 1,
        name: "Filé Parmegiana",
        description: "Filé mignon empanado com molho de tomate e queijo gratinado, acompanha arroz e fritas",
        price: 59.9,
        image: "",
      },
      {
        id: 2,
        name: "Picanha na Chapa",
        description: "Picanha grelhada com alho, acompanha arroz, farofa e vinagrete",
        price: 79.9,
        image: "",
      },
    ],
    bebidas: [
      {
        id: 101,
        name: "Coca-Cola Lata",
        description: "350ml",
        price: 6.0,
        image: "",
      },
      {
        id: 102,
        name: "Suco de Laranja",
        description: "Natural 500ml",
        price: 12.0,
        image: "",
      },
    ],
    sobremesas: [
      {
        id: 201,
        name: "Pudim de Leite",
        description: "Com calda de caramelo",
        price: 15.0,
        image: "",
      },
    ],
    porcoes: [
      {
        id: 301,
        name: "Batata Frita",
        description: "Porção 400g",
        price: 25.0,
        image: "",
      },
    ]
  };

  // Se não houver produtos, carrega os fictícios
  if (
    products.pratos.length === 0 &&
    products.bebidas.length === 0 &&
    products.sobremesas.length === 0 &&
    products.porcoes.length === 0
  ) {
    products = defaultDummies;
    writeLS(LS_PRODUCTS, products);
  }
  let waiterCalls = readLS(LS_WAITER_CALLS, []);
  let currentFilter = "all";

  // DOM refs
  const pedidosBadge = q("#pedidosBadge");
  const comandasBadge = q("#comandasBadge");
  const finalizadasBadge = q("#finalizadasBadge");
  const waiterBadge = q("#waiterBadge");

  const statPending = q("#statPending");
  const statActive = q("#statActive");
  const statDelivered = q("#statDelivered");
  const statRevenue = q("#statRevenue");

  const dashboardOrders = q("#dashboardOrders");
  const allOrdersList = q("#allOrdersList");
  const comandasGrid = q("#comandasGrid");
  const finalizadasGrid = q("#finalizadasGrid");
  const productsGrid = q("#productsGrid");
  const waiterCallsList = q("#waiterCallsList");

  const notification = q("#notification");
  const notificationText = q("#notificationText");
  const notificationSub = q("#notificationSub");

  // Navigation
  qs(".nav-item").forEach((item) => {
    item.addEventListener("click", () => {
      qs(".nav-item").forEach((i) => i.classList.remove("active"));
      item.classList.add("active");

      const section = item.dataset.section;
      if (!section) return;

      qs(".section").forEach((s) => s.classList.remove("active"));
      const target = q("#" + section);
      if (target) target.classList.add("active");
    });
  });

  // ===== FILTROS FUNCIONANDO =====
  qs(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      qs(".filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.dataset.filter;
      renderAllOrders();
    });
  });

  // Render functions
  function renderStats() {
    const merged = getMergedOrders();
    const pending = merged.filter((o) => o.open && o.status === "open").length;
    const active = merged.filter((o) => o.open).length;
    const delivered = merged.filter((o) => o.status === "closed").length;
    const revenue = merged
      .filter((o) => o.status === "closed")
      .reduce(
        (s, o) =>
          s +
          (o.items
            ? o.items.reduce((a, i) => a + i.price * i.qty, 0)
            : (o.total || 0)),
        0
      );

    // Métricas adicionais
    const avgTicket = delivered > 0 ? revenue / delivered : 0;

    // Ocupação: contar mesas únicas ativas
    const activeTables = new Set(merged.filter(o => o.open).map(o => o.table)).size;
    const totalTables = 20; // Capacidade simulada
    const occupancy = Math.round((activeTables / totalTables) * 100);

    // DOM Updates
    if (statPending) statPending.textContent = pending;
    if (statActive) statActive.textContent = active;
    if (statDelivered) statDelivered.textContent = delivered;
    if (statRevenue) statRevenue.textContent = fmtBRL(revenue);

    const statTicket = q("#statTicket");
    if (statTicket) statTicket.textContent = fmtBRL(avgTicket);

    const statOccupancy = q("#statOccupancy");
    if (statOccupancy) statOccupancy.textContent = `${occupancy}%`;

    if (pedidosBadge) pedidosBadge.textContent = merged.length;
    if (comandasBadge)
      comandasBadge.textContent = merged.filter((o) => o.open).length;
    if (finalizadasBadge)
      finalizadasBadge.textContent = merged.filter(
        (o) => o.status === "closed"
      ).length;

    const pendingCalls = waiterCalls.filter(
      (c) => c.status === "pending"
    ).length;
    if (waiterBadge) {
      waiterBadge.textContent = pendingCalls;
      waiterBadge.style.display = pendingCalls > 0 ? "inline-flex" : "none";
    }
  }

  function getStatusBadge(order) {
    if (order.status === "closed") return "Fechada";
    if (order.status === "sent") return "Aguardando";
    if (order.status === "preparing") return "Preparando";
    if (order.status === "ready") return "Pronto";
    return "Aberta";
  }

  function renderDashboardOrders() {
    if (!dashboardOrders) return;
    dashboardOrders.innerHTML = "";

    const merged = getMergedOrders();
    if (merged.length === 0) {
      dashboardOrders.innerHTML =
        '<div style="padding: 40px; text-align: center; color: var(--text-secondary);">Nenhum pedido ainda</div>';
      return;
    }

    merged
      .slice()
      .reverse()
      .slice(0, 10)
      .forEach((o) => {
        const row = document.createElement("div");
        row.className = "order-row";

        const itemsText = o.items
          ? o.items.map((i) => `${i.qty}x ${i.name}`).join(", ")
          : "Sem itens";

        const total = o.items
          ? o.items.reduce((s, i) => s + i.price * i.qty, 0)
          : 0;

        row.innerHTML = `
        <div class="order-table">Mesa ${o.table}</div>
        <div class="order-items">${itemsText}</div>
        <div class="order-total">${fmtBRL(total)}</div>
        <div class="order-customer">${o.sessionName || ""}</div>
        <div class="order-status">${getStatusBadge(o)}</div>
      `;
        dashboardOrders.appendChild(row);
      });
  }

  function renderAllOrders() {
    if (!allOrdersList) return;
    allOrdersList.innerHTML = "";

    const merged = getMergedOrders();
    // Aplica filtro
    let filteredOrders = [];

    if (currentFilter === "all") {
      // "Todos" agora mostra apenas os ativos (não finalizados)
      filteredOrders = merged.filter(o => o.status !== "closed");
    } else if (currentFilter === "closed") {
      filteredOrders = merged.filter(o => o.status === "closed");
    } else if (currentFilter === "pending") {
      filteredOrders = merged.filter(
        (o) => (o.status === "open" || o.status === "pending") && o.status !== "closed"
      );
    } else if (currentFilter === "preparing") {
      filteredOrders = merged.filter((o) => o.status === "preparing");
    } else if (currentFilter === "ready") {
      filteredOrders = merged.filter(
        (o) => o.status === "ready" || o.status === "sent"
      );
    }

    if (filteredOrders.length === 0) {
      allOrdersList.innerHTML =
        '<div style="padding: 40px; text-align: center; color: var(--text-secondary);">Nenhum pedido</div>';
      return;
    }

    filteredOrders
      .slice()
      .reverse()
      .forEach((o) => {
        const row = document.createElement("div");
        row.className = "order-row";

        const total = o.items
          ? o.items.reduce((s, i) => s + i.price * i.qty, 0)
          : 0;

        row.innerHTML = `
        <div>${o.createdAt ? new Date(o.createdAt).toLocaleString() : ""}</div>
        <div style="font-weight: 700; position: relative; display: inline-block;">
          ${o.sessionName || ""}
          ${o.tem_notificacao
            ? `<span class="notification-badge" style="
                position: absolute; 
                top: -8px; 
                right: -25px; 
                background: #ff3b30; 
                color: white; 
                font-size: 9px; 
                padding: 2px 6px; 
                border-radius: 4px;
                animation: pulse-notification 2s infinite;
              ">NOVO</span>`
            : ''}
        </div>
        <div>Mesa ${o.table}</div>
        <div>${o.items ? o.items.length : 0} itens</div>
        <div>${fmtBRL(total)}</div>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-info btn-preparing" data-id="${o.id}">Preparando</button>
          <button class="btn btn-success btn-ready" data-id="${o.id}">Pronto</button>
          <button class="btn btn-primary btn-finish" style="background: #673ab7; border-color: #673ab7;" data-id="${o.id}">Finalizado</button>
          <button class="btn btn-danger btn-delete" data-id="${o.id}">Cancelar</button>
        </div>
      `;
        allOrdersList.appendChild(row);
      });
  }

  function renderComandas() {
    if (!comandasGrid) return;
    comandasGrid.innerHTML = "";

    const open = orders.filter((o) => o.open);

    if (open.length === 0) {
      comandasGrid.innerHTML =
        '<div style="grid-column: 1 / -1; padding: 40px; text-align: center; color: var(--text-secondary);">Nenhuma comanda aberta</div>';
      return;
    }

    open.forEach((o) => {
      const card = document.createElement("div");
      card.className = "comanda-card";
      card.dataset.orderId = o.id;

      // Mostrar apenas uma prévia dos itens (primeiros 3)
      const allItems = o.items || [];
      const previewItems = allItems.slice(0, 3);
      const remainingItems = allItems.length - 3;

      const itemsPreview = previewItems
        .map(
          (i) => `
          <div class="comanda-item">
            <div>${i.qty}x ${i.name}${i.obs ? ' <span style="color: var(--text-secondary); font-size: 11px;">(obs)</span>' : ''}</div>
            <div>${fmtBRL(i.price * i.qty)}</div>
          </div>
        `
        )
        .join("");

      const total = o.items
        ? o.items.reduce((s, i) => s + i.price * i.qty, 0)
        : 0;

      card.innerHTML = `
        <div class="comanda-header">
          <div>
            <div class="comanda-table">Mesa ${o.table}</div>
            <div class="comanda-customer">${o.sessionName || ""}</div>
            ${o.clientId ? `<div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">ID: ${o.clientId.substring(0, 8)}...</div>` : ''}
          </div>
          <div class="comanda-status ${o.status === "sent" ? "finishing active" : ""
        }">
            ${o.status === "sent" ? "AGUARDANDO PAGAMENTO" : "ATIVA"}
          </div>
        </div>
        <div class="comanda-body">
          ${itemsPreview || '<div style="color: var(--text-secondary);">Sem itens</div>'}
          ${remainingItems > 0 ? `<div style="color: var(--primary); font-size: 13px; margin-top: 8px; cursor: pointer;" class="view-more-items" data-order-id="${o.id}">+ ${remainingItems} item(s) mais - Ver detalhes</div>` : ''}
          ${allItems.length <= 3 && allItems.length > 0 ? `<div style="color: var(--primary); font-size: 13px; margin-top: 8px; cursor: pointer;" class="view-more-items" data-order-id="${o.id}">Ver detalhes completos</div>` : ''}
        </div>
        <div class="comanda-total">
          <div>Total</div>
          <div class="value">${fmtBRL(total)}</div>
        </div>
        <div class="comanda-actions">
          <button class="btn btn-info btn-view-comanda" data-id="${o.id}" style="margin-right: 8px;">
            <svg viewBox="0 0 24 24" style="width: 16px; height: 16px; fill: currentColor; vertical-align: middle;">
              <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
            </svg>
            Ver Detalhes
          </button>
          ${o.status === "sent"
          ? `<button class="btn btn-success btn-close-comanda" data-id="${o.id}" data-client="${o.clientId}">Confirmar Pagamento</button>`
          : `<button class="btn btn-primary" onclick="manualCloseComanda(${o.id})">Finalizar Manualmente</button>`
        }
          <button class="btn btn-danger btn-delete" data-id="${o.id
        }">Cancelar</button>
        </div>
      `;

      comandasGrid.appendChild(card);
    });
  }

  function renderFinalizadas() {
    if (!finalizadasGrid) return;
    finalizadasGrid.innerHTML = "";

    const merged = getMergedOrders();
    const closed = merged.filter((o) => o.status === "closed");

    if (closed.length === 0) {
      finalizadasGrid.innerHTML =
        '<div style="grid-column: 1 / -1; padding: 40px; text-align: center; color: var(--text-secondary);">Nenhuma comanda finalizada</div>';
      return;
    }

    closed
      .slice()
      .reverse()
      .forEach((o) => {
        const card = document.createElement("div");
        card.className = "comanda-card closed";

        const items = o.items
          ? o.items
            .map(
              (i) => `
          <div class="comanda-item">
            <div>${i.name}</div>
            <div>${i.qty} x ${fmtBRL(i.price)}</div>
          </div>
        `
            )
            .join("")
          : "";

        const total = o.items
          ? o.items.reduce((s, i) => s + i.price * i.qty, 0)
          : 0;

        card.innerHTML = `
        <div class="comanda-header">
          <div>
            <div class="comanda-table">Mesa ${o.table}</div>
            <div class="comanda-customer">${o.sessionName || ""}</div>
          </div>
          <div class="comanda-status closed">FINALIZADA</div>
        </div>
        <div class="comanda-body">
          ${items}
        </div>
        <div class="comanda-total">
          <div>Total</div>
          <div class="value">${fmtBRL(total)}</div>
        </div>
        <div class="comanda-actions">
          <button class="btn btn-print" onclick="imprimirViaCliente(${JSON.stringify(o.id)})" style="width: 100%; border: 1px solid rgba(255, 255, 255, 0.2); background: var(--bg-lighter);">🖨️ Imprimir Via</button>
        </div>
        <div class="comanda-footer">
          <small>Fechada em ${o.closedAt ? new Date(o.closedAt).toLocaleString() : "N/A"
          }</small>
        </div>
      `;

        finalizadasGrid.appendChild(card);
      });
  }

  function renderWaiterCalls() {
    if (!waiterCallsList) return;
    waiterCallsList.innerHTML = "";

    // Apply deduplication based on table and clientId or clientName for rendering
    const pendingList = waiterCalls.filter((c) => c.status === "pending");
    const pending = [];
    const seen = new Set();

    pendingList.forEach(c => {
      const key = `${c.table}-${c.clientId || c.clientName}`;
      if (!seen.has(key)) {
        seen.add(key);
        pending.push(c);
      }
    });

    if (pending.length === 0) {
      waiterCallsList.innerHTML =
        '<div style="padding: 40px; text-align: center; color: var(--text-secondary);">Nenhum chamado pendente</div>';
      return;
    }

    pending.forEach((call) => {
      const row = document.createElement("div");
      row.className = "waiter-call-row";

      row.innerHTML = `
        <div class="call-info">
          <div class="call-table">Mesa ${call.table}</div>
          <div class="call-customer">${call.clientName || "Cliente"}</div>
          <div class="call-time">${new Date(
        call.timestamp
      ).toLocaleTimeString()}</div>
        </div>
        <button class="btn btn-success btn-dismiss-call" data-id="${call.id
        }">Atender</button>
      `;

      waiterCallsList.appendChild(row);
    });
  }

  let currentProductFilter = "pratos";

  function renderProducts(filter = currentProductFilter) {
    if (!productsGrid) return;
    productsGrid.innerHTML = "";

    const cat = filter;
    if (products[cat]) {
      if (products[cat].length === 0) {
        productsGrid.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-secondary); grid-column: 1/-1;">Nenhum produto nesta categoria</div>';
        return;
      }

      products[cat].forEach((p) => {
        const isHidden = p.visible === false;
        const card = document.createElement("div");
        card.className = `product-card ${isHidden ? 'product-hidden' : ''}`;
        if (isHidden) {
          card.style.opacity = "0.6";
          card.style.filter = "grayscale(1)";
        }

        card.innerHTML = `
        <div class="product-image">
          ${p.image
            ? `<img src="${p.image}" alt="${p.name}" />`
            : `<svg viewBox="0 0 24 24"><path d="M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z"/></svg>`
          }
           ${isHidden ? '<div style="position: absolute; top: 10px; right: 10px; background: rgba(0,0,0,0.7); color: white; padding: 4px 8px; border-radius: 4px; font-size: 10px; text-transform: uppercase; font-weight: bold;">Oculto</div>' : ''}
        </div>
        <div class="product-body">
          <div class="product-name">${p.name}</div>
          <div class="product-desc">${p.description || ""}</div>
          <div class="product-footer">
            <div class="product-price">${fmtBRL(p.price)}</div>
            <div class="product-actions">
              <button class="btn-icon toggle-visible" data-id="${p.id}" data-cat="${cat}" title="${isHidden ? 'Exibir produto' : 'Ocultar produto'}" style="color: ${isHidden ? 'var(--text-secondary)' : 'var(--primary)'}">
                 ${isHidden
            ? `<svg viewBox="0 0 24 24"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z" fill="currentColor"/></svg>`
            : `<svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" fill="currentColor"/></svg>`
          }
              </button>
              <button class="btn-icon edit" data-id="${p.id}" data-cat="${cat}">
                <svg viewBox="0 0 24 24">
                  <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.42l-2.34-2.34a1 1 0 00-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z" fill="currentColor"/>
                </svg>
              </button>
              <button class="btn-icon delete" data-id="${p.id}" data-cat="${cat}">
                <svg viewBox="0 0 24 24">
                  <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      `;

        productsGrid.appendChild(card);
      });
    }
  }

  // Event listener para filtros de produtos (Delegation)
  document.addEventListener("click", (e) => {
    // Apenas se estiver dentro da seção produtos
    const section = e.target.closest("#produtos");
    if (!section) return;

    const btn = e.target.closest(".product-tab");
    if (btn) {
      // Remove active de todos
      const allTabs = section.querySelectorAll(".product-tab");
      allTabs.forEach(b => b.classList.remove("active"));

      // Adiciona ao clicado
      btn.classList.add("active");

      // Atualiza filtro e renderiza
      currentProductFilter = btn.dataset.category;
      console.log("Filtro alterado para:", currentProductFilter); // Debug
      renderProducts(currentProductFilter);
    }
  });

  function saveAndBroadcast() {
    writeLS(LS_ORDERS, orders);
    writeLS(LS_PRODUCTS, products);
    writeLS(LS_WAITER_CALLS, waiterCalls);

    try {
      if (channel) {
        channel.postMessage({ type: "orders-updated", orders });
      }
      localStorage.setItem("rb-lastupdate", Date.now().toString());
    } catch (e) { }
  }

  function renderAll() {
    renderStats();
    renderDashboardOrders();
    renderAllOrders();
    renderComandas();
    renderFinalizadas();
    renderProducts();
    renderWaiterCalls();
    verificarNotificacoesAudio();
  }

  // Delegated clicks
  document.addEventListener("click", (e) => {
    const finish = e.target.closest(".btn-finish");
    if (finish) {
      const id = parseInt(finish.dataset.id, 10);
      const order = orders.find((o) => o.id === id);
      if (order) {
        if (!confirm("Confirmar entrega do pedido?")) return;

        // Marcamos como "entregue" (delivered) ao invés de "closed"
        // Isso remove da lista de pendentes mas MANTÉM a comanda aberta no cliente
        order.status = "delivered";
        // Opcional: registrar data de entrega
        order.deliveredAt = new Date().toISOString();

        saveAndBroadcast();
        renderAll();
        showNotification("Pedido entregue e arquivado! A comanda do cliente continua aberta.");

        // NÃO enviamos 'comanda-closed' para não fechar a tela do cliente
      }
    }

    const preparing = e.target.closest(".btn-preparing");
    const ready = e.target.closest(".btn-ready");
    const del = e.target.closest(".btn-delete");
    const closeComanda = e.target.closest(".btn-close-comanda");
    const viewComanda = e.target.closest(".btn-view-comanda");
    const viewMoreItems = e.target.closest(".view-more-items");
    const editBtn = e.target.closest(".btn-icon.edit");
    const delProd = e.target.closest(".btn-icon.delete");
    const dismissCall = e.target.closest(".btn-dismiss-call");

    if (preparing) {
      const id = parseInt(preparing.dataset.id, 10);
      const ord = orders.find((o) => o.id === id);
      if (ord) {
        ord.status = "preparing";
        saveAndBroadcast();
        showNotification(`Pedido da mesa ${ord.table} em preparação`);
      }
    }

    if (ready) {
      const id = parseInt(ready.dataset.id, 10);
      const ord = orders.find((o) => o.id === id);
      if (ord) {
        ord.status = "ready";
        saveAndBroadcast();
        showNotification(`Pedido da mesa ${ord.table} está pronto!`);
      }
    }

    if (del) {
      const id = parseInt(del.dataset.id, 10);
      orders = orders.filter((o) => o.id !== id);
      saveAndBroadcast();
      renderAll();
    }

    if (viewComanda || viewMoreItems) {
      const id = parseInt((viewComanda?.dataset.id || viewMoreItems?.dataset.orderId), 10);
      openComandaDetails(id);
    }

    if (closeComanda) {
      const id = parseInt(closeComanda.dataset.id, 10);
      const clientId = closeComanda.dataset.client;

      // Confirma pagamento e fecha TODAS as comandas abertas desse clientId
      orders = orders.map((o) => {
        if (o.clientId === clientId && o.open) {
          return {
            ...o,
            open: false,
            status: "closed",
            closedAt: new Date().toISOString(),
            paidAt: new Date().toISOString(),
          };
        }
        return o;
      });

      saveAndBroadcast();

      if (channel && clientId) {
        channel.postMessage({
          type: "comanda-closed",
          clientId,
        });
      }

      const anyOrder = orders.find((o) => o.clientId === clientId);
      showNotification(
        anyOrder ? `Pagamento confirmado! Comanda da mesa ${anyOrder.table} finalizada!` : "Pagamento confirmado!",
        anyOrder?.sessionName || ""
      );

      renderAll();
    }


    const toggleVisible = e.target.closest(".btn-icon.toggle-visible");
    if (toggleVisible) {
      const id = parseInt(toggleVisible.dataset.id, 10);
      const cat = toggleVisible.dataset.cat;
      if (products[cat]) {
        const prod = products[cat].find((p) => p.id === id);
        if (prod) {
          // Alternar visibilidade (undefined/true -> false, false -> true)
          prod.visible = prod.visible === false ? true : false;
          saveAndBroadcast();
          renderProducts();
          showNotification(prod.visible !== false ? "Produto visível para clientes" : "Produto oculto para clientes");
        }
      }
    }

    if (editBtn) {
      const id = parseInt(editBtn.dataset.id, 10);
      const cat = editBtn.dataset.cat;
      openProductModalAdmin(id, cat);
    }

    if (delProd) {
      const id = parseInt(delProd.dataset.id, 10);
      const cat = delProd.dataset.cat;
      if (products[cat]) {
        products[cat] = products[cat].filter((p) => p.id !== id);
        saveAndBroadcast();
        renderProducts();
      }
    }

    if (dismissCall) {
      const id = parseInt(dismissCall.dataset.id, 10);
      const call = waiterCalls.find((c) => c.id === id);
      if (call) {
        call.status = "attended";
        writeLS(LS_WAITER_CALLS, waiterCalls);
        renderAll();
        showNotification(
          `Chamado da mesa ${call.table} atendido`,
          call.clientName || "Cliente"
        );
      }
    }
  });

  // Product modal com upload de imagem
  function ensureAdminProductModal() {
    if (q("#adminProductModal")) return;

    const div = document.createElement("div");
    div.id = "adminProductModal";
    div.className = "modal-overlay";
    div.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3 class="modal-title" id="adminModalTitle">Editar Produto</h3>
          <button class="modal-close" id="adminModalClose">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Nome</label>
            <input id="adminProdName" />
          </div>
          <div class="form-group">
            <label>Descrição</label>
            <textarea id="adminProdDesc"></textarea>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Preço</label>
              <input id="adminProdPrice" type="number" step="0.01" />
            </div>
            <div class="form-group">
              <label>Categoria</label>
              <select id="adminProdCategory">
                <option value="pratos">Pratos</option>
                <option value="bebidas">Bebidas</option>
                <option value="sobremesas">Sobremesas</option>
                <option value="porcoes">Porções</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label>Imagem do Produto</label>
            <div class="image-upload-container">
              <input type="file" id="adminProdImageFile" accept="image/*" style="display:none" />
              <button type="button" class="btn btn-secondary" id="btnUploadImage" style="width:100%; margin-bottom:8px;">
                Selecionar Imagem do Computador...
              </button>
              <div id="imagePreview" style="text-align:center; margin-top:8px;"></div>
              <input id="adminProdImage" placeholder="Ou cole uma URL de imagem" style="margin-top:8px;" />
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="adminProdCancel">Cancelar</button>
          <button class="btn btn-primary" id="adminProdSave">Salvar</button>
        </div>
      </div>
    `;
    document.body.appendChild(div);

    const fileInput = q("#adminProdImageFile");
    const btnUpload = q("#btnUploadImage");
    const imagePreview = q("#imagePreview");
    const imageUrlInput = q("#adminProdImage");

    btnUpload.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (evt) => {
          const base64 = evt.target.result;
          imageUrlInput.value = base64;
          imagePreview.innerHTML = `<img src="${base64}" style="max-width:100%; max-height:150px; border-radius:8px;" />`;
        };
        reader.readAsDataURL(file);
      }
    });

    q("#adminModalClose").addEventListener("click", () =>
      div.classList.remove("active")
    );
    q("#adminProdCancel").addEventListener("click", () =>
      div.classList.remove("active")
    );
    q("#adminProdSave").addEventListener("click", () => {
      const id = Number(div.dataset.editId);
      const name = q("#adminProdName").value.trim();
      const desc = q("#adminProdDesc").value.trim();
      const price = parseFloat(q("#adminProdPrice").value) || 0;
      const cat = q("#adminProdCategory").value;
      const img = q("#adminProdImage").value.trim();

      if (!name) {
        alert("Nome obrigatório");
        return;
      }

      if (id) {
        Object.keys(products).forEach((c) => {
          products[c] =
            products[c]?.map((p) =>
              p.id === id
                ? {
                  ...p,
                  name,
                  description: desc,
                  price,
                  image: img,
                }
                : p
            ) || products[c];
        });
      } else {
        if (!products[cat]) products[cat] = [];
        products[cat].push({
          id: Date.now(),
          name,
          description: desc,
          price,
          image: img,
        });
      }

      div.classList.remove("active");
      saveAndBroadcast();
      renderProducts();
    });
  }

  function openProductModalAdmin(id, cat) {
    ensureAdminProductModal();
    const modal = q("#adminProductModal");
    const imagePreview = q("#imagePreview");
    modal.classList.add("active");
    modal.dataset.editId = id || "";

    q("#adminProdName").value = "";
    q("#adminProdDesc").value = "";
    q("#adminProdPrice").value = "";
    q("#adminProdCategory").value = cat || "pratos";
    q("#adminProdImage").value = "";
    imagePreview.innerHTML = "";

    if (id && products[cat]) {
      const prod = products[cat].find((p) => p.id === id);
      if (prod) {
        q("#adminProdName").value = prod.name;
        q("#adminProdDesc").value = prod.description;
        q("#adminProdPrice").value = prod.price;
        q("#adminProdCategory").value = cat;
        q("#adminProdImage").value = prod.image || "";
        if (prod.image) {
          imagePreview.innerHTML = `<img src="${prod.image}" style="max-width:100%; max-height:150px; border-radius:8px;" />`;
        }
      }
    }
  }

  window.openProductModal = function () {
    openProductModalAdmin(null, "pratos");
  };

  // ============================================
  // PEDIDO MANUAL
  // ============================================

  let manualCart = [];
  const manualClientName = q("#manualClientName");
  const manualClientTable = q("#manualClientTable");
  const manualClientPhone = q("#manualClientPhone");
  const manualProductsGrid = q("#manualProductsGrid");
  const manualCartContainer = q("#manualCart");
  const manualTotal = q("#manualTotal");
  const btnConfirmManualOrder = q("#btnConfirmManualOrder");
  const manualTabs = q("#manualTabs");

  // Renderizar produtos para pedido manual
  function renderManualProducts(category = "pratos") {
    if (!manualProductsGrid) return;
    manualProductsGrid.innerHTML = "";

    const catProducts = products[category] || [];

    if (catProducts.length === 0) {
      manualProductsGrid.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-secondary);">Nenhum produto nesta categoria</div>';
      return;
    }

    catProducts.forEach((p) => {
      const card = document.createElement("div");
      card.className = "product-card";
      card.innerHTML = `
        <div class="product-image">
          ${p.image ? `<img src="${p.image}" alt="${p.name}" />` : `<svg viewBox="0 0 24 24"><path d="M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z"/></svg>`}
        </div>
        <div class="product-body">
          <div class="product-name">${p.name}</div>
          <div class="product-desc">${p.description || ""}</div>
          <div class="product-footer">
            <div class="product-price">${fmtBRL(p.price)}</div>
            <button class="btn btn-primary btn-add-manual" data-id="${p.id}" data-name="${p.name}" data-price="${p.price}">
              Adicionar
            </button>
          </div>
        </div>
      `;
      manualProductsGrid.appendChild(card);
    });
  }

  // Renderizar carrinho manual
  function renderManualCart() {
    if (!manualCartContainer) return;

    if (manualCart.length === 0) {
      manualCartContainer.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">Nenhum item adicionado</p>';
      if (manualTotal) manualTotal.textContent = "R$ 0,00";
      return;
    }

    let html = "";
    let total = 0;

    manualCart.forEach((item, index) => {
      const itemTotal = item.price * item.qty;
      total += itemTotal;
      html += `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.05);">
          <div>
            <div style="font-weight: 600;">${item.name}</div>
            <div style="font-size: 13px; color: var(--text-secondary);">${item.qty}x ${fmtBRL(item.price)}</div>
          </div>
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="font-weight: 700;">${fmtBRL(itemTotal)}</div>
            <button class="btn-icon delete-manual-item" data-index="${index}" style="background: var(--danger); color: white; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer;">
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/>
              </svg>
            </button>
          </div>
        </div>
      `;
    });

    manualCartContainer.innerHTML = html;
    if (manualTotal) manualTotal.textContent = fmtBRL(total);
  }

  // Tabs do pedido manual
  if (manualTabs) {
    manualTabs.addEventListener("click", (e) => {
      const tab = e.target.closest(".product-tab");
      if (!tab) return;

      qs(".product-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");

      const category = tab.dataset.category;
      renderManualProducts(category);
    });
  }

  // Adicionar item ao carrinho manual
  document.addEventListener("click", (e) => {
    const addBtn = e.target.closest(".btn-add-manual");
    if (addBtn) {
      const id = parseInt(addBtn.dataset.id, 10);
      const name = addBtn.dataset.name;
      const price = parseFloat(addBtn.dataset.price);

      const existingItem = manualCart.find((item) => item.id === id);
      if (existingItem) {
        existingItem.qty += 1;
      } else {
        manualCart.push({ id, name, price, qty: 1 });
      }

      renderManualCart();
    }

    const deleteBtn = e.target.closest(".delete-manual-item");
    if (deleteBtn) {
      const index = parseInt(deleteBtn.dataset.index, 10);
      manualCart.splice(index, 1);
      renderManualCart();
    }
  });

  // Confirmar pedido manual
  if (btnConfirmManualOrder) {
    btnConfirmManualOrder.addEventListener("click", async () => {
      const name = manualClientName?.value.trim();
      const table = manualClientTable?.value.trim();
      const phone = manualClientPhone?.value.trim() || null;

      // Validações
      if (!name || !table) {
        alert("Nome e mesa são obrigatórios");
        return;
      }

      if (manualCart.length === 0) {
        alert("Adicione pelo menos um item ao pedido");
        return;
      }

      try {
        // Buscar ou criar cliente
        let clienteId = null;
        if (window.ClienteAPI && phone) {
          const cliente = await window.ClienteAPI.buscarOuCriar(name, phone, null);
          clienteId = cliente.id;
          if (cliente.isReturning) {
            showNotification(`Bem-vindo de volta, ${cliente.nome}!`);
          }
        }

        // Criar comanda (estrutura compatível com localStorage)
        const clientId = clienteId || `client_${Date.now()}`;
        const sessionName = name;

        // Criar ordem no formato existente
        const newOrder = {
          id: Date.now(),
          clientId: clientId,
          sessionName: sessionName,
          table: table,
          items: manualCart.map(item => ({
            productId: item.id,
            name: item.name,
            price: item.price,
            qty: item.qty,
            obs: null
          })),
          open: true,
          status: "open",
          origem: "manual",
          createdAt: new Date().toISOString()
        };

        orders.push(newOrder);
        saveAndBroadcast();

        // Limpar formulário
        if (manualClientName) manualClientName.value = "";
        if (manualClientTable) manualClientTable.value = "";
        if (manualClientPhone) manualClientPhone.value = "";
        manualCart = [];
        renderManualCart();
        renderManualProducts("pratos");

        showNotification(`Pedido manual criado para mesa ${table}!`, name);
        renderAll();

        // Navegar para comandas
        const comandasNav = q('[data-section="comandas"]');
        if (comandasNav) comandasNav.click();

      } catch (error) {
        console.error("Erro ao criar pedido manual:", error);
        alert("Erro ao criar pedido. Tente novamente.");
      }
    });
  }

  // Inicializar produtos manuais
  if (manualProductsGrid) {
    renderManualProducts("pratos");
  }

  // ============================================
  // NOTIFICAÇÕES VISUAIS EM COMANDAS
  // ============================================

  function updateComandaNotifications() {
    // Adicionar indicador de notificação nas comandas com novos pedidos
    qs(".comanda-card").forEach((card) => {
      const orderId = card.dataset.orderId || card.querySelector("[data-id]")?.dataset?.id;
      if (!orderId) return;

      const order = orders.find((o) => o.id === parseInt(orderId, 10));
      if (order && order.tem_notificacao) {
        // Adicionar badge mais visível (NOVO PEDIDO)
        let notifBadge = card.querySelector(".notification-badge");
        if (!notifBadge) {
          notifBadge = document.createElement("div");
          notifBadge.className = "notification-badge";
          notifBadge.textContent = "NOVO PEDIDO";
          notifBadge.style.cssText = `
            position: absolute;
            top: -10px;
            right: 10px;
            background: #ff3b30;
            color: white;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 800;
            box-shadow: 0 4px 12px rgba(255, 59, 48, 0.5);
            z-index: 100;
            border: 2px solid #1a1a1a;
            animation: pulse-notification 2s infinite;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          `;

          // Adicionar keyframes se não existir
          if (!document.getElementById("notification-keyframes")) {
            const style = document.createElement("style");
            style.id = "notification-keyframes";
            style.innerHTML = `
              @keyframes pulse-notification {
                0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255, 59, 48, 0.7); }
                70% { transform: scale(1.05); box-shadow: 0 0 0 10px rgba(255, 59, 48, 0); }
                100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255, 59, 48, 0); }
              }
            `;
            document.head.appendChild(style);
          }

          card.style.position = "relative";
          // Bordas pulsantes no card também
          card.style.border = "1px solid #ff3b30";

          card.appendChild(notifBadge);
        }
        notifBadge.style.display = "block";
      } else {
        const notifBadge = card.querySelector(".notification-badge");
        if (notifBadge) notifBadge.style.display = "none";

        // Remove borda vermelha
        card.style.border = "";
      }
    });
  }

  // OBS: Removemos o listener de clique genérico no card para limpar notificação
  // Agora a limpeza é feita apenas em openComandaDetails

  // Sobrescrever renderComandas para incluir notificações
  const originalRenderComandas = renderComandas;
  renderComandas = function () {
    originalRenderComandas();
    setTimeout(updateComandaNotifications, 100);
  };

  // Notification
  function showNotification(msg, sub) {
    if (!notification) return;
    notificationText.textContent = msg;
    if (notificationSub) notificationSub.textContent = sub || "";
    notification.classList.add("show");

    setTimeout(() => {
      notification.classList.remove("show");
    }, 3000);
  }

  // ============================================
  // ESTOQUE
  // ============================================

  const LS_STOCK = "rb-stock-v1";
  const LS_STOCK_MOVEMENTS = "rb-stock-movements-v1";
  let stock = readLS(LS_STOCK, []);
  let stockMovements = readLS(LS_STOCK_MOVEMENTS, []);

  function renderStock() {
    const stockGrid = q("#stockGrid");
    if (!stockGrid) return;

    stockGrid.innerHTML = "";

    if (stock.length === 0) {
      stockGrid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: var(--text-secondary); padding: 40px;">Nenhum item no estoque. Clique em "Adicionar Item ao Estoque" para começar.</div>';
      return;
    }

    stock.forEach((item) => {
      const card = document.createElement("div");
      const percentage = item.minimum > 0 ? (item.quantity / item.minimum) * 100 : 100;
      let statusClass = "";
      let progressClass = "success";

      if (item.quantity === 0) {
        statusClass = "out-stock";
        progressClass = "danger";
      } else if (percentage < 50) {
        statusClass = "low-stock";
        progressClass = "warning";
      }

      card.className = `stock-card ${statusClass}`;
      card.innerHTML = `
        <div class="stock-card-header">
          <div class="stock-card-name">${item.name}</div>
          <div class="stock-card-actions">
            <button onclick="editStockItem(${item.id})" title="Editar">
              <svg viewBox="0 0 24 24" style="width: 18px; height: 18px; fill: currentColor;">
                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.42l-2.34-2.34a1 1 0 00-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z"/>
              </svg>
            </button>
            <button onclick="deleteStockItem(${item.id})" title="Excluir">
              <svg viewBox="0 0 24 24" style="width: 18px; height: 18px; fill: currentColor;">
                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="stock-card-info">
          <div class="stock-info-row">
            <span class="stock-info-label">Quantidade Atual:</span>
            <span class="stock-info-value">${item.quantity} ${item.unit}</span>
          </div>
          <div class="stock-info-row">
            <span class="stock-info-label">Estoque Mínimo:</span>
            <span class="stock-info-value">${item.minimum} ${item.unit}</span>
          </div>
          ${item.cost ? `<div class="stock-info-row">
            <span class="stock-info-label">Custo Unitário:</span>
            <span class="stock-info-value">${fmtBRL(item.cost)}</span>
          </div>` : ""}
        </div>
        ${item.minimum > 0 ? `<div class="stock-progress">
          <div class="stock-progress-bar ${progressClass}" style="width: ${Math.min(percentage, 100)}%"></div>
        </div>` : ""}
        ${item.notes ? `<div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.05); font-size: 13px; color: var(--text-secondary);">${item.notes}</div>` : ""}
      `;
      stockGrid.appendChild(card);
    });
  }

  function renderStockMovements() {
    const tbody = q("#stockMovementsBody");
    if (!tbody) return;

    tbody.innerHTML = "";

    if (stockMovements.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="padding: 40px; text-align: center; color: var(--text-secondary);">Nenhuma movimentação registrada</td></tr>';
      return;
    }

    stockMovements.slice().reverse().slice(0, 50).forEach((mov) => {
      const row = document.createElement("tr");
      const item = stock.find((s) => s.id === mov.itemId);
      row.innerHTML = `
        <td style="padding: 12px;">${new Date(mov.date).toLocaleString()}</td>
        <td style="padding: 12px;">${item ? item.name : "Item removido"}</td>
        <td style="padding: 12px;"><span style="padding: 4px 8px; border-radius: 4px; background: ${mov.type === 'entry' ? 'rgba(76, 175, 80, 0.2)' : 'rgba(244, 67, 54, 0.2)'}; color: ${mov.type === 'entry' ? 'var(--success)' : 'var(--danger)'};">${mov.type === 'entry' ? 'Entrada' : 'Saída'}</span></td>
        <td style="padding: 12px; text-align: right; color: ${mov.type === 'entry' ? 'var(--success)' : 'var(--danger)'};">${mov.type === 'entry' ? '+' : '-'}${mov.quantity} ${mov.unit}</td>
        <td style="padding: 12px; text-align: right;">${mov.balance} ${mov.unit}</td>
      `;
      tbody.appendChild(row);
    });
  }

  window.openStockModal = function (id) {
    const modal = q("#stockModal");
    if (!modal) return;
    modal.style.display = "flex";
    modal.classList.add("active");

    if (id) {
      const item = stock.find((s) => s.id === id);
      if (item) {
        q("#stockModalTitle").textContent = "Editar Item do Estoque";
        q("#stockItemName").value = item.name;
        q("#stockQuantity").value = item.quantity;
        q("#stockUnit").value = item.unit;
        q("#stockMin").value = item.minimum;
        q("#stockCost").value = item.cost || "";
        q("#stockNotes").value = item.notes || "";
        modal.dataset.editId = id;
      }
    } else {
      q("#stockModalTitle").textContent = "Adicionar Item ao Estoque";
      q("#stockItemName").value = "";
      q("#stockQuantity").value = "";
      q("#stockUnit").value = "un";
      q("#stockMin").value = "";
      q("#stockCost").value = "";
      q("#stockNotes").value = "";
      delete modal.dataset.editId;
    }
  };

  window.closeStockModal = function () {
    const modal = q("#stockModal");
    if (modal) {
      modal.style.display = "none";
      modal.classList.remove("active");
    }
  };

  window.saveStockItem = function () {
    const modal = q("#stockModal");
    if (!modal) return;

    const name = q("#stockItemName").value.trim();
    const quantity = parseFloat(q("#stockQuantity").value) || 0;
    const unit = q("#stockUnit").value;
    const minimum = parseFloat(q("#stockMin").value) || 0;
    const cost = parseFloat(q("#stockCost").value) || null;
    const notes = q("#stockNotes").value.trim() || null;
    const editId = modal.dataset.editId;

    if (!name) {
      alert("Nome do item é obrigatório");
      return;
    }

    if (editId) {
      const idx = stock.findIndex((s) => s.id === parseInt(editId, 10));
      if (idx !== -1) {
        const oldQuantity = stock[idx].quantity;
        stock[idx] = { ...stock[idx], name, quantity, unit, minimum, cost, notes };

        // Registrar movimentação se quantidade mudou
        if (oldQuantity !== quantity) {
          stockMovements.push({
            id: Date.now(),
            itemId: parseInt(editId, 10),
            date: new Date().toISOString(),
            type: quantity > oldQuantity ? 'entry' : 'exit',
            quantity: Math.abs(quantity - oldQuantity),
            unit: unit,
            balance: quantity
          });
        }
      }
    } else {
      const newId = Date.now();
      stock.push({
        id: newId,
        name,
        quantity,
        unit,
        minimum,
        cost,
        notes,
        createdAt: new Date().toISOString()
      });

      stockMovements.push({
        id: Date.now(),
        itemId: newId,
        date: new Date().toISOString(),
        type: 'entry',
        quantity: quantity,
        unit: unit,
        balance: quantity
      });
    }

    writeLS(LS_STOCK, stock);
    writeLS(LS_STOCK_MOVEMENTS, stockMovements);
    renderStock();
    renderStockMovements();
    closeStockModal();
    showNotification(editId ? "Item atualizado" : "Item adicionado ao estoque");
  };

  window.editStockItem = function (id) {
    openStockModal(id);
  };

  window.deleteStockItem = function (id) {
    if (!confirm("Tem certeza que deseja excluir este item?")) return;

    stock = stock.filter((s) => s.id !== id);
    writeLS(LS_STOCK, stock);
    renderStock();
    showNotification("Item removido do estoque");
  };

  // Filtros de estoque
  qs("[data-stock-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      qs("[data-stock-filter]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const filter = btn.dataset.stockFilter;
      renderStockFiltered(filter);
    });
  });

  function renderStockFiltered(filter) {
    const stockGrid = q("#stockGrid");
    if (!stockGrid) return;

    let filtered = stock.slice();

    if (filter === "low") {
      filtered = stock.filter((item) => {
        if (item.minimum === 0) return false;
        return item.quantity < item.minimum && item.quantity > 0;
      });
    } else if (filter === "out") {
      filtered = stock.filter((item) => item.quantity === 0);
    }

    stockGrid.innerHTML = "";

    if (filtered.length === 0) {
      stockGrid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: var(--text-secondary); padding: 40px;">Nenhum item encontrado</div>';
      return;
    }

    filtered.forEach((item) => {
      const card = document.createElement("div");
      const percentage = item.minimum > 0 ? (item.quantity / item.minimum) * 100 : 100;
      let statusClass = "";
      let progressClass = "success";

      if (item.quantity === 0) {
        statusClass = "out-stock";
        progressClass = "danger";
      } else if (percentage < 50) {
        statusClass = "low-stock";
        progressClass = "warning";
      }

      card.className = `stock-card ${statusClass}`;
      card.innerHTML = `
        <div class="stock-card-header">
          <div class="stock-card-name">${item.name}</div>
          <div class="stock-card-actions">
            <button onclick="editStockItem(${item.id})" title="Editar">
              <svg viewBox="0 0 24 24" style="width: 18px; height: 18px; fill: currentColor;">
                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.42l-2.34-2.34a1 1 0 00-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z"/>
              </svg>
            </button>
            <button onclick="deleteStockItem(${item.id})" title="Excluir">
              <svg viewBox="0 0 24 24" style="width: 18px; height: 18px; fill: currentColor;">
                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="stock-card-info">
          <div class="stock-info-row">
            <span class="stock-info-label">Quantidade Atual:</span>
            <span class="stock-info-value">${item.quantity} ${item.unit}</span>
          </div>
          <div class="stock-info-row">
            <span class="stock-info-label">Estoque Mínimo:</span>
            <span class="stock-info-value">${item.minimum} ${item.unit}</span>
          </div>
        </div>
        ${item.minimum > 0 ? `<div class="stock-progress">
          <div class="stock-progress-bar ${progressClass}" style="width: ${Math.min(percentage, 100)}%"></div>
        </div>` : ""}
      `;
      stockGrid.appendChild(card);
    });
  }

  // Inicializar estoque quando a seção for carregada
  const estoqueSection = q("#estoque");
  if (estoqueSection) {
    const observer = new MutationObserver(() => {
      if (estoqueSection.classList.contains("active")) {
        renderStock();
        renderStockMovements();
      }
    });
    observer.observe(estoqueSection, { attributes: true, attributeFilter: ["class"] });
  }

  // ============================================
  // DASHBOARD AVANÇADO E RELATÓRIOS
  // ============================================

  window.generateReport = function () {
    const startDate = q("#reportStartDate").value;
    const endDate = q("#reportEndDate").value;
    const reportContent = q("#reportContent");

    if (!startDate || !endDate) {
      alert("Selecione as datas inicial e final");
      return;
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const merged = getMergedOrders();
    const filteredOrders = merged.filter((o) => {
      const orderDate = o.closedAt ? new Date(o.closedAt) : new Date(o.createdAt || 0);
      return orderDate >= start && orderDate <= end && o.status === "closed";
    });

    let totalRevenue = 0;
    const productCount = {};

    filteredOrders.forEach((order) => {
      if (order.items) {
        order.items.forEach((item) => {
          totalRevenue += item.price * item.qty;
          productCount[item.name] = (productCount[item.name] || 0) + item.qty;
        });
      } else if (order.total != null) {
        totalRevenue += Number(order.total);
      }
    });

    const topProducts = Object.entries(productCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    reportContent.innerHTML = `
      <div style="margin-bottom: 24px;">
        <h3 style="margin-bottom: 16px; color: var(--primary);">Resumo do Período</h3>
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;">
          <div style="padding: 16px; background: var(--bg-lighter); border-radius: 8px;">
            <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 4px;">Total de Comandas</div>
            <div style="font-size: 24px; font-weight: 700;">${filteredOrders.length}</div>
          </div>
          <div style="padding: 16px; background: var(--bg-lighter); border-radius: 8px;">
            <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 4px;">Faturamento Total</div>
            <div style="font-size: 24px; font-weight: 700; color: var(--primary);">${fmtBRL(totalRevenue)}</div>
          </div>
          <div style="padding: 16px; background: var(--bg-lighter); border-radius: 8px;">
            <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 4px;">Ticket Médio</div>
            <div style="font-size: 24px; font-weight: 700;">${fmtBRL(filteredOrders.length > 0 ? totalRevenue / filteredOrders.length : 0)}</div>
          </div>
        </div>
      </div>
      <div>
        <h3 style="margin-bottom: 16px; color: var(--primary);">Produtos Mais Vendidos</h3>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${topProducts.map(([name, count]) => `
            <div style="display: flex; justify-content: space-between; padding: 12px; background: var(--bg-lighter); border-radius: 8px;">
              <span style="font-weight: 600;">${name}</span>
              <span style="color: var(--text-secondary);">${count} unidades</span>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  };

  window.exportReport = function (format) {
    alert(`Funcionalidade de exportação ${format.toUpperCase()} será implementada em breve`);
  };

  // ============================================
  // DASHBOARD AVANÇADO (CHART.JS)
  // ============================================

  let revenueChartInstance = null;
  let categoryChartInstance = null;

  function initCharts() {
    const ctxRev = document.getElementById('revenueChart');
    const ctxCat = document.getElementById('categoryChart');

    if (ctxRev && !revenueChartInstance) {
      revenueChartInstance = new Chart(ctxRev, {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            label: 'Vendas (R$)',
            data: [],
            borderColor: '#ff9800',
            backgroundColor: 'rgba(255, 152, 0, 0.1)',
            borderWidth: 2,
            tension: 0.4,
            fill: true,
            pointBackgroundColor: '#1a1a1a',
            pointBorderColor: '#ff9800',
            pointBorderWidth: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              mode: 'index',
              intersect: false,
              backgroundColor: 'rgba(0,0,0,0.8)',
              titleColor: '#fff',
              bodyColor: '#ccc',
              borderColor: 'rgba(255,255,255,0.1)',
              borderWidth: 1
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              grid: { color: 'rgba(255,255,255,0.05)' },
              ticks: { color: '#888', callback: (v) => 'R$ ' + v }
            },
            x: {
              grid: { display: false },
              ticks: { color: '#888' }
            }
          }
        }
      });
    }

    if (ctxCat && !categoryChartInstance) {
      categoryChartInstance = new Chart(ctxCat, {
        type: 'doughnut',
        data: {
          labels: [],
          datasets: [{
            data: [],
            backgroundColor: [
              '#ff9800', '#2196f3', '#4caf50', '#e91e63', '#9c27b0', '#00bcd4'
            ],
            borderWidth: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'right', labels: { color: '#ccc', usePointStyle: true } }
          },
          cutout: '70%'
        }
      });
    }
  }

  function updateDashboardCharts() {
    if (!revenueChartInstance || !categoryChartInstance) {
      initCharts();
      if (!revenueChartInstance) return; // Se ainda falhar (elemento não visível)
    }

    // 1. Dados de Faturamento por Hora (Hoje)
    const merged = getMergedOrders();
    const hours = Array.from({ length: 24 }, (_, i) => `${i}h`);
    const hourlySales = new Array(24).fill(0);
    const today = new Date().toDateString();

    merged.forEach(o => {
      const dateStr = o.createdAt || new Date().toISOString();
      const orderDate = new Date(dateStr);

      if (orderDate.toDateString() === today && (o.status === 'closed' || o.status === 'sent' || o.status === 'ready')) {
        const hour = orderDate.getHours();
        const total = o.total || (o.items ? o.items.reduce((s, i) => s + i.price * i.qty, 0) : 0);
        hourlySales[hour] += total;
      }
    });

    revenueChartInstance.data.labels = hours;
    revenueChartInstance.data.datasets[0].data = hourlySales;
    revenueChartInstance.update();

    // 2. Dados por Categoria
    const catSales = {};
    merged.forEach(o => {
      if (o.status === 'closed' || o.status === 'sent') {
        if (o.items) {
          o.items.forEach(item => {
            // Tentar descobrir categoria do item (precisamos buscar no 'products')
            // Como 'item' na comanda não tem categoria salva, buscamos pelo ID
            let category = 'Outros';
            // Busca reversa ineficiente mas funcional para demo
            for (const [cat, list] of Object.entries(products)) {
              if (list.some(p => p.id === item.productId)) {
                category = cat.charAt(0).toUpperCase() + cat.slice(1);
                break;
              }
            }
            catSales[category] = (catSales[category] || 0) + (item.price * item.qty);
          });
        }
      }
    });

    categoryChartInstance.data.labels = Object.keys(catSales);
    categoryChartInstance.data.datasets[0].data = Object.values(catSales);
    categoryChartInstance.update();

    // 3. Top Produtos (Visual Melhorado)
    const topProductsDiv = q("#topProducts");
    if (topProductsDiv) {
      const productCount = {};
      merged.filter(o => o.status === 'closed' || o.status === 'sent').forEach(order => {
        if (order.items) {
          order.items.forEach(item => {
            productCount[item.name] = (productCount[item.name] || 0) + item.qty;
          });
        }
      });

      const topProducts = Object.entries(productCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

      if (topProducts.length === 0) {
        topProductsDiv.innerHTML = '<div style="text-align: center; color: var(--text-secondary);">Nenhum dado ainda</div>';
      } else {
        const maxVal = topProducts[0][1];
        topProductsDiv.innerHTML = topProducts.map(([name, count], index) => `
          <div class="top-product-card" style="background: var(--bg-lighter); padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
            <div style="display:flex; justify-content:space-between; margin-bottom: 8px;">
              <span style="font-weight: 600; font-size: 14px;">${index + 1}. ${name}</span>
              <span style="font-weight: 700; color: var(--primary);">${count} un</span>
            </div>
            <div style="background: rgba(255,255,255,0.1); height: 4px; border-radius: 2px; overflow: hidden;">
              <div style="background: var(--primary); height: 100%; width: ${(count / maxVal) * 100}%"></div>
            </div>
          </div>
        `).join("");
      }
    }
  }

  // Atualizar quando dashboard for carregado
  const dashboardSection = q("#dashboard");
  if (dashboardSection) {
    // Inicializar charts se já estiver visível
    if (dashboardSection.classList.contains("active")) {
      setTimeout(updateDashboardCharts, 500); // Delay para garantir render
    }

    const observer = new MutationObserver(() => {
      if (dashboardSection.classList.contains("active")) {
        updateDashboardCharts();
      }
    });
    observer.observe(dashboardSection, { attributes: true, attributeFilter: ["class"] });
  }

  // ============================================
  // VISUALIZAR DETALHES DA COMANDA
  // ============================================

  window.openComandaDetails = function (orderId) {
    const order = getOrderById(orderId);
    if (!order) return;

    // Limpar notificação ao abrir detalhes
    if (order.tem_notificacao) {
      order.tem_notificacao = false;
      saveAndBroadcast();
      updateComandaNotifications();
    }

    const modal = q("#comandaDetailsModal");
    const modalTitle = q("#comandaDetailsTitle");
    const modalBody = q("#comandaDetailsBody");
    const modalFooter = q("#comandaDetailsFooter");

    if (!modal || !modalTitle || !modalBody || !modalFooter) return;

    modalTitle.textContent = `Comanda - Mesa ${order.table}`;

    const total = order.items
      ? order.items.reduce((s, i) => s + i.price * i.qty, 0)
      : 0;

    const itemsHtml = order.items && order.items.length > 0
      ? order.items.map((item) => `
          <div style="padding: 16px; background: var(--bg-lighter); border-radius: 8px; margin-bottom: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
              <div style="flex: 1;">
                <div style="font-weight: 600; font-size: 16px; margin-bottom: 4px;">${item.qty}x ${item.name}</div>
                ${item.obs ? `<div style="color: var(--text-secondary); font-size: 13px; margin-top: 4px; padding: 8px; background: var(--bg-card); border-radius: 4px;">
                  <strong>Observação:</strong> ${item.obs}
                </div>` : ''}
              </div>
              <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 8px; margin-left: 16px;">
                <div style="font-weight: 600; color: var(--primary);">
                  ${fmtBRL(item.price * item.qty)}
                </div>
                ${order.status !== "closed" ? `
                <button class="btn btn-danger btn-remove-admin-item" data-order-id="${order.id}" data-item-index="${order.items.indexOf(item)}" style="padding: 4px 8px; font-size: 11px; background: rgba(244, 67, 54, 0.1); color: var(--danger); border: 1px solid rgba(244, 67, 54, 0.3);">
                  🗑️ Remover
                </button>
                ` : ''}
              </div>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 13px; color: var(--text-secondary);">
              <span>Preço unitário: ${fmtBRL(item.price)}</span>
              <span>Subtotal: ${fmtBRL(item.price * item.qty)}</span>
            </div>
          </div>
        `).join("")
      : '<div style="text-align: center; color: var(--text-secondary); padding: 40px;">Nenhum item nesta comanda</div>';

    // Preparar lista de produtos para adicionar
    const allProductsList = [];
    Object.keys(products).forEach((cat) => {
      if (products[cat]) {
        products[cat].forEach((p) => {
          allProductsList.push({ ...p, category: cat });
        });
      }
    });

    modalBody.innerHTML = `
      <div style="margin-bottom: 24px;">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;">
          <div style="padding: 12px; background: var(--bg-lighter); border-radius: 8px;">
            <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;">Cliente</div>
            <div style="font-weight: 600;">${order.sessionName || "Não informado"}</div>
          </div>
          <div style="padding: 12px; background: var(--bg-lighter); border-radius: 8px;">
            <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;">Status</div>
            <div style="font-weight: 600;">
              <span style="padding: 4px 8px; border-radius: 4px; background: ${order.status === "sent" ? "rgba(255, 152, 0, 0.2)" :
        order.status === "closed" ? "rgba(76, 175, 80, 0.2)" :
          "rgba(33, 150, 243, 0.2)"
      }; color: ${order.status === "sent" ? "var(--warning)" :
        order.status === "closed" ? "var(--success)" :
          "var(--info)"
      };">
                ${order.status === "sent" ? "Aguardando Pagamento" :
        order.status === "closed" ? "Finalizada" :
          order.status === "preparing" ? "Preparando" :
            order.status === "ready" ? "Pronto" :
              "Aberta"}
              </span>
            </div>
          </div>
        </div>
        <div style="padding: 12px; background: var(--bg-lighter); border-radius: 8px; margin-bottom: 16px;">
          <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;">Data/Hora</div>
          <div style="font-weight: 600;">${order.createdAt ? new Date(order.createdAt).toLocaleString("pt-BR") : "Não informado"}</div>
        </div>
      </div>

      <div style="margin-bottom: 24px;">
        <h4 style="margin-bottom: 12px; color: var(--primary);">Itens do Pedido</h4>
        ${itemsHtml}
      </div>

      ${order.status !== "closed" ? `
        <div style="margin-bottom: 24px; padding: 16px; background: var(--bg-lighter); border-radius: 8px; border: 1px solid rgba(212, 165, 116, 0.3);">
          <h4 style="margin-bottom: 16px; color: var(--primary); display: flex; align-items: center; gap: 8px;">
            <svg viewBox="0 0 24 24" style="width: 20px; height: 20px; fill: currentColor;">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
            </svg>
            Adicionar Produtos ao Pedido
          </h4>
          <div style="margin-bottom: 12px;">
            <select id="comandaAddProductSelect" style="width: 100%; padding: 10px; border-radius: 6px; background: var(--bg-card); border: 1px solid rgba(255,255,255,0.1); color: var(--text-primary); font-size: 14px;">
              <option value="">Selecione um produto...</option>
              ${allProductsList.map(p => `<option value="${p.id}" data-cat="${p.category}" data-price="${p.price}">${p.name} - ${fmtBRL(p.price)}</option>`).join('')}
            </select>
          </div>
          <div style="display: grid; grid-template-columns: 100px 1fr 120px; gap: 12px; margin-bottom: 12px;">
            <input type="number" id="comandaAddProductQty" min="1" value="1" style="padding: 10px; border-radius: 6px; background: var(--bg-card); border: 1px solid rgba(255,255,255,0.1); color: var(--text-primary); text-align: center;">
            <textarea id="comandaAddProductObs" placeholder="Observações (opcional)" style="padding: 10px; border-radius: 6px; background: var(--bg-card); border: 1px solid rgba(255,255,255,0.1); color: var(--text-primary); font-size: 13px; resize: vertical; min-height: 40px;"></textarea>
            <button class="btn btn-primary" onclick="addProductToComanda(${orderId})" style="padding: 10px;">
              Adicionar
            </button>
          </div>
        </div>
      ` : ''}

      <div style="padding: 20px; background: var(--bg-lighter); border-radius: 8px; border: 2px solid var(--primary);">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="font-size: 18px; font-weight: 700;">Total da Comanda</div>
          <div style="font-size: 28px; font-weight: 700; color: var(--primary);" id="comandaDetailsTotal">${fmtBRL(total)}</div>
        </div>
      </div>
    `;

    // Armazenar orderId no modal para uso nas funções
    modal.dataset.orderId = orderId;

    modalFooter.innerHTML = `
      <button class="btn-secondary" onclick="closeComandaDetailsModal()">Fechar</button>
      <button class="btn-print" onclick="imprimirViaCliente(${JSON.stringify(order.id)})">🖨️ Imprimir Via</button>
      ${order.status === "sent"
        ? `<button class="btn btn-success" onclick="confirmPaymentFromDetails(${order.id}, '${order.clientId || ''}')">Confirmar Pagamento e Finalizar</button>`
        : order.status !== "closed"
          ? `<button class="btn btn-primary" onclick="manualCloseComandaFromDetails(${order.id}, '${order.clientId || ''}')">Finalizar Manualmente</button>`
          : ''
      }
    `;

    // Adicionar listener para atualizar preço ao selecionar produto
    const productSelect = q("#comandaAddProductSelect");
    if (productSelect) {
      productSelect.addEventListener("change", function () {
        const option = this.options[this.selectedIndex];
        if (option && option.dataset.price) {
          // Pode adicionar preview do preço se necessário
        }
      });
    }

    modal.style.display = "flex";
    modal.classList.add("active");
  }

  window.closeComandaDetailsModal = function () {
    const modal = q("#comandaDetailsModal");
    if (modal) {
      modal.style.display = "none";
      modal.classList.remove("active");
    }
  };

  // Função para imprimir a via do cliente (Cupom não-fiscal 80mm)
  window.imprimirViaCliente = function (orderId) {
    // Busca a comanda ativa (localStorage ou API)
    const order = getOrderById(orderId);
    if (!order) return;

    // Remove cupom de impressão anterior da DOM (se existir algum lixo)
    let printArea = document.getElementById("print-area");
    if (printArea) {
      printArea.remove();
    }

    // Cria a área exclusiva de impressão que ficará invisível na tela
    printArea = document.createElement("div");
    printArea.id = "print-area";

    // Calcula o total e os itens usando as formatações já existentes no script
    const total = order.items
      ? order.items.reduce((s, i) => s + i.price * i.qty, 0)
      : 0;

    const itemsHtml = order.items && order.items.length > 0
      ? order.items.map(item => `
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <div style="flex: 1; padding-right: 8px; text-align: left;">
              ${item.qty}x ${item.name}
              ${item.obs ? `<br><span style="font-size: 10px;">Obs: ${item.obs}</span>` : ''}
            </div>
            <div style="text-align: right;">
              ${fmtBRL(item.price * item.qty)}
            </div>
          </div>
        `).join('')
      : '<div style="text-align: center;">Sem itens</div>';

    // Monta o visual do cupom todo inline
    printArea.innerHTML = `
        <div style="text-align: center; margin-bottom: 10px;">
            <h2 style="margin: 0 0 5px 0; font-size: 16px; font-weight: bold;">Restaurante do Bairro</h2>
            <div style="font-size: 12px; margin-bottom: 2px;">Mesa: ${order.table}</div>
            <div style="font-size: 12px; margin-bottom: 2px;">Cliente: ${order.sessionName || "Não informado"}</div>
            <div style="font-size: 12px;">Data: ${order.createdAt ? new Date(order.createdAt).toLocaleString("pt-BR") : new Date().toLocaleString("pt-BR")}</div>
        </div>
        <div style="font-size: 12px; border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 8px 0; margin-bottom: 10px;">
            ${itemsHtml}
        </div>
        <div style="font-size: 14px; font-weight: bold; text-align: right; margin-bottom: 15px;">
            Total: ${fmtBRL(total)}
        </div>
        <div style="text-align: center; font-size: 12px;">
            Obrigado pela preferência!
        </div>
    `;

    // Anexa ao body e dispara a impressão
    document.body.appendChild(printArea);
    window.print();
  };

  window.confirmPaymentFromDetails = function (orderId, clientId) {
    closeComandaDetailsModal();
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;

    // Fecha todas as comandas do cliente
    orders = orders.map((o) => {
      if (o.clientId === clientId && o.open) {
        return {
          ...o,
          open: false,
          status: "closed",
          closedAt: new Date().toISOString(),
          paidAt: new Date().toISOString(),
        };
      }
      return o;
    });

    saveAndBroadcast();

    if (channel && clientId) {
      channel.postMessage({
        type: "comanda-closed",
        clientId,
      });
    }

    try {
      const total = order.items.reduce((s, i) => s + (i.price * i.qty), 0);
      const vendasUrl = window.location.origin + '/api/vendas'; // Rota corrigida
      fetch(vendasUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mesa: order.table, itens: order.items, total: total, session_id: clientId })
      });
    } catch (e) { }

    showNotification(
      `Pagamento confirmado! Comanda da mesa ${order.table} finalizada!`,
      order.sessionName || ""
    );

    renderAll();
  };

  window.manualCloseComandaFromDetails = function (orderId, clientId) {
    if (!confirm("Tem certeza que deseja finalizar esta comanda manualmente?")) return;
    closeComandaDetailsModal();
    manualCloseComanda(orderId);
  };

  window.manualCloseComanda = function (orderId) {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;

    // Fecha todas as comandas do cliente
    orders = orders.map((o) => {
      if (o.clientId === order.clientId && o.open) {
        return {
          ...o,
          open: false,
          status: "closed",
          closedAt: new Date().toISOString(),
          manuallyClosed: true,
        };
      }
      return o;
    });

    saveAndBroadcast();

    if (channel && order.clientId) {
      channel.postMessage({
        type: "comanda-closed",
        clientId: order.clientId,
      });
    }

    try {
      const total = order.items.reduce((s, i) => s + (i.price * i.qty), 0);
      const vendasUrl = window.location.origin + '/api/vendas'; // Rota corrigida dinâmica
      fetch(vendasUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mesa: order.table, itens: order.items, total: total, session_id: order.clientId })
      });
    } catch (e) { }

    showNotification(
      `Comanda da mesa ${order.table} finalizada manualmente!`,
      order.sessionName || ""
    );

    renderAll();
  };

  // Adicionar produto à comanda
  window.addProductToComanda = function (orderId) {
    const modal = q("#comandaDetailsModal");
    if (!modal) return;

    const storedOrderId = modal.dataset.orderId || orderId;
    const order = orders.find((o) => o.id === parseInt(storedOrderId, 10));
    if (!order || order.status === "closed") {
      showNotification("Não é possível adicionar produtos a uma comanda finalizada");
      return;
    }

    const productSelect = q("#comandaAddProductSelect");
    const qtyInput = q("#comandaAddProductQty");
    const obsInput = q("#comandaAddProductObs");

    if (!productSelect || !qtyInput) return;

    const selectedOption = productSelect.options[productSelect.selectedIndex];
    if (!selectedOption || !selectedOption.value) {
      showNotification("Selecione um produto");
      return;
    }

    const productId = parseInt(selectedOption.value, 10);
    const category = selectedOption.dataset.cat;
    const price = parseFloat(selectedOption.dataset.price);
    const qty = parseInt(qtyInput.value, 10) || 1;
    const obs = obsInput ? obsInput.value.trim() : null;

    // Buscar produto completo
    const product = products[category]?.find((p) => p.id === productId);
    if (!product) {
      showNotification("Produto não encontrado");
      return;
    }

    // Adicionar item à comanda
    if (!order.items) order.items = [];
    order.items.push({
      productId: product.id,
      name: product.name,
      price: price,
      qty: qty,
      obs: obs || null,
      addedBy: "admin", // Marcar que foi adicionado pelo admin
      addedAt: new Date().toISOString()
    });

    // Salvar e atualizar
    saveAndBroadcast();
    renderAll(); // Atualizar a interface principal também

    // Recarregar modal com dados atualizados
    openComandaDetails(parseInt(storedOrderId, 10));

    showNotification(`Produto "${product.name}" adicionado à comanda!`, order.sessionName || "");
  };

  // Remover produto da comanda pelo admin
  document.addEventListener("click", function (e) {
    const btnRemove = e.target.closest(".btn-remove-admin-item");
    if (btnRemove) {
      if (!confirm("Tem certeza que deseja remover este item da comanda?")) return;

      const orderId = parseInt(btnRemove.dataset.orderId, 10);
      const itemIndex = parseInt(btnRemove.dataset.itemIndex, 10);

      const order = orders.find((o) => o.id === orderId);
      if (order && order.items && order.items[itemIndex]) {
        // Remover item do array
        order.items.splice(itemIndex, 1);

        saveAndBroadcast();
        renderAll();

        // Recarregar o modal para refletir os totais e a lista atualizada
        if (q("#comandaDetailsModal").classList.contains("active")) {
          openComandaDetails(orderId);
        }

        showNotification("Item removido da comanda com sucesso!");
      }
    }
  });

  // ============================================
  // ATUALIZAÇÕES EM TEMPO REAL
  // ============================================

  // Função para mesclar e detectar novos pedidos
  function mergeOrders(currentList, newList) {
    return newList.map(newOrd => {
      const oldOrd = currentList.find(o => o.id === newOrd.id);

      // Se é uma nova comanda
      if (!oldOrd) {
        newOrd.tem_notificacao = true;
        return newOrd;
      }

      // Se tem mais itens que antes
      const newItemsCount = newOrd.items ? newOrd.items.length : 0;
      const oldItemsCount = oldOrd.items ? oldOrd.items.length : 0;

      if (newItemsCount > oldItemsCount) {
        newOrd.tem_notificacao = true;
      } else {
        // Mantém estado anterior da notificação (se não foi vista, continua true)
        newOrd.tem_notificacao = oldOrd.tem_notificacao;
      }

      return newOrd;
    });
  }

  // BroadcastChannel
  if (channel) {
    channel.onmessage = (event) => {
      const data = event.data;
      if (!data) return;

      if (data.type === "orders-updated" && data.orders) {
        // Detectar mudanças para notificação
        const mergedOrders = mergeOrders(orders, data.orders);

        orders = mergedOrders;

        writeLS(LS_ORDERS, orders);
        renderAll();

        if (data.notification) {
          if (data.notification.type === "payment-requested") {
            showNotification(`Pagamento solicitado: Mesa ${data.notification.table}`, data.notification.clientName);
            // Tocar som se possível
          }
        }
      }

      if (data.type === "call-waiter") {
        // Broadcast listener deduplication check
        const isDuplicate = waiterCalls.some(c =>
          c.table === data.table &&
          (c.clientId === data.clientId || c.clientName === data.clientName) &&
          c.status === "pending"
        );

        if (!isDuplicate) {
          waiterCalls.push({
            id: Date.now(),
            table: data.table,
            clientName: data.clientName,
            clientId: data.clientId,
            timestamp: Date.now(),
            status: "pending"
          });
          writeLS(LS_WAITER_CALLS, waiterCalls);
          renderAll();
          showNotification(`CHAMADO: Mesa ${data.table}`, data.clientName);
        }
      }
    };
  }

  // Lógica Remarketing
  window.loadRemarketing = async function () {
    const tbody = document.getElementById("remarketingBody");
    if (!tbody) return;
    try {
      const contatosUrl = window.location.origin + '/api/contatos';
      const res = await fetch(contatosUrl);
      if (!res.ok) throw new Error("Falha ao buscar");
      const data = await res.json();

      if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="padding: 24px; text-align: center; color: var(--text-secondary);">Nenhum contato encontrado.</td></tr>';
        return;
      }

      tbody.innerHTML = data.map(c => `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
          <td style="padding: 12px;"><strong>${c.nome}</strong></td>
          <td style="padding: 12px; color: var(--text-secondary);">${c.mesa || 'N/A'}</td>
          <td style="padding: 12px; color: var(--primary); font-weight: bold;">${c.pontos}</td>
          <td style="padding: 12px;">${fmtBRL(parseFloat(c.total_gasto))}</td>
          <td style="padding: 12px;">${c.visitas}</td>
          <td style="padding: 12px; text-align: right;">
            <button class="btn btn-secondary btn-remarketing-send" data-id="${c.id}" data-nome="${c.nome}" data-pontos="${c.pontos}" style="padding: 6px 12px; font-size: 12px;">
              Enviar para CRM
            </button>
          </td>
        </tr>
      `).join("");
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="6" style="padding: 24px; text-align: center; color: var(--danger);">Falha ao carregar contatos do banco de dados (Verifique o backend).</td></tr>';
    }
  };

  document.addEventListener("click", async (e) => {
    const btn = e.target.closest(".btn-remarketing-send");
    if (btn) {
      const { id, nome, pontos } = btn.dataset;
      const url = q("#webhookUrl")?.value || "";
      if (!url) {
        alert("Configure a URL do webhook do CRM primeiro.");
        return;
      }

      const originalText = btn.textContent;
      btn.textContent = "⏳";
      try {
        await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ evento: "remarketing_manual", contato_id: id, nome, pontos })
        });
        showNotification("Contato enviado ao CRM com sucesso!");
        btn.textContent = "✅";
      } catch (err) {
        alert("Falha ao chamar webhook.");
        btn.textContent = originalText;
      }
    }
  });

  const remarketingSection = q("#remarketing");
  if (remarketingSection) {
    const mbserver = new MutationObserver(() => {
      if (remarketingSection.classList.contains("active")) loadRemarketing();
    });
    mbserver.observe(remarketingSection, { attributes: true, attributeFilter: ["class"] });
  }

  // Diagnóstico CRM
  const btnTestWebhook = q("#btnTestWebhook");
  const webhookTestResult = q("#webhookTestResult");
  if (btnTestWebhook) {
    btnTestWebhook.addEventListener("click", async () => {
      const url = q("#webhookUrl").value;
      if (!url) {
        webhookTestResult.textContent = "⚠️ Insira a URL primeiro";
        webhookTestResult.style.color = "var(--warning)";
        return;
      }

      btnTestWebhook.textContent = "Testando...";
      webhookTestResult.textContent = "";

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ evento: "teste_conexao", timestamp: new Date().toISOString() })
        });

        if (res.ok) {
          webhookTestResult.textContent = "✅ Webhook conectado com sucesso!";
          webhookTestResult.style.color = "var(--success)";
        } else {
          webhookTestResult.textContent = "❌ Falha na conexão (Causa: Código HTTP " + res.status + ")";
          webhookTestResult.style.color = "var(--danger)";
        }
      } catch (err) {
        webhookTestResult.textContent = "❌ Falha na conexão. Verifique a URL.";
        webhookTestResult.style.color = "var(--danger)";
      } finally {
        btnTestWebhook.textContent = "🔍 Testar Conexão";
      }
    });
  }

  // Storage Event (fallback e sync entre abas)
  window.addEventListener("storage", (e) => {
    if (e.key === LS_ORDERS) {
      const incomingOrders = readLS(LS_ORDERS, []);

      // Mesclar para preservar/gerar notificações
      const mergedOrders = mergeOrders(orders, incomingOrders);

      orders = mergedOrders;
      renderAll();
    }
    if (e.key === LS_WAITER_CALLS) {
      waiterCalls = readLS(LS_WAITER_CALLS, []);
      renderAll();
    }
  });

  // Polling (garantia final) + busca vendas do backend (pedidos de outros dispositivos)
  (async function pollAndFetch() {
    const incomingOrders = readLS(LS_ORDERS, []);
    const currentCalls = readLS(LS_WAITER_CALLS, []);

    let updated = false;

    const incomingOrdersWithoutNotificationFlag = incomingOrders.map(o => {
      const { tem_notificacao, ...rest } = o;
      return rest;
    });
    const currentOrdersWithoutNotificationFlag = orders.map(o => {
      const { tem_notificacao, ...rest } = o;
      return rest;
    });

    if (JSON.stringify(incomingOrdersWithoutNotificationFlag) !== JSON.stringify(currentOrdersWithoutNotificationFlag)) {
      orders = mergeOrders(orders, incomingOrders);
      updated = true;
    }

    if (JSON.stringify(currentCalls) !== JSON.stringify(waiterCalls)) {
      waiterCalls = currentCalls;
      updated = true;
    }

    await fetchVendasFromAPI();
    updated = true;

    if (updated) {
      renderAll();
    }
  })();

  setInterval(pollAndFetch, 5000);

})();
