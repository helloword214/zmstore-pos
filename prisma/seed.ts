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

const brandsByCategory: Record<string, string[]> = {
  "Animal Feeds": ["BMEG", "FeedPro", "New Hope", "Pigrolac", "ACE"],
  "Binhi (Seeds)": ["RC 160", "RC 216", "Triple 2,", "Agelica"],
  Medicines: ["Medilife", "VetRx"],
  "Pet Supplies": ["PawCare", "FurMed"],
  LPG: [
    "Regasco",
    "Gerona",
    "Island",
    "Solane",
    "Axel",
    "Fiesta",
    "Petron Gasul",
    "MDS",
  ],
  "Rices & Grains": ["Angelica", "160", "Sinandomeng", "Pandan"],
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

const productNamesByCategory: Record<string, string[]> = {
  "Animal Feeds": [
    "Hog Grower Pellets",
    "Chick Booster Crumble",
    "Layer Mash",
    "Broiler Starter Feed",
    "Dog Chow Premium",
    "Cat Food Supreme",
    "Aqua Pellets 3mm",
    "BIO 1000",
    "BIO 2000",
    "BIO 3000",
    "Darak",
    "Corn 1/2 Grains",
    "Corn 1/8 Grains",
    "Corn 1/4 Grains",
    "Corn whole Grains",
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
    "Pet Tali",
    "Tick & Flea Powder",
    "Cat Litter Crystals",
    "Bird Cage Cleaner",
    "Puppy Pads",
  ],
  "Rices & Grains": [
    "Grade A Whole Grain Rice",
    "Whole Grain Rice",
    "Well-Milled Rice",
    "Brown Rice",
    "Dikit",
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
  indicationList,
  usedBarcodes,
  nameList,
}: any) {
  if (!brandMap || Object.keys(brandMap).length === 0) {
    throw new Error("❌ brandMap is empty or undefined in makeFeedProducts()");
  }

  const products = [];
  for (let i = 0; i < 20; i++) {
    const brandNames = Object.keys(brandMap);
    const brandName = brandNames[i % brandNames.length];
    const brandId = brandMap[brandName];
    const [name] = pickRandom<string>(nameList, 1);
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

async function makeMedicineProducts({
  categoryId,
  brandMap,
  unitMap,
  packingUnitMap,
  locationId,
  tagList,
  targetList,
  indicationList,
  usedBarcodes,
  nameList,
}: any) {
  if (!brandMap || Object.keys(brandMap).length === 0) {
    throw new Error(
      "❌ brandMap is empty or undefined in makeMedicineProducts()"
    );
  }

  const products = [];
  for (let i = 0; i < 20; i++) {
    const brandNames = Object.keys(brandMap);
    const brandName = brandNames[i % brandNames.length];
    const brandId = brandMap[brandName];
    const [name] = pickRandom<string>(nameList, 1);
    const packingSize = [10, 30, 100][i % 3];
    const allowRetail = packingSize >= 10;
    const srp = 100 + Math.random() * 150;
    const price = allowRetail ? computeRetailPrice(srp, packingSize) : srp;

    const unitId = unitMap[i % 2 === 0 ? "ml" : "cc"];
    const packingUnitId = packingUnitMap[i % 2 === 0 ? "bottle" : "vial"];
    const barcode = generateBarcode(usedBarcodes);
    const selectedTargets = pickRandom(targetList, 2);
    const selectedTags = pickRandom(tagList, 2);
    const selectedIndications = pickRandom(indicationList ?? [], 2);

    if (!Array.isArray(tagList)) {
      throw new Error(
        "❌ tagList is missing or not an array in makeMedicineProducts"
      );
    }

    products.push(
      db.product.create({
        data: {
          name,
          sku: generateSKU({
            name,
            brand: brandName,
            category: "Medicines",
            id: i + 1,
          }),
          price,
          srp,
          dealerPrice: srp - 30,
          allowPackSale: allowRetail,
          packingSize,
          packingStock: 2 + Math.floor(Math.random() * 2),
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

async function makeLpgProducts({
  categoryId,
  brandMap,
  unitMap,
  packingUnitMap,
  locationId,
  tagList,
  targetList,
  indicationList,
  usedBarcodes,
  nameList,
}: any) {
  if (!brandMap || Object.keys(brandMap).length === 0) {
    throw new Error("❌ brandMap is empty or undefined in makeLpgProducts()");
  }

  const products = [];
  for (let i = 0; i < 15; i++) {
    const brandNames = Object.keys(brandMap);
    const brandName = brandNames[i % brandNames.length];
    const brandId = brandMap[brandName];
    const [name] = pickRandom<string>(nameList, 1);

    const packingSize = [5, 11, 22][i % 3]; // In kg
    const allowRetail = false; // No per-kg sale for LPG
    const srp = 600 + Math.random() * 400;
    const price = srp;

    const unitId = unitMap["kg"];
    const packingUnitId = packingUnitMap["tank"];
    const barcode = generateBarcode(usedBarcodes);
    const selectedTargets = pickRandom(targetList, 1);
    const selectedTags = pickRandom(tagList, 2);
    const selectedIndications = pickRandom(indicationList ?? [], 2);

    products.push(
      db.product.create({
        data: {
          name,
          sku: generateSKU({
            name,
            brand: brandName,
            category: "LPG",
            id: i + 1,
          }),
          price,
          srp,
          dealerPrice: srp - 80,
          allowPackSale: allowRetail,
          packingSize,
          packingStock: 3,
          stock: 0,
          barcode,
          isActive: true,
          minStock: 1,
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

async function makePetSupplyProducts({
  categoryName,
  categoryId,
  brandMap,
  unitMap,
  packingUnitMap,
  locationId,
  tagList,
  targetList,
  indicationList,
  usedBarcodes,
  nameList,
}: any) {
  if (!brandMap || Object.keys(brandMap).length === 0) {
    throw new Error(
      "❌ brandMap is empty or undefined in makePetSupplyProducts()"
    );
  }

  const products = [];
  for (let i = 0; i < 20; i++) {
    const brandNames = Object.keys(brandMap);
    const brandName = brandNames[i % brandNames.length];
    const brandId = brandMap[brandName];
    const [name] = pickRandom<string>(nameList, 1);
    const packingSize = [0.5, 1, 2][i % 3]; // In kg or liters
    const allowRetail = packingSize >= 1;
    const srp = 120 + Math.random() * 150;
    const price = allowRetail ? computeRetailPrice(srp, packingSize) : srp;

    const unitId = unitMap["kg"];
    const packingUnitId = packingUnitMap["pack"];
    const barcode = generateBarcode(usedBarcodes);
    const selectedTargets = pickRandom(targetList, 2);
    const selectedTags = pickRandom(tagList, 2);
    const selectedIndications = pickRandom(indicationList ?? [], 2);

    products.push(
      db.product.create({
        data: {
          name,
          sku: generateSKU({
            name,
            brand: brandName,
            category: categoryName,
            id: i + 1,
          }),
          price,
          srp,
          dealerPrice: srp - 20,
          allowPackSale: allowRetail,
          packingSize,
          packingStock: 2 + Math.floor(Math.random() * 2),
          stock: allowRetail ? packingSize * 2 : 0,
          barcode,
          isActive: true,
          minStock: 3,
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

async function makeRiceProducts({
  categoryName,
  categoryId,
  brandMap,
  unitMap,
  packingUnitMap,
  locationId,
  tagList,
  targetList,
  indicationList,
  usedBarcodes,
  nameList,
}: any) {
  if (!brandMap || Object.keys(brandMap).length === 0) {
    throw new Error("❌ brandMap is empty or undefined in makeRiceProducts()");
  }

  const products = [];
  for (let i = 0; i < 20; i++) {
    const brandNames = Object.keys(brandMap);
    const brandName = brandNames[i % brandNames.length];
    const brandId = brandMap[brandName];
    const [name] = pickRandom<string>(nameList, 1);

    const packingSize = [25, 50][i % 2]; // Rices often packed in 25kg or 50kg sacks
    const allowRetail = shouldAllowRetail(packingSize);
    const srp = 1400 + Math.random() * 800;
    const price = allowRetail ? computeRetailPrice(srp, packingSize) : srp;

    const unitId = unitMap["kg"];
    const packingUnitId = packingUnitMap["sack"];
    const barcode = generateBarcode(usedBarcodes);
    const selectedTargets = pickRandom(targetList, 1);
    const selectedTags = pickRandom(tagList, 2);
    const selectedIndications = pickRandom(indicationList ?? [], 2);

    products.push(
      db.product.create({
        data: {
          name,
          sku: generateSKU({
            name,
            brand: brandName,
            category: categoryName,
            id: i + 1,
          }),
          price,
          srp,
          dealerPrice: srp - 100,
          allowPackSale: allowRetail,
          packingSize,
          packingStock: 4 + Math.floor(Math.random() * 3),
          stock: allowRetail ? packingSize * 3 : 0,
          barcode,
          isActive: true,
          minStock: 10,
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

async function makeEquipmentProducts({
  categoryName,
  categoryId,
  brandMap,
  unitMap,
  packingUnitMap,
  locationId,
  tagList,
  targetList,
  indicationList,
  usedBarcodes,
  nameList,
}: any) {
  if (!brandMap || Object.keys(brandMap).length === 0) {
    throw new Error(
      "❌ brandMap is empty or undefined in makeEquipmentProducts()"
    );
  }

  const products = [];
  for (let i = 0; i < 20; i++) {
    const brandNames = Object.keys(brandMap);
    const brandName = brandNames[i % brandNames.length];
    const brandId = brandMap[brandName];
    const [name] = pickRandom<string>(nameList, 1);

    const packingSize = 1;
    const allowRetail = false;
    const srp = 500 + Math.random() * 2000;
    const price = srp;

    const unitId = unitMap["unit"];
    const packingUnitId = packingUnitMap["unit"];
    const barcode = generateBarcode(usedBarcodes);
    const selectedTargets = pickRandom(targetList, 1);
    const selectedTags = pickRandom(tagList, 2);
    const selectedIndications = pickRandom(indicationList ?? [], 2);

    products.push(
      db.product.create({
        data: {
          name,
          sku: generateSKU({
            name,
            brand: brandName,
            category: categoryName,
            id: i + 1,
          }),
          price,
          srp,
          dealerPrice: srp - 200,
          allowPackSale: allowRetail,
          packingSize,
          packingStock: 5,
          stock: 0,
          barcode,
          isActive: true,
          minStock: 1,
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

async function makeBinhiProducts({
  categoryName,
  categoryId,
  brandMap,
  unitMap,
  packingUnitMap,
  locationId,
  tagList,
  targetList,
  indicationList,
  usedBarcodes,
  nameList,
}: any) {
  if (!brandMap || Object.keys(brandMap).length === 0) {
    throw new Error("❌ brandMap is empty or undefined in makeBinhiProducts()");
  }

  const products = [];
  for (let i = 0; i < 20; i++) {
    const brandNames = Object.keys(brandMap);
    const brandName = brandNames[i % brandNames.length];
    const brandId = brandMap[brandName];
    const [name] = pickRandom<string>(nameList, 1);

    const packingSize = [0.1, 0.25, 0.5][i % 3]; // in kg
    const allowRetail = packingSize >= 0.25;
    const srp = 50 + Math.random() * 80;
    const price = allowRetail ? computeRetailPrice(srp, packingSize) : srp;

    const unitId = unitMap["kg"];
    const packingUnitId = packingUnitMap["sachet"];
    const barcode = generateBarcode(usedBarcodes);
    const selectedTargets = pickRandom(targetList, 1);
    const selectedTags = pickRandom(tagList, 2);
    const selectedIndications = pickRandom(indicationList ?? [], 2);

    products.push(
      db.product.create({
        data: {
          name,
          sku: generateSKU({
            name,
            brand: brandName,
            category: categoryName,
            id: i + 1,
          }),
          price,
          srp,
          dealerPrice: srp - 10,
          allowPackSale: allowRetail,
          packingSize,
          packingStock: 10,
          stock: allowRetail ? packingSize * 5 : 0,
          barcode,
          isActive: true,
          minStock: 2,
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

async function makeAgriProducts({
  categoryName,
  categoryId,
  brandMap,
  unitMap,
  packingUnitMap,
  locationId,
  tagList,
  targetList,
  indicationList,
  usedBarcodes,
  nameList,
}: any) {
  if (!brandMap || Object.keys(brandMap).length === 0) {
    throw new Error("❌ brandMap is empty or undefined in makeAgriProducts()");
  }

  const products = [];
  for (let i = 0; i < 20; i++) {
    const brandNames = Object.keys(brandMap);
    const brandName = brandNames[i % brandNames.length];
    const brandId = brandMap[brandName];
    const [name] = pickRandom<string>(nameList, 1);

    const packingSize = [0.5, 1, 5][i % 3]; // liters or kg
    const allowRetail = packingSize >= 1;
    const srp = 200 + Math.random() * 300;
    const price = allowRetail ? computeRetailPrice(srp, packingSize) : srp;

    const unitId = unitMap["liter"];
    const packingUnitId = packingUnitMap["bottle"];
    const barcode = generateBarcode(usedBarcodes);
    const selectedTargets = pickRandom(targetList, 1); // always plants
    const selectedTags = pickRandom(tagList, 2);
    const selectedIndications = pickRandom(indicationList ?? [], 2);

    products.push(
      db.product.create({
        data: {
          name,
          sku: generateSKU({
            name,
            brand: brandName,
            category: categoryName,
            id: i + 1,
          }),
          price,
          srp,
          dealerPrice: srp - 30,
          allowPackSale: allowRetail,
          packingSize,
          packingStock: 4 + Math.floor(Math.random() * 3),
          stock: allowRetail ? packingSize * 3 : 0,
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

  const tagList = await getOrCreateGlobalTags();

  console.log("📦 Creating categories...");
  const categoryMap: Record<string, number> = {};
  for (const name of categories) {
    const cat = await db.category.create({ data: { name } });
    categoryMap[name] = cat.id;
  }

  console.log("📍 Creating locations...");
  const locationMap: Record<string, number> = {};
  for (const name of Object.values(locationsByCategory)) {
    const location = await db.location.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    locationMap[name] = location.id;
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
  const brandMapByCategory: Record<string, Record<string, number>> = {};

  for (const [categoryName, brandNames] of Object.entries(brandsByCategory)) {
    const categoryId = categoryMap[categoryName];
    if (!categoryId) continue;

    brandMapByCategory[categoryName] = {};

    for (const name of brandNames) {
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

      brandMapByCategory[categoryName][name] = brand.id;
    }
  }

  console.log("🌾 Creating realistic products...");
  const usedBarcodes = new Set<string>();
  console.log("🧪 DEBUG:", {
    unitKeys: Object.keys(unitMap),
    packingUnitKeys: Object.keys(packingUnitMap),
    tagCount: tagList.length,
    targetCount: targetMapByCategory["Animal Feeds"]?.length ?? 0,
  });

  await makeFeedProducts({
    categoryName: "Animal Feeds",
    categoryId: categoryMap["Animal Feeds"],
    locationId: locationMap[locationsByCategory["Animal Feeds"]],
    brandMap: brandMapByCategory["Animal Feeds"],
    unitMap,
    packingUnitMap,
    targetList: targetMapByCategory["Animal Feeds"],
    indicationList: indicationMapByCategory["Animal Feeds"],
    usedBarcodes,
    tagList,
    nameList: productNamesByCategory["Animal Feeds"],
  });

  await makeMedicineProducts({
    categoryName: "Medicines",
    categoryId: categoryMap["Medicines"],
    locationId: locationMap[locationsByCategory["Medicines"]],
    brandMap: brandMapByCategory["Medicines"],
    unitMap,
    packingUnitMap,
    targetList: targetMapByCategory["Medicines"],
    indicationList: indicationMapByCategory["Medicines"],
    usedBarcodes,
    tagList,
    nameList: productNamesByCategory["Medicines"],
  });

  await makeLpgProducts({
    categoryName: "LPG",
    categoryId: categoryMap["LPG"],
    locationId: locationMap[locationsByCategory["LPG"]],
    brandMap: brandMapByCategory["LPG"],
    unitMap,
    packingUnitMap,
    targetList: targetMapByCategory["LPG"],
    indicationList: indicationMapByCategory["LPG"],
    usedBarcodes,
    tagList,
    nameList: productNamesByCategory["LPG"],
  });

  await makePetSupplyProducts({
    categoryName: "Pet Supplies",
    categoryId: categoryMap["Pet Supplies"],
    locationId: locationMap[locationsByCategory["Pet Supplies"]],
    brandMap: brandMapByCategory["Pet Supplies"],
    unitMap,
    packingUnitMap,
    targetList: targetMapByCategory["Pet Supplies"],
    indicationList: indicationMapByCategory["Pet Supplies"],
    usedBarcodes,
    tagList,
    nameList: productNamesByCategory["Pet Supplies"],
  });

  await makeRiceProducts({
    categoryName: "Rices & Grains",
    categoryId: categoryMap["Rices & Grains"],
    locationId: locationMap[locationsByCategory["Rices & Grains"]],
    brandMap: brandMapByCategory["Rices & Grains"],
    unitMap,
    packingUnitMap,
    targetList: targetMapByCategory["Rices & Grains"],
    indicationList: indicationMapByCategory["Rices & Grains"],
    usedBarcodes,
    tagList,
    nameList: productNamesByCategory["Rices & Grains"],
  });

  await makeEquipmentProducts({
    categoryName: "Equipment",
    categoryId: categoryMap["Equipment"],
    locationId: locationMap[locationsByCategory["Equipment"]],
    brandMap: brandMapByCategory["Equipment"],
    unitMap,
    packingUnitMap,
    targetList: targetMapByCategory["Equipment"],
    indicationList: indicationMapByCategory["Equipment"],
    usedBarcodes,
    tagList,
    nameList: productNamesByCategory["Equipment"],
  });

  await makeBinhiProducts({
    categoryName: "Binhi (Seeds)",
    categoryId: categoryMap["Binhi (Seeds)"],
    locationId: locationMap[locationsByCategory["Binhi (Seeds)"]],
    brandMap: brandMapByCategory["Binhi (Seeds)"],
    unitMap,
    packingUnitMap,
    targetList: targetMapByCategory["Binhi (Seeds)"],
    indicationList: indicationMapByCategory["Binhi (Seeds)"],
    usedBarcodes,
    tagList,
    nameList: productNamesByCategory["Binhi (Seeds)"],
  });

  await makeAgriProducts({
    categoryName: "Agriculture Products",
    categoryId: categoryMap["Agriculture Products"],
    locationId: locationMap[locationsByCategory["Agriculture Products"]],
    brandMap: brandMapByCategory["Agriculture Products"],
    unitMap,
    packingUnitMap,
    targetList: targetMapByCategory["Agriculture Products"],
    indicationList: indicationMapByCategory["Agriculture Products"],
    usedBarcodes,
    tagList,
    nameList: productNamesByCategory["Agriculture Products"],
  });

  console.log("\n✅ Seeding complete!");
  await db.$disconnect();
}

seed().catch((err) => {
  console.error("❌ Seed failed", err);
  process.exit(1);
});
