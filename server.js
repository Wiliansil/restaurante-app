require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    sameSite: 'lax'
  }
}));

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

pool.connect((err, client, release) => {
  if (err) {
    console.error('Erro ao conectar ao PostgreSQL:', err.message);
  } else {
    release();
    console.log('Conectado ao PostgreSQL com sucesso!');
    initializeDatabase();
  }
});

async function initializeDatabase() {
  try {
    const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await pool.query(schemaSql);
    await pool.query(`
      ALTER TABLE vendas ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pendente'
    `);
    await pool.query(`UPDATE vendas SET status = COALESCE(status, 'pago') WHERE status IS NULL`);
    console.log('Tabelas verificadas com sucesso a partir do schema.sql');
  } catch (err) {
    console.error('Falha de inicialização das tabelas SQL:', err.message);
  }
}

function requireAdminAuth(req, res, next) {
  if (req.session && req.session.isAdminAuthenticated) {
    return next();
  }
  return res.redirect('/login.html');
}

app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;

  if (
    username === process.env.ADMIN_USER &&
    password === process.env.ADMIN_PASSWORD
  ) {
    req.session.isAdminAuthenticated = true;
    req.session.adminUser = username;
    return res.redirect('/admin.html');
  }

  return res.redirect('/login.html?error=1');
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login.html');
  });
});

app.get('/api/status-db', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Falha Status:', err);
    res.status(500).json({ status: 'error', message: 'Falha global com Banco de Dados' });
  }
});

app.get('/api/contatos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM contatos ORDER BY pontos DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('Falha GET contatos:', err);
    res.status(500).json({ error: 'Erro ao buscar contatos.' });
  }
});

app.post('/api/contatos', async (req, res) => {
  const { nome, session_id, mesa } = req.body;

  try {
    const result = await pool.query(
      `
      INSERT INTO contatos (nome, session_id, mesa)
      VALUES ($1, $2, $3)
      ON CONFLICT (session_id) DO UPDATE
      SET nome = $1, mesa = $3, visitas = contatos.visitas + 1, atualizado_em = NOW()
      RETURNING *
      `,
      [nome, session_id, mesa]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Falha POST contatos:', err);
    res.status(500).json({ error: 'Erro ao salvar contato.' });
  }
});

app.get('/api/produtos', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM produtos WHERE ativo = true AND visivel = true ORDER BY nome ASC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Falha GET produtos:', err);
    res.status(500).json({ error: 'Erro ao buscar produtos.' });
  }
});

app.get('/api/vendas', async (req, res) => {
  try {
    const statusFilter = req.query.status;
    let whereClause = '';
    const params = [];

    if (statusFilter === 'pendente' || statusFilter === 'pago') {
      whereClause = 'WHERE v.status = $1';
      params.push(statusFilter);
    }

    const result = await pool.query(
      {
        text: `
          SELECT v.*, c.nome as session_name
          FROM vendas v
          LEFT JOIN contatos c ON v.contato_id = c.id
          ${whereClause}
          ORDER BY v.criado_em DESC
        `,
        values: params
      }
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Falha GET vendas:', err);
    res.status(500).json({ error: 'Erro ao buscar vendas.' });
  }
});

app.post('/api/vendas', async (req, res) => {
  const { session_id, mesa, itens, total } = req.body;

  try {
    const pontos = Math.floor(Number(total) || 0);

    const contato = await pool.query(
      'SELECT id FROM contatos WHERE session_id = $1',
      [session_id]
    );

    const contato_id = contato.rows[0]?.id || null;

    if (contato_id) {
      await pool.query(
        `
        UPDATE contatos
        SET pontos = pontos + $1,
            total_gasto = total_gasto + $2,
            atualizado_em = NOW()
        WHERE id = $3
        `,
        [pontos, total, contato_id]
      );
    }

    const result = await pool.query(
      `
      INSERT INTO vendas (contato_id, mesa, itens, total, pontos_gerados, status)
      VALUES ($1, $2, $3, $4, $5, 'pendente')
      RETURNING *
      `,
      [contato_id, mesa, JSON.stringify(itens), total, pontos]
    );

    const webhookUrl = process.env.N8N_WEBHOOK_URL;

    if (webhookUrl) {
      fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          evento: 'nova_venda_finalizada',
          dados: result.rows[0],
          user_session_id: session_id,
        }),
      }).catch((err) => {
        console.error('Aviso secundário: Webhook/N8N falhou:', err.message);
      });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Falha POST transação de venda:', err);
    res.status(500).json({ error: 'Erro ao registrar venda.' });
  }
});

app.put('/api/vendas/:id/pagar', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'ID inválido.' });
  }

  try {
    const result = await pool.query(
      `UPDATE vendas SET status = 'pago' WHERE id = $1 AND status = 'pendente' RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Venda não encontrada ou já paga.' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Falha PUT vendas/pagar:', err);
    res.status(500).json({ error: 'Erro ao marcar venda como paga.' });
  }
});

app.get('/admin.html', requireAdminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.use(express.static(path.join(__dirname)));

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});