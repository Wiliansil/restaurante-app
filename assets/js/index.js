// index.js - armazenamento local + BroadcastChannel para comunicação entre abas
const channel =
  "BroadcastChannel" in window
    ? new BroadcastChannel("restaurante-channel")
    : null;

const LS_PRODUCTS = "rb-products-v1";
const LS_ORDERS = "rb-orders-v1";
const LS_SESSION = "rb-session-v1";
const LS_CLIENTS = "rb-clients-v1";

// Helpers
const q = (sel) => document.querySelector(sel);
const fmtBRL = (v) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Gerar ID único para cada cliente/sessão
function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0,
      v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Dados iniciais (somente se não existir)
const defaultProducts = {
  pratos: [
    {
      id: 1,
      name: "Filé Parmegiana",
      description:
        "Filé mignon empanado com molho de tomate e queijo gratinado, acompanha arroz e fritas",
      price: 59.9,
      image: "",
    },
    {
      id: 2,
      name: "Picanha na Chapa",
      description:
        "Picanha grelhada com alho, acompanha arroz, farofa e vinagrete",
      price: 79.9,
      image: "",
    },
    {
      id: 3,
      name: "Frango Grelhado",
      description: "Peito de frango grelhado com ervas finas, acompanha legumes",
      price: 34.9,
      image: "",
    },
  ],
  bebidas: [
    {
      id: 101,
      name: "Refrigerante lata",
      description: "Coca-Cola 350ml",
      price: 6.5,
      image: "",
    },
    {
      id: 102,
      name: "Suco natural",
      description: "Suco do dia",
      price: 8.5,
      image: "",
    },
  ],
  sobremesas: [
    {
      id: 201,
      name: "Pudim",
      description: "Pudim de leite condensado",
      price: 9.9,
      image: "",
    },
  ],
  porcoes: [
    {
      id: 301,
      name: "Porção de Batata",
      description: "Batata frita crocante",
      price: 19.9,
      image: "",
    },
  ],
};

function readLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.error("readLS", e);
    return fallback;
  }
}

function writeLS(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch (e) {
    console.error("writeLS", e);
  }
}

let products = readLS(LS_PRODUCTS, null);
if (!products) {
  products = defaultProducts;
  writeLS(LS_PRODUCTS, products);
}

// --- NOVO BLOCO PARA RENOVAR CARDÁPIO EM VÔO COM O BACKEND ---
setTimeout(() => {
  fetch(window.location.origin + '/api/produtos')
    .then(res => res.json())
    .then(serverProducts => {
      if (serverProducts && serverProducts.length > 0) {
        // Transpõe o vetor do backend para a estruturação que o front espera nas abas
        const newCatalog = { pratos: [], bebidas: [], sobremesas: [], porcoes: [] };
        serverProducts.forEach(sp => {
          let catRef = sp.categoria && newCatalog[sp.categoria.toLowerCase()]
            ? sp.categoria.toLowerCase() : "pratos";
          newCatalog[catRef].push({
            id: sp.id, name: sp.nome, description: sp.descricao || "",
            price: parseFloat(sp.preco), image: sp.imagem || ""
          });
        });
        products = newCatalog; // Atualiza a memória
        writeLS(LS_PRODUCTS, products);
        if (app && app.classList.contains("visible") && typeof renderAllCategories === "function") {
          renderAllCategories(); // Re-renderiza abas pra UI refletir dados atualizados do Postgres
        }
      }
    })
    .catch(err => console.log("Cardápio estático do LS será usado (PostgreSQL não acessível momentaneamente)."));
}, 500);
// -----------------------------------------------------------

// Sessão: nome, mesa e clientId único
let session = readLS(LS_SESSION, { name: null, table: null, clientId: null });

// Se não tem clientId, gera um novo (cada aba/dispositivo terá seu próprio)
if (!session.clientId) {
  session.clientId = generateUUID();
  writeLS(LS_SESSION, session);
}

