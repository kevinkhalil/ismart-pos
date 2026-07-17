import "dotenv/config";
import express from "express";
import cors from "cors";
import pkg from "@prisma/client";
import OpenAI from "openai";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import cron from "node-cron";
import { runQuotationAgent } from "./emailAgent.js";
const { PrismaClient } = pkg;

const azureAI = new OpenAI({ baseURL: process.env.AZURE_AI_ENDPOINT, apiKey: process.env.AZURE_AI_API_KEY });

const app = express();
const prisma = new PrismaClient();
app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:5173" }));
app.use(express.json());

// Verifies the Bearer token on every protected route and attaches { id, role } to req.user
function authenticate(req, res, next) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing or invalid Authorization header" });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session — please log in again" });
  }
}

// Use after authenticate() to restrict a route to specific roles
function authorize(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "You don't have permission to do that" });
    next();
  };
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please wait a few minutes and try again." },
});

// A simple test: when someone visits /api/health, reply with a little message
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "iSmart kitchen is open!" });
});

// GET /api/users/list — public, returns names + roles only (for login screen)
app.get("/api/users/list", async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, name: true, role: true },
      orderBy: { createdAt: "asc" },
    });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/setup — create first owner (only when no users exist)
app.post("/api/auth/setup", async (req, res) => {
  const { name, pin } = req.body;
  if (!name || !pin) return res.status(400).json({ error: "name and pin required" });
  try {
    const count = await prisma.user.count();
    if (count > 0) return res.status(403).json({ error: "Setup already complete" });
    const hashed = await bcrypt.hash(String(pin), 10);
    const user   = await prisma.user.create({ data: { name, role: "owner", pin: hashed } });
    const token  = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "12h" });
    res.json({ id: user.id, name: user.name, role: user.role, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login — { userId, pin } → { id, name, role, token }
app.post("/api/auth/login", loginLimiter, async (req, res) => {
  const { userId, pin } = req.body;
  if (!userId || pin === undefined) return res.status(400).json({ error: "userId and pin required" });
  try {
    const user = await prisma.user.findUnique({ where: { id: parseInt(userId) } });
    if (!user) return res.status(401).json({ error: "Incorrect PIN" });
    const match = await bcrypt.compare(String(pin), user.pin);
    if (!match) return res.status(401).json({ error: "Incorrect PIN" });
    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "12h" });
    res.json({ id: user.id, name: user.name, role: user.role, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/users — full user list (owner only)
app.get("/api/users", authenticate, authorize("owner"), async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, name: true, role: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users — create a new user (owner only)
app.post("/api/users", authenticate, authorize("owner"), async (req, res) => {
  const { name, role, pin } = req.body;
  if (!name || !role || !pin) return res.status(400).json({ error: "name, role, and pin required" });
  if (!["cashier", "manager", "owner"].includes(role)) return res.status(400).json({ error: "Invalid role" });
  if (!/^\d{4,6}$/.test(String(pin))) return res.status(400).json({ error: "PIN must be 4–6 digits" });
  try {
    const hashed = await bcrypt.hash(String(pin), 10);
    const user   = await prisma.user.create({
      data: { name, role, pin: hashed },
      select: { id: true, name: true, role: true, createdAt: true },
    });
    res.status(201).json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/users/:id/pin — change a user's PIN (owner only)
app.patch("/api/users/:id/pin", authenticate, authorize("owner"), async (req, res) => {
  const id  = parseInt(req.params.id);
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: "pin required" });
  if (!/^\d{4,6}$/.test(String(pin))) return res.status(400).json({ error: "PIN must be 4–6 digits" });
  try {
    const hashed = await bcrypt.hash(String(pin), 10);
    await prisma.user.update({ where: { id }, data: { pin: hashed } });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/users/:id (owner only)
app.delete("/api/users/:id", authenticate, authorize("owner"), async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const target = await prisma.user.findUnique({ where: { id } });
    if (target?.role === "owner") {
      const ownerCount = await prisma.user.count({ where: { role: "owner" } });
      if (ownerCount <= 1) return res.status(400).json({ error: "Cannot delete the last owner account" });
    }
    await prisma.user.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get all products, each with its in_stock units.
// Filtering units here means the client only sees units it can actually sell.
app.get("/api/products", authenticate, async (req, res) => {
  try {
    const products = await prisma.product.findMany({
      include: { units: { where: { status: "in_stock" } }, category: true },
    });
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard — all numbers the dashboard needs, in one request
app.get("/api/dashboard", authenticate, authorize("owner"), async (req, res) => {
  try {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  // Run all DB queries in parallel so the response is fast
  const [todayStats, allTimeStats, todayPayment, allTimePayment, lowStockAccessories, serializedProducts, saleItems] =
    await Promise.all([
      // Revenue + sale count for today
      prisma.sale.aggregate({
        where: { createdAt: { gte: startOfDay } },
        _sum:   { totalPrice: true },
        _count: { id: true },
      }),
      // Revenue + sale count all time
      prisma.sale.aggregate({
        _sum:   { totalPrice: true },
        _count: { id: true },
      }),
      // Cash vs card split today
      prisma.sale.groupBy({
        by:    ["paymentMethod"],
        where: { createdAt: { gte: startOfDay } },
        _sum:  { totalPrice: true },
      }),
      // Cash vs card split all time
      prisma.sale.groupBy({
        by:   ["paymentMethod"],
        _sum: { totalPrice: true },
      }),
      // Accessories running low (5 or fewer left)
      prisma.product.findMany({
        where:   { isSerialized: false, quantity: { lte: 5 } },
        orderBy: { quantity: "asc" },
        select:  { id: true, name: true, quantity: true },
      }),
      // Serialized products with their in_stock unit count
      prisma.product.findMany({
        where:   { isSerialized: true },
        include: { units: { where: { status: "in_stock" }, select: { id: true } } },
      }),
      // Every sale item ever — used to compute top products and profit
      prisma.saleItem.findMany({
        include: {
          product: { select: { name: true, costPrice: true } },
          unit:    { select: { costPrice: true } },
          sale:    { select: { createdAt: true } },
        },
      }),
    ]);

  // Phones with zero units in stock
  const outOfStockPhones = serializedProducts
    .filter(p => p.units.length === 0)
    .map(p => ({ id: p.id, name: p.name, quantity: 0 }));

  // Group sale items by product AND compute costs for profit margin
  const byProduct = {};
  let todayCost = 0, allTimeCost = 0;

  for (const item of saleItems) {
    if (!byProduct[item.productId]) {
      byProduct[item.productId] = { name: item.product.name, revenue: 0, unitsSold: 0 };
    }
    byProduct[item.productId].revenue   += item.unitPrice * item.quantity;
    byProduct[item.productId].unitsSold += item.quantity;

    const unitCost = item.unit?.costPrice ?? item.product.costPrice;
    const cost     = unitCost * item.quantity;
    allTimeCost += cost;
    if (new Date(item.sale.createdAt) >= startOfDay) todayCost += cost;
  }

  const topProducts = Object.values(byProduct)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  function paymentMap(rows) {
    const m = { cash: 0, card: 0 };
    for (const r of rows) m[r.paymentMethod] = r._sum.totalPrice ?? 0;
    return m;
  }

  res.json({
    today:    { revenue: todayStats._sum.totalPrice   ?? 0, sales: todayStats._count.id,   cost: todayCost,   payment: paymentMap(todayPayment)   },
    allTime:  { revenue: allTimeStats._sum.totalPrice ?? 0, sales: allTimeStats._count.id, cost: allTimeCost, payment: paymentMap(allTimePayment) },
    lowStock: [...lowStockAccessories, ...outOfStockPhones],
    topProducts,
  });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/reports/owner — fire owner summary email via Power Automate
app.post("/api/reports/owner", authenticate, authorize("owner"), async (req, res) => {
  if (!process.env.OWNER_REPORT_URL) {
    return res.status(500).json({ error: "OWNER_REPORT_URL not set" });
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [todayStats, allTimeStats, lowStockAccessories, serializedProducts, saleItems] =
    await Promise.all([
      prisma.sale.aggregate({ where: { createdAt: { gte: startOfDay } }, _sum: { totalPrice: true }, _count: { id: true } }),
      prisma.sale.aggregate({ _sum: { totalPrice: true }, _count: { id: true } }),
      prisma.product.findMany({ where: { isSerialized: false, quantity: { lte: 5 } }, orderBy: { quantity: "asc" }, select: { name: true, quantity: true } }),
      prisma.product.findMany({ where: { isSerialized: true }, include: { units: { where: { status: "in_stock" }, select: { id: true } } } }),
      prisma.saleItem.findMany({ include: { product: { select: { name: true } } } }),
    ]);

  const outOfStockPhones = serializedProducts
    .filter(p => p.units.length === 0)
    .map(p => ({ name: p.name, quantity: 0 }));

  const lowStock = [...lowStockAccessories, ...outOfStockPhones];

  const byProduct = {};
  for (const item of saleItems) {
    if (!byProduct[item.productId]) byProduct[item.productId] = { name: item.product.name, revenue: 0, unitsSold: 0 };
    byProduct[item.productId].revenue   += item.unitPrice * item.quantity;
    byProduct[item.productId].unitsSold += item.quantity;
  }
  const topProducts = Object.values(byProduct).sort((a, b) => b.revenue - a.revenue).slice(0, 5);

  const topProductsText = topProducts.length === 0
    ? "No sales recorded yet."
    : topProducts.map((p, i) => `#${i + 1} ${p.name} — $${p.revenue.toFixed(2)} (${p.unitsSold} sold)`).join("\n");

  const lowStockText = lowStock.length === 0
    ? "All products are well stocked."
    : lowStock.map(p => p.quantity === 0 ? `• ${p.name} — OUT OF STOCK` : `• ${p.name} — ${p.quantity} left`).join("\n");

  const payload = {
    todayRevenue:    todayStats._sum.totalPrice  ?? 0,
    todaySales:      todayStats._count.id,
    allTimeRevenue:  allTimeStats._sum.totalPrice ?? 0,
    topProductsText,
    lowStockText,
  };

  console.log("[Owner Report] Firing webhook…");
  console.log("[Owner Report] Payload:", JSON.stringify(payload, null, 2));

  try {
    const r = await fetch(process.env.OWNER_REPORT_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
    console.log(`[Owner Report] Response: ${r.status} ${r.statusText}`);
    if (!r.ok) {
      const text = await r.text();
      console.error("[Owner Report] Error body:", text);
      return res.status(502).json({ error: `Power Automate returned ${r.status}`, detail: text });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("[Owner Report] Fetch failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/categories — all categories with their children
app.get("/api/categories", authenticate, async (req, res) => {
  try {
    const categories = await prisma.category.findMany({
      orderBy: { name: "asc" },
      include: { children: { orderBy: { name: "asc" } } },
    });
    res.json(categories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/categories — create a new category or sub-category
app.post("/api/categories", authenticate, authorize("manager", "owner"), async (req, res) => {
  const { name, parentId } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });
  const category = await prisma.category.create({
    data: { name, parentId: parentId ? parseInt(parentId) : null },
  });
  res.status(201).json(category);
});

// DELETE /api/categories/:id
app.delete("/api/categories/:id", authenticate, authorize("manager", "owner"), async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.product.updateMany({ where: { categoryId: id }, data: { categoryId: null } });
      await tx.category.updateMany({ where: { parentId: id }, data: { parentId: null } });
      await tx.category.delete({ where: { id } });
    });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/sales/:saleId/items/:itemId/refund — refund one line item, restore stock
app.patch("/api/sales/:saleId/items/:itemId/refund", authenticate, async (req, res) => {
  const saleId = parseInt(req.params.saleId);
  const itemId = parseInt(req.params.itemId);
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const item = await tx.saleItem.findUnique({
        where: { id: itemId },
        include: { product: true },
      });
      if (!item)               throw new Error("Item not found");
      if (item.saleId !== saleId) throw new Error("Item does not belong to this sale");
      if (item.refunded)       throw new Error("Item already refunded");

      await tx.saleItem.update({ where: { id: itemId }, data: { refunded: true } });

      if (item.productUnitId) {
        await tx.productUnit.update({ where: { id: item.productUnitId }, data: { status: "in_stock" } });
      } else {
        await tx.product.update({ where: { id: item.productId }, data: { quantity: { increment: item.quantity } } });
      }

      return tx.saleItem.findUnique({ where: { id: itemId } });
    });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/returns/search?q=<saleId or customer name>
app.get("/api/returns/search", authenticate, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json([]);

    const asId = parseInt(q);
    const where = isNaN(asId)
      ? { customer: { name: { contains: q } } }
      : { OR: [{ id: asId }, { customer: { name: { contains: q } } }] };

    const sales = await prisma.sale.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        customer: true,
        items: { include: { product: { select: { name: true } }, unit: { select: { imei: true } } } },
      },
    });
    res.json(sales);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reports/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD
app.get("/api/reports/analytics", authenticate, authorize("manager", "owner"), async (req, res) => {
  try {
    let { from, to } = req.query;
    if (!from) { const d = new Date(); d.setDate(d.getDate() - 29); from = d.toISOString().slice(0, 10); }
    if (!to)   { to = new Date().toISOString().slice(0, 10); }

    const fromDate = new Date(from);
    const toDate   = new Date(to);
    toDate.setDate(toDate.getDate() + 1);

    const sales = await prisma.sale.findMany({
      where:   { createdAt: { gte: fromDate, lt: toDate } },
      orderBy: { createdAt: "asc" },
      include: { items: { include: { product: { select: { name: true } } } } },
    });

    // Pre-fill every day in range with zero so chart shows continuous bars
    const dailyMap = {};
    const cursor   = new Date(from);
    const end      = new Date(to);
    while (cursor <= end) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,"0")}-${String(cursor.getDate()).padStart(2,"0")}`;
      dailyMap[key] = { date: key, revenue: 0, sales: 0 };
      cursor.setDate(cursor.getDate() + 1);
    }

    const payment   = { cash: 0, card: 0 };
    const byProduct = {};

    for (const sale of sales) {
      const d   = sale.createdAt;
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      if (dailyMap[key]) { dailyMap[key].revenue += sale.totalPrice; dailyMap[key].sales += 1; }

      payment[sale.paymentMethod] = (payment[sale.paymentMethod] ?? 0) + sale.totalPrice;

      for (const item of sale.items) {
        if (!byProduct[item.productId]) byProduct[item.productId] = { name: item.product.name, revenue: 0, unitsSold: 0 };
        byProduct[item.productId].revenue   += item.unitPrice * item.quantity;
        byProduct[item.productId].unitsSold += item.quantity;
      }
    }

    const totalRevenue = sales.reduce((sum, s) => sum + s.totalPrice, 0);
    const totalSales   = sales.length;

    res.json({
      summary:     { totalRevenue, totalSales, avgOrderValue: totalSales > 0 ? totalRevenue / totalSales : 0 },
      daily:       Object.values(dailyMap),
      topProducts: Object.values(byProduct).sort((a, b) => b.revenue - a.revenue).slice(0, 5),
      payment,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sales?from=YYYY-MM-DD&to=YYYY-MM-DD — sales history with optional date range
app.get("/api/sales", authenticate, authorize("manager", "owner"), async (req, res) => {
  try {
    const { from, to } = req.query;
    const where = {};
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) {
        const toDate = new Date(to);
        toDate.setDate(toDate.getDate() + 1);
        where.createdAt.lt = toDate;
      }
    }
    const sales = await prisma.sale.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        customer: true,
        items: {
          include: {
            product: { select: { name: true } },
            unit:    { select: { imei: true } },
          },
        },
      },
    });
    res.json(sales);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sales
// Body: { items: [...], customer?: { name, phone, email } }
// If customer.phone matches an existing customer, that customer is linked.
// If not, a new customer row is created. Customer is always optional.
app.post("/api/sales", authenticate, async (req, res) => {
  const { items, customer, paymentMethod, discount } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "items must be a non-empty array" });
  }

  try {
    const sale = await prisma.$transaction(async (tx) => {
      // --- Resolve customer ---
      let customerId = null;
      if (customer?.name || customer?.phone) {
        if (customer.phone) {
          // Find by phone or create — this way returning customers are recognised
          const found = await tx.customer.upsert({
            where:  { phone: customer.phone },
            update: { name: customer.name || undefined },
            create: { name: customer.name || "Unknown", phone: customer.phone, email: customer.email || null },
          });
          customerId = found.id;
        } else {
          // Name only, no phone — create a new record each time
          const created = await tx.customer.create({
            data: { name: customer.name, email: customer.email || null },
          });
          customerId = created.id;
        }
      }

      // --- Process cart items ---
      let totalPrice = 0;
      const saleItemsData = [];

      for (const item of items) {
        const product = await tx.product.findUnique({ where: { id: item.productId } });
        if (!product) throw new Error(`Product ${item.productId} not found`);

        if (product.isSerialized) {
          if (!item.productUnitId) {
            throw new Error(`${product.name} is serialized — a productUnitId is required`);
          }
          const unit = await tx.productUnit.findUnique({ where: { id: item.productUnitId } });
          if (!unit) throw new Error(`Unit ${item.productUnitId} not found`);
          if (unit.productId !== product.id) throw new Error(`Unit does not belong to ${product.name}`);
          if (unit.status !== "in_stock") throw new Error(`Unit ${unit.imei} is not available (status: ${unit.status})`);

          await tx.productUnit.update({ where: { id: unit.id }, data: { status: "sold" } });

          totalPrice += product.sellPrice;
          saleItemsData.push({ productId: product.id, productUnitId: unit.id, unitPrice: product.sellPrice, quantity: 1 });
        } else {
          const qty = item.quantity ?? 1;
          if (qty < 1) throw new Error(`Quantity for ${product.name} must be at least 1`);
          if (product.quantity < qty) throw new Error(`Not enough stock for ${product.name}: need ${qty}, have ${product.quantity}`);

          await tx.product.update({ where: { id: product.id }, data: { quantity: { decrement: qty } } });

          totalPrice += product.sellPrice * qty;
          saleItemsData.push({ productId: product.id, productUnitId: null, unitPrice: product.sellPrice, quantity: qty });
        }
      }

      if (discount?.value > 0) {
        const amt = discount.type === "pct"
          ? totalPrice * (Math.min(discount.value, 100) / 100)
          : Math.min(discount.value, totalPrice);
        totalPrice = Math.max(0, totalPrice - amt);
      }

      return tx.sale.create({
        data: {
          totalPrice,
          paymentMethod: paymentMethod || "cash",
          customerId,
          items: { create: saleItemsData },
        },
        include: {
          customer: true,
          items: { include: { product: { select: { name: true } }, unit: { select: { imei: true } } } },
        },
      });
    });

    res.status(201).json(sale);

    // Fire receipt email via Power Automate — only if the customer has an email address
    if (sale.customer?.email) {
      if (!process.env.POWER_AUTOMATE_URL) {
        console.log("[PA] Skipped — POWER_AUTOMATE_URL not set in .env");
      } else {
        const itemsText = sale.items
          .map(i => `• ${i.product?.name || "Item"} ×${i.quantity} — $${(i.unitPrice * i.quantity).toFixed(2)}`)
          .join("\n");

        const date = new Date(sale.createdAt).toLocaleString("en-US", {
          year: "numeric", month: "long", day: "numeric",
          hour: "2-digit", minute: "2-digit",
        });

        const payload = {
          customerName:  sale.customer.name,
          customerEmail: sale.customer.email,
          saleId:        sale.id,
          totalPrice:    sale.totalPrice,
          paymentMethod: sale.paymentMethod === "card" ? "Card" : "Cash",
          createdAt:     date,
          itemsText,
        };

        console.log(`[PA] Firing webhook for sale #${sale.id} → ${sale.customer.email}`);
        console.log("[PA] Payload:", JSON.stringify(payload, null, 2));

        fetch(process.env.POWER_AUTOMATE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
          .then(r => {
            console.log(`[PA] Response status: ${r.status} ${r.statusText}`);
            if (!r.ok) r.text().then(t => console.error("[PA] Error body:", t));
          })
          .catch(e => console.error("[PA] Fetch failed:", e.message));
      }
    } else {
      console.log(`[PA] Skipped — sale #${sale.id} has no customer email`);
    }

  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/customers/:id — update a customer's name, phone, or email
app.patch("/api/customers/:id", authenticate, authorize("manager", "owner"), async (req, res) => {
  const id = parseInt(req.params.id);
  const { name, phone, email } = req.body;
  try {
    const customer = await prisma.customer.update({
      where: { id },
      data: {
        name:  name  ?? undefined,
        phone: phone ?? undefined,
        email: email ?? undefined,
      },
    });
    res.json(customer);
  } catch (err) {
    if (err.code === "P2002") {
      return res.status(400).json({ error: "That phone number is already linked to another customer" });
    }
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/customers/:id — remove a customer, unlinking their past sales (sales are kept)
app.delete("/api/customers/:id", authenticate, authorize("manager", "owner"), async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.sale.updateMany({ where: { customerId: id }, data: { customerId: null } });
      await tx.customer.delete({ where: { id } });
    });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/customers/lookup?phone=xxx — find a single customer by exact phone number
app.get("/api/customers/lookup", authenticate, async (req, res) => {
  try {
    const { phone } = req.query;
    if (!phone) return res.json(null);
    const customer = await prisma.customer.findUnique({ where: { phone } });
    res.json(customer ?? null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/customers — all customers, each with stats and full purchase history
app.get("/api/customers", authenticate, authorize("manager", "owner"), async (req, res) => {
  try {
  const customers = await prisma.customer.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      sales: {
        orderBy: { createdAt: "desc" },
        include: {
          items: {
            include: {
              product: { select: { name: true } },
              unit:    { select: { imei: true } },
            },
          },
        },
      },
    },
  });

  // Compute per-customer stats on the server so the client just renders
  const result = customers.map(c => ({
    id:           c.id,
    name:         c.name,
    phone:        c.phone,
    email:        c.email,
    createdAt:    c.createdAt,
    totalSpent:   c.sales.reduce((sum, s) => sum + s.totalPrice, 0),
    totalSales:   c.sales.length,
    lastPurchase: c.sales[0]?.createdAt ?? null,
    sales:        c.sales,
  }));

  // Sort by total spent — highest value customers first
  result.sort((a, b) => b.totalSpent - a.totalSpent);

  res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/products/:id — update an existing product's details
app.patch("/api/products/:id", authenticate, authorize("manager", "owner"), async (req, res) => {
  const id = parseInt(req.params.id);
  const { name, sellPrice, costPrice, upc, categoryId } = req.body;
  try {
    const product = await prisma.product.update({
      where: { id },
      data: {
        name:       name       || undefined,
        sellPrice:  sellPrice  != null ? parseFloat(sellPrice)  : undefined,
        costPrice:  costPrice  != null ? parseFloat(costPrice)  : undefined,
        upc:        upc        !== undefined ? (upc || null)     : undefined,
        categoryId: categoryId !== undefined ? (categoryId ? parseInt(categoryId) : null) : undefined,
      },
    });
    res.json(product);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/products — create a brand-new product
app.post("/api/products", authenticate, authorize("manager", "owner"), async (req, res) => {
  const { name, sellPrice, costPrice, upc, isSerialized, quantity, categoryId } = req.body;
  if (!name || sellPrice == null) {
    return res.status(400).json({ error: "name and sellPrice are required" });
  }
  const product = await prisma.product.create({
    data: {
      name,
      sellPrice:    parseFloat(sellPrice),
      costPrice:    parseFloat(costPrice ?? 0),
      upc:          upc || null,
      isSerialized: Boolean(isSerialized),
      quantity:     isSerialized ? 0 : parseInt(quantity ?? 0),
      categoryId:   categoryId ? parseInt(categoryId) : null,
    },
  });
  res.status(201).json(product);
});

// POST /api/products/:id/units — add a new phone unit (IMEI) to an existing serialized product
app.post("/api/products/:id/units", authenticate, authorize("manager", "owner"), async (req, res) => {
  const productId = parseInt(req.params.id);
  const { imei, costPrice } = req.body;
  if (!imei) return res.status(400).json({ error: "imei is required" });

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product)          return res.status(404).json({ error: "Product not found" });
  if (!product.isSerialized) return res.status(400).json({ error: "Product is not a serialized phone" });

  try {
    const unit = await prisma.productUnit.create({
      data: { productId, imei, costPrice: parseFloat(costPrice ?? 0), status: "in_stock" },
    });
    res.status(201).json(unit);
  } catch (err) {
    if (err.code === "P2002") {
      return res.status(400).json({ error: `IMEI ${imei} already exists in the system` });
    }
    throw err;
  }
});

// PATCH /api/products/:id/stock — add quantity to an existing accessory
app.patch("/api/products/:id/stock", authenticate, authorize("manager", "owner"), async (req, res) => {
  const productId = parseInt(req.params.id);
  const qty = parseInt(req.body.quantity);
  if (!qty || qty < 1) return res.status(400).json({ error: "quantity must be at least 1" });

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product)         return res.status(404).json({ error: "Product not found" });
  if (product.isSerialized) return res.status(400).json({ error: "Use /units for serialized phones" });

  const updated = await prisma.product.update({
    where: { id: productId },
    data:  { quantity: { increment: qty } },
  });
  res.json(updated);
});

// POST /api/chat — AI store assistant powered by Azure AI Foundry (gpt-5-mini)
app.post("/api/chat", authenticate, authorize("manager", "owner"), async (req, res) => {
  if (!process.env.AZURE_AI_ENDPOINT || !process.env.AZURE_AI_API_KEY) {
    return res.status(500).json({ error: "AZURE_AI_ENDPOINT or AZURE_AI_API_KEY not set in .env" });
  }

  const { message, history = [] } = req.body;
  if (!message) return res.status(400).json({ error: "message is required" });

  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [products, todayStats, allTimeStats, lowStockAcc, serializedProds, saleItems, customerCount, recentSales] =
      await Promise.all([
        prisma.product.findMany({ include: { units: { where: { status: "in_stock" } } } }),
        prisma.sale.aggregate({ where: { createdAt: { gte: startOfDay } }, _sum: { totalPrice: true }, _count: { id: true } }),
        prisma.sale.aggregate({ _sum: { totalPrice: true }, _count: { id: true } }),
        prisma.product.findMany({ where: { isSerialized: false, quantity: { lte: 5 } }, orderBy: { quantity: "asc" } }),
        prisma.product.findMany({ where: { isSerialized: true }, include: { units: { where: { status: "in_stock" } } } }),
        prisma.saleItem.findMany({ include: { product: { select: { name: true } } } }),
        prisma.customer.count(),
        prisma.sale.findMany({
          take: 5, orderBy: { createdAt: "desc" },
          include: { customer: true, items: { include: { product: { select: { name: true } } } } },
        }),
      ]);

    // Top products by revenue
    const byProduct = {};
    for (const item of saleItems) {
      if (!byProduct[item.productId]) byProduct[item.productId] = { name: item.product.name, revenue: 0, unitsSold: 0 };
      byProduct[item.productId].revenue   += item.unitPrice * item.quantity;
      byProduct[item.productId].unitsSold += item.quantity;
    }
    const topProducts = Object.values(byProduct).sort((a, b) => b.revenue - a.revenue).slice(0, 5);

    const outOfStockPhones = serializedProds.filter(p => p.units.length === 0).map(p => ({ name: p.name, quantity: 0 }));
    const lowStock = [...lowStockAcc, ...outOfStockPhones];

    const inventoryLines = products.map(p => {
      const stock = p.isSerialized ? `${p.units.length} units in stock` : `${p.quantity} in stock`;
      return `- ${p.name}: sell $${p.sellPrice}, ${stock}`;
    }).join("\n");

    const context = `
TODAY (${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}):
- Revenue: $${(todayStats._sum.totalPrice ?? 0).toFixed(2)}
- Sales: ${todayStats._count.id}

ALL TIME:
- Total Revenue: $${(allTimeStats._sum.totalPrice ?? 0).toFixed(2)}
- Total Sales: ${allTimeStats._count.id}
- Total Customers: ${customerCount}

INVENTORY:
${inventoryLines || "No products yet."}

LOW STOCK ALERTS:
${lowStock.length === 0 ? "All items well stocked." : lowStock.map(p => p.quantity === 0 ? `- ${p.name}: OUT OF STOCK` : `- ${p.name}: ${p.quantity} left`).join("\n")}

TOP PRODUCTS BY REVENUE:
${topProducts.length === 0 ? "No sales yet." : topProducts.map((p, i) => `${i + 1}. ${p.name} — $${p.revenue.toFixed(2)} (${p.unitsSold} sold)`).join("\n")}

RECENT SALES (last 5):
${recentSales.length === 0 ? "No sales yet." : recentSales.map(s => `- Sale #${s.id}: $${s.totalPrice.toFixed(2)} (${s.paymentMethod}) — ${s.customer?.name || "Walk-in"} — ${s.items.map(i => i.product.name).join(", ")}`).join("\n")}
`.trim();

    const response = await azureAI.responses.create({
      model: process.env.AZURE_AI_DEPLOYMENT,
      instructions: `You are an AI assistant for iSmart, a smartphone retail shop. You help the store manager answer questions about inventory, sales, and customers. Be concise, friendly, and accurate. Only use numbers from the store data provided — never make up figures. If something isn't in the data, say so.\n\nLIVE STORE DATA:\n${context}`,
      input: [
        ...history,
        { role: "user", content: message },
      ],
    });

    res.json({ reply: response.output_text });
  } catch (err) {
    console.error("[Chat] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// ── Scheduled owner report — fires every day at 09:00 ──────────────────────
async function fireOwnerReport() {
  if (!process.env.OWNER_REPORT_URL) return;
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [todayStats, allTimeStats, lowStockAccessories, serializedProducts, saleItems] =
      await Promise.all([
        prisma.sale.aggregate({ where: { createdAt: { gte: startOfDay } }, _sum: { totalPrice: true }, _count: { id: true } }),
        prisma.sale.aggregate({ _sum: { totalPrice: true }, _count: { id: true } }),
        prisma.product.findMany({ where: { isSerialized: false, quantity: { lte: 5 } }, orderBy: { quantity: "asc" }, select: { name: true, quantity: true } }),
        prisma.product.findMany({ where: { isSerialized: true }, include: { units: { where: { status: "in_stock" }, select: { id: true } } } }),
        prisma.saleItem.findMany({ include: { product: { select: { name: true } } } }),
      ]);

    const outOfStockPhones = serializedProducts.filter(p => p.units.length === 0).map(p => ({ name: p.name, quantity: 0 }));
    const lowStock = [...lowStockAccessories, ...outOfStockPhones];
    const byProduct = {};
    for (const item of saleItems) {
      if (!byProduct[item.productId]) byProduct[item.productId] = { name: item.product.name, revenue: 0, unitsSold: 0 };
      byProduct[item.productId].revenue   += item.unitPrice * item.quantity;
      byProduct[item.productId].unitsSold += item.quantity;
    }
    const topProducts = Object.values(byProduct).sort((a, b) => b.revenue - a.revenue).slice(0, 5);

    const payload = {
      todayRevenue:   todayStats._sum.totalPrice  ?? 0,
      todaySales:     todayStats._count.id,
      allTimeRevenue: allTimeStats._sum.totalPrice ?? 0,
      topProductsText: topProducts.length === 0 ? "No sales recorded yet." : topProducts.map((p, i) => `#${i+1} ${p.name} — $${p.revenue.toFixed(2)} (${p.unitsSold} sold)`).join("\n"),
      lowStockText:    lowStock.length === 0 ? "All products well stocked." : lowStock.map(p => p.quantity === 0 ? `• ${p.name} — OUT OF STOCK` : `• ${p.name} — ${p.quantity} left`).join("\n"),
    };

    await fetch(process.env.OWNER_REPORT_URL, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    console.log("[Cron] Owner report sent at", new Date().toLocaleTimeString());
  } catch (err) {
    console.error("[Cron] Owner report failed:", err.message);
  }
}

// "0 9 * * *" = every day at 09:00 server local time
cron.schedule("0 9 * * *", fireOwnerReport);

// Poll support inbox every 2 minutes for quotation requests
cron.schedule("*/2 * * * *", () => {
  runQuotationAgent(prisma).catch(err => console.error("[QuotationAgent] Uncaught:", err.message));
});