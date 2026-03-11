# RELATÓRIO DE DIAGNÓSTICO — Pedidos do Cardápio Não Aparecem no Admin

**Data:** 2025-03-10  
**Projeto:** Restaurante do Bairro  
**Problema:** Pedidos feitos pelo cardápio digital não aparecem no painel admin (principalmente em dispositivos diferentes).

---

## 1. RESUMO DO PROBLEMA

O painel admin **usa apenas `localStorage`** para exibir pedidos e comandas. O `localStorage` é **isolado por origem e por dispositivo**. Quando o cliente faz o pedido no celular (via QR Code) e o admin acompanha no computador, são contextos distintos: o admin nunca recebe os dados do celular.

O backend **recebe e persiste corretamente** as vendas via `POST /api/vendas`, mas o admin **não consulta** `GET /api/vendas`. Os dados ficam no PostgreSQL e não são exibidos.

---

## 2. FLUXO ESPERADO

```
[Cliente - Celular]                    [Backend]                    [Admin - Computador]
       |                                    |                                |
       | 1. Identificar (nome, mesa)        |                                |
       |----------------------------------->| POST /api/contatos              |
       |                                    | (persiste em contatos)          |
       |                                    |                                |
       | 2. Adicionar itens                 |                                |
       |    (em memória/localStorage)       |                                |
       |                                    |                                |
       | 3. Finalizar comanda               |                                |
       |----------------------------------->| POST /api/vendas                |
       |                                    | (persiste em vendas)            |
       |                                    |                                |
       |                                    |<-------------------------------| GET /api/vendas
       |                                    | (retorna vendas do banco)       |
       |                                    |------------------------------->| Exibe no painel
```

---

## 3. FLUXO REAL ENCONTRADO NO CÓDIGO

### 3.1 Cardápio (index.js)

| Etapa | Onde ocorre | O que faz |
|-------|-------------|-----------|
| 1. Identificação | L.414-453 | `POST /api/contatos` com `{ nome, session_id, mesa }` ✓ |
| 2. Comanda em memória | L.288-306 | `getOrCreateOrder()` → objeto em `orders` |
| 3. Persistência local | L.308-319 | `saveOrders()` → `writeLS(LS_ORDERS, orders)` |
| 4. Adicionar itens | L.495-528 | `ord.items.push()` → `saveOrders()` |
| 5. Finalizar | L.541-578 | `ord.status = "sent"` → `saveOrders()` → `POST /api/vendas` ✓ |

**Trecho crítico (L.553-563):**

```javascript
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
}).catch(err => console.warn("Backend local não alcançado..."));
```

O `fetch` é chamado sem `await`. Se falhar, o erro é só logado; a UI mostra sucesso mesmo assim.

### 3.2 Admin (admin.js)

| Etapa | Onde ocorre | O que faz |
|-------|-------------|-----------|
| Inicialização | L.33 | `let orders = readLS(LS_ORDERS, []);` — **somente localStorage** |
| Atualização | L.1725-1750 | Polling a cada 2s em `localStorage` |
| Sync | L.1687-1702 | `storage` event — só dispara em **outra aba do mesmo navegador** |
| Sync | L.1620-1684 | `BroadcastChannel` — só entre **abas da mesma origem** |

**Nenhuma chamada a `GET /api/vendas` em todo o admin.js.**

### 3.3 Backend (server.js)

| Rota | Existe? | Uso pelo frontend |
|------|---------|-------------------|
| `GET /api/status-db` | ✓ | Não usado |
| `GET /api/contatos` | ✓ | Admin (Remarketing) |
| `POST /api/contatos` | ✓ | Index (identificação) |
| `GET /api/produtos` | ✓ | Index (cardápio) |
| `GET /api/vendas` | ✓ | **Não usado** |
| `POST /api/vendas` | ✓ | Index (finalizar) + Admin (confirmar pagamento) |

---

## 4. ONDE QUEBRA

| Ponto | Arquivo | Linha | Descrição |
|-------|---------|-------|-----------|
| **1** | admin.js | 33 | `orders = readLS(LS_ORDERS, [])` — admin só lê do localStorage do próprio dispositivo |
| **2** | admin.js | — | Não existe `fetch(GET /api/vendas)` em nenhum lugar |
| **3** | index.html / admin.html | — | `api-client.js` **não é carregado** — arquivo não utilizado |

O `BroadcastChannel` e o evento `storage` funcionam apenas quando:
- Cliente e admin estão na **mesma máquina** e **mesma origem** (domínio/porta)
- Ou em abas diferentes do mesmo navegador

Em produção típica (cliente no celular, admin no PC), **não há sincronização**.

---

## 5. ARQUIVOS E FUNÇÕES RESPONSÁVEIS

### 5.1 admin.js

| Função/Bloco | Responsabilidade |
|--------------|------------------|
| L.33 | `let orders = readLS(LS_ORDERS, []);` — fonte única de dados de pedidos |
| L.264-357 | `renderStats()`, `renderDashboardOrders()` — leem de `orders` |
| L.322-356 | `renderDashboardOrders()` — lista "Últimos Pedidos" |
| L.359-324 | `renderAllOrders()` — lista "Todos os Pedidos" |
| L.326-384 | `renderComandas()` — comandas abertas |
| L.386-434 | `renderFinalizadas()` — comandas fechadas |
| L.1687-1702 | `storage` event — atualização entre abas |
| L.1725-1750 | Polling em `LS_ORDERS` |

### 5.2 index.js

