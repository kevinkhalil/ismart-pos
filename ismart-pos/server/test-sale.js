// Looks up the seeded iPhone and its in_stock unit, then POSTs a sale.
import pkg from "@prisma/client";
const { PrismaClient } = pkg;

const prisma = new PrismaClient();

const product = await prisma.product.findFirst({ where: { name: "iPhone 15" } });
const unit    = await prisma.productUnit.findFirst({ where: { productId: product.id, status: "in_stock" } });
await prisma.$disconnect();

if (!unit) { console.error("No in_stock unit found — re-run: node prisma/seed.js"); process.exit(1); }

console.log(`Selling productId=${product.id}  productUnitId=${unit.id}  imei=${unit.imei}`);

const res  = await fetch("http://localhost:3000/api/sales", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ items: [{ productId: product.id, productUnitId: unit.id }] }),
});
const sale = await res.json();
console.log(JSON.stringify(sale, null, 2));
