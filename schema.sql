-- ============================================
-- SCHEMA COMPLETO DO SISTEMA DE RESTAURANTE (POSTGRESQL)
-- ============================================

-- Tabela de Contatos (Substituindo Clientes antigas pra acompanhar server.js)
CREATE TABLE IF NOT EXISTS contatos (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    session_id VARCHAR(255) UNIQUE,
    mesa VARCHAR(50),
    pontos INTEGER DEFAULT 0,
    total_gasto NUMERIC(10,2) DEFAULT 0,
    visitas INTEGER DEFAULT 1,
    criado_em TIMESTAMP DEFAULT NOW(),
    atualizado_em TIMESTAMP DEFAULT NOW()
);

-- Tabela de Vendas (Responsável por manter os pedidos serializados)
-- status: 'pendente' = aguardando pagamento, 'pago' = finalizado
CREATE TABLE IF NOT EXISTS vendas (
    id SERIAL PRIMARY KEY,
    contato_id INTEGER REFERENCES contatos(id) ON DELETE SET NULL,
    mesa VARCHAR(50),
    itens JSONB,
    total NUMERIC(10,2),
    pontos_gerados INTEGER,
    status VARCHAR(20) DEFAULT 'pendente',
    criado_em TIMESTAMP DEFAULT NOW()
);

-- Tabela de Comandas
CREATE TABLE IF NOT EXISTS comandas (
    id SERIAL PRIMARY KEY,
    contato_id INTEGER REFERENCES contatos(id) ON DELETE SET NULL,
    mesa VARCHAR(10) NOT NULL,
    status VARCHAR(20) DEFAULT 'aberta',
    total NUMERIC(10,2) DEFAULT 0,
    origem VARCHAR(20) DEFAULT 'qr_code',
    aberta_em TIMESTAMP DEFAULT NOW(),
    fechada_em TIMESTAMP,
    tem_notificacao BOOLEAN DEFAULT FALSE,
    atualizado_em TIMESTAMP DEFAULT NOW()
);

-- Tabela de Produtos
CREATE TABLE IF NOT EXISTS produtos (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    descricao TEXT,
    preco NUMERIC(10,2) NOT NULL,
    categoria VARCHAR(50) NOT NULL,
    imagem TEXT,
    visivel BOOLEAN DEFAULT TRUE,
    ativo BOOLEAN DEFAULT TRUE,
    criado_em TIMESTAMP DEFAULT NOW(),
    atualizado_em TIMESTAMP DEFAULT NOW()
);

-- Outras tabelas de suporte traduzidas para o novo banco
CREATE TABLE IF NOT EXISTS pagamentos (
    id SERIAL PRIMARY KEY,
    comanda_id INTEGER NOT NULL REFERENCES comandas(id) ON DELETE CASCADE,
    valor NUMERIC(10,2) NOT NULL,
    metodo_pagamento VARCHAR(50) NOT NULL,
    status VARCHAR(20) DEFAULT 'pendente',
    criado_em TIMESTAMP DEFAULT NOW()
);
