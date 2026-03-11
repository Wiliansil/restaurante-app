# ANÁLISE: Fluxo de Pedidos Ativos e Comandas Abertas

**Data:** 2025-03-10  
**Objetivo:** Identificar por que Pedidos Pendentes e Comandas Abertas ficam zerados no admin e qual rota deveria alimentá-los.

---

## 1. FLUXO DO CARDÁPIO (index.js) — O QUE É CHAMADO E QUANDO

### 1.1 Identificação do cliente (submit do formulário)
- **Endpoint:** `POST /api/contatos`
- **Payload:** `{ nome, session_id, mesa }`
- **Quando:** Ao clicar em "Abrir Minha Comanda" no modal de identificação.

### 1.2 Criação da comanda (getOrCreateOrder)
- **Endpoint:** NENHUM
- **Persistência:** Somente em memória e `localStorage` (LS_ORDERS).
- **Quando:** Ao abrir o cardápio e adicionar o primeiro item.

### 1.3 Adicionar item ao pedido (btnAddToCart)
- **Endpoint:** NENHUM
- **Persistência:** Somente `saveOrders()` → `localStorage` + `BroadcastChannel`.
- **Quando:** Ao clicar em "Adicionar" no modal do produto.

### 1.4 Finalizar comanda (btnConfirmFinish)
- **Endpoint:** `POST /api/vendas`
- **Payload:** `{ session_id, mesa, itens, total }`
- **Persistência:** `localStorage` (status = "sent") + backend (tabela `vendas`).
- **Quando:** Ao clicar em "Confirmar" no modal de finalização.

### 1.5 Busca de produtos
- **Endpoint:** `GET /api/produtos`
- **Quando:** 500 ms após o carregamento da página.

---

## 2. RESUMO: ONDE O PEDIDO É ENVIADO AO BACKEND

| Momento                         | Backend chamado? | Rota              |
|---------------------------------|------------------|-------------------|
| Cliente se identifica           | Sim              | POST /api/contatos|
| Comanda criada (primeiro item)  | Não              | —                 |
| Item adicionado                 | Não              | —                 |
| Cliente clica em "Finalizar"    | Sim              | POST /api/vendas  |

**Conclusão:** O pedido só chega ao backend no momento da **finalização** (status "sent"). Pedidos em construção (status "open") permanecem apenas em `localStorage`.

---

## 3. ROTAS EXISTENTES NO BACKEND (server.js)

| Método | Rota                | Descrição                         |
|--------|---------------------|-----------------------------------|
| POST   | /admin/login        | Login do admin                    |
| GET    | /admin/logout       | Logout                            |
| GET    | /api/status-db      | Health check do banco             |
| GET    | /api/contatos       | Listar contatos                   |
| POST   | /api/contatos       | Criar/atualizar contato           |
| GET    | /api/produtos       | Listar produtos                   |
| GET    | /api/vendas         | Listar vendas (todas)             |
| POST   | /api/vendas         | Registrar venda                   |

### Rotas inexistentes no backend

| Rota esperada (api-client.js)   | Existe? |
|---------------------------------|---------|
| POST /api/clientes              | Não     |
| GET /api/clientes               | Não     |
| GET /api/clientes/telefone/:id  | Não     |
| POST /api/comandas              | Não     |
| GET /api/comandas/abertas       | Não     |
| PUT /api/comandas/:id/fechar    | Não     |
| PUT /api/comandas/:id/visualizar| Não     |
| POST /api/pedidos               | Não     |
| POST /api/pedidos/:id/itens     | Não     |
| GET /api/comandas/:id/pedidos   | Não     |
| GET /api/estoque                | Não     |

**Observação:** `api-client.js` não é carregado em `index.html` nem em `admin.html`; o cardápio usa apenas `index.js`.

---

## 4. O QUE O ADMIN ESPERA

### 4.1 Pedidos Pendentes
- **Fonte:** `getMergedOrders()` → `orders.filter(o => o.open && o.status === "open")`
- **Significado:** Comandas em que o cliente ainda está adicionando itens.

### 4.2 Comandas Ativas
- **Fonte:** `orders.filter(o => o.open)` (em `renderComandas`)
- **Significado:** Comandas com `open === true` (status "open" ou "sent").

### 4.3 Comandas Finalizadas
- **Fonte:** `getMergedOrders()` → vendas vindas de `GET /api/vendas`.
- **Significado:** Vendas registradas no PostgreSQL.

---

## 5. ONDE O FLUXO QUEBRA

### 5.1 Pedidos em aberto (status "open")
- Ficam **somente** em `localStorage` do dispositivo do cliente.
- Nenhuma rota de backend recebe esses dados.
- O admin, em outro dispositivo, não tem acesso a esse `localStorage`.

### 5.2 Pedidos enviados (status "sent")
- São enviados ao backend via `POST /api/vendas`.
- O backend grava na tabela `vendas`.
- `GET /api/vendas` retorna essas vendas.
- O admin mapeia todas como `status: 'closed'` e `open: false`.
- Resultado: aparecem em **Finalizadas**, e não em **Comandas Abertas** ou **Pedidos Pendentes**.

### 5.3 Resumo da quebra

