import pkg from "@prisma/client";
const { PrismaClient } = pkg;

const prisma = new PrismaClient();

async function main() {
  // Delete leaf tables first, then parents — FK constraints block any other order.
  // SaleItem references Sale, ProductUnit, and Product.
  // Sale references nothing but is referenced by SaleItem.
  // ProductUnit references Product.
  await prisma.saleItem.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.productUnit.deleteMany();
  await prisma.product.deleteMany();

  // --- Non-serialized accessories (stock tracked by quantity field) ---
  await prisma.product.create({
    data: {
      name: "USB-C Cable",
      upc: "0123456789012",
      isSerialized: false,
      costPrice: 3,
      sellPrice: 10,
      quantity: 50,
    },
  });

  await prisma.product.create({
    data: {
      name: "AirPods Pro",
      upc: "0123456789013",
      isSerialized: false,
      costPrice: 150,
      sellPrice: 250,
      quantity: 12,
    },
  });

  // --- Serialized phone (stock tracked by ProductUnit rows, not quantity) ---
  // quantity is left at 0 for serialized products; the real count comes from
  // counting units WHERE status = 'in_stock'.
  const iphone = await prisma.product.create({
    data: {
      name: "iPhone 15",
      isSerialized: true,
      sellPrice: 799,
    },
  });

  await prisma.productUnit.create({
    data: {
      productId: iphone.id,
      imei: "352099001761481",
      status: "in_stock",
      costPrice: 599,
    },
  });

  console.log("Database seeded!");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
  });