| Função/Bloco | Responsabilidade |
|--------------|------------------|
| L.308-319 | `saveOrders()` — grava em `LS_ORDERS` e faz broadcast |
| L.553-563 | `POST /api/vendas` ao finalizar — envia ao backend |
| L.444-451 | `POST /api/contatos` na identificação |

### 5.3 api-client.js

- **Não é referenciado** em `index.html` nem em `admin.html`
- Chama rotas inexistentes: `/api/clientes`, `/api/comandas`, `/api/pedidos`, `/api/estoque`
- `checkAPI()` usa `/api/clientes` (que não existe) — isso não impacta o fluxo atual porque o arquivo não é carregado

---

## 6. ESTRUTURA DE DADOS: FRONTEND vs BACKEND

### Frontend (orders no localStorage)

```javascript
{
  id: number,
  clientId: string,      // UUID da sessão
  sessionName: string,   // Nome do cliente
  table: string,         // Mesa
  items: [{ productId, name, price, qty, obs }],
  status: "open" | "sent" | "closed" | "preparing" | "ready",
  open: boolean,
  createdAt: number,
  sentAt?: string,
  closedAt?: string
}
```

### Backend (tabela vendas)

```sql
id, contato_id, mesa, itens (JSONB), total, pontos_gerados, criado_em
```

- `contato_id` → FK para `contatos` (nome do cliente)
- `itens` já está em formato compatível (array de objetos)

---

## 7. CAUSA RAIZ

1. **Admin depende 100% de localStorage**  
   Todas as telas de pedidos/comandas leem apenas `orders` vindo de `readLS(LS_ORDERS, [])`.

2. **localStorage não cruza dispositivos**  
   Celular e computador têm storages separados. Não há forma de o admin “ver” o localStorage do celular.

3. **Dados no banco não são consumidos**  
   `POST /api/vendas` grava corretamente no PostgreSQL, mas o admin nunca usa `GET /api/vendas`.

4. **`api-client.js` não participa do fluxo**  
   O arquivo existe mas não é incluído em nenhum HTML. As rotas que ele usa não existem no backend.

---

## 8. CORREÇÃO RECOMENDADA

### 8.1 Prioridade 1: Admin buscar vendas da API

- Na inicialização e em intervalo periódico (ex.: 5–10s), chamar `GET /api/vendas`.
- Mapear o retorno para o formato que o admin já usa (ex.: `table` ← `mesa`, `sessionName` via join em `contatos` ou incluído na resposta).
- Combinar vendas da API com orders vindos do localStorage (priorizar API em caso de conflito).

### 8.2 Prioridade 2: Comandas em aberto

- Hoje, comandas com `status: "open"` ou `"sent"` existem só no localStorage.
- Para funcionar entre dispositivos, seria necessário:
  - Criar endpoint `POST /api/comandas` (ou similar) ao abrir/completar comanda, e
  - `GET /api/comandas/abertas` (ou equivalente) no admin para listar comandas pendentes.

### 8.3 Prioridade 3: Tratamento de erro no index.js

- Usar `await fetch(...)` ou `.then()/.catch()` de forma que falhas em `POST /api/vendas` sejam tratadas e, se possível, sinalizadas ao usuário.

### 8.4 Opcional: Ajustar ou remover api-client.js

- Ou adaptar o `api-client.js` às rotas reais e passá-lo a ser usado pelo frontend,
- Ou removê-lo para evitar confusão.

---

## 9. MUDANÇAS EXATAS PROPOSTAS

### A. server.js — incluir nome do cliente em GET /api/vendas

Fazer join com `contatos` para retornar `sessionName` (ou `nome`) junto às vendas, facilitando o uso no admin.

### B. admin.js — buscar vendas da API

1. Criar função `fetchVendasFromAPI()` que chama `GET /api/vendas` e converte o retorno para o formato de `orders`.
2. Na inicialização, chamar essa função e mesclar com `orders` do localStorage.
3. Configurar `setInterval` (ex.: 5s) para atualizar vendas da API.
4. Na renderização, priorizar vendas vindas da API quando houver vendas finalizadas.

### C. admin.js — mesclar fontes

- Comandas abertas (`status: "open"`, `"sent"`): manter lógica atual (localStorage + BroadcastChannel) para admin e cardápio na mesma máquina.
- Vendas finalizadas: usar principalmente `GET /api/vendas`; localStorage como fallback/merge quando fizer sentido.

### D. index.js — tratamento de erro (opcional)

- Usar `await` e exibir feedback ao usuário em caso de falha no `POST /api/vendas`.

---

## 10. ROTAS EXISTENTES vs CHAMADAS

| Backend (server.js) | Chamado por | Observação |
|---------------------|-------------|------------|
| POST /admin/login | login.html | ✓ |
| GET /admin/logout | — | ✓ |
| GET /api/status-db | — | Não usado |
| GET /api/contatos | admin.js (Remarketing) | ✓ |
| POST /api/contatos | index.js | ✓ |
| GET /api/produtos | index.js | ✓ |
| **GET /api/vendas** | **Ninguém** | **Não usado** |
| POST /api/vendas | index.js, admin.js | ✓ |

| api-client.js (não carregado) | Backend | Observação |
|-------------------------------|---------|------------|
| GET /api/clientes | Não existe | Incompatível |
| POST /api/clientes | Não existe | Incompatível |
| GET /api/comandas/abertas | Não existe | Incompatível |
| POST /api/comandas | Não existe | Incompatível |
| etc. | — | api-client não é usado |

---

**Fim do relatório.**
