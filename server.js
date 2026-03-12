require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');
const path    = require('path');
const fs      = require('fs');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // allow large base64 images
app.use(express.static(path.join(__dirname, 'public')));

const {
  BOT_TOKEN,
  PRODUCTS_CHANNEL,
  REQUESTS_CHANNEL,
  ORDERS_CHANNEL,
  ADMIN_KEY = 'tavobarygaadmin123',
  PORT = 3000
} = process.env;

const DISCORD_API = 'https://discord.com/api/v10';

// ── Persistent storage (flat JSON file) ──
const DATA_FILE = path.join(__dirname, 'data.json');

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {}
  return { products: [], orders: [] };
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let db = loadData();

// ── Discord helper ──
async function discordPost(channelId, payload) {
  try {
    const r = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${BOT_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    return r.ok ? await r.json() : null;
  } catch (e) {
    console.error('Discord post error:', e.message);
    return null;
  }
}

// ══════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════

// POST /api/login — verify admin key
app.post('/api/login', (req, res) => {
  let { key } = req.body;
  if (!key) return res.status(400).json({ ok: false, error: 'No key provided' });

  // Support "AdminKey:lolol" format
  if (key.startsWith('AdminKey:')) key = key.replace('AdminKey:', '').trim();

  if (key === ADMIN_KEY) {
    discordPost(PRODUCTS_CHANNEL, {
      embeds: [{
        title: '🔑 Admin Login',
        color: 0x00ff00,
        description: `Admin logged in at ${new Date().toLocaleString()}`,
        footer: { text: 'TavoBaryga Security' }
      }]
    });
    return res.json({ ok: true });
  }

  discordPost(PRODUCTS_CHANNEL, {
    embeds: [{
      title: '⚠️ Failed Login Attempt',
      color: 0xff0000,
      description: `Wrong password attempt at ${new Date().toLocaleString()}`,
      footer: { text: 'TavoBaryga Security' }
    }]
  });
  return res.status(401).json({ ok: false, error: 'Invalid key' });
});

// ══════════════════════════════════════════
// PRODUCTS
// ══════════════════════════════════════════

// GET /api/products — return all products
app.get('/api/products', (req, res) => {
  res.json(db.products);
});

// POST /api/products — add product
app.post('/api/products', (req, res) => {
  const { name, price, desc, badge, stock, emoji, image } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'Name and price required' });

  const product = {
    id: Date.now(),
    name, price: parseFloat(price),
    desc: desc || '',
    badge: (badge || '').toUpperCase(),
    stock: stock || '',
    emoji: emoji || '',
    image: image || '',
    createdAt: new Date().toISOString()
  };

  db.products.push(product);
  saveData(db);

  // Log to Discord products channel
  discordPost(PRODUCTS_CHANNEL, {
    embeds: [{
      title: `📦 New Product Added`,
      color: 0xffffff,
      fields: [
        { name: 'Name',  value: name,                            inline: true },
        { name: 'Price', value: `$${parseFloat(price).toFixed(2)}`, inline: true },
        { name: 'Badge', value: badge || 'None',                 inline: true },
        { name: 'Description', value: desc || 'None',            inline: false }
      ],
      footer: { text: `Product ID: ${product.id} · ${new Date().toLocaleString()}` }
    }]
  });

  res.json(product);
});

// PUT /api/products/:id — update product
app.put('/api/products/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const idx = db.products.findIndex(p => p.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  const { name, price, desc, badge, stock, emoji, image } = req.body;
  db.products[idx] = {
    ...db.products[idx],
    name:  name  || db.products[idx].name,
    price: price ? parseFloat(price) : db.products[idx].price,
    desc:  desc  !== undefined ? desc  : db.products[idx].desc,
    badge: badge !== undefined ? (badge||'').toUpperCase() : db.products[idx].badge,
    stock: stock !== undefined ? stock : db.products[idx].stock,
    emoji: emoji !== undefined ? emoji : db.products[idx].emoji,
    image: image !== undefined ? image : db.products[idx].image,
    updatedAt: new Date().toISOString()
  };

  saveData(db);

  discordPost(PRODUCTS_CHANNEL, {
    embeds: [{
      title: `✏️ Product Updated: ${db.products[idx].name}`,
      color: 0xaaaaaa,
      fields: [
        { name: 'Price', value: `$${db.products[idx].price.toFixed(2)}`, inline: true },
        { name: 'Badge', value: db.products[idx].badge || 'None',        inline: true }
      ],
      footer: { text: `Product ID: ${id} · ${new Date().toLocaleString()}` }
    }]
  });

  res.json(db.products[idx]);
});

