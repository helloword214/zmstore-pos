/* eslint-disable @typescript-eslint/no-explicit-any */
// prisma/seed.ts
import "dotenv/config";
import { PrismaClient, EmployeeRole, VehicleType } from "@prisma/client";
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
  console.log("🧹 Resetting (FK-safe order)...");
  // Wrap in a single transaction for speed & consistency
  await db.$transaction([
    // ── M3/M2 artifacts first (may reference Product & Order)
    db.deliveryRunOrder.deleteMany(),
    db.runAdhocSale.deleteMany(),
    db.stockMovement.deleteMany(),

    // ── Order graph
    db.payment.deleteMany(),
    db.orderItem.deleteMany(),
    db.order.deleteMany(),

    // ── Sales graph
    db.saleItem.deleteMany(),
    db.sale.deleteMany(),

    // ── Product-side many-to-many & details
    db.productIndication.deleteMany(),
    db.productTarget.deleteMany(),
    db.productTag.deleteMany(),

    // ── Customers (if you want a clean slate for your product seeding run)
    //    Keep these if you prefer to retain customers/addresses.
    db.customerAddress.deleteMany(),
    db.customerItemPrice.deleteMany(),
    db.cylinderLoan.deleteMany(),
    db.customer.deleteMany(),

    // ── Core catalog
    db.product.deleteMany(),
    db.brand.deleteMany(),
    db.target.deleteMany(),
    db.indication.deleteMany(),
    db.tag.deleteMany(),
    db.category.deleteMany(),

    // ── Static refs
    db.unit.deleteMany(),
    db.packingUnit.deleteMany(),
    db.location.deleteMany(),

    // ── Optional: if you also want a clean slate for fleet/workforce
    // Comment out if you want to keep them across seeds.
    // db.overrideLog.deleteMany(),
    // db.deliveryRun.deleteMany(),
    db.vehicleCapacityProfile.deleteMany(),
    db.vehicle.deleteMany(),
    db.employee.deleteMany(),
  ]);

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

  // ─────────────────────────────────────────
  // NEW: Fleet & Riders
  // ─────────────────────────────────────────
  console.log("🛵 Creating vehicles (capacity now in **kg**)...");
  // NOTE:
  // - capacityUnits === TOTAL WEIGHT CAPACITY IN **KG** (generic for any goods)
  // - We'll also derive an LPG "slots" profile (per 11 kg net) for TAG:LPG.
  const LPG_TANK_NET_KG = 11;

  const vehiclesData = [
    {
      name: "Tricycle A",
      type: VehicleType.TRICYCLE,
      capacityUnits: 150, // kg
      notes: "Main trike",
      active: true,
    },
    {
      name: "Motorcycle A",
      type: VehicleType.MOTORCYCLE,
      capacityUnits: 60, // kg
      notes: "Rack installed",
      active: true,
    },
    {
      name: "Sidecar A",
      type: VehicleType.SIDECAR,
      capacityUnits: 120, // kg
      notes: null,
      active: true,
    },
    {
      name: "Multicab A",
      type: VehicleType.MULTICAB,
      capacityUnits: 300, // kg
      notes: "High capacity",
      active: true,
    },
  ];
  const vehiclesByKey: Record<string, { id: number }> = {};
  for (const v of vehiclesData) {
    const up = await db.vehicle.upsert({
      where: { name_type: { name: v.name, type: v.type } }, // @@unique([name, type])
      update: {
        capacityUnits: v.capacityUnits,
        notes: v.notes,
        active: v.active,
      },
      create: v,
    });
    vehiclesByKey[`${up.name}:${up.type}`] = { id: up.id };
  }
  // Optional capacity profile (tag-based): derive LPG slots from kg capacity.
  for (const key of Object.keys(vehiclesByKey)) {
    const v = vehiclesByKey[key];
    const capacityKg =
      vehiclesData.find((d) => `${d.name}:${d.type}` === key)?.capacityUnits ??
      0;
    const lpgSlots = Math.floor(capacityKg / LPG_TANK_NET_KG);
    await db.vehicleCapacityProfile.upsert({
      where: { vehicleId_key: { vehicleId: v.id, key: "TAG:LPG" } },
      update: {
        maxUnits: lpgSlots,
      },
      create: {
        vehicleId: v.id,
        key: "TAG:LPG",
        maxUnits: lpgSlots,
      },
    });
  }

  console.log("👷 Creating riders (employees)...");
  const riders = [
    {
      firstName: "Juan",
      lastName: "Dela Cruz",
      alias: "Juan",
      phone: "09170000001",
      email: "juan.rider@example.com",
      role: EmployeeRole.RIDER,
      dv: "Tricycle A:TRICYCLE",
    },
    {
      firstName: "Maria",
      lastName: "Santos",
      alias: "Maria",
      phone: "09170000002",
      email: "maria.rider@example.com",
      role: EmployeeRole.RIDER,
      dv: "Motorcycle A:MOTORCYCLE",
    },
    {
      firstName: "Pedro",
      lastName: "Reyes",
      alias: "Pedro",
      phone: "09170000003",
      email: "pedro.rider@example.com",
      role: EmployeeRole.RIDER,
      dv: "Sidecar A:SIDECAR",
    },
  ];
  for (const r of riders) {
    await db.employee.upsert({
      where: { email: r.email },
      update: {
        firstName: r.firstName,
        lastName: r.lastName,
        alias: r.alias,
        phone: r.phone,
        role: r.role,
        active: true,
        defaultVehicleId: vehiclesByKey[r.dv]?.id ?? null,
      },
      create: {
        firstName: r.firstName,
        lastName: r.lastName,
        alias: r.alias,
        phone: r.phone,
        email: r.email,
        role: r.role,
        active: true,
        defaultVehicleId: vehiclesByKey[r.dv]?.id ?? null,
      },
    });
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

  // ─────────────────────────────────────────
  // NEW: A few customers with addresses (safe upserts)
  // ─────────────────────────────────────────
  console.log("👨‍👩‍👧‍👦 Creating customers + addresses…");
  const customers = [
    {
      alias: "Bahay ni Mang Tonyo",
      firstName: "Antonio",
      lastName: "Ramirez",
      phone: "09180000001",
      email: "antonio@example.com",
      notes: "Prefers morning delivery",
      addr: {
        label: "Home",
        line1: "Blk 4 Lot 12, Mabini St.",
        barangay: "San Isidro",
        city: "Quezon City",
        province: "Metro Manila",
        postalCode: "1100",
        landmark: "Near sari-sari store",
        geoLat: 14.6501,
        geoLng: 121.0493,
      },
    },
    {
      alias: "Apt 2B",
      firstName: "Jessica",
      lastName: "Lopez",
      phone: "09180000002",
      email: "jessica@example.com",
      notes: "GCash preferred",
      addr: {
        label: "Condo",
        line1: "Unit 2B, Sunrise Tower",
        barangay: "Bel-Air",
        city: "Makati",
        province: "Metro Manila",
        postalCode: "1210",
        landmark: "Across coffee shop",
        geoLat: 14.5585,
        geoLng: 121.0244,
      },
    },
    {
      alias: "Carinderia",
      firstName: "Luisa",
      lastName: "Garcia",
      phone: "09180000003",
      email: "luisa@example.com",
      notes: "Bulk LPG every Friday",
      addr: {
        label: "Store",
        line1: "P. Burgos St.",
        barangay: "San Roque",
        city: "Marikina",
        province: "Metro Manila",
        postalCode: "1800",
        landmark: "Beside pharmacy",
        geoLat: 14.6517,
        geoLng: 121.1029,
      },
    },
  ];
  for (const c of customers) {
    const customer = await db.customer.upsert({
      where: { phone: c.phone }, // phone is unique

      update: {
        alias: c.alias,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        notes: c.notes,
        isActive: true,
      },
      create: {
        alias: c.alias,
        firstName: c.firstName,
        lastName: c.lastName,
        phone: c.phone,
        email: c.email,
        notes: c.notes,
        isActive: true,
      },
    });

    // Ensure one address by (customerId,label)
    const existing = await db.customerAddress.findFirst({
      where: { customerId: customer.id, label: c.addr.label },
      select: { id: true },
    });
    if (existing) {
      await db.customerAddress.update({
        where: { id: existing.id },
        data: {
          line1: c.addr.line1,
          barangay: c.addr.barangay,
          city: c.addr.city,
          province: c.addr.province,
          postalCode: c.addr.postalCode ?? null,
          landmark: c.addr.landmark ?? null,
          geoLat: c.addr.geoLat ?? null,
          geoLng: c.addr.geoLng ?? null,
        },
      });
    } else {
      await db.customerAddress.create({
        data: {
          customerId: customer.id,
          label: c.addr.label,
          line1: c.addr.line1,
          barangay: c.addr.barangay,
          city: c.addr.city,
          province: c.addr.province,
          postalCode: c.addr.postalCode ?? null,
          landmark: c.addr.landmark ?? null,
          geoLat: c.addr.geoLat ?? null,
          geoLng: c.addr.geoLng ?? null,
        },
      });
    }
  }
  // ─────────────────────────────────────────
  // EXTRA: generate 25 more dummy customers (unique phones)
  // ─────────────────────────────────────────
  const firstNames = [
    "Alex",
    "Bea",
    "Carlo",
    "Diane",
    "Eli",
    "Faye",
    "Gio",
    "Hannah",
    "Ivan",
    "Janna",
    "Kyle",
    "Lia",
    "Mico",
    "Nina",
    "Owen",
    "Pia",
    "Quin",
    "Rhea",
    "Seth",
    "Tina",
    "Uli",
    "Vera",
    "Wade",
    "Yani",
    "Zach",
  ];
  const lastNames = [
    "Alonso",
    "Bautista",
    "Cruz",
    "Dizon",
    "Escobar",
    "Flores",
    "Garcia",
    "Hernandez",
    "Ilagan",
    "Jimenez",
    "Katigbak",
    "Lopez",
    "Mendoza",
    "Navarro",
    "Ortega",
    "Perez",
    "Quiambao",
    "Ramos",
    "Santos",
    "Trinidad",
    "Uy",
    "Villanueva",
    "Wong",
    "Yap",
    "Zamora",
  ];
  function pad(n: number, len = 6) {
    return String(n).padStart(len, "0");
  }

  for (let i = 1; i <= 25; i++) {
    const fn = firstNames[(i - 1) % firstNames.length];
    const ln = lastNames[(i - 1) % lastNames.length];
    const phone = `0918${pad(100000 + i)}`; // unique phone each
    const email = `${fn.toLowerCase()}.${ln.toLowerCase()}${i}@example.com`;
    const alias = `${fn} ${ln}`;
    const city = ["Quezon City", "Makati", "Pasig", "Marikina", "Taguig"][
      i % 5
    ];
    const barangay = [
      "San Isidro",
      "Bel-Air",
      "Ugong",
      "San Roque",
      "Bagumbayan",
    ][i % 5];
    const label = ["Home", "Condo", "Shop", "Office"][i % 4];

    const customer = await db.customer.upsert({
      where: { phone },
      update: { alias, firstName: fn, lastName: ln, email, isActive: true },
      create: {
        alias,
        firstName: fn,
        lastName: ln,
        phone,
        email,
        isActive: true,
      },
    });

    const existing = await db.customerAddress.findFirst({
      where: { customerId: customer.id, label },
      select: { id: true },
    });

    const addrData = {
      line1: `#${100 + i} Mabini St.`,
      barangay,
      city,
      province: "Metro Manila",
      postalCode: "1000",
      landmark: "Near trike terminal",
      geoLat: 14.5 + i * 0.001,
      geoLng: 121.0 + i * 0.001,
    };

    if (existing) {
      await db.customerAddress.update({
        where: { id: existing.id },
        data: addrData,
      });
    } else {
      await db.customerAddress.create({
        data: { customerId: customer.id, label, ...addrData },
      });
    }
  }

  console.log("\n✅ Seeding complete!");
  await db.$disconnect();
}

seed().catch((err) => {
  console.error("❌ Seed failed", err);
  process.exit(1);
});
