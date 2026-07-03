import pkg from "@prisma/client";
const { PrismaClient } = pkg;
const prisma = new PrismaClient();

async function main() {
  const items = await prisma.saleItem.deleteMany({});
  const sales = await prisma.sale.deleteMany({});

  // Also restore stock for serialized phones that were marked "sold"
  await prisma.productUnit.updateMany({
    where: { status: "sold" },
    data:  { status: "in_stock" },
  });

  console.log(`Deleted ${items.count} sale items and ${sales.count} sales.`);
  console.log("All sold phone units have been restored to in_stock.");
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