| Tipo de pedido            | Onde está no cardápio | Backend recebe? | Admin mostra em      |
|---------------------------|------------------------|-----------------|----------------------|
| Em construção (open)      | localStorage           | Não             | Nada (zerado)        |
| Enviado/aguardando (sent) | localStorage + vendas  | Sim             | Finalizadas (errado) |

---

## 6. ROTAS NECESSÁRIAS

### 6.1 Rota para pedidos/comandas ativas

Hoje não existe rota que retorne pedidos ou comandas em aberto.

O schema já tem a tabela `comandas`:

```sql
CREATE TABLE IF NOT EXISTS comandas (
    id SERIAL PRIMARY KEY,
    contato_id INTEGER,
    mesa VARCHAR(10),
    status VARCHAR(20) DEFAULT 'aberta',
    total NUMERIC(10,2) DEFAULT 0,
    origem VARCHAR(20) DEFAULT 'qr_code',
    aberta_em TIMESTAMP,
    fechada_em TIMESTAMP,
    ...
);
```

Ela não é utilizada por nenhuma rota do `server.js`.

### 6.2 Rotas que faltam

| Rota                        | Uso sugerido                                      |
|-----------------------------|---------------------------------------------------|
| POST /api/comandas          | Criar comanda quando o cliente se identifica      |
| PUT /api/comandas/:id       | Atualizar comanda (itens, status)                 |
| GET /api/comandas/abertas   | Listar comandas com status aberta/sent            |

Ou, mantendo só a tabela `vendas`:

| Rota                     | Uso sugerido                                      |
|--------------------------|---------------------------------------------------|
| GET /api/vendas?status=  | Filtrar vendas por status (ex.: pendente/ativo)   |

Mas a tabela `vendas` não possui coluna `status`.

---

## 7. RESPOSTAS DIRETAS

### 7.1 Qual rota recebe o pedido no momento da criação?

- **Criação da comanda:** nenhuma.
- **Adição de itens:** nenhuma.
- **Finalização:** `POST /api/vendas`.

### 7.2 Qual rota lista pedidos/comandas ativas?

Não existe rota no backend para isso.

### 7.3 Essa rota existe?

Não.

### 7.4 Qual rota o admin deveria usar para pedidos pendentes?

Deveria existir algo como `GET /api/comandas/abertas` ou equivalente que retorne comandas com status "aberta" ou "enviada" (aguardando pagamento).

---

## 8. AJUSTES SUGERIDOS

### 8.1 No backend (server.js)

1. **Usar a tabela `comandas`**  
   - Criar rotas que leiam e gravem nela.

2. **Criar rota para comandas abertas**  
   - Ex.: `GET /api/comandas/abertas`
   - Retornar comandas com `status IN ('aberta', 'enviada')` ou `fechada_em IS NULL`.

3. **Alternativa mais simples (sem mexer no schema):**  
   - Adicionar coluna `status` em `vendas` (ex.: 'pendente', 'pago').
   - No `POST /api/vendas`, gravar `status = 'pendente'`.
   - No `GET /api/vendas`, permitir filtro por status, ex.: `?status=pendente`.

### 8.2 No cardápio (index.js)

1. **Persistir comanda ao abrir**
   - Chamar `POST /api/comandas` quando o cliente se identifica (com contato/session).

2. **Enviar itens ao adicionar**
   - Chamar `PUT /api/comandas/:id` ou `POST /api/pedidos/:id/itens` ao adicionar item.

3. **Alternativa mais simples**
   - Continuar enviando só no finalizar, mas:
     - No `POST /api/vendas`, gravar com `status = 'pendente'`.
     - Criar `GET /api/vendas?status=pendente` para o admin.

### 8.3 No admin (admin.js)

1. **Nova função de API**
   - Ex.: `fetchComandasAbertasFromAPI()` ou `fetchVendasPendentesFromAPI()`.
   - Chamar `GET /api/comandas/abertas` ou `GET /api/vendas?status=pendente`.

2. **Mesclar no `getMergedOrders()`**
   - Incluir comandas/vendas ativas vindas da API junto com as do `localStorage`.

3. **Comportamento esperado**
   - **Comandas Abertas:** `orders` (LS) + comandas/vendas ativas da API.
   - **Pedidos Pendentes:** mesmo conjunto filtrado por status adequado.
   - **Finalizadas:** vendas com status pago/fechado ou equivalentes.

---

## 9. CAMINHO RECOMENDADO (MÍNIMO)

1. **Schema**
   - Adicionar `status VARCHAR(20) DEFAULT 'pendente'` na tabela `vendas`.
   - Valores sugeridos: `'pendente'`, `'pago'`.

2. **Backend**
   - Em `POST /api/vendas`: gravar `status = 'pendente'`.
   - Criar `GET /api/vendas?status=pendente` (ou endpoint equivalente).
   - Ter rota/handler para marcar venda como paga (ex.: `PUT /api/vendas/:id/pagar` ou similar).

3. **index.js**
   - Sem mudança obrigatória; o `POST /api/vendas` já é chamado na finalização.

4. **admin.js**
   - Criar `fetchVendasPendentesFromAPI()` que chama `GET /api/vendas?status=pendente`.
   - Mapear para `status: 'sent'`, `open: true`.
   - Incluir no `getMergedOrders()` para exibir em Comandas Abertas e Pedidos Pendentes.
   - Ao confirmar pagamento, chamar a rota que marca a venda como paga (em vez de só atualizar localmente).