// DELETE /api/products/:id — delete product
app.delete('/api/products/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const product = db.products.find(p => p.id === id);
  if (!product) return res.status(404).json({ error: 'Not found' });

  db.products = db.products.filter(p => p.id !== id);
  saveData(db);

  discordPost(PRODUCTS_CHANNEL, {
    embeds: [{
      title: `🗑️ Product Deleted: ${product.name}`,
      color: 0xff4444,
      footer: { text: `${new Date().toLocaleString()}` }
    }]
  });

  res.json({ ok: true });
});

// ══════════════════════════════════════════
// ORDERS
// ══════════════════════════════════════════

// GET /api/orders
app.get('/api/orders', (req, res) => {
  res.json(db.orders);
});

// POST /api/orders — place order
app.post('/api/orders', async (req, res) => {
  const { name, email, phone, address, items } = req.body;
  if (!name || !email || !phone || !items?.length) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const orderNum = Math.floor(1000 + Math.random() * 9000);
  const orderId  = 'TB-' + orderNum;
  const total    = items.reduce((s, i) => s + i.price * i.qty, 0);
  const itemsText = items.map(i => `${i.emoji || '📦'} ${i.name} × ${i.qty} — $${(i.price * i.qty).toFixed(2)}`).join('\n');

  const order = {
    id: orderId, orderNum, name, email, phone,
    address: address || '',
    items, total,
    date: new Date().toISOString()
  };

  db.orders.push(order);
  saveData(db);

  // 1. Send customer info to REQUESTS channel
  await discordPost(REQUESTS_CHANNEL, {
    embeds: [{
      title: '📥 New Customer Request',
      color: 0xffffff,
      fields: [
        { name: 'Name',    value: name,             inline: true },
        { name: 'Email',   value: email,            inline: true },
        { name: 'Phone',   value: phone,            inline: true },
        { name: 'Address', value: address || 'Not provided', inline: false }
      ],
      footer: { text: `Order ${orderId} · ${new Date().toLocaleString()}` }
    }]
  });

  // 2. Send full order to ORDERS channel
  await discordPost(ORDERS_CHANNEL, {
    embeds: [{
      title: `🛒 New Order — ${orderId}`,
      color: 0xffffff,
      fields: [
        { name: 'Customer', value: `${name}\n📧 ${email}\n📞 ${phone}`, inline: true },
        { name: 'Items',    value: itemsText,                           inline: true },
        { name: 'Total',    value: `**$${total.toFixed(2)}**`,          inline: false },
        { name: 'Address',  value: address || 'Not provided',           inline: false }
      ],
      footer: { text: `Placed at ${new Date().toLocaleString()}` }
    }]
  });

  // 3. Send order confirmation "email preview" to REQUESTS channel
  await discordPost(REQUESTS_CHANNEL, {
    embeds: [{
      title: `📧 Email Confirmation → ${email}`,
      color: 0xffffff,
      description:
`**To:** ${email}
**Subject:** Your TavoBaryga Order Confirmation

─────────────────────────

Hello **${name}**,

You have placed your order. Your order number is:

# **#${orderNum}**

**Items:**
${itemsText}

**Total: $${total.toFixed(2)}**
${address ? `\n**Delivery to:** ${address}` : ''}

Thank you for shopping with **TavoBaryga**.

— TavoBaryga Team`,
      footer: { text: 'Automated confirmation' }
    }]
  });

  res.json({ ok: true, orderId, orderNum });
});

// ══════════════════════════════════════════
// SERVE FRONTEND
// ══════════════════════════════════════════
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n✅ TavoBaryga Store running on http://localhost:${PORT}`);
  console.log(`   Products channel : ${PRODUCTS_CHANNEL}`);
  console.log(`   Requests channel : ${REQUESTS_CHANNEL}`);
  console.log(`   Orders channel   : ${ORDERS_CHANNEL}`);
  console.log(`   Admin key        : ${ADMIN_KEY}\n`);
});
