import express from "express";
import cors from "cors";
import pkg from "@prisma/client";
const { PrismaClient } = pkg;

const app = express();
const prisma = new PrismaClient();
app.use(cors());
app.use(express.json());

// A simple test: when someone visits /api/health, reply with a little message
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "iSmart kitchen is open!" });
});

// Get all products, each with its in_stock units.
// Filtering units here means the client only sees units it can actually sell.
app.get("/api/products", async (req, res) => {
  const products = await prisma.product.findMany({
    include: { units: { where: { status: "in_stock" } }, category: true },
  });
  res.json(products);
});

// GET /api/dashboard — all numbers the dashboard needs, in one request
app.get("/api/dashboard", async (req, res) => {
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
});

// GET /api/categories — all categories with their children
app.get("/api/categories", async (req, res) => {
  const categories = await prisma.category.findMany({
    orderBy: { name: "asc" },
    include: { children: { orderBy: { name: "asc" } } },
  });
  res.json(categories);
});

// POST /api/categories — create a new category or sub-category
app.post("/api/categories", async (req, res) => {
  const { name, parentId } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });
  const category = await prisma.category.create({
    data: { name, parentId: parentId ? parseInt(parentId) : null },
  });
  res.status(201).json(category);
});

// DELETE /api/categories/:id
app.delete("/api/categories/:id", async (req, res) => {
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
app.patch("/api/sales/:saleId/items/:itemId/refund", async (req, res) => {
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

// GET /api/sales — full sales history, newest first
app.get("/api/sales", async (req, res) => {
  const sales = await prisma.sale.findMany({
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
});

// POST /api/sales
// Body: { items: [...], customer?: { name, phone, email } }
// If customer.phone matches an existing customer, that customer is linked.
// If not, a new customer row is created. Customer is always optional.
app.post("/api/sales", async (req, res) => {
  const { items, customer, paymentMethod } = req.body;

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
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/customers/:id — update a customer's name, phone, or email
app.patch("/api/customers/:id", async (req, res) => {
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
app.delete("/api/customers/:id", async (req, res) => {
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
app.get("/api/customers/lookup", async (req, res) => {
  const { phone } = req.query;
  if (!phone) return res.json(null);
  const customer = await prisma.customer.findUnique({ where: { phone } });
  res.json(customer ?? null);
});

// GET /api/customers — all customers, each with stats and full purchase history
app.get("/api/customers", async (req, res) => {
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
});

// PATCH /api/products/:id — update an existing product's details
app.patch("/api/products/:id", async (req, res) => {
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
app.post("/api/products", async (req, res) => {
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
app.post("/api/products/:id/units", async (req, res) => {
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
app.patch("/api/products/:id/stock", async (req, res) => {
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

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});