// Orders: array de comandas
let orders = readLS(LS_ORDERS, []);

// DOM refs - garantir que sejam buscados após DOM carregar
let welcome, btnGo, identifyModal, identifyForm, headerTable;

// Função para inicializar referências DOM
function initDOMRefs() {
  welcome = q("#welcomeScreen");
  btnGo = q("#btnGoToMenu");
  identifyModal = q("#identifyModal");
  identifyForm = q("#identifyForm");
  headerTable = q("#headerTable");

  console.log("DOM Refs inicializados:", {
    welcome: !!welcome,
    btnGo: !!btnGo,
    identifyModal: !!identifyModal,
    identifyForm: !!identifyForm,
    headerTable: !!headerTable
  });
}

// Inicializar imediatamente
initDOMRefs();

const tabs = Array.from(document.querySelectorAll(".tab"));
const tabContents = Array.from(document.querySelectorAll(".tab-content"));

const containers = {
  pratos: q("#pratosContainer"),
  bebidas: q("#bebidasContainer"),
  sobremesas: q("#sobremesasContainer"),
  porcoes: q("#porcoesContainer"),
  pedidos: q("#ordersContainer"),
};

const orderBadge = q("#orderBadge");
const footerTotal = q("#footerTotal");
const totalValue = q("#totalValue");

// Product modal
const productModal = q("#productModal");
const productModalImage = q("#productModalImage");
const productModalName = q("#productModalName");
const productModalDesc = q("#productModalDesc");
const productModalPrice = q("#productModalPrice");
const qtyMinus = q("#qtyMinus");
const qtyPlus = q("#qtyPlus");
const qtyValue = q("#qtyValue");
const productObs = q("#productObs");
const btnAddToCart = q("#btnAddToCart");
const closeProductModal = q("#closeProductModal");

let currentProduct = null;
let currentQty = 1;

// Toast
const toast = q("#toast");
const toastMessage = q("#toastMessage");

// Finish modals
const finishModal = q("#finishModal");
const finishTotal = q("#finishTotal");
const btnFinishOrder = q("#btnFinishOrder");
const btnCancelFinish = q("#btnCancelFinish");
const btnConfirmFinish = q("#btnConfirmFinish");

const waitingPaymentModal = q("#waitingPaymentModal");
const waitingTotal = q("#waitingTotal");

// Waiter call
const btnCallWaiter = q("#btnCallWaiter");
const confirmWaiterModal = q("#confirmWaiterModal");
const btnCancelWaiter = q("#btnCancelWaiter");
const btnConfirmWaiter = q("#btnConfirmWaiter");

// App container
const app = q("#app");

// Util
function openModal(m) {
  if (!m) {
    console.error("Modal não encontrado!");
    return;
  }
  m.classList.add("active");
  m.style.display = "flex";
}
function closeModal(m) {
  if (!m) return;
  m.classList.remove("active");
  m.style.display = "none";
}

function showToast(message, duration = 3000) {
  toastMessage.textContent = message;
  toast.classList.add("show", "success");
  setTimeout(() => toast.classList.remove("show", "success"), duration);
}

// Renderizar produtos
function renderCategory(cat) {
  const node = containers[cat];
  if (!node) return;
  node.innerHTML = "";

  products[cat]
    .filter(p => p.visible !== false)
    .forEach((p) => {
      const div = document.createElement("div");
      div.className = "product-card";
      div.innerHTML = `
      <div class="product-image">
        ${p.image
          ? `<img src="${p.image}" alt="${p.name}" />`
          : `<svg viewBox="0 0 24 24"><path d="M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z"/></svg>`
        }
      </div>
      <div class="product-info">
        <div class="product-name">${p.name}</div>
        <div class="product-description">${p.description}</div>
        <div class="product-footer">
          <div class="product-price">${fmtBRL(p.price)}</div>
          <button class="btn-add" data-id="${p.id}" data-cat="${cat}">
            <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
          </button>
        </div>
      </div>
    `;
      node.appendChild(div);
    });
}

