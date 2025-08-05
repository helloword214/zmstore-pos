// prisma/seed.ts
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { generateSKU } from "~/utils/skuHelpers";

const db = new PrismaClient();

// ─────────────────────────────────────────
// 1️⃣ Static Config
// ─────────────────────────────────────────
const categories = [
  "Medicines",
  "Animal Feeds",
  "Pet Supplies",
  "LPG",
  "Rices & Grains",
  "Agriculture Products",
  "Equipment",
  "Binhi (Seeds)",
] as const;

const globalTags = [
  "Vitamins",
  "Antibiotic",
  "Antiparasitic",
  "Booster",
  "Laxative",
  "Organic",
  "Fortified",
  "Deworming",
  "Pain Reliever",
  "Energy",
  "Weight Gain",
  "Immunity",
  "Stress Relief",
  "First Aid",
];

const productNamesByCategory: Record<string, string[]> = {
  "Animal Feeds": [
    "Hog Grower Pellets",
    "Chick Booster Crumble",
    "Layer Mash",
    "Broiler Starter Feed",
    "Dog Chow Premium",
    "Cat Food Supreme",
    "Aqua Pellets 3mm",
  ],
  Medicines: [
    "Amoxicillin Syrup",
    "Paracetamol Drops",
    "Multivitamin Injection",
    "Ivermectin Oral",
    "Loperamide Tablets",
    "Vitamin B Complex",
    "Tylosin Solution",
  ],
  "Pet Supplies": [
    "Dog Shampoo",
    "Tick & Flea Powder",
    "Cat Litter Crystals",
    "Bird Cage Cleaner",
    "Puppy Pads",
  ],
  "Rices & Grains": [
    "Sinandomeng Rice",
    "Jasmine Rice",
    "Well-Milled Rice",
    "Brown Rice",
    "Whole Corn Kernel",
    "Cracked Corn",
  ],
  LPG: ["Petron Gasul 11kg", "Solane Tank 7kg", "Regasco Refill 2.7kg"],
  "Agriculture Products": [
    "Urea Fertilizer",
    "Complete 14-14-14",
    "Organic Foliar Spray",
    "Carbaryl Insecticide",
    "Molasses Booster",
  ],
  Equipment: [
    "Plastic Feeder",
    "Manual Sprayer",
    "Watering Can",
    "Machete (Itak)",
    "Steel Cage",
    "Rake Handle",
  ],
  "Binhi (Seeds)": [
    "Hybrid Tomato Seeds",
    "Okra Seed Pack",
    "Eggplant Black Beauty",
    "Sweet Corn Seeds",
    "Ampalaya F1",
  ],
};

const brandsByCategory: Record<string, string[]> = {
  "Animal Feeds": ["AgriFeeds", "FeedPro", "SunGrow"],
  "Binhi (Seeds)": ["RC 160", "RC 216", "Triple 2"],
  Medicines: ["Medilife", "VetRx"],
  "Pet Supplies": ["PawCare", "FurMed"],
  LPG: ["GasGo", "TankPro"],
  "Rices & Grains": ["Golden Grain", "RiceMaster", "Pilipinas Rice"],
  "Agriculture Products": ["AgroTech", "GreenPlus", "GrowWell"],
  Equipment: ["ToolPro", "AgriTools", "EquipMax"],
};

const locationsByCategory: Record<string, string> = {
  "Animal Feeds": "Feeds Section",
  "Binhi (Seeds)": "Seed Rack",
  Medicines: "Medicine Shelf",
  "Pet Supplies": "Pet Corner",
  LPG: "LPG Area",
  "Rices & Grains": "Rice Display",
  "Agriculture Products": "Agri Shelf",
  Equipment: "Tool Section",
};

const indicationsByCategory: Record<string, string[]> = {
  Medicines: [
    "Fever",
    "Pain Relief",
    "Deworming",
    "Antibiotic",
    "Appetite Booster",
  ],
  "Animal Feeds": ["Weight Gain", "Growth Boost", "Energy", "Stress Relief"],
  "Pet Supplies": ["Vitamins", "Immune Support", "Laxative"],
  "Binhi (Seeds)": ["Germination", "High Yield", "Resistant Variety"],
  LPG: ["Cooking", "Heating"],
  Equipment: ["First Aid", "Animal Handling"],
  "Rices & Grains": ["Staple Food", "Energy Source"],
  "Agriculture Products": ["Pest Control", "Fertilizer", "Organic Growth"],
};

const unitNames = ["kg", "gram", "ml", "cc", "tablet", "liter", "unit"];
const packingUnitNames = [
  "sack",
  "pack",
  "pouch",
  "bottle",
  "vial",
  "ampule",
  "tank",
  "sachet",
  "unit",
];

