import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

async function main() {
  await db.product.createMany({
    data: [
      { name: "Rice", price: 45.5, unit: "kg" },
      { name: "Dog Food", price: 120, unit: "sack" },
      { name: "Pet Vitamins", price: 85.75, unit: "bottle" },
    ],
  });
  console.log("🌱 Seed data inserted.");
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
