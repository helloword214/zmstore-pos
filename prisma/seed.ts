import { PrismaClient } from "@prisma/client";
import { faker } from "@faker-js/faker";

const db = new PrismaClient();

const categories = [
  "Medicines",
  "Animal Feeds",
  "Pet Supplies",
  "LPG",
  "Rices & Grains",
  "Agriculture Products",
];

const unitOptions = [
  "vial",
  "ampule",
  "bottle",
  "ml",
  "liter",
  "sack",
  "kg",
  "g",
  "piece",
  "meter",
  "roll",
  "tank",
  "tab",
  "capsule",
];

const usesOptions = [
  "Vitamins",
  "Pain Relief",
  "Antibiotic",
  "Dewormer",
  "Supplement",
];

const targetOptions = [
  "Human",
  "Dog",
  "Cat",
  "Poultry",
  "Livestock",
  "Bird",
  "Other",
];

function getRandomElements<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

async function seed() {
  console.log("🧹 Clearing old data...");
  await db.saleItem.deleteMany();
  await db.sale.deleteMany();
  await db.productTag.deleteMany();
  await db.tag.deleteMany();
  await db.product.deleteMany();
  await db.brand.deleteMany();
  await db.category.deleteMany();

  console.log("📂 Seeding categories...");
  const createdCategories = await Promise.all(
    categories.map((name) => db.category.create({ data: { name } }))
  );

  console.log("🏷️ Seeding brands...");
  const createdBrands = await Promise.all(
    Array.from({ length: 10 }).map(() => {
      const randomCategory = faker.helpers.arrayElement(createdCategories);
      return db.brand.create({
        data: {
          name: faker.company.name(),
          categoryId: randomCategory.id,
        },
      });
    })
  );

  console.log("📦 Seeding products...");
  await Promise.all(
    Array.from({ length: 100 }).map(() => {
      const category = faker.helpers.arrayElement(createdCategories);
      const brand = faker.helpers.arrayElement(createdBrands);
      return db.product.create({
        data: {
          name: faker.commerce.productName(),
          price: parseFloat(faker.commerce.price()),
          unit: faker.helpers.arrayElement(unitOptions),
          stock: faker.number.float({ min: 0, max: 100 }),
          dealerPrice: parseFloat(faker.commerce.price()),
          srp: parseFloat(faker.commerce.price()),
          packingSize: faker.helpers.arrayElement([
            "100ml",
            "50kg",
            "10 tabs",
            "1 sack",
          ]),
          description: faker.commerce.productDescription(),
          imageTag: faker.word.adjective(),
          imageUrl: faker.image.url(),
          categoryId: category.id,
          brandId: brand.id,
          uses: getRandomElements(
            usesOptions,
            faker.number.int({ min: 1, max: 3 })
          ),
          target: getRandomElements(
            targetOptions,
            faker.number.int({ min: 1, max: 2 })
          ),
        },
      });
    })
  );

  console.log("✅ Done seeding.");
  await db.$disconnect();
}

seed().catch((e) => {
  console.error("❌ Error seeding:", e);
  process.exit(1);
});