function renderAllCategories() {
  renderCategory("pratos");
  renderCategory("bebidas");
  renderCategory("sobremesas");
  renderCategory("porcoes");
}

// Recupera comanda atual do cliente
function getCurrentOrder() {
  return orders.find((o) => o.clientId === session.clientId && o.open);
}

function getOrCreateOrder() {
  let ord = getCurrentOrder();
  if (!ord) {
    ord = {
      id: Date.now(),
      clientId: session.clientId,
      sessionName: session.name,
      table: session.table,
      items: [],
      status: "open",
      open: true,
      createdAt: Date.now(),
    };
    orders.push(ord);
  }
  return ord;
}

function saveOrders(broadcast = true) {
  writeLS(LS_ORDERS, orders);

  // Atualiza timestamp para notificar outras abas
  localStorage.setItem("rb-lastupdate", Date.now().toString());

  if (broadcast && channel) {
    channel.postMessage({
      type: "orders-updated",
      orders,
    });
  }
}

function updateOrderUI() {
  const ord = getCurrentOrder();
  const container = containers.pedidos;

  if (!ord || !ord.items || ord.items.length === 0) {
    container.innerHTML = `
      <div class="orders-empty">
        <svg viewBox="0 0 24 24">
          <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
        </svg>
        <h3>Comanda vazia</h3>
        <p>Adicione itens do cardápio para começar</p>
      </div>
    `;
    orderBadge.style.display = "none";
    footerTotal.classList.remove("visible");
    totalValue.textContent = fmtBRL(0);
    return;
  }

  let html = "";
  let total = 0;

  ord.items.forEach((item, idx) => {
    const subtotal = item.price * item.qty;
    total += subtotal;
    html += `
      <div class="order-item">
        <div class="order-item-header">
          <div class="order-item-name">${item.name}</div>
          <div class="order-item-qty">${item.qty}x</div>
        </div>
        ${item.obs
        ? `<div class="order-item-obs">Obs: ${item.obs}</div>`
        : ""
      }
        <div class="order-item-footer">
          <div class="order-item-price">${fmtBRL(subtotal)}</div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
  orderBadge.style.display = "inline-flex";
  orderBadge.textContent = ord.items.reduce((s, i) => s + i.qty, 0);
  footerTotal.classList.add("visible");
  totalValue.textContent = fmtBRL(total);

  // Se comanda está aguardando pagamento, desabilita botão de finalizar e mostra mensagem
  if (ord.status === "sent") {
    if (btnFinishOrder) {
      btnFinishOrder.disabled = true;
      btnFinishOrder.textContent = "Aguardando Confirmação de Pagamento";
      btnFinishOrder.style.opacity = "0.6";
      btnFinishOrder.style.cursor = "not-allowed";
    }

    // Adiciona aviso na lista de pedidos
    container.innerHTML = `
      <div style="padding: 16px; background: rgba(255, 152, 0, 0.1); border-radius: 8px; margin-bottom: 16px; border: 1px solid var(--warning);">
        <div style="display: flex; align-items: center; gap: 12px;">
          <svg viewBox="0 0 24 24" style="width: 24px; height: 24px; fill: var(--warning);">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
          </svg>
          <div>
            <div style="font-weight: 600; color: var(--warning); margin-bottom: 4px;">Aguardando Confirmação de Pagamento</div>
            <div style="font-size: 13px; color: var(--text-secondary);">Dirija-se ao caixa para realizar o pagamento. Assim que confirmado, sua comanda será finalizada.</div>
          </div>
        </div>
      </div>
      ${html}
    `;
  } else {
    if (btnFinishOrder) {
      btnFinishOrder.disabled = false;
      btnFinishOrder.textContent = "Finalizar Comanda";
      btnFinishOrder.style.opacity = "1";
      btnFinishOrder.style.cursor = "pointer";
    }
  }
}

// Tabs
tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const target = tab.dataset.tab;
    tabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");

    tabContents.forEach((c) => c.classList.remove("active"));
    const content = q("#" + target);
    if (content) content.classList.add("active");
  });
});

// Função para abrir cardápio - tornar global para onclick funcionar
window.handleGoToMenu = function (e) {
  if (e) e.preventDefault();
  console.log("Botão clicado!"); // Debug

  // Buscar elementos se não estiverem disponíveis
  if (!welcome) welcome = q("#welcomeScreen");
  if (!identifyModal) identifyModal = q("#identifyModal");
  if (!headerTable) headerTable = q("#headerTable");
  const appEl = q("#app");

  if (!appEl) {
    console.error("Elemento #app não encontrado!");
    return;
  }

  if (welcome) {
    welcome.classList.add("hidden");
  }

  // Se já tem nome/mesa, vai direto pro app; senão abre modal
  if (session && session.name && session.table) {
    appEl.classList.add("visible");
    if (headerTable) {
      headerTable.textContent = `Mesa ${session.table}`;
    }
    if (typeof renderAllCategories === 'function') {
      renderAllCategories();
    }
    if (typeof updateOrderUI === 'function') {
      updateOrderUI();
    }
  } else {
    if (identifyModal) {
      console.log("Abrindo modal de identificação"); // Debug
      if (typeof openModal === 'function') {
        openModal(identifyModal);
      } else {
        identifyModal.style.display = "flex";
        identifyModal.classList.add("active");
      }
    } else {
      console.error("Modal de identificação não encontrado!");
      alert("Erro: Modal de identificação não encontrado. Recarregue a página.");
    }
  }

  return false; // Prevenir comportamento padrão
}

// Abrir cardápio - múltiplas formas de garantir que funcione
if (btnGo) {
  btnGo.addEventListener("click", handleGoToMenu);
  console.log("Event listener adicionado ao botão"); // Debug
} else {
  console.error("Botão btnGoToMenu não encontrado! Tentando novamente...");

  // Tentar novamente após DOM carregar
  setTimeout(() => {
    const btnRetry = q("#btnGoToMenu");
    if (btnRetry) {
      btnRetry.addEventListener("click", handleGoToMenu);
      console.log("Event listener adicionado após retry"); // Debug
    } else {
      console.error("Botão ainda não encontrado após retry!");
    }
  }, 100);
}

// Garantir que funcione quando DOM estiver carregado
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    initDOMRefs();
    if (btnGo) {
      btnGo.removeEventListener("click", handleGoToMenu); // Remove duplicatas
      btnGo.addEventListener("click", handleGoToMenu);
      console.log("Event listener adicionado no DOMContentLoaded");
    }
  });
} else {
  // DOM já carregado, garantir que está tudo ok
  setTimeout(() => {
    initDOMRefs();
    if (btnGo && !btnGo.onclick) {
      btnGo.addEventListener("click", handleGoToMenu);
      console.log("Event listener adicionado após verificação");
    }
  }, 100);
}

// Fallback final - adicionar diretamente no HTML se possível
window.addEventListener("load", () => {
  initDOMRefs();
  const btn = q("#btnGoToMenu");
  if (btn) {
    // Remove todos os listeners anteriores e adiciona novo
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    newBtn.addEventListener("click", handleGoToMenu);
    btnGo = newBtn;
    console.log("Botão resetado e listener adicionado no window.load");
  }
});

// Form identificação
// Formatação de telefone
const clientPhoneInput = q("#clientPhone");
if (clientPhoneInput) {
  clientPhoneInput.addEventListener("input", (e) => {
    let value = e.target.value.replace(/\D/g, "");
    if (value.length > 11) value = value.slice(0, 11);

    if (value.length <= 10) {
      value = value.replace(/^(\d{2})(\d{4})(\d{0,4}).*/, "($1) $2-$3");
    } else {
      value = value.replace(/^(\d{2})(\d{5})(\d{0,4}).*/, "($1) $2-$3");
    }
    e.target.value = value;
  });
}

identifyForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = q("#customerName").value.trim();
  const table = q("#tableNumber").value;
  const phone = q("#clientPhone") ? q("#clientPhone").value.replace(/\D/g, "") : "";

  if (!name || !table) return;

  // Buscar cliente existente pelo telefone
  let client = null;
  let isReturning = false;
  if (phone && phone.length >= 10) {
    let clients = readLS(LS_CLIENTS, []);
    client = clients.find((c) => c.phone === phone);

    if (client) {
      // Cliente retornando
      isReturning = true;
      client.lastVisit = new Date().toISOString();
      client.visitCount = (client.visitCount || 0) + 1;
      // Atualizar nome se mudou
      if (name !== client.name) {
        client.name = name;
      }
      // Atualizar na lista
      clients = clients.map((c) => c.phone === phone ? client : c);
    } else {
      // Novo cliente
      client = {
        id: generateUUID(),
        name: name,
        phone: phone,
        createdAt: new Date().toISOString(),
        lastVisit: new Date().toISOString(),
        visitCount: 1
      };
      clients.push(client);
    }
    writeLS(LS_CLIENTS, clients);
  }

  session.name = name;
  session.table = table;
  session.clientId = client ? client.id : generateUUID();
  session.phone = phone;
  writeLS(LS_SESSION, session);

  try {
    const backendUrl = window.location.origin + '/api/contatos';
    fetch(backendUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome: session.name, session_id: session.clientId, mesa: session.table })
    }).catch(() => console.warn("Modo fallback operando na ausência temporária do servidor!"));
  } catch (e) { }

  headerTable.textContent = `Mesa ${table}`;
  closeModal(identifyModal);

  // Mostrar mensagem de boas-vindas se cliente retornando
  if (isReturning && client) {
    showToast(`Bem-vindo de volta, ${client.name}!`, 4000);
  } else {
    showToast(`Bem-vindo, ${name}!`, 3000);
  }

  app.classList.add("visible");
  renderAllCategories();
  updateOrderUI();

  // Inicia polling para atualizações em tempo real
  lastOrdersHash = getOrdersHash();
  startOrdersPolling();
});

// Clique em produto
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".btn-add");
  if (btn) {
    const id = parseInt(btn.dataset.id, 10);
    const cat = btn.dataset.cat;
    const p = products[cat].find((x) => x.id === id);
    if (!p) return;

    currentProduct = p;
    currentQty = 1;
    qtyValue.textContent = "1";
    productObs.value = "";
    productModalName.textContent = p.name;
    productModalDesc.textContent = p.description;
    productModalPrice.textContent = fmtBRL(p.price);
    btnAddToCart.querySelector("#addTotal").textContent = fmtBRL(p.price);

    if (p.image) {
      productModalImage.innerHTML = `<img src="${p.image}" alt="${p.name}" />`;
    } else {
      productModalImage.innerHTML = `
        <svg viewBox="0 0 24 24">
          <path d="M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z"/>
        </svg>
      `;
    }

    openModal(productModal);
  }
});

// Modal produto quantidade
qtyMinus.addEventListener("click", () => {
  if (currentQty > 1) {
    currentQty--;
    qtyValue.textContent = String(currentQty);
    if (currentProduct) {
      btnAddToCart
        .querySelector("#addTotal")
        .textContent = fmtBRL(currentProduct.price * currentQty);
    }
  }
});

qtyPlus.addEventListener("click", () => {
  currentQty++;
  qtyValue.textContent = String(currentQty);
  if (currentProduct) {
    btnAddToCart
      .querySelector("#addTotal")
      .textContent = fmtBRL(currentProduct.price * currentQty);
  }
});

closeProductModal.addEventListener("click", () =>
  closeModal(productModal)
);

// Adicionar item à comanda
btnAddToCart.addEventListener("click", () => {
  if (!currentProduct) return;

  // Verificar se comanda está aguardando pagamento
  let ord = getCurrentOrder();
  if (ord && ord.status === "sent") {
    showToast("Não é possível adicionar itens. Comanda aguardando pagamento.", 4000);
    closeModal(productModal);
    return;
  }

  ord = getOrCreateOrder();

  ord.items.push({
    productId: currentProduct.id,
    name: currentProduct.name,
    price: currentProduct.price,
    qty: currentQty,
    obs: productObs.value.trim() || null,
  });

  ord.sessionName = session.name;
  ord.table = session.table;

  saveOrders();
  updateOrderUI();
  closeModal(productModal);
  showToast("Item adicionado à comanda");

  // Notificar painel admin
  if (channel) {
    channel.postMessage({
      type: "orders-updated",
      orders,
    });
  }
});

// Finalizar comanda
btnFinishOrder.addEventListener("click", () => {
  const ord = getCurrentOrder();
  if (!ord || !ord.items || ord.items.length === 0) return;

  const total = ord.items.reduce((s, i) => s + i.price * i.qty, 0);
  finishTotal.textContent = fmtBRL(total);
  openModal(finishModal);
});

btnCancelFinish.addEventListener("click", () =>
  closeModal(finishModal)
);

btnConfirmFinish.addEventListener("click", () => {
  const ord = getCurrentOrder();
  if (!ord) return;

  const total = ord.items.reduce((s, i) => s + i.price * i.qty, 0);

  // NÃO fecha a comanda diretamente - coloca em "aguardando pagamento"
  ord.status = "sent";
  ord.open = true; // Mantém aberta até admin confirmar pagamento
  ord.sentAt = new Date().toISOString();
  saveOrders();

  closeModal(finishModal);

  // Mostra modal de aguardando pagamento
  waitingTotal.textContent = fmtBRL(total);
  openModal(waitingPaymentModal);

  // Notifica painel admin
  if (channel) {
    channel.postMessage({
      type: "orders-updated",
      orders,
      notification: {
        type: "payment-requested",
        orderId: ord.id,
        table: ord.table,
        clientName: ord.sessionName
      }
    });
  }

  // --- Enviar venda para o backend (PostgreSQL + N8N) ---
  const backendVendasUrl = window.location.origin + '/api/vendas';
  fetch(backendVendasUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: session.clientId,
      mesa: session.table,
      itens: ord.items,
      total: total
    })
  })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    })
    .catch((err) => {
      console.warn("Falha ao enviar comanda ao backend:", err);
      showToast("Comanda salva localmente. O painel admin pode não exibir em outro dispositivo.", 5000);
    });
  // ------------------------------------------------------------------

  // Atualiza UI para não permitir mais pedidos nesta comanda
  updateOrderUI();

  showToast("Comanda enviada! Aguarde a confirmação do pagamento.");
});


// Chamar garçom
btnCallWaiter.addEventListener("click", () => {
  openModal(confirmWaiterModal);
});

btnCancelWaiter.addEventListener("click", () =>
  closeModal(confirmWaiterModal)
);

btnConfirmWaiter.addEventListener("click", () => {
  closeModal(confirmWaiterModal);

  const existingCalls = readLS("rb-waiter-calls", []);

  // Deduplicação: verifica se já existe chamado pendente para esta mesa e cliente
  const isDuplicate = existingCalls.some(c =>
    c.table === session.table &&
    (c.clientName === session.name || c.clientId === session.clientId) &&
    c.status === "pending"
  );

  if (isDuplicate) {
    showToast("Garçom chamado!"); // Finge que chamou para o usuário
    return; // Mas aborta silenciosamente a inclusão duplicada no sistema
  }

  const call = {
    id: Date.now(),
    table: session.table || "N/A",
    clientName: session.name || "Cliente",
    clientId: session.clientId,
    timestamp: Date.now(),
    status: "pending",
  };

  existingCalls.push(call);
  writeLS("rb-waiter-calls", existingCalls);
  localStorage.setItem("rb-waiter-update", Date.now().toString());

  if (channel) {
    channel.postMessage({
      type: "call-waiter",
      table: call.table,
      clientName: call.clientName,
      clientId: call.clientId
    });
  }

  showToast("Garçom chamado!");
});

// Broadcast: comanda fechada
if (channel) {
  channel.addEventListener("message", (ev) => {
    const d = ev.data;
    if (!d) return;

    if (d.type === "comanda-closed" && d.clientId === session.clientId) {
      handleComandaClosed();
    }

    if (d.type === "orders-updated") {
      // Atualiza orders localmente
      const newOrders = d.orders || readLS(LS_ORDERS, []);
      const oldOrder = getCurrentOrder();
      orders = newOrders;
      writeLS(LS_ORDERS, orders);

      // Verifica se a comanda foi fechada
      const newOrder = getCurrentOrder();
      if (oldOrder && newOrder && oldOrder.status !== "closed" && newOrder.status === "closed") {
        handleComandaClosed();
      } else {
        updateOrderUI();
      }
    }
  });
}

// Função para lidar com comanda fechada
function handleComandaClosed() {
  // Para o polling
  stopOrdersPolling();

  const ord = getCurrentOrder();
  if (ord) {
    ord.open = false;
    ord.status = "closed";
    writeLS(LS_ORDERS, orders);
  }

  closeModal(waitingPaymentModal);
  closeModal(finishModal);
  showToast("Pagamento confirmado! Obrigado pela visita.", 3000);

  // limpa sessão do cliente
  session = { name: null, table: null, clientId: null };
  writeLS(LS_SESSION, session);

  // volta para a tela inicial
  setTimeout(() => {
    location.reload();
  }, 1500);
}

// Atualização por storage (multiplas abas diferentes)
window.addEventListener("storage", (e) => {
  if (e.key === LS_ORDERS || e.key === "rb-lastupdate") {
    checkAndUpdateOrders();
  }
  // Se produtos mudaram (por ação do admin)
  if (e.key === LS_PRODUCTS || e.key === "rb-lastupdate") {
    reloadProducts();
  }
});

function reloadProducts() {
  const newProducts = readLS(LS_PRODUCTS, null);
  if (newProducts) {
    products = newProducts;
    renderAllCategories();
  }
}

// Escuta mensagens do BroadcastChannel também para produtos
if (channel) {
  // Já existe listener em algum lugar?
  // O código nas linhas 787+ tratava channel.addEventListener('message', ...)
  // Vamos garantir que ele também atualize produtos se receber algo genérico ou se adicionarmos type='products-updated' futuramente
  // Mas por enquanto, confiaremos no rb-lastupdate e no storage event
}

// ============================================
// SISTEMA DE TEMPO REAL VIA LOCALSTORAGE
// ============================================

let lastUpdateCheck = localStorage.getItem("rb-lastupdate") || "0";
let lastOrdersHash = "";

// Função para calcular hash simples dos pedidos (para detectar mudanças)
function getOrdersHash() {
  const currentOrder = getCurrentOrder();
  if (!currentOrder) return "";
  return JSON.stringify({
    id: currentOrder.id,
    status: currentOrder.status,
    itemsCount: currentOrder.items ? currentOrder.items.length : 0,
    total: currentOrder.items ? currentOrder.items.reduce((s, i) => s + i.price * i.qty, 0) : 0
  });
}

// Função para verificar e atualizar orders
function checkAndUpdateOrders() {
  // Verifica se ainda tem sessão ativa
  const currentSession = readLS(LS_SESSION, {});
  if (!currentSession || !currentSession.clientId) {
    stopOrdersPolling();
    return;
  }

  try {
    // Verifica se há atualização no timestamp
    const currentLastUpdate = localStorage.getItem("rb-lastupdate") || "0";

    // Sempre verifica mudanças, não apenas quando timestamp muda
    // (pode haver mudanças sem timestamp se for na mesma aba)
    const updatedOrders = readLS(LS_ORDERS, []);
    const oldOrder = getCurrentOrder();

    // Atualiza orders localmente se houver mudanças
    if (JSON.stringify(orders) !== JSON.stringify(updatedOrders)) {
      orders = updatedOrders;
      // Não reescreve para não causar loop, apenas atualiza em memória
    }

    // Verifica mudanças na comanda atual
    const newOrder = getCurrentOrder();

    if (!newOrder && oldOrder) {
      // Comanda foi removida
      stopOrdersPolling();
      return;
    }

    if (!newOrder) return; // Sem comanda atual

    const newHash = getOrdersHash();

    if (oldOrder && newOrder) {
      // Verifica se status mudou para "closed"
      if (oldOrder.status !== "closed" && newOrder.status === "closed") {
        handleComandaClosed();
        return;
      }

      // Verifica se status mudou para "sent" (aguardando pagamento)
      if (oldOrder.status !== "sent" && newOrder.status === "sent") {
        // Comanda foi enviada para pagamento (pode ter sido pelo cliente ou admin)
        updateOrderUI();
        const total = newOrder.items ? newOrder.items.reduce((s, i) => s + i.price * i.qty, 0) : 0;
        if (waitingTotal) waitingTotal.textContent = fmtBRL(total);
        if (waitingPaymentModal && !waitingPaymentModal.classList.contains("active")) {
          openModal(waitingPaymentModal);
        }
        showToast("Comanda aguardando pagamento!", 3000);
        lastOrdersHash = newHash;
        return;
      }

      // Verifica se itens mudaram
      if (newHash !== lastOrdersHash) {
        const hadMoreItems = newOrder.items && oldOrder.items &&
          newOrder.items.length > oldOrder.items.length;

        lastOrdersHash = newHash;
        updateOrderUI();

        // Notifica se novo item foi adicionado (pode ser admin adicionando manualmente)
        if (hadMoreItems) {
          showToast("Novo item adicionado à sua comanda!", 2000);
        }
      }
    } else if (newOrder && newHash !== lastOrdersHash) {
      lastOrdersHash = newHash;
      updateOrderUI();
    }

    // Atualiza lastUpdateCheck para evitar verificações desnecessárias
    lastUpdateCheck = currentLastUpdate;
  } catch (e) {
    console.error("Erro ao verificar atualizações:", e);
  }
}

// Inicia polling para verificar atualizações em tempo real
let ordersPollInterval = null;

function startOrdersPolling() {
  // Verifica a cada 1 segundo se há atualizações
  if (ordersPollInterval) {
    clearInterval(ordersPollInterval);
  }

  ordersPollInterval = setInterval(() => {
    checkAndUpdateOrders();
  }, 1000);

  // Também verifica quando a aba ganha foco
  window.addEventListener("focus", checkAndUpdateOrders);
}

function stopOrdersPolling() {
  if (ordersPollInterval) {
    clearInterval(ordersPollInterval);
    ordersPollInterval = null;
  }
}

// Inicializa polling se tiver sessão ativa
if (session.clientId) {
  lastOrdersHash = getOrdersHash();
  startOrdersPolling();
}

// Inicialização automática se já tiver sessão
(function init() {
  if (session.name && session.table) {
    welcome.classList.add("hidden");
    app.classList.add("visible");
    headerTable.textContent = `Mesa ${session.table}`;
    renderAllCategories();
    updateOrderUI();

    // Inicia polling para atualizações em tempo real
    lastOrdersHash = getOrdersHash();
    startOrdersPolling();
  }
})();
