import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

async function main() {
  console.log("🔄 Starting seed...");

  // Seed Categories
  const categories = [
    "Animal Feeds",
    "Pet Supplies",
    "Agriculture",
    "LPG & Gas",
    "Rice & Grains",
    "Accessories & Tools",
    "Medicines & Vaccines",
    "General Goods",
    "Aquaculture",
  ];

  const categoryMap: Record<string, number> = {};

  try {
    for (const name of categories) {
      const cat = await db.category.upsert({
        where: { name },
        update: {},
        create: { name },
      });
      categoryMap[name] = cat.id;
    }
    console.log("✅ Categories seeded");
  } catch (e) {
    console.error("❌ Category seeding error:", e);
  }

  // Seed Tags
  const tags = [
    "Pig",
    "Chicken",
    "Cow",
    "Goat",
    "Dog",
    "Cat",
    "Bird",
    "Fish",
    "Layer",
    "Broiler",
    "Refill",
    "With Tank",
    "Pesticide",
    "Herbicide",
    "Vaccine",
    "Vitamin",
    "Organic",
    "Wholegrain",
    "Seedling",
  ];

  try {
    for (const name of tags) {
      await db.tag.upsert({
        where: { name },
        update: {},
        create: { name },
      });
    }
    console.log("✅ Tags seeded");
  } catch (e) {
    console.error("❌ Tag seeding error:", e);
  }

  // Seed Brands with category
  const brands = [
    { name: "Solane", category: "LPG & Gas" },
    { name: "Phoenix LPG", category: "LPG & Gas" },
    { name: "NutriFeeds", category: "Animal Feeds" },
    { name: "PetKing", category: "Pet Supplies" },
    { name: "AgriBest", category: "Agriculture" },
  ];

  const brandMap: Record<string, number> = {};

  try {
    for (const { name, category } of brands) {
      const categoryId = categoryMap[category];
      if (!categoryId) {
        throw new Error(`Category '${category}' not found for brand '${name}'`);
      }
      const brand = await db.brand.upsert({
        where: { name },
        update: {},
        create: { name, categoryId },
      });
      brandMap[name] = brand.id;
    }
    console.log("✅ Brands seeded");
  } catch (e) {
    console.error("❌ Brand seeding error:", e);
  }

  // Seed Products
  try {
    await db.product.createMany({
      data: [
        { name: "Rice", price: 45.5, unit: "kg" },
        { name: "Dog Food", price: 120, unit: "sack" },
        { name: "Pet Vitamins", price: 85.75, unit: "bottle" },
      ],
      skipDuplicates: true,
    });
    console.log("✅ Regular products seeded");
  } catch (e) {
    console.error("❌ Product createMany error:", e);
  }

  // Product with brand
  try {
    await db.product.create({
      data: {
        name: "Solane LPG 11kg",
        price: 900,
        unit: "tank",
        brandId: brandMap["Solane"],
        categoryId: categoryMap["LPG & Gas"],
      },
    });
    console.log("✅ Branded product created");
  } catch (e) {
    console.error("❌ Branded product creation error:", e);
  }

  console.log(
    "🌱 Seeded products, categories, tags, and brands with relationships."
  );
}

main()
  .catch((e) => {
    console.error("❌ Seeding error (global):", e);
  })
  .finally(() => db.$disconnect());