const globalTargets = [
  { name: "Dog", categories: ["Animal Feeds", "Medicines", "Pet Supplies"] },
  { name: "Cat", categories: ["Animal Feeds", "Medicines", "Pet Supplies"] },
  { name: "Hog", categories: ["Animal Feeds", "Medicines"] },
  { name: "Fish", categories: ["Animal Feeds", "Medicines", "Pet Supplies"] },
  { name: "Chicken", categories: ["Animal Feeds", "Medicines"] },
  { name: "Rice", categories: ["Binhi (Seeds)"] },
  { name: "Corn", categories: ["Binhi (Seeds)"] },
  { name: "Eggplants", categories: ["Binhi (Seeds)"] },
  { name: "Others", categories: ["Binhi (Seeds)", "LPG", "Equipment"] },
  { name: "Human", categories: ["Rices & Grains"] },
  { name: "Plants", categories: ["Agriculture Products"] },
];

// ─────────────────────────────────────────
// 2️⃣ Helpers
// ─────────────────────────────────────────
function pickRandom<T>(arr: T[], count = 2): T[] {
  if (!Array.isArray(arr)) {
    console.error("❌ pickRandom() expected array but got:", arr);
    throw new TypeError("pickRandom: arr is not an array");
  }
  const shuffled = [...arr].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

function shouldAllowRetail(packingSize: number): boolean {
  return packingSize >= 20;
}

function generateBarcode(existing: Set<string>) {
  let code;
  do {
    code = "480" + Math.floor(100000000 + Math.random() * 899999999);
  } while (existing.has(code));
  existing.add(code);
  return code;
}

function computeRetailPrice(srp: number, packingSize: number): number {
  return +(srp / packingSize + 3).toFixed(2);
}

async function getOrCreateMap<T extends string>(
  table: "unit" | "location" | "packingUnit",
  names: T[]
): Promise<Record<T, number>> {
  const map: Record<T, number> = {} as any;
  for (const name of names) {
    const entry =
      table === "unit"
        ? await db.unit.upsert({
            where: { name },
            update: {},
            create: { name },
          })
        : table === "location"
        ? await db.location.upsert({
            where: { name },
            update: {},
            create: { name },
          })
        : await db.packingUnit.upsert({
            where: { name },
            update: {},
            create: { name },
          });
    map[name] = entry.id;
  }
  return map;
}

async function getOrCreateGlobalTags() {
  return Promise.all(
    globalTags.map((name) =>
      db.tag.upsert({ where: { name }, update: {}, create: { name } })
    )
  );
}

// ─────────────────────────────────────────
// 3️⃣ Product Generator (Animal Feeds)
// ─────────────────────────────────────────
async function makeFeedProducts({
  categoryId,
  brandMap,
  unitMap,
  packingUnitMap,
  locationId,
  tagList,
  targetList,
  indicationList, // ✅ NEW
  usedBarcodes,
}: any) {
  if (!brandMap || Object.keys(brandMap).length === 0) {
    throw new Error("❌ brandMap is empty or undefined in makeFeedProducts()");
  }

  const products = [];
  for (let i = 0; i < 20; i++) {
    const brandNames = Object.keys(brandMap);
    const brandName = brandNames[i % brandNames.length];
    const brandId = brandMap[brandName];

    const name = `Feed Product ${i + 1}`;
    const packingSize = [20, 25, 50][i % 3];
    const allowRetail = shouldAllowRetail(packingSize);
    const srp = 300 + Math.random() * 300;
    const price = allowRetail ? computeRetailPrice(srp, packingSize) : srp;

    const unitId = unitMap["kg"];
    const packingUnitId = packingUnitMap["sack"];
    const barcode = generateBarcode(usedBarcodes);
    const selectedTargets = pickRandom(targetList, 2);
    const selectedTags = pickRandom(tagList, 2);
    console.log("📌 indicationList is:", indicationList);
    console.log("📌 typeof:", typeof indicationList);
    console.log("📌 isArray?", Array.isArray(indicationList));
    const selectedIndications = pickRandom(indicationList ?? [], 2);

    if (!indicationList || indicationList.length === 0) {
      console.warn("⚠️ indicationList is empty for Feed Products!");
    }

    if (!Array.isArray(tagList)) {
      throw new Error(
        "❌ tagList is missing or not an array in makeFeedProducts"
      );
    }

    products.push(
      db.product.create({
        data: {
          name,
          sku: generateSKU({
            name,
            brand: brandName,
            category: "Animal Feeds",
            id: i + 1,
          }),
          price,
          srp,
          dealerPrice: srp - 50,
          allowPackSale: allowRetail,
          packingSize,
          packingStock: 2 + Math.floor(Math.random() * 3),
          stock: allowRetail ? packingSize * 2 : 0,
          barcode,
          isActive: true,
          minStock: 5,
          categoryId,
          brandId,
          locationId,
          unitId,
          packingUnitId,
          productTargets: {
            create: selectedTargets.map((t: any) => ({
              target: { connect: { id: t.id } },
            })),
          },
          productTags: {
            create: selectedTags.map((t: any) => ({
              tag: { connect: { id: t.id } },
            })),
          },
          productIndications: {
            create: selectedIndications.map((i: any) => ({
              indication: { connect: { id: i.id } },
            })),
          },
        },
      })
    );
  }

  return Promise.all(products);
}

// ─────────────────────────────────────────
// 4️⃣ Seed Function
// ─────────────────────────────────────────
async function seed() {
  console.log("🧹 Resetting...");
  await db.saleItem.deleteMany();
  await db.sale.deleteMany();
  await db.productTarget.deleteMany();
  await db.productTag.deleteMany();
  await db.product.deleteMany();
  await db.target.deleteMany();
  await db.indication.deleteMany();
  await db.tag.deleteMany();
  await db.brand.deleteMany();
  await db.category.deleteMany();
  await db.unit.deleteMany();
  await db.packingUnit.deleteMany();
  await db.location.deleteMany();

  console.log("🏷️ Creating units, locations, tags...");
  const unitMap = await getOrCreateMap("unit", unitNames);
  const packingUnitMap = await getOrCreateMap("packingUnit", packingUnitNames);
  const locationMap = await getOrCreateMap(
    "location",
    Object.values(locationsByCategory)
  );
  const tagList = await getOrCreateGlobalTags();

  console.log("📦 Creating categories...");
  const categoryMap: Record<string, number> = {};
  for (const name of categories) {
    const cat = await db.category.create({ data: { name } });
    categoryMap[name] = cat.id;
  }

  console.log("🎯 Creating targets...");
  const targetMapByCategory: Record<string, any[]> = {};

  for (const target of globalTargets) {
    for (const category of target.categories) {
      const categoryId = categoryMap[category];
      if (!categoryId) continue;

      const existing = await db.target.findFirst({
        where: {
          name: target.name,
          categoryId,
        },
      });

      let createdOrFound = existing;
      if (!existing) {
        createdOrFound = await db.target.create({
          data: {
            name: target.name,
            categoryId,
          },
        });
      }

      targetMapByCategory[category] ??= [];
      targetMapByCategory[category].push(createdOrFound);
    }
  }

  console.log("💊 Creating indications...");

  const indicationMapByCategory: Record<string, any[]> = {};

  for (const [categoryName, indications] of Object.entries(
    indicationsByCategory
  )) {
    const categoryId = categoryMap[categoryName];
    if (!categoryId) continue;

    for (const name of indications) {
      const created = await db.indication.create({
        data: { name, categoryId },
      });

      if (!indicationMapByCategory[categoryName]) {
        indicationMapByCategory[categoryName] = [];
      }

      indicationMapByCategory[categoryName].push(created);
    }
  }

  console.log("🛠 Creating brands...");
  const brandMap: Record<string, number> = {};

  for (const name of brandsByCategory["Animal Feeds"]) {
    const categoryId = categoryMap["Animal Feeds"];
    const brand = await db.brand.upsert({
      where: {
        name_categoryId: {
          name,
          categoryId,
        },
      },
      update: {},
      create: {
        name,
        categoryId,
      },
    });
    brandMap[name] = brand.id;
  }

  console.log("🌾 Creating realistic products...");
  const usedBarcodes = new Set<string>();
  console.log("🧪 DEBUG:", {
    unitKeys: Object.keys(unitMap),
    packingUnitKeys: Object.keys(packingUnitMap),
    tagCount: tagList.length,
    targetCount: targetMapByCategory["Animal Feeds"]?.length ?? 0,
  });

  console.log(
    "Animal Feeds indications:",
    indicationMapByCategory["Animal Feeds"]
  );

  console.log(
    "✅ Feeding indications list:",
    Array.isArray(indicationMapByCategory["Animal Feeds"])
  );

  console.log(
    "Animal Feeds indications:",
    indicationMapByCategory["Animal Feeds"]
  );

  await makeFeedProducts({
    categoryName: "Animal Feeds",
    categoryId: categoryMap["Animal Feeds"],
    locationId: locationMap["Feeds Section"],
    brandMap,
    unitMap,
    packingUnitMap,
    targetList: targetMapByCategory["Animal Feeds"],
    indicationList: indicationMapByCategory["Animal Feeds"],
    usedBarcodes,
    tagList,
  });

  console.log("\n✅ Seeding complete!");
  await db.$disconnect();
}

seed().catch((err) => {
  console.error("❌ Seed failed", err);
  process.exit(1);
});
