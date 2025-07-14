import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const medicineNames = [
  "Paracetamol",
  "Ibuprofen",
  "Amoxicillin",
  "Cetirizine",
  "Loperamide",
  "Metronidazole",
  "Vitamin C",
  "Calcium",
  "Zinc Sulfate",
  "Azithromycin",
];

const feedNames = [
  "Grower Pellets",
  "Broiler Booster",
  "Layer Mash",
  "Pig Starter",
  "Cow Calf Feed",
  "Dog Kibble",
  "Cat Tuna Mix",
  "Rabbit Pellets",
  "Duck Crumbles",
  "Fish Floating Feed",
];

const units = [
  "bottle",
  "tab",
  "capsule",
  "vial",
  "kg",
  "g",
  "liter",
  "ml",
  "piece",
  "sack",
];

const usesList = [
  "Fever",
  "Pain Relief",
  "Cough",
  "Infection",
  "Worm Treatment",
  "Growth Support",
  "Weight Gain",
  "Immune Boost",
  "Digestive Aid",
  "Skin Health",
];

const defaultCategories = ["Medicine", "Animal Feed", "Supplements"];
const defaultBrands = [
  "VetPlus",
  "FarmGrow",
  "MediLife",
  "PetCare",
  "AgriBest",
];
const defaultTags = ["Livestock", "Dog", "Cat", "Poultry", "Vitamin", "OTC"];

function getRandomElements<T>(arr: T[], count: number): T[] {
  return [...arr].sort(() => 0.5 - Math.random()).slice(0, count);
}

function getRandomName(i: number): string {
  const name =
    Math.random() < 0.5
      ? medicineNames[Math.floor(Math.random() * medicineNames.length)]
      : feedNames[Math.floor(Math.random() * feedNames.length)];
  return `${name} ${i}`;
}

async function seedDefaults() {
  // Seed categories
  for (const name of defaultCategories) {
    await prisma.category.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  const categories = await prisma.category.findMany();

  // Seed brands
  for (const name of defaultBrands) {
    const randomCategory =
      categories[Math.floor(Math.random() * categories.length)];
    await prisma.brand.upsert({
      where: { name },
      update: {},
      create: {
        name,
        categoryId: randomCategory.id,
      },
    });
  }

  // Seed tags
  for (const name of defaultTags) {
    await prisma.tag.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
}

async function main() {
  await seedDefaults();

  const categories = await prisma.category.findMany();
  const brands = await prisma.brand.findMany();
  const tags = await prisma.tag.findMany();

  if (!categories.length || !brands.length) {
    throw new Error("Please seed some categories and brands first.");
  }

  for (let i = 1; i <= 100; i++) {
    const category = categories[Math.floor(Math.random() * categories.length)];
    const brand = brands[Math.floor(Math.random() * brands.length)];
    const unit = units[Math.floor(Math.random() * units.length)];

    const product = await prisma.product.create({
      data: {
        name: getRandomName(i),
        price: parseFloat((Math.random() * 100 + 10).toFixed(2)),
        srp: parseFloat((Math.random() * 150 + 10).toFixed(2)),
        dealerPrice: parseFloat((Math.random() * 80 + 5).toFixed(2)),
        unit,
        description: `Detailed description of product ${i}.`,
        stock: parseFloat((Math.random() * 50 + 1).toFixed(2)),
        imageTag: `img-${i}`,
        imageUrl: `https://placehold.co/100x100?text=Prod+${i}`,
        packingSize: `${Math.floor(Math.random() * 100) + 1}${unit}`,
        expirationDate: new Date(Date.now() + Math.random() * 1e10),
        replenishAt: new Date(Date.now() + Math.random() * 1e10),
        uses: getRandomElements(usesList, Math.floor(Math.random() * 3) + 1),
        category: { connect: { id: category.id } },
        brand: { connect: { id: brand.id } },
      },
    });

    const selectedTags = getRandomElements(tags, Math.floor(Math.random() * 3));
    for (const tag of selectedTags) {
      await prisma.productTag.create({
        data: {
          productId: product.id,
          tagId: tag.id,
        },
      });
    }
  }

  console.log("✅ Seeded 100 random products successfully.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
