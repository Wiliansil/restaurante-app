// api-client.js - Cliente API que funciona com localStorage (fallback) ou backend
(function () {
  const API_URL = window.API_URL || (window.location.origin + '/api');
  const USE_API = window.USE_API !== false; // Padrão: usar API se disponível

  const LS_CLIENTES = 'rb-clientes-v1';
  const LS_COMANDAS = 'rb-comandas-v1';
  const LS_ESTOQUE = 'rb-estoque-v1';

  // Helper para localStorage
  function readLS(key, def) {
    try {
      const r = localStorage.getItem(key);
      return r ? JSON.parse(r) : def;
    } catch (e) {
      return def;
    }
  }

  function writeLS(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { }
  }

  // Verificar se API está disponível
  async function checkAPI() {
    if (!USE_API) return false;
    try {
      const response = await fetch(`${API_URL}/dashboard`, { method: 'GET', timeout: 2000 });
      return response.ok;
    } catch (e) {
      return false;
    }
  }

  // ============================================
  // CLIENTES
  // ============================================

  window.ClienteAPI = {
    // Buscar ou criar cliente
    async buscarOuCriar(nome, telefone, email) {
      const apiAvailable = await checkAPI();

      if (apiAvailable) {
        try {
          const response = await fetch(`${API_URL}/clientes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome, telefone, email })
          });
          if (response.ok) {
            const cliente = await response.json();
            return cliente;
          }
        } catch (e) {
          console.warn('API indisponível, usando localStorage:', e);
        }
      }

      // Fallback: localStorage
      let clientes = readLS(LS_CLIENTES, []);
      let cliente = clientes.find(c => c.telefone === telefone);

      if (cliente) {
        cliente.ultima_visita = new Date().toISOString();
        cliente.total_visitas = (cliente.total_visitas || 0) + 1;
        cliente.isReturning = true;
      } else {
        cliente = {
          id: Date.now(),
          nome,
          telefone,
          email: email || null,
          data_cadastro: new Date().toISOString(),
          ultima_visita: new Date().toISOString(),
          total_visitas: 1,
          isReturning: false
        };
        clientes.push(cliente);
      }

      writeLS(LS_CLIENTES, clientes);
      return cliente;
    },

    // Buscar por telefone
    async buscarPorTelefone(telefone) {
      const apiAvailable = await checkAPI();

      if (apiAvailable) {
        try {
          const response = await fetch(`${API_URL}/clientes/telefone/${encodeURIComponent(telefone)}`);
          if (response.ok) {
            const cliente = await response.json();
            if (cliente) return cliente;
          }
        } catch (e) {
          console.warn('API indisponível, usando localStorage:', e);
        }
      }

      // Fallback: localStorage
      const clientes = readLS(LS_CLIENTES, []);
      return clientes.find(c => c.telefone === telefone) || null;
    }
  };

  // ============================================
  // COMANDAS
  // ============================================

  window.ComandaAPI = {
    // Criar comanda
    async criar(clienteId, mesa, origem = 'qr_code') {
      const apiAvailable = await checkAPI();

      if (apiAvailable) {
        try {
          const response = await fetch(`${API_URL}/comandas`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cliente_id: clienteId, mesa, origem })
          });
          if (response.ok) {
            return await response.json();
          }
        } catch (e) {
          console.warn('API indisponível, usando localStorage:', e);
        }
      }

      // Fallback: localStorage (usa estrutura existente)
      return {
        id: Date.now(),
        cliente_id: clienteId,
        mesa,
        origem,
        status: 'aberta',
        total: 0,
        tem_notificacao: false,
        aberta_em: new Date().toISOString()
      };
    },

    // Buscar comandas abertas
    async buscarAbertas() {
      const apiAvailable = await checkAPI();

      if (apiAvailable) {
        try {
          const response = await fetch(`${API_URL}/comandas/abertas`);
          if (response.ok) {
            return await response.json();
          }
        } catch (e) {
          console.warn('API indisponível, usando localStorage:', e);
        }
      }

      // Fallback: usa estrutura existente do localStorage
      return [];
    },

    // Fechar comanda
    async fechar(comandaId) {
      const apiAvailable = await checkAPI();

      if (apiAvailable) {
        try {
          const response = await fetch(`${API_URL}/comandas/${comandaId}/fechar`, {
            method: 'PUT'
          });
          if (response.ok) {
            return await response.json();
          }
        } catch (e) {
          console.warn('API indisponível:', e);
        }
      }

      return { success: true };
    },

    // Marcar como visualizada
    async visualizar(comandaId) {
      const apiAvailable = await checkAPI();

      if (apiAvailable) {
        try {
          await fetch(`${API_URL}/comandas/${comandaId}/visualizar`, { method: 'PUT' });
        } catch (e) {
          console.warn('API indisponível:', e);
        }
      }
    }
  };

  // ============================================
  // PEDIDOS
  // ============================================

  window.PedidoAPI = {
    // Criar pedido
    async criar(comandaId, origemPedido = 'qr_code', observacoes) {
      const apiAvailable = await checkAPI();

      if (apiAvailable) {
        try {
          const response = await fetch(`${API_URL}/pedidos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ comanda_id: comandaId, origem_pedido: origemPedido, observacoes })
          });
          if (response.ok) {
            return await response.json();
          }
        } catch (e) {
          console.warn('API indisponível, usando localStorage:', e);
        }
      }

      // Fallback: retorna estrutura básica
      return {
        id: Date.now(),
        comanda_id: comandaId,
        origem_pedido: origemPedido,
        status: 'pendente',
        observacoes: observacoes || null,
        created_at: new Date().toISOString()
      };
    },

    // Adicionar item ao pedido
    async adicionarItem(pedidoId, item) {
      const apiAvailable = await checkAPI();

      if (apiAvailable) {
        try {
          const response = await fetch(`${API_URL}/pedidos/${pedidoId}/itens`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              produto_id: item.productId,
              nome_produto: item.name,
              quantidade: item.qty,
              preco_unitario: item.price,
              observacoes: item.obs || null
            })
          });
          if (response.ok) {
            return await response.json();
          }
        } catch (e) {
          console.warn('API indisponível:', e);
        }
      }

      // Fallback: retorna item
      return {
        id: Date.now(),
        subtotal: item.qty * item.price
      };
    },

    // Buscar pedidos de uma comanda
    async buscarPorComanda(comandaId) {
      const apiAvailable = await checkAPI();

      if (apiAvailable) {
        try {
          const response = await fetch(`${API_URL}/comandas/${comandaId}/pedidos`);
          if (response.ok) {
            return await response.json();
          }
        } catch (e) {
          console.warn('API indisponível:', e);
        }
      }

      return [];
    }
  };

  // ============================================
  // ESTOQUE
  // ============================================

  window.EstoqueAPI = {
    // Listar estoque
    async listar() {
      const apiAvailable = await checkAPI();

      if (apiAvailable) {
        try {
          const response = await fetch(`${API_URL}/estoque`);
          if (response.ok) {
            return await response.json();
          }
        } catch (e) {
          console.warn('API indisponível, usando localStorage:', e);
        }
      }

      // Fallback: localStorage
      return readLS(LS_ESTOQUE, []);
    },

    // Criar item
    async criar(item) {
      const apiAvailable = await checkAPI();

      if (apiAvailable) {
        try {
          const response = await fetch(`${API_URL}/estoque`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item)
          });
          if (response.ok) {
            return await response.json();
          }
        } catch (e) {
          console.warn('API indisponível, usando localStorage:', e);
        }
      }

      // Fallback: localStorage
      let estoque = readLS(LS_ESTOQUE, []);
      item.id = Date.now();
      estoque.push(item);
      writeLS(LS_ESTOQUE, estoque);
      return item;
    },

    // Atualizar item
    async atualizar(id, item) {
      const apiAvailable = await checkAPI();

      if (apiAvailable) {
        try {
          const response = await fetch(`${API_URL}/estoque/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item)
          });
          if (response.ok) {
            return await response.json();
          }
        } catch (e) {
          console.warn('API indisponível, usando localStorage:', e);
        }
      }

      // Fallback: localStorage
      let estoque = readLS(LS_ESTOQUE, []);
      estoque = estoque.map(e => e.id === id ? { ...e, ...item } : e);
      writeLS(LS_ESTOQUE, estoque);
      return { success: true };
    }
  };

  console.log('API Client inicializado (modo:', USE_API ? 'API' : 'localStorage', ')');
})();

