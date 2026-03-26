/* eslint-disable @typescript-eslint/no-explicit-any */
// prisma/seed.ts
import "dotenv/config";
import {
  PrismaClient,
  EmployeeRole,
  EmployeeDocumentType,
  VehicleType,
  UserRole,
  UserAuthState,
  ManagerKind,
  PayrollFrequency,
  SickLeavePayTreatment,
  WorkerScheduleRole,
  WorkerScheduleTemplateDayOfWeek,
} from "@prisma/client";
import { generateSKU } from "~/utils/skuHelpers";
import {
  upsertCompanyPayrollPolicy,
  upsertEmployeePayProfile,
  upsertEmployeeStatutoryDeductionProfile,
} from "~/services/worker-payroll-policy.server";
import {
  assignWorkerScheduleTemplateToWorkers,
  upsertWorkerScheduleTemplate,
} from "~/services/worker-schedule-template.server";
import { generateWorkerSchedulesFromTemplateAssignments } from "~/services/worker-schedule-publication.server";
import * as bcrypt from "bcryptjs";

const db = new PrismaClient();

// ─────────────────────────────────────────
// 0️⃣ Pangasinan Geo Master Data (Region I)
// ─────────────────────────────────────────
const PANGASINAN = {
  province: { name: "Pangasinan", code: "0155" as string | undefined },
  municipalities: [
    // Core focus for now; add more later if needed
    { name: "Asingan" },
    { name: "San Nicolas" },
    { name: "Tayug" },
    { name: "Rosales" },
    { name: "Urdaneta City" },
    { name: "Villasis" },
    { name: "Binalonan" },
    { name: "San Manuel" },
    { name: "Umingan" },
    { name: "Natividad" },
    { name: "Balungao" },
  ],
  // Source: LGU Asingan / PhilAtlas / PSA lists
  barangaysByMunicipality: {
    Asingan: [
      "Ariston Este",
      "Ariston Weste",
      "Bantog",
      "Baro",
      "Bobonan",
      "Calepaan",
      "Carosucan Norte",
      "Carosucan Sur",
      "Coldit",
      "Domanpot",
      "Dupac",
      "Macalong",
      "Poblacion East",
      "Poblacion West",
      "San Vicente East",
      "San Vicente West",
      "Sanchez",
      "Cabalitian",
      "Sobol",
    ],
    // Source: PhilAtlas (San Nicolas, Pangasinan)
    "San Nicolas": [
      "Bensican",
      "Caanamangaan",
      "Cabaldongan",
      "Calanutian",
      "Camangaan",
      "Casaratan",
      "Fianza",
      "Malico",
      "Salpad",
      "San Felipe East",
      "San Felipe West",
      "San Rafael Centro",
      "San Rafael East",
      "San Rafael West",
      "San Roque",
      "Santa Maria East",
      "Santa Maria West",
      "Poblacion East",
      "Poblacion West",
      "San Eugenio",
      "San Jose",
      "San Pedro",
      "San Vicente",
      "Santa Barbara",
      "Santa Pilar",
      "Santa Rosa",
      "Santo Domingo",
      "Santo Niño East",
      "Santo Niño West",
      "Santo Tomas",
      "Toketec",
      "Tulong",
    ],
    // keep a few for neighbors we reference in dummy data
    Rosales: ["Carmen East", "Carmen West", "Poblacion", "Rabago", "Tomling"],
    Tayug: ["Barangobong", "Caoayan", "Lawak", "Poblacion", "Saleng"],
    "Urdaneta City": [
      "Anonas",
      "Cabaruan",
      "Bayaoas",
      "Casantaan",
      "Cayambanan",
      "Poblacion",
    ],
    Villasis: ["Amamperez", "Barangobong", "Poblacion", "San Blas", "Unzad"],
    Binalonan: [
      "Balangobong",
      "Bugayong",
      "Camangaan",
      "Poblacion",
      "Santiago",
    ],
    "San Manuel": ["Cabacaraan", "Laoac", "Narra", "Poblacion", "San Roque"],
    Umingan: ["Abot Molina", "Barira", "Palacpalac", "Poblacion", "San Juan"],
    Natividad: [
      "Acacia",
      "Batchelor East",
      "Batchelor West",
      "Poblacion",
      "Tumbar",
    ],
    Balungao: [
      "Capayaran",
      "Esmeralda",
      "Kita-Kita",
      "Poblacion",
      "San Aurelio 1st",
    ],
  } as Record<string, string[]>,
};

// Zip code helpers (optional snapshots)
const ZIP_BY_MUNI: Record<string, string> = {
  Asingan: "2439",
  "San Nicolas": "2447",
  Rosales: "2441",
  Tayug: "2445",
  "Urdaneta City": "2428",
  Villasis: "2427",
  Binalonan: "2436",
  "San Manuel": "2438",
  Umingan: "2443",
  Natividad: "2446",
  Balungao: "2442",
};

// ── upsert full Province → Municipalities → Barangays → Zones → Landmarks
async function seedGeoPangasinan() {
  const province = await db.province.upsert({
    where: { name: PANGASINAN.province.name },
    update: { code: PANGASINAN.province.code ?? null, isActive: true },
    create: {
      name: PANGASINAN.province.name,
      code: PANGASINAN.province.code ?? null,
    },
  });

  const muniMap: Record<string, number> = {};
  for (const m of PANGASINAN.municipalities) {
    const muni = await db.municipality.upsert({
      where: { provinceId_name: { provinceId: province.id, name: m.name } },
      update: { isActive: true },
      create: { name: m.name, provinceId: province.id },
    });
    muniMap[m.name] = muni.id;

    const brgys = PANGASINAN.barangaysByMunicipality[m.name] ?? [];
    for (const b of brgys) {
      const brgy = await db.barangay.upsert({
        where: { municipalityId_name: { municipalityId: muni.id, name: b } },
        update: { isActive: true },
        create: { name: b, municipalityId: muni.id },
      });

      // Create a few default zones/purok to start
      for (const z of ["Purok 1", "Purok 2", "Purok 3"]) {
        await db.zone.upsert({
          where: { barangayId_name: { barangayId: brgy.id, name: z } },
          update: { isActive: true },
          create: { name: z, barangayId: brgy.id },
        });
      }
    }
  }

  // Landmarks (sample, tie to key barangays)
  const LMK = [
    { muni: "Asingan", brgy: "Poblacion East", name: "Asingan Town Plaza" },
    { muni: "Asingan", brgy: "Poblacion West", name: "Asingan Public Market" },
    {
      muni: "Asingan",
      brgy: "Carosucan Norte",
      name: "Carosucan Norte Trike Terminal",
    },
    {
      muni: "San Nicolas",
      brgy: "Poblacion East",
      name: "San Nicolas Municipal Hall",
    },
    {
      muni: "San Nicolas",
      brgy: "San Rafael Centro",
      name: "SN Public Market",
    },
  ];
  for (const l of LMK) {
    const barangay = await db.barangay.findFirst({
      where: {
        name: l.brgy,
        municipality: { name: l.muni, province: { name: "Pangasinan" } },
      },
      select: { id: true },
    });
    if (barangay) {
      await db.landmark.upsert({
        where: { name_barangayId: { name: l.name, barangayId: barangay.id } },
        update: { isActive: true },
        create: { name: l.name, barangayId: barangay.id, isActive: true },
      });
    }
  }

  return { provinceId: province.id, muniMap };
}

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

type SeedCatalogCategory = (typeof categories)[number];
type SeedUnitName = (typeof unitNames)[number];
type SeedPackingUnitName = (typeof packingUnitNames)[number];

type SeedCatalogItem = {
  category: SeedCatalogCategory;
  brand: string;
  name: string;
  description: string;
  unit: SeedUnitName;
  packingUnit: SeedPackingUnitName;
  packingSize: number;
  packPrice: number;
  dealerPrice: number;
  allowPackSale: boolean;
  unitPrice?: number;
  packingStock: number;
  stock: number;
  minStock: number;
  targets: string[];
  indications: string[];
};

type SeedCustomerFixture = {
  alias: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  notes?: string;
  addr: {
    label: string;
    line1: string;
    barangay: string;
    city: string;
    province: string;
    postalCode?: string;
    purok?: string;
    landmark?: string;
    geoLat?: number;
    geoLng?: number;
  };
};

type SeedEmployeeFixture = {
  firstName: string;
  middleName?: string;
  lastName: string;
  alias?: string;
  phone: string;
  email: string;
  role: EmployeeRole;
  birthDate?: string;
  sssNumber?: string;
  pagIbigNumber?: string;
  licenseNumber?: string;
  licenseExpiry?: string;
  defaultVehicleKey?: string;
  address: {
    line1: string;
    barangay: string;
    city: string;
    province: string;
    postalCode?: string;
    purok?: string;
    landmark?: string;
    geoLat?: number;
    geoLng?: number;
  };
};

type SeededEmployeeRecord = {
  id: number;
  seed: SeedEmployeeFixture;
};

const brandsByCategory: Record<SeedCatalogCategory, string[]> = {
  "Animal Feeds": ["BMEG", "New Hope", "Robina", "Vitarich"],
  "Binhi (Seeds)": [
    "East-West Seed",
    "Ramgo",
    "Condor",
    "Known-You",
    "PhilRice",
  ],
  Medicines: ["VetRx", "Medilife", "GeneriVet", "Virbac"],
  "Pet Supplies": ["TopBreed", "Powercat", "Cosi", "Cature"],
  LPG: ["Petron Gasul", "Solane", "Regasco", "Fiesta"],
  "Rices & Grains": ["Well-Milled", "Sinandomeng", "Dinorado", "Jasmine"],
  "Agriculture Products": ["Yara", "Atlas", "Bio-N", "Crop Giant"],
  Equipment: ["Ingco", "Lotus", "Truper", "Generic"],
};

const locationsByCategory: Record<SeedCatalogCategory, string> = {
  "Animal Feeds": "Feeds Section",
  "Binhi (Seeds)": "Seed Rack",
  Medicines: "Medicine Shelf",
  "Pet Supplies": "Pet Corner",
  LPG: "LPG Area",
  "Rices & Grains": "Rice Display",
  "Agriculture Products": "Agri Shelf",
  Equipment: "Tool Section",
};

const targetNamesByCategory: Record<SeedCatalogCategory, string[]> = {
  "Animal Feeds": ["Hog", "Chicken", "Fish"],
  "Binhi (Seeds)": ["Rice", "Corn", "Eggplants", "Plants"],
  Medicines: ["Hog", "Chicken", "Dog", "Cat"],
  "Pet Supplies": ["Dog", "Cat"],
  LPG: ["Others"],
  "Rices & Grains": ["Human"],
  "Agriculture Products": ["Plants", "Rice", "Corn"],
  Equipment: ["Others", "Plants"],
};

const indicationsByCategory: Record<SeedCatalogCategory, string[]> = {
  "Animal Feeds": [
    "Starter Feed",
    "Grower Feed",
    "Layer Support",
    "Finisher Feed",
  ],
  "Binhi (Seeds)": [
    "High Yield",
    "Early Maturity",
    "Heat Tolerant",
    "Disease Resistance",
  ],
  Medicines: [
    "Antibiotic",
    "Pain Relief",
    "Deworming",
    "Appetite Booster",
    "Immune Support",
  ],
  "Pet Supplies": [
    "Daily Feeding",
    "Coat Care",
    "Hygiene",
    "Litter Control",
  ],
  LPG: ["Cooking", "Heating"],
  "Rices & Grains": ["Daily Consumption", "Premium Grain"],
  "Agriculture Products": [
    "Fertilizer",
    "Foliar Feed",
    "Pest Control",
    "Soil Health",
  ],
  Equipment: ["Daily Farm Use", "Spraying", "Harvest Support"],
};

// Stable March 2026 snapshot for seed realism.
// Public anchors where available:
// - DOE LPG monitor (11kg range)
// - DA weekly rice price monitoring
// - FPA fertilizer weekly prices
// Other store items use deterministic local retail ranges to avoid reseed drift.
const PRODUCT_SNAPSHOTS: SeedCatalogItem[] = [
  {
    category: "Animal Feeds",
    brand: "BMEG",
    name: "Hog Grower Pellets",
    description: "25kg hog grower feed sack for backyard and small farm operations.",
    unit: "kg",
    packingUnit: "sack",
    packingSize: 25,
    packPrice: 1120,
    dealerPrice: 1080,
    allowPackSale: true,
    unitPrice: 44.8,
    packingStock: 10,
    stock: 250,
    minStock: 50,
    targets: ["Hog"],
    indications: ["Grower Feed"],
  },
  {
    category: "Animal Feeds",
    brand: "New Hope",
    name: "Broiler Starter Crumble",
    description: "25kg broiler starter crumble for the first feeding stage.",
    unit: "kg",
    packingUnit: "sack",
    packingSize: 25,
    packPrice: 1085,
    dealerPrice: 1045,
    allowPackSale: true,
    unitPrice: 43.4,
    packingStock: 8,
    stock: 200,
    minStock: 50,
    targets: ["Chicken"],
    indications: ["Starter Feed"],
  },
  {
    category: "Animal Feeds",
    brand: "Vitarich",
    name: "Layer Mash",
    description: "50kg layer mash feed for egg-laying poultry.",
    unit: "kg",
    packingUnit: "sack",
    packingSize: 50,
    packPrice: 2060,
    dealerPrice: 1985,
    allowPackSale: true,
    unitPrice: 41.2,
    packingStock: 6,
    stock: 300,
    minStock: 100,
    targets: ["Chicken"],
    indications: ["Layer Support"],
  },
  {
    category: "Animal Feeds",
    brand: "Robina",
    name: "Aqua Starter Crumble",
    description: "25kg starter crumble for bangus and tilapia grow-out ponds.",
    unit: "kg",
    packingUnit: "sack",
    packingSize: 25,
    packPrice: 1160,
    dealerPrice: 1115,
    allowPackSale: true,
    unitPrice: 46.4,
    packingStock: 6,
    stock: 150,
    minStock: 50,
    targets: ["Fish"],
    indications: ["Starter Feed"],
  },
  {
    category: "Animal Feeds",
    brand: "BMEG",
    name: "Chick Booster Crumble",
    description: "25kg chick booster feed for small poultry raisers.",
    unit: "kg",
    packingUnit: "sack",
    packingSize: 25,
    packPrice: 1060,
    dealerPrice: 1025,
    allowPackSale: true,
    unitPrice: 42.4,
    packingStock: 8,
    stock: 175,
    minStock: 50,
    targets: ["Chicken"],
    indications: ["Starter Feed"],
  },
  {
    category: "Medicines",
    brand: "VetRx",
    name: "Ivermectin Oral Suspension 100ml",
    description: "100ml deworming suspension commonly used in farm animal care.",
    unit: "ml",
    packingUnit: "bottle",
    packingSize: 100,
    packPrice: 245,
    dealerPrice: 228,
    allowPackSale: false,
    packingStock: 12,
    stock: 32,
    minStock: 6,
    targets: ["Hog", "Dog"],
    indications: ["Deworming"],
  },
  {
    category: "Medicines",
    brand: "Medilife",
    name: "Vitamin B Complex 100ml",
    description: "100ml vitamin booster bottle for livestock recovery and appetite support.",
    unit: "ml",
    packingUnit: "bottle",
    packingSize: 100,
    packPrice: 185,
    dealerPrice: 170,
    allowPackSale: false,
    packingStock: 15,
    stock: 24,
    minStock: 6,
    targets: ["Hog", "Chicken"],
    indications: ["Appetite Booster", "Immune Support"],
  },
  {
    category: "Medicines",
    brand: "GeneriVet",
    name: "Tylosin Solution 100ml",
    description: "100ml antibiotic solution for routine farm inventory.",
    unit: "ml",
    packingUnit: "bottle",
    packingSize: 100,
    packPrice: 315,
    dealerPrice: 292,
    allowPackSale: false,
    packingStock: 10,
    stock: 4,
    minStock: 4,
    targets: ["Hog", "Chicken"],
    indications: ["Antibiotic"],
  },
  {
    category: "Medicines",
    brand: "Virbac",
    name: "Amoxicillin Oral Suspension 60ml",
    description: "60ml oral antibiotic suspension for household pet and farm use.",
    unit: "ml",
    packingUnit: "bottle",
    packingSize: 60,
    packPrice: 168,
    dealerPrice: 152,
    allowPackSale: false,
    packingStock: 14,
    stock: 18,
    minStock: 6,
    targets: ["Dog", "Cat"],
    indications: ["Antibiotic"],
  },
  {
    category: "Medicines",
    brand: "Virbac",
    name: "Oxytetracycline LA 100ml",
    description: "100ml long-acting oxytetracycline bottle for common bacterial farm cases.",
    unit: "ml",
    packingUnit: "bottle",
    packingSize: 100,
    packPrice: 298,
    dealerPrice: 276,
    allowPackSale: false,
    packingStock: 8,
    stock: 10,
    minStock: 4,
    targets: ["Hog", "Chicken"],
    indications: ["Antibiotic"],
  },
  {
    category: "Medicines",
    brand: "Medilife",
    name: "Dextrose Powder 1kg",
    description: "1kg dextrose powder pack for recovery support during stress and transport.",
    unit: "kg",
    packingUnit: "pack",
    packingSize: 1,
    packPrice: 142,
    dealerPrice: 128,
    allowPackSale: false,
    packingStock: 10,
    stock: 12,
    minStock: 4,
    targets: ["Hog", "Chicken"],
    indications: ["Appetite Booster", "Immune Support"],
  },
  {
    category: "Pet Supplies",
    brand: "TopBreed",
    name: "TopBreed Adult Dog Food 20kg",
    description: "20kg dry dog food sack for repeat household buyers and breeders.",
    unit: "kg",
    packingUnit: "sack",
    packingSize: 20,
    packPrice: 1780,
    dealerPrice: 1715,
    allowPackSale: true,
    unitPrice: 89,
    packingStock: 5,
    stock: 120,
    minStock: 20,
    targets: ["Dog"],
    indications: ["Daily Feeding"],
  },
  {
    category: "Pet Supplies",
    brand: "Powercat",
    name: "Powercat Dry Cat Food 20kg",
    description: "20kg dry cat food sack for store resale and bulk household orders.",
    unit: "kg",
    packingUnit: "sack",
    packingSize: 20,
    packPrice: 1695,
    dealerPrice: 1630,
    allowPackSale: true,
    unitPrice: 84.75,
    packingStock: 4,
    stock: 100,
    minStock: 20,
    targets: ["Cat"],
    indications: ["Daily Feeding"],
  },
  {
    category: "Pet Supplies",
    brand: "Cosi",
    name: "Pet Shampoo 500ml",
    description: "500ml pet shampoo bottle for routine grooming inventory.",
    unit: "ml",
    packingUnit: "bottle",
    packingSize: 500,
    packPrice: 165,
    dealerPrice: 148,
    allowPackSale: false,
    packingStock: 10,
    stock: 22,
    minStock: 5,
    targets: ["Dog", "Cat"],
    indications: ["Coat Care", "Hygiene"],
  },
  {
    category: "Pet Supplies",
    brand: "Cature",
    name: "Cat Litter Crystals 10L",
    description: "10-liter cat litter crystals bag for monthly household use.",
    unit: "unit",
    packingUnit: "pack",
    packingSize: 1,
    packPrice: 320,
    dealerPrice: 295,
    allowPackSale: false,
    packingStock: 12,
    stock: 10,
    minStock: 4,
    targets: ["Cat"],
    indications: ["Litter Control"],
  },
  {
    category: "LPG",
    brand: "Petron Gasul",
    name: "Petron Gasul 11kg",
    description: "11kg household LPG cylinder refill priced within the March 2026 DOE range.",
    unit: "kg",
    packingUnit: "tank",
    packingSize: 11,
    packPrice: 1028,
    dealerPrice: 1008,
    allowPackSale: false,
    packingStock: 12,
    stock: 18,
    minStock: 4,
    targets: ["Others"],
    indications: ["Cooking"],
  },
  {
    category: "LPG",
    brand: "Solane",
    name: "Solane 11kg",
    description: "11kg household LPG cylinder refill for branded premium buyers.",
    unit: "kg",
    packingUnit: "tank",
    packingSize: 11,
    packPrice: 1065,
    dealerPrice: 1040,
    allowPackSale: false,
    packingStock: 10,
    stock: 14,
    minStock: 4,
    targets: ["Others"],
    indications: ["Cooking"],
  },
  {
    category: "LPG",
    brand: "Regasco",
    name: "Regasco 11kg",
    description: "11kg household LPG cylinder refill for repeat neighborhood delivery sales.",
    unit: "kg",
    packingUnit: "tank",
    packingSize: 11,
    packPrice: 965,
    dealerPrice: 945,
    allowPackSale: false,
    packingStock: 10,
    stock: 3,
    minStock: 3,
    targets: ["Others"],
    indications: ["Cooking"],
  },
  {
    category: "LPG",
    brand: "Fiesta",
    name: "Fiesta Gas 11kg",
    description: "11kg LPG refill kept as value-priced household option.",
    unit: "kg",
    packingUnit: "tank",
    packingSize: 11,
    packPrice: 918,
    dealerPrice: 898,
    allowPackSale: false,
    packingStock: 8,
    stock: 0,
    minStock: 2,
    targets: ["Others"],
    indications: ["Cooking"],
  },
  {
    category: "LPG",
    brand: "Solane",
    name: "Solane 22kg",
    description: "22kg household and small eatery LPG refill for higher-volume repeat buyers.",
    unit: "kg",
    packingUnit: "tank",
    packingSize: 22,
    packPrice: 2135,
    dealerPrice: 2090,
    allowPackSale: false,
    packingStock: 4,
    stock: 5,
    minStock: 2,
    targets: ["Others"],
    indications: ["Cooking"],
  },
  {
    category: "LPG",
    brand: "Regasco",
    name: "Regasco 22kg",
    description: "22kg LPG refill positioned for sari-sari stores and small food stalls.",
    unit: "kg",
    packingUnit: "tank",
    packingSize: 22,
    packPrice: 1945,
    dealerPrice: 1905,
    allowPackSale: false,
    packingStock: 4,
    stock: 4,
    minStock: 2,
    targets: ["Others"],
    indications: ["Cooking"],
  },
  {
    category: "LPG",
    brand: "Solane",
    name: "LPG Regulator Set",
    description: "Replacement household regulator set for refill installation and safety swaps.",
    unit: "unit",
    packingUnit: "unit",
    packingSize: 1,
    packPrice: 385,
    dealerPrice: 345,
    allowPackSale: false,
    packingStock: 14,
    stock: 14,
    minStock: 4,
    targets: ["Others"],
    indications: ["Cooking"],
  },
  {
    category: "LPG",
    brand: "Regasco",
    name: "High Pressure LPG Hose 2m",
    description: "2-meter LPG hose replacement kept for home service and new regulator installs.",
    unit: "unit",
    packingUnit: "unit",
    packingSize: 1,
    packPrice: 145,
    dealerPrice: 126,
    allowPackSale: false,
    packingStock: 12,
    stock: 10,
    minStock: 3,
    targets: ["Others"],
    indications: ["Cooking"],
  },
  {
    category: "Rices & Grains",
    brand: "Well-Milled",
    name: "Well-Milled Rice 50kg",
    description: "50kg well-milled rice sack for everyday household consumption.",
    unit: "kg",
    packingUnit: "sack",
    packingSize: 50,
    packPrice: 2290,
    dealerPrice: 2210,
    allowPackSale: true,
    unitPrice: 45.8,
    packingStock: 6,
    stock: 300,
    minStock: 100,
    targets: ["Human"],
    indications: ["Daily Consumption"],
  },
  {
    category: "Rices & Grains",
    brand: "Sinandomeng",
    name: "Sinandomeng Rice 50kg",
    description: "50kg Sinandomeng rice sack positioned for mid-range walk-in buyers.",
    unit: "kg",
    packingUnit: "sack",
    packingSize: 50,
    packPrice: 2390,
    dealerPrice: 2310,
    allowPackSale: true,
    unitPrice: 47.8,
    packingStock: 7,
    stock: 350,
    minStock: 100,
    targets: ["Human"],
    indications: ["Daily Consumption"],
  },
  {
    category: "Rices & Grains",
    brand: "Dinorado",
    name: "Dinorado Rice 25kg",
    description: "25kg aromatic rice sack for premium home buyers.",
    unit: "kg",
    packingUnit: "sack",
    packingSize: 25,
    packPrice: 1525,
    dealerPrice: 1470,
    allowPackSale: true,
    unitPrice: 61,
    packingStock: 5,
    stock: 125,
    minStock: 50,
    targets: ["Human"],
    indications: ["Premium Grain"],
  },
  {
    category: "Rices & Grains",
    brand: "Jasmine",
    name: "Jasmine Rice 25kg",
    description: "25kg premium jasmine rice sack for store and household orders.",
    unit: "kg",
    packingUnit: "sack",
    packingSize: 25,
    packPrice: 1490,
    dealerPrice: 1435,
    allowPackSale: true,
    unitPrice: 59.6,
    packingStock: 5,
    stock: 125,
    minStock: 50,
    targets: ["Human"],
    indications: ["Premium Grain"],
  },
  {
    category: "Agriculture Products",
    brand: "Yara",
    name: "Urea Fertilizer 46-0-0 50kg",
    description: "50kg urea fertilizer sack aligned with Region I public fertilizer pricing.",
    unit: "kg",
    packingUnit: "sack",
    packingSize: 50,
    packPrice: 1650,
    dealerPrice: 1605,
    allowPackSale: false,
    packingStock: 8,
    stock: 18,
    minStock: 4,
    targets: ["Plants", "Rice", "Corn"],
    indications: ["Fertilizer"],
  },
  {
    category: "Agriculture Products",
    brand: "Atlas",
    name: "Complete Fertilizer 14-14-14 50kg",
    description: "50kg complete fertilizer sack for vegetable and palay production.",
    unit: "kg",
    packingUnit: "sack",
    packingSize: 50,
    packPrice: 1580,
    dealerPrice: 1535,
    allowPackSale: false,
    packingStock: 8,
    stock: 12,
    minStock: 4,
    targets: ["Plants", "Rice", "Corn"],
    indications: ["Fertilizer"],
  },
  {
    category: "Agriculture Products",
    brand: "Atlas",
    name: "Ammosul 21-0-0 50kg",
    description: "50kg ammonium sulfate fertilizer sack for regular field replenishment.",
    unit: "kg",
    packingUnit: "sack",
    packingSize: 50,
    packPrice: 870,
    dealerPrice: 835,
    allowPackSale: false,
    packingStock: 6,
    stock: 6,
    minStock: 3,
    targets: ["Plants", "Rice", "Corn"],
    indications: ["Fertilizer"],
  },
  {
    category: "Agriculture Products",
    brand: "Bio-N",
    name: "Organic Foliar Spray 1L",
    description: "1-liter foliar feed bottle for vegetable and backyard farm use.",
    unit: "liter",
    packingUnit: "bottle",
    packingSize: 1,
    packPrice: 265,
    dealerPrice: 245,
    allowPackSale: false,
    packingStock: 12,
    stock: 20,
    minStock: 5,
    targets: ["Plants"],
    indications: ["Foliar Feed", "Soil Health"],
  },
  {
    category: "Agriculture Products",
    brand: "Crop Giant",
    name: "Carbaryl Insecticide 1L",
    description: "1-liter insecticide bottle for common field and backyard pest issues.",
    unit: "liter",
    packingUnit: "bottle",
    packingSize: 1,
    packPrice: 345,
    dealerPrice: 320,
    allowPackSale: false,
    packingStock: 10,
    stock: 3,
    minStock: 3,
    targets: ["Plants"],
    indications: ["Pest Control"],
  },
  {
    category: "Agriculture Products",
    brand: "Crop Giant",
    name: "Glyphosate Herbicide 1L",
    description: "1-liter glyphosate herbicide bottle for grass control around field edges and pathways.",
    unit: "liter",
    packingUnit: "bottle",
    packingSize: 1,
    packPrice: 438,
    dealerPrice: 405,
    allowPackSale: false,
    packingStock: 8,
    stock: 16,
    minStock: 4,
    targets: ["Plants"],
    indications: ["Pest Control"],
  },
  {
    category: "Agriculture Products",
    brand: "Yara",
    name: "Muriate of Potash 0-0-60 50kg",
    description: "50kg potash fertilizer sack for fruiting-stage support and balanced nutrient programs.",
    unit: "kg",
    packingUnit: "sack",
    packingSize: 50,
    packPrice: 1785,
    dealerPrice: 1735,
    allowPackSale: false,
    packingStock: 6,
    stock: 8,
    minStock: 3,
    targets: ["Plants", "Rice", "Corn"],
    indications: ["Fertilizer"],
  },
  {
    category: "Equipment",
    brand: "Ingco",
    name: "Knapsack Sprayer 16L",
    description: "16-liter knapsack sprayer for fertilizer and pesticide field application.",
    unit: "unit",
    packingUnit: "unit",
    packingSize: 1,
    packPrice: 980,
    dealerPrice: 930,
    allowPackSale: false,
    packingStock: 5,
    stock: 7,
    minStock: 2,
    targets: ["Plants"],
    indications: ["Spraying", "Daily Farm Use"],
  },
  {
    category: "Equipment",
    brand: "Lotus",
    name: "Watering Can 8L",
    description: "8-liter watering can for seedling and backyard garden care.",
    unit: "unit",
    packingUnit: "unit",
    packingSize: 1,
    packPrice: 210,
    dealerPrice: 190,
    allowPackSale: false,
    packingStock: 8,
    stock: 14,
    minStock: 4,
    targets: ["Plants"],
    indications: ["Daily Farm Use"],
  },
  {
    category: "Equipment",
    brand: "Truper",
    name: "Bolo 18in",
    description: "18-inch bolo for routine clearing and farm work.",
    unit: "unit",
    packingUnit: "unit",
    packingSize: 1,
    packPrice: 325,
    dealerPrice: 295,
    allowPackSale: false,
    packingStock: 6,
    stock: 9,
    minStock: 2,
    targets: ["Others"],
    indications: ["Harvest Support", "Daily Farm Use"],
  },
  {
    category: "Equipment",
    brand: "Generic",
    name: "Plastic Feeder 10kg",
    description: "10kg plastic feeder for poultry and small livestock use.",
    unit: "unit",
    packingUnit: "unit",
    packingSize: 1,
    packPrice: 185,
    dealerPrice: 165,
    allowPackSale: false,
    packingStock: 10,
    stock: 18,
    minStock: 4,
    targets: ["Others"],
    indications: ["Daily Farm Use"],
  },
  {
    category: "Equipment",
    brand: "Truper",
    name: "Round Shovel",
    description: "Round shovel for soil turning, fertilizer loading, and rice warehouse handling.",
    unit: "unit",
    packingUnit: "unit",
    packingSize: 1,
    packPrice: 365,
    dealerPrice: 332,
    allowPackSale: false,
    packingStock: 6,
    stock: 2,
    minStock: 2,
    targets: ["Plants", "Others"],
    indications: ["Daily Farm Use", "Harvest Support"],
  },
  {
    category: "Equipment",
    brand: "Ingco",
    name: "Hand Sprayer 2L",
    description: "2-liter hand sprayer for garden foliar feed and backyard pest-control work.",
    unit: "unit",
    packingUnit: "unit",
    packingSize: 1,
    packPrice: 245,
    dealerPrice: 218,
    allowPackSale: false,
    packingStock: 10,
    stock: 11,
    minStock: 3,
    targets: ["Plants"],
    indications: ["Spraying", "Daily Farm Use"],
  },
  {
    category: "Binhi (Seeds)",
    brand: "East-West Seed",
    name: "Hybrid Tomato Seeds 10g",
    description: "10g hybrid tomato seed sachet for backyard and market gardening.",
    unit: "gram",
    packingUnit: "sachet",
    packingSize: 10,
    packPrice: 145,
    dealerPrice: 132,
    allowPackSale: false,
    packingStock: 20,
    stock: 48,
    minStock: 10,
    targets: ["Plants"],
    indications: ["High Yield", "Disease Resistance"],
  },
  {
    category: "Binhi (Seeds)",
    brand: "East-West Seed",
    name: "Ampalaya F1 Seeds 10g",
    description: "10g ampalaya F1 seed sachet for vegetable growers.",
    unit: "gram",
    packingUnit: "sachet",
    packingSize: 10,
    packPrice: 198,
    dealerPrice: 182,
    allowPackSale: false,
    packingStock: 20,
    stock: 34,
    minStock: 8,
    targets: ["Plants"],
    indications: ["High Yield", "Heat Tolerant"],
  },
  {
    category: "Binhi (Seeds)",
    brand: "Ramgo",
    name: "Sweet Corn Seeds 250g",
    description: "250g sweet corn seed pack for small farm planting cycles.",
    unit: "gram",
    packingUnit: "pack",
    packingSize: 250,
    packPrice: 215,
    dealerPrice: 198,
    allowPackSale: false,
    packingStock: 18,
    stock: 26,
    minStock: 6,
    targets: ["Corn"],
    indications: ["High Yield", "Early Maturity"],
  },
  {
    category: "Binhi (Seeds)",
    brand: "Condor",
    name: "Okra Seeds 100g",
    description: "100g okra seed pack for direct field sowing.",
    unit: "gram",
    packingUnit: "pack",
    packingSize: 100,
    packPrice: 85,
    dealerPrice: 76,
    allowPackSale: false,
    packingStock: 18,
    stock: 18,
    minStock: 5,
    targets: ["Plants"],
    indications: ["Early Maturity"],
  },
  {
    category: "Binhi (Seeds)",
    brand: "Known-You",
    name: "Eggplant Black Beauty Seeds 25g",
    description: "25g eggplant seed pack for vegetable growers and home gardens.",
    unit: "gram",
    packingUnit: "sachet",
    packingSize: 25,
    packPrice: 125,
    dealerPrice: 112,
    allowPackSale: false,
    packingStock: 15,
    stock: 12,
    minStock: 5,
    targets: ["Eggplants"],
    indications: ["Disease Resistance"],
  },
  {
    category: "Binhi (Seeds)",
    brand: "PhilRice",
    name: "RC 160 Certified Rice Seeds 20kg",
    description: "20kg certified rice seed bag for palay growers around Asingan.",
    unit: "kg",
    packingUnit: "sack",
    packingSize: 20,
    packPrice: 1280,
    dealerPrice: 1235,
    allowPackSale: false,
    packingStock: 10,
    stock: 3,
    minStock: 3,
    targets: ["Rice"],
    indications: ["High Yield", "Early Maturity"],
  },
  {
    category: "Binhi (Seeds)",
    brand: "PhilRice",
    name: "RC 216 Certified Rice Seeds 20kg",
    description: "20kg certified rice seed bag suited for irrigated planting schedules.",
    unit: "kg",
    packingUnit: "sack",
    packingSize: 20,
    packPrice: 1320,
    dealerPrice: 1270,
    allowPackSale: false,
    packingStock: 8,
    stock: 0,
    minStock: 2,
    targets: ["Rice"],
    indications: ["High Yield", "Disease Resistance"],
  },
  {
    category: "Binhi (Seeds)",
    brand: "East-West Seed",
    name: "Pechay Seeds 25g",
    description: "25g pechay seed sachet for fast-turn backyard and market-garden planting.",
    unit: "gram",
    packingUnit: "sachet",
    packingSize: 25,
    packPrice: 92,
    dealerPrice: 82,
    allowPackSale: false,
    packingStock: 18,
    stock: 40,
    minStock: 8,
    targets: ["Plants"],
    indications: ["Early Maturity", "High Yield"],
  },
  {
    category: "Binhi (Seeds)",
    brand: "Ramgo",
    name: "Mustasa Seeds 25g",
    description: "25g mustard greens seed pack for quick local vegetable cycles.",
    unit: "gram",
    packingUnit: "sachet",
    packingSize: 25,
    packPrice: 78,
    dealerPrice: 68,
    allowPackSale: false,
    packingStock: 18,
    stock: 38,
    minStock: 8,
    targets: ["Plants"],
    indications: ["Early Maturity", "Heat Tolerant"],
  },
  {
    category: "Binhi (Seeds)",
    brand: "Condor",
    name: "Sitaw Seeds 100g",
    description: "100g sitaw seed pack for household and small-farm trellis planting.",
    unit: "gram",
    packingUnit: "pack",
    packingSize: 100,
    packPrice: 118,
    dealerPrice: 104,
    allowPackSale: false,
    packingStock: 14,
    stock: 24,
    minStock: 6,
    targets: ["Plants"],
    indications: ["High Yield", "Heat Tolerant"],
  },
];

const ASINGAN_CUSTOMERS: SeedCustomerFixture[] = [
  {
    alias: "Neri Poultry Supply",
    firstName: "Nerissa",
    lastName: "Mendoza",
    phone: "09180000501",
    email: "nerissa.mendoza@example.com",
    notes: "Feeds and poultry supplies repeat account.",
    addr: {
      label: "Store",
      line1: "M. H. Del Pilar St.",
      barangay: "Poblacion West",
      city: "Asingan",
      province: "Pangasinan",
      postalCode: ZIP_BY_MUNI["Asingan"],
      purok: "Purok 1",
      landmark: "Asingan Public Market",
      geoLat: 16.009,
      geoLng: 120.669,
    },
  },
  {
    alias: "Bautista Household",
    firstName: "Joel",
    lastName: "Bautista",
    phone: "09180000502",
    email: "joel.bautista@example.com",
    notes: "Usually books rice and LPG together.",
    addr: {
      label: "Home",
      line1: "Mabini St.",
      barangay: "Poblacion East",
      city: "Asingan",
      province: "Pangasinan",
      postalCode: ZIP_BY_MUNI["Asingan"],
      purok: "Purok 1",
      landmark: "Asingan Town Plaza",
      geoLat: 16.011,
      geoLng: 120.67,
    },
  },
  {
    alias: "J. Flores Farm",
    firstName: "Jasper",
    lastName: "Flores",
    phone: "09180000503",
    email: "jasper.flores@example.com",
    notes: "Field orders are usually fertilizer and seed combos.",
    addr: {
      label: "Farm",
      line1: "Sitio Centro",
      barangay: "Carosucan Norte",
      city: "Asingan",
      province: "Pangasinan",
      postalCode: ZIP_BY_MUNI["Asingan"],
      purok: "Purok 2",
      landmark: "Carosucan Norte Trike Terminal",
      geoLat: 16.02,
      geoLng: 120.653,
    },
  },
  {
    alias: "San Vicente East Home",
    firstName: "Marlon",
    lastName: "Castro",
    phone: "09180000504",
    email: "marlon.castro@example.com",
    notes: "Regular LPG buyer for household use.",
    addr: {
      label: "Home",
      line1: "Purok Uno",
      barangay: "San Vicente East",
      city: "Asingan",
      province: "Pangasinan",
      postalCode: ZIP_BY_MUNI["Asingan"],
      purok: "Purok 1",
      landmark: "Near barangay hall",
      geoLat: 16.018,
      geoLng: 120.676,
    },
  },
  {
    alias: "Westside Rice Buyer",
    firstName: "Cynthia",
    lastName: "Labrador",
    phone: "09180000505",
    email: "cynthia.labrador@example.com",
    notes: "Buys rice by sack every payout week.",
    addr: {
      label: "Home",
      line1: "Rizal Ave.",
      barangay: "San Vicente West",
      city: "Asingan",
      province: "Pangasinan",
      postalCode: ZIP_BY_MUNI["Asingan"],
      purok: "Purok 2",
      landmark: "Near chapel",
      geoLat: 16.017,
      geoLng: 120.664,
    },
  },
  {
    alias: "Macalong Backyard Farm",
    firstName: "Edgar",
    lastName: "Rivera",
    phone: "09180000506",
    email: "edgar.rivera@example.com",
    notes: "Orders feeds and dewormer for small livestock.",
    addr: {
      label: "Farm",
      line1: "Sitio Proper",
      barangay: "Macalong",
      city: "Asingan",
      province: "Pangasinan",
      postalCode: ZIP_BY_MUNI["Asingan"],
      purok: "Purok 1",
      landmark: "Near covered court",
      geoLat: 16.025,
      geoLng: 120.651,
    },
  },
  {
    alias: "Domanpot Residence",
    firstName: "Aileen",
    lastName: "Soriano",
    phone: "09180000507",
    email: "aileen.soriano@example.com",
    notes: "Prefers morning delivery window.",
    addr: {
      label: "Home",
      line1: "Quezon St.",
      barangay: "Domanpot",
      city: "Asingan",
      province: "Pangasinan",
      postalCode: ZIP_BY_MUNI["Asingan"],
      purok: "Purok 1",
      landmark: "Near elementary school",
      geoLat: 16.004,
      geoLng: 120.648,
    },
  },
  {
    alias: "Bobonan Store",
    firstName: "Karen",
    lastName: "Uy",
    phone: "09180000508",
    email: "karen.uy@example.com",
    notes: "Mixed basket orders for sari-sari replenishment.",
    addr: {
      label: "Store",
      line1: "National Road",
      barangay: "Bobonan",
      city: "Asingan",
      province: "Pangasinan",
      postalCode: ZIP_BY_MUNI["Asingan"],
      purok: "Purok 2",
      landmark: "Near tricycle terminal",
      geoLat: 16.002,
      geoLng: 120.661,
    },
  },
  {
    alias: "Sobol LPG Suki",
    firstName: "Lorna",
    lastName: "Apostol",
    phone: "09180000509",
    email: "lorna.apostol@example.com",
    notes: "Household LPG refill customer.",
    addr: {
      label: "Home",
      line1: "Purok Dos",
      barangay: "Sobol",
      city: "Asingan",
      province: "Pangasinan",
      postalCode: ZIP_BY_MUNI["Asingan"],
      purok: "Purok 2",
      landmark: "Near waiting shed",
      geoLat: 16.028,
      geoLng: 120.658,
    },
  },
  {
    alias: "Cabalitian Hog Raiser",
    firstName: "Rodel",
    lastName: "Manalo",
    phone: "09180000510",
    email: "rodel.manalo@example.com",
    notes: "Monthly feeds and livestock medicine account.",
    addr: {
      label: "Farm",
      line1: "Sitio Ilaya",
      barangay: "Cabalitian",
      city: "Asingan",
      province: "Pangasinan",
      postalCode: ZIP_BY_MUNI["Asingan"],
      purok: "Purok 3",
      landmark: "Near barangay health station",
      geoLat: 16.03,
      geoLng: 120.67,
    },
  },
  {
    alias: "Bantog Variety Store",
    firstName: "Sharon",
    lastName: "Velasco",
    phone: "09180000511",
    email: "sharon.velasco@example.com",
    notes: "Buys pet supplies and rice weekly.",
    addr: {
      label: "Store",
      line1: "Purok Uno",
      barangay: "Bantog",
      city: "Asingan",
      province: "Pangasinan",
      postalCode: ZIP_BY_MUNI["Asingan"],
      purok: "Purok 1",
      landmark: "Near basketball court",
      geoLat: 16.022,
      geoLng: 120.642,
    },
  },
  {
    alias: "Coldit Family Home",
    firstName: "Paolo",
    lastName: "Sarmiento",
    phone: "09180000512",
    email: "paolo.sarmiento@example.com",
    notes: "Occasional fertilizer and seed pickup customer.",
    addr: {
      label: "Home",
      line1: "Sitio Centro",
      barangay: "Coldit",
      city: "Asingan",
      province: "Pangasinan",
      postalCode: ZIP_BY_MUNI["Asingan"],
      purok: "Purok 2",
      landmark: "Near barangay hall",
      geoLat: 16.026,
      geoLng: 120.646,
    },
  },
];

const SEEDED_RIDERS: SeedEmployeeFixture[] = [
  {
    firstName: "Noel",
    middleName: "B.",
    lastName: "Villanueva",
    alias: "Noel",
    phone: "09170000101",
    email: "noel.villanueva@example.com",
    role: EmployeeRole.RIDER,
    birthDate: "1991-04-12",
    sssNumber: "34-1000101-3",
    pagIbigNumber: "1001-0001-0101",
    licenseNumber: "N01-91-456782",
    licenseExpiry: "2028-06-30",
    defaultVehicleKey: "Asingan Delivery Trike 01:TRICYCLE",
    address: {
      line1: "Mabini St.",
      barangay: "Poblacion East",
      city: "Asingan",
      province: "Pangasinan",
      postalCode: ZIP_BY_MUNI["Asingan"],
      purok: "Purok 1",
      landmark: "Asingan Town Plaza",
      geoLat: 16.011,
      geoLng: 120.67,
    },
  },
  {
    firstName: "Arvin",
    middleName: "S.",
    lastName: "Guzman",
    alias: "Arvin",
    phone: "09170000102",
    email: "arvin.guzman@example.com",
    role: EmployeeRole.RIDER,
    birthDate: "1989-09-03",
    sssNumber: "34-1000102-1",
    pagIbigNumber: "1001-0001-0102",
    licenseNumber: "N02-89-781245",
    licenseExpiry: "2029-02-15",
    defaultVehicleKey: "Asingan Delivery Motor 01:MOTORCYCLE",
    address: {
      line1: "Quezon Ave.",
      barangay: "San Vicente West",
      city: "Asingan",
      province: "Pangasinan",
      postalCode: ZIP_BY_MUNI["Asingan"],
      purok: "Purok 2",
      landmark: "Near chapel",
      geoLat: 16.018,
      geoLng: 120.664,
    },
  },
  {
    firstName: "Jayson",
    middleName: "M.",
    lastName: "Ferrer",
    alias: "Jayson",
    phone: "09170000103",
    email: "jayson.ferrer@example.com",
    role: EmployeeRole.RIDER,
    birthDate: "1994-01-18",
    sssNumber: "34-1000103-9",
    pagIbigNumber: "1001-0001-0103",
    licenseNumber: "N03-94-223641",
    licenseExpiry: "2028-11-20",
    defaultVehicleKey: "Asingan Utility Sidecar 01:SIDECAR",
    address: {
      line1: "Sitio Centro",
      barangay: "Carosucan Norte",
      city: "Asingan",
      province: "Pangasinan",
      postalCode: ZIP_BY_MUNI["Asingan"],
      purok: "Purok 2",
      landmark: "Carosucan Norte Trike Terminal",
      geoLat: 16.02,
      geoLng: 120.653,
    },
  },
];

const SEEDED_MANAGERS: SeedEmployeeFixture[] = [
  {
    firstName: "Sheila",
    middleName: "R.",
    lastName: "Manalo",
    alias: "Sheila",
    phone: "09170000111",
    email: "sheila.manalo@example.com",
    role: EmployeeRole.MANAGER,
    birthDate: "1987-06-21",
    sssNumber: "34-1000111-6",
    pagIbigNumber: "1001-0001-0111",
    address: {
      line1: "M. H. Del Pilar St.",
      barangay: "Poblacion West",
      city: "Asingan",
      province: "Pangasinan",
      postalCode: ZIP_BY_MUNI["Asingan"],
      purok: "Purok 1",
      landmark: "Asingan Public Market",
      geoLat: 16.009,
      geoLng: 120.669,
    },
  },
  {
    firstName: "Rowena",
    middleName: "C.",
    lastName: "Delos Reyes",
    alias: "Weng",
    phone: "09170000112",
    email: "rowena.delosreyes@example.com",
    role: EmployeeRole.MANAGER,
    birthDate: "1985-11-07",
    sssNumber: "34-1000112-4",
    pagIbigNumber: "1001-0001-0112",
    address: {
      line1: "Rizal Ave.",
      barangay: "San Vicente East",
      city: "Asingan",
      province: "Pangasinan",
      postalCode: ZIP_BY_MUNI["Asingan"],
      purok: "Purok 1",
      landmark: "Near barangay hall",
      geoLat: 16.018,
      geoLng: 120.676,
    },
  },
];

const SEEDED_CASHIERS: SeedEmployeeFixture[] = [
  {
    firstName: "Maricel",
    middleName: "A.",
    lastName: "Aquino",
    alias: "Cely",
    phone: "09170000121",
    email: "maricel.aquino@example.com",
    role: EmployeeRole.STAFF,
    birthDate: "1993-08-14",
    sssNumber: "34-1000121-1",
    pagIbigNumber: "1001-0001-0121",
    address: {
      line1: "Purok Uno",
      barangay: "Bantog",
      city: "Asingan",
      province: "Pangasinan",
      postalCode: ZIP_BY_MUNI["Asingan"],
      purok: "Purok 1",
      landmark: "Near basketball court",
      geoLat: 16.022,
      geoLng: 120.642,
    },
  },
  {
    firstName: "Paolo",
    middleName: "L.",
    lastName: "Ramos",
    alias: "Pao",
    phone: "09170000122",
    email: "paolo.ramos@example.com",
    role: EmployeeRole.STAFF,
    birthDate: "1996-02-26",
    sssNumber: "34-1000122-9",
    pagIbigNumber: "1001-0001-0122",
    address: {
      line1: "Quezon St.",
      barangay: "Domanpot",
      city: "Asingan",
      province: "Pangasinan",
      postalCode: ZIP_BY_MUNI["Asingan"],
      purok: "Purok 1",
      landmark: "Near elementary school",
      geoLat: 16.004,
      geoLng: 120.648,
    },
  },
];

// ─────────────────────────────────────────
// 2️⃣ Helpers
// ─────────────────────────────────────────
function createSeedBarcode(index: number) {
  return `480${String(100000000 + index).padStart(9, "0")}`;
}

function requireValue<T>(value: T | null | undefined, message: string): T {
  if (value == null) throw new Error(message);
  return value;
}

function toDateOnly(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function startOfCurrentMonth(reference: Date) {
  return new Date(reference.getFullYear(), reference.getMonth(), 1);
}

function addDays(reference: Date, days: number) {
  const next = new Date(reference);
  next.setDate(next.getDate() + days);
  return next;
}

function addHours(reference: Date, hours: number) {
  return new Date(reference.getTime() + hours * 60 * 60 * 1000);
}

function addYears(reference: Date, years: number) {
  const next = new Date(reference);
  next.setFullYear(next.getFullYear() + years);
  return next;
}

function startOfNextWeek(reference: Date) {
  const base = toDateOnly(reference);
  const day = base.getDay();
  const daysUntilMonday = ((8 - day) % 7) || 7;
  return addDays(base, daysUntilMonday);
}

function buildTemplateDays(args: {
  dayOfWeeks: WorkerScheduleTemplateDayOfWeek[];
  startMinute: number;
  endMinute: number;
  note: string;
}) {
  return args.dayOfWeeks.map((dayOfWeek) => ({
    dayOfWeek,
    startMinute: args.startMinute,
    endMinute: args.endMinute,
    note: args.note,
  }));
}

function slugifySeedEmployeeDocumentKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatSeedPersonLabel(args: {
  alias?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}) {
  return (
    args.alias?.trim() ||
    [args.firstName, args.lastName].filter(Boolean).join(" ").trim() ||
    "Seed User"
  );
}

function pickSeedOrderUnitPrice(product: {
  price?: number | string | { toString(): string } | null;
  srp?: number | string | { toString(): string } | null;
}) {
  const srp = Number(product.srp ?? 0);
  if (Number.isFinite(srp) && srp > 0) return Math.round(srp * 100) / 100;

  const price = Number(product.price ?? 0);
  if (Number.isFinite(price) && price > 0) return Math.round(price * 100) / 100;

  return 1;
}

function buildSeedEmployeeDocumentRows(args: {
  employeeId: number;
  employeeSeed: SeedEmployeeFixture;
  uploadedById: number;
}) {
  const slugBase = slugifySeedEmployeeDocumentKey(
    `${args.employeeSeed.firstName}-${args.employeeSeed.lastName}`,
  );

  const baseRows: Array<{
    docType: EmployeeDocumentType;
    extension: "jpg" | "pdf";
    mimeType: "image/jpeg" | "application/pdf";
    sizeBytes: number;
    expiresAt?: Date | null;
    notes: string;
  }> = [
    {
      docType: EmployeeDocumentType.VALID_ID,
      extension: "jpg",
      mimeType: "image/jpeg",
      sizeBytes: 248_000,
      notes: "Seeded sample front ID capture metadata.",
    },
    {
      docType: EmployeeDocumentType.BARANGAY_CLEARANCE,
      extension: "pdf",
      mimeType: "application/pdf",
      sizeBytes: 186_000,
      notes: "Seeded barangay clearance metadata for compliance demos.",
    },
    {
      docType: EmployeeDocumentType.PHOTO_2X2,
      extension: "jpg",
      mimeType: "image/jpeg",
      sizeBytes: 96_000,
      notes: "Seeded 2x2 employee photo metadata placeholder.",
    },
  ];

  if (args.employeeSeed.licenseNumber) {
    baseRows.push({
      docType: EmployeeDocumentType.DRIVER_LICENSE_SCAN,
      extension: "jpg",
      mimeType: "image/jpeg",
      sizeBytes: 214_000,
      expiresAt: args.employeeSeed.licenseExpiry
        ? new Date(args.employeeSeed.licenseExpiry)
        : addYears(new Date(), 2),
      notes: "Seeded driver license scan metadata for rider compliance demos.",
    });
  } else if (args.employeeSeed.role === EmployeeRole.MANAGER) {
    baseRows.push({
      docType: EmployeeDocumentType.NBI_CLEARANCE,
      extension: "pdf",
      mimeType: "application/pdf",
      sizeBytes: 202_000,
      notes: "Seeded NBI clearance metadata for manager compliance demos.",
    });
  } else {
    baseRows.push({
      docType: EmployeeDocumentType.POLICE_CLEARANCE,
      extension: "pdf",
      mimeType: "application/pdf",
      sizeBytes: 198_000,
      notes: "Seeded police clearance metadata for store staff compliance demos.",
    });
  }

  return baseRows.map((row) => {
    const docSlug = slugifySeedEmployeeDocumentKey(row.docType);
    const fileName = `${docSlug}.${row.extension}`;
    const fileKey = `seed/employee-documents/${slugBase}/${fileName}`;

    return {
      employeeId: args.employeeId,
      docType: row.docType,
      fileKey,
      fileUrl: `https://seed.local/${fileKey}`,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      expiresAt: row.expiresAt ?? null,
      uploadedById: args.uploadedById,
      notes: row.notes,
    };
  });
}

async function seedEmployeeDocumentBaseline(args: {
  actorUserId: number;
  seededEmployees: SeededEmployeeRecord[];
}) {
  const documentRows = args.seededEmployees.flatMap((employee) =>
    buildSeedEmployeeDocumentRows({
      employeeId: employee.id,
      employeeSeed: employee.seed,
      uploadedById: args.actorUserId,
    }),
  );

  if (documentRows.length === 0) {
    return;
  }

  await db.employeeDocument.createMany({
    data: documentRows,
  });
}

async function seedDeliveryTransactionBaseline(args: {
  adminUserId: number;
  cashierUserId: number | null;
  riderUserId: number | null;
  riderEmployee: SeededEmployeeRecord | null;
  riderVehicleId: number | null;
  riderVehicleName: string | null;
}) {
  if (!args.riderEmployee) {
    return;
  }

  const [queueProduct, activeProduct, deliveredProduct, failedProduct] =
    await Promise.all([
      db.product.findFirst({
        where: { name: "Hog Grower Pellets", isActive: true },
        select: { id: true, name: true, price: true, srp: true },
      }),
      db.product.findFirst({
        where: { name: "Petron Gasul 11kg", isActive: true },
        select: { id: true, name: true, price: true, srp: true },
      }),
      db.product.findFirst({
        where: { name: "Well-Milled Rice 50kg", isActive: true },
        select: { id: true, name: true, price: true, srp: true },
      }),
      db.product.findFirst({
        where: { name: "Fiesta Gas 11kg", isActive: true },
        select: { id: true, name: true, price: true, srp: true },
      }),
    ]);

  const [queueCustomer, activeCustomer, deliveredCustomer, failedCustomer] =
    await Promise.all([
      db.customer.findFirst({
        where: { alias: "Neri Poultry Supply" },
        include: { addresses: { orderBy: { id: "asc" }, take: 1 } },
      }),
      db.customer.findFirst({
        where: { alias: "Bautista Household" },
        include: { addresses: { orderBy: { id: "asc" }, take: 1 } },
      }),
      db.customer.findFirst({
        where: { alias: "Westside Rice Buyer" },
        include: { addresses: { orderBy: { id: "asc" }, take: 1 } },
      }),
      db.customer.findFirst({
        where: { alias: "Sobol LPG Suki" },
        include: { addresses: { orderBy: { id: "asc" }, take: 1 } },
      }),
    ]);

  const resolvedQueueProduct = requireValue(
    queueProduct,
    "Missing seeded queue product for delivery transaction baseline.",
  );
  const resolvedActiveProduct = requireValue(
    activeProduct,
    "Missing seeded active-run product for delivery transaction baseline.",
  );
  const resolvedDeliveredProduct = requireValue(
    deliveredProduct,
    "Missing seeded delivered-order product for delivery transaction baseline.",
  );
  const resolvedFailedProduct = requireValue(
    failedProduct,
    "Missing seeded failed-order product for delivery transaction baseline.",
  );
  const resolvedQueueCustomer = requireValue(
    queueCustomer,
    "Missing seeded queue customer for delivery transaction baseline.",
  );
  const resolvedActiveCustomer = requireValue(
    activeCustomer,
    "Missing seeded active customer for delivery transaction baseline.",
  );
  const resolvedDeliveredCustomer = requireValue(
    deliveredCustomer,
    "Missing seeded delivered customer for delivery transaction baseline.",
  );
  const resolvedFailedCustomer = requireValue(
    failedCustomer,
    "Missing seeded failed customer for delivery transaction baseline.",
  );

  const queueAddress = requireValue(
    resolvedQueueCustomer.addresses[0],
    "Missing seeded queue customer address for delivery transaction baseline.",
  );
  const activeAddress = requireValue(
    resolvedActiveCustomer.addresses[0],
    "Missing seeded active customer address for delivery transaction baseline.",
  );
  const deliveredAddress = requireValue(
    resolvedDeliveredCustomer.addresses[0],
    "Missing seeded delivered customer address for delivery transaction baseline.",
  );
  const failedAddress = requireValue(
    resolvedFailedCustomer.addresses[0],
    "Missing seeded failed customer address for delivery transaction baseline.",
  );

  const actorUserId = args.cashierUserId ?? args.adminUserId;
  const actorUserRole =
    args.cashierUserId != null ? UserRole.CASHIER : UserRole.ADMIN;
  const riderLabel = formatSeedPersonLabel({
    alias: args.riderEmployee.seed.alias ?? null,
    firstName: args.riderEmployee.seed.firstName,
    lastName: args.riderEmployee.seed.lastName,
  });
  const traceId = "SEED-DELIVERY-BASELINE";

  const now = new Date();
  const queuePrintedAt = addHours(now, -6);
  const queueStagedAt = addHours(now, -5);
  const activeDispatchedAt = addHours(now, -2);
  const activeStagedAt = addHours(now, -3);
  const closedDispatchedAt = addHours(now, -26);
  const closedStagedAt = addHours(now, -27);
  const closedCheckinAt = addHours(now, -22);
  const closedAt = addHours(now, -21);

  const createDeliveryOrder = async (input: {
    orderCode: string;
    customer: typeof resolvedQueueCustomer;
    address: typeof queueAddress;
    product: typeof resolvedQueueProduct;
    qty: number;
    stagedAt?: Date | null;
    fulfillmentStatus: "NEW" | "STAGED" | "DISPATCHED" | "DELIVERED" | "ON_HOLD";
    dispatchedAt?: Date | null;
    deliveredAt?: Date | null;
    riderId?: number | null;
    riderName?: string | null;
    vehicleId?: number | null;
    vehicleName?: string | null;
    remitGroup?: string | null;
  }) => {
    const unitPrice = pickSeedOrderUnitPrice(input.product);
    const lineTotal = Math.round(unitPrice * input.qty * 100) / 100;
    const customerLabel = formatSeedPersonLabel({
      alias: input.customer.alias ?? null,
      firstName: input.customer.firstName,
      lastName: input.customer.lastName,
    });
    const deliverTo = `${customerLabel} — ${input.address.line1}, ${input.address.barangay}, ${input.address.city}`;

    return db.order.create({
      data: {
        orderCode: input.orderCode,
        status: "UNPAID",
        channel: "DELIVERY",
        subtotal: lineTotal,
        totalBeforeDiscount: lineTotal,
        printedAt: input.stagedAt ?? queuePrintedAt,
        expiryAt: addDays(input.stagedAt ?? queuePrintedAt, 1),
        terminalId: "SEED-DELIVERY",
        createdById: actorUserId,
        createdByRole: actorUserRole,
        customerId: input.customer.id,
        deliveryAddressId: input.address.id,
        deliverTo,
        deliverPhone: input.customer.phone ?? null,
        deliverLandmark: input.address.landmark ?? null,
        deliverGeoLat: input.address.geoLat ?? null,
        deliverGeoLng: input.address.geoLng ?? null,
        fulfillmentStatus: input.fulfillmentStatus,
        stagedAt: input.stagedAt ?? null,
        dispatchedAt: input.dispatchedAt ?? null,
        deliveredAt: input.deliveredAt ?? null,
        riderId: input.riderId ?? null,
        riderName: input.riderName ?? null,
        vehicleId: input.vehicleId ?? null,
        vehicleName: input.vehicleName ?? null,
        loadoutSnapshot: [
          {
            productId: input.product.id,
            name: input.product.name,
            qty: input.qty,
            unitKind: "PACK",
          },
        ],
        remitGroup: input.remitGroup ?? null,
        items: {
          create: [
            {
              productId: input.product.id,
              name: input.product.name,
              qty: input.qty,
              unitPrice,
              lineTotal,
              unitKind: "PACK",
              baseUnitPrice: unitPrice,
              discountAmount: 0,
              isLpg:
                input.product.name.includes("Gasul") ||
                input.product.name.includes("Gas "),
            },
          ],
        },
      },
      select: {
        id: true,
        orderCode: true,
        customerId: true,
        deliverTo: true,
        deliverPhone: true,
      },
    });
  };

  const queueOrder = await createDeliveryOrder({
    orderCode: "SEED-ORD-QUEUE-001",
    customer: resolvedQueueCustomer,
    address: queueAddress,
    product: resolvedQueueProduct,
    qty: 1,
    stagedAt: queueStagedAt,
    fulfillmentStatus: "STAGED",
  });

  const activeOrder = await createDeliveryOrder({
    orderCode: "SEED-ORD-ACTIVE-001",
    customer: resolvedActiveCustomer,
    address: activeAddress,
    product: resolvedActiveProduct,
    qty: 1,
    stagedAt: activeStagedAt,
    fulfillmentStatus: "DISPATCHED",
    dispatchedAt: activeDispatchedAt,
    riderId: args.riderEmployee.id,
    riderName: riderLabel,
    vehicleId: args.riderVehicleId,
    vehicleName: args.riderVehicleName,
    remitGroup: `${traceId}-ACTIVE`,
  });

  const deliveredOrder = await createDeliveryOrder({
    orderCode: "SEED-ORD-CLOSED-001",
    customer: resolvedDeliveredCustomer,
    address: deliveredAddress,
    product: resolvedDeliveredProduct,
    qty: 1,
    stagedAt: closedStagedAt,
    fulfillmentStatus: "DELIVERED",
    dispatchedAt: closedDispatchedAt,
    deliveredAt: closedCheckinAt,
    riderId: args.riderEmployee.id,
    riderName: riderLabel,
    vehicleId: args.riderVehicleId,
    vehicleName: args.riderVehicleName,
    remitGroup: `${traceId}-CLOSED`,
  });

  const failedReviewOrder = await createDeliveryOrder({
    orderCode: "SEED-ORD-FAILED-001",
    customer: resolvedFailedCustomer,
    address: failedAddress,
    product: resolvedFailedProduct,
    qty: 1,
    stagedAt: closedStagedAt,
    fulfillmentStatus: "ON_HOLD",
    riderId: args.riderEmployee.id,
    riderName: riderLabel,
    vehicleId: args.riderVehicleId,
    vehicleName: args.riderVehicleName,
    remitGroup: `${traceId}-FAILED`,
  });

  const plannedRun = await db.deliveryRun.create({
    data: {
      runCode: "SEED-RUN-PLAN-001",
      status: "PLANNED",
      riderId: args.riderEmployee.id,
      vehicleId: args.riderVehicleId,
      notes: "Seed delivery baseline planned run for dispatch assignment visibility.",
    },
  });

  const activeRun = await db.deliveryRun.create({
    data: {
      runCode: "SEED-RUN-ACTIVE-001",
      status: "DISPATCHED",
      riderId: args.riderEmployee.id,
      vehicleId: args.riderVehicleId,
      dispatchedAt: activeDispatchedAt,
      loadoutSnapshot: [
        {
          productId: resolvedDeliveredProduct.id,
          name: resolvedDeliveredProduct.name,
          qty: 1,
          unitKind: "PACK",
        },
      ],
      notes: "Seed delivery baseline active dispatched run.",
    },
  });

  const closedRun = await db.deliveryRun.create({
    data: {
      runCode: "SEED-RUN-CLOSED-001",
      status: "CLOSED",
      riderId: args.riderEmployee.id,
      vehicleId: args.riderVehicleId,
      dispatchedAt: closedDispatchedAt,
      riderCheckinAt: closedCheckinAt,
      riderCheckinSnapshot: {
        source: "seed",
        traceId,
        parentOrderIds: [deliveredOrder.id, failedReviewOrder.id],
      },
      riderCheckinNotes: "Seed baseline check-in completed with one failed-delivery return.",
      closedAt,
      notes: "Seed delivery baseline closed run with remit-ready history.",
    },
  });

  await db.deliveryRunOrder.createMany({
    data: [
      {
        runId: activeRun.id,
        orderId: activeOrder.id,
        sequence: 1,
      },
      {
        runId: closedRun.id,
        orderId: deliveredOrder.id,
        sequence: 1,
      },
      {
        runId: closedRun.id,
        orderId: failedReviewOrder.id,
        sequence: 2,
        attemptOutcome: "NO_RELEASE_REATTEMPT",
        attemptNote: "Customer not home during delivery window. Goods returned complete.",
        attemptReportedAt: closedCheckinAt,
        attemptReportedById: args.riderUserId,
      },
    ],
    skipDuplicates: true,
  });

  const deliveredUnitPrice = pickSeedOrderUnitPrice(resolvedDeliveredProduct);
  await db.runReceipt.create({
    data: {
      runId: closedRun.id,
      kind: "PARENT",
      receiptKey: "SEED-RR-PARENT-001",
      parentOrderId: deliveredOrder.id,
      customerId: resolvedDeliveredCustomer.id,
      customerName: formatSeedPersonLabel({
        alias: resolvedDeliveredCustomer.alias ?? null,
        firstName: resolvedDeliveredCustomer.firstName,
        lastName: resolvedDeliveredCustomer.lastName,
      }),
      customerPhone: resolvedDeliveredCustomer.phone ?? null,
      cashCollected: deliveredUnitPrice,
      note: "Seed reviewed parent receipt for cashier remit visibility.",
      status: "REVIEWED",
      reviewedAt: closedAt,
      lines: {
        create: [
          {
            productId: resolvedDeliveredProduct.id,
            name: resolvedDeliveredProduct.name,
            qty: 1,
            unitPrice: deliveredUnitPrice,
            lineTotal: deliveredUnitPrice,
            unitKind: "PACK",
            baseUnitPrice: deliveredUnitPrice,
            discountAmount: 0,
          },
        ],
      },
    },
  });

  return {
    plannedRunId: plannedRun.id,
    activeRunId: activeRun.id,
    closedRunId: closedRun.id,
    queueOrderId: queueOrder.id,
    failedReviewOrderId: failedReviewOrder.id,
  };
}

async function seedWorkforcePayrollAndScheduleBaseline(args: {
  actorUserId: number;
  branchId: number;
  riderWorkerIds: number[];
  managerWorkerIds: number[];
  cashierWorkerIds: number[];
}) {
  const now = new Date();
  const policyEffectiveFrom = startOfCurrentMonth(now);
  const scheduleRangeStart = startOfNextWeek(now);
  const scheduleRangeEnd = addDays(scheduleRangeStart, 13);

  await upsertCompanyPayrollPolicy(
    {
      effectiveFrom: policyEffectiveFrom,
      payFrequency: PayrollFrequency.SEMI_MONTHLY,
      customCutoffNote: "Default seed policy: 1st-15th and 16th-end of month.",
      restDayWorkedPremiumPercent: 30,
      regularHolidayWorkedPremiumPercent: 100,
      specialHolidayWorkedPremiumPercent: 30,
      sickLeavePayTreatment: SickLeavePayTreatment.PAID,
      attendanceIncentiveEnabled: true,
      attendanceIncentiveAmount: 300,
      attendanceIncentiveRequireNoLate: true,
      attendanceIncentiveRequireNoAbsent: true,
      attendanceIncentiveRequireNoSuspension: true,
      sssDeductionEnabled: true,
      philhealthDeductionEnabled: true,
      pagIbigDeductionEnabled: true,
      allowManagerOverride: true,
      actorUserId: args.actorUserId,
    },
    db,
  );

  const workforceGroups = [
    {
      workerIds: args.riderWorkerIds,
      dailyRate: 620,
      sssAmount: 320,
      philhealthAmount: 150,
      pagIbigAmount: 100,
      note: "Seed baseline for active rider payroll and deductions.",
    },
    {
      workerIds: args.managerWorkerIds,
      dailyRate: 980,
      sssAmount: 430,
      philhealthAmount: 210,
      pagIbigAmount: 100,
      note: "Seed baseline for store manager payroll and deductions.",
    },
    {
      workerIds: args.cashierWorkerIds,
      dailyRate: 580,
      sssAmount: 290,
      philhealthAmount: 140,
      pagIbigAmount: 100,
      note: "Seed baseline for cashier payroll and deductions.",
    },
  ];

  for (const group of workforceGroups) {
    for (const workerId of group.workerIds) {
      await upsertEmployeePayProfile(
        {
          employeeId: workerId,
          dailyRate: group.dailyRate,
          effectiveFrom: policyEffectiveFrom,
          note: group.note,
          actorUserId: args.actorUserId,
        },
        db,
      );

      await upsertEmployeeStatutoryDeductionProfile(
        {
          employeeId: workerId,
          sssAmount: group.sssAmount,
          philhealthAmount: group.philhealthAmount,
          pagIbigAmount: group.pagIbigAmount,
          effectiveFrom: policyEffectiveFrom,
          note: group.note,
          actorUserId: args.actorUserId,
        },
        db,
      );
    }
  }

  const templateSpecs = [
    {
      templateName: "Seed Rider Delivery Week",
      role: WorkerScheduleRole.EMPLOYEE,
      workerIds: args.riderWorkerIds,
      days: buildTemplateDays({
        dayOfWeeks: [
          WorkerScheduleTemplateDayOfWeek.MONDAY,
          WorkerScheduleTemplateDayOfWeek.TUESDAY,
          WorkerScheduleTemplateDayOfWeek.WEDNESDAY,
          WorkerScheduleTemplateDayOfWeek.THURSDAY,
          WorkerScheduleTemplateDayOfWeek.FRIDAY,
          WorkerScheduleTemplateDayOfWeek.SATURDAY,
        ],
        startMinute: 8 * 60,
        endMinute: 17 * 60,
        note: "Delivery and field coverage baseline shift.",
      }),
    },
    {
      templateName: "Seed Cashier Counter Week",
      role: WorkerScheduleRole.CASHIER,
      workerIds: args.cashierWorkerIds,
      days: buildTemplateDays({
        dayOfWeeks: [
          WorkerScheduleTemplateDayOfWeek.MONDAY,
          WorkerScheduleTemplateDayOfWeek.TUESDAY,
          WorkerScheduleTemplateDayOfWeek.WEDNESDAY,
          WorkerScheduleTemplateDayOfWeek.THURSDAY,
          WorkerScheduleTemplateDayOfWeek.FRIDAY,
          WorkerScheduleTemplateDayOfWeek.SATURDAY,
        ],
        startMinute: 7 * 60 + 30,
        endMinute: 16 * 60 + 30,
        note: "Counter opening and cashier handoff baseline shift.",
      }),
    },
    {
      templateName: "Seed Manager Store Week",
      role: WorkerScheduleRole.STORE_MANAGER,
      workerIds: args.managerWorkerIds,
      days: buildTemplateDays({
        dayOfWeeks: [
          WorkerScheduleTemplateDayOfWeek.MONDAY,
          WorkerScheduleTemplateDayOfWeek.TUESDAY,
          WorkerScheduleTemplateDayOfWeek.WEDNESDAY,
          WorkerScheduleTemplateDayOfWeek.THURSDAY,
          WorkerScheduleTemplateDayOfWeek.FRIDAY,
        ],
        startMinute: 8 * 60,
        endMinute: 17 * 60,
        note: "Manager supervision and approval baseline shift.",
      }),
    },
  ];

  for (const spec of templateSpecs) {
    if (spec.workerIds.length === 0) continue;

    const template = await upsertWorkerScheduleTemplate(
      {
        templateName: spec.templateName,
        branchId: args.branchId,
        role: spec.role,
        effectiveFrom: policyEffectiveFrom,
        days: spec.days,
        actorUserId: args.actorUserId,
      },
      db,
    );

    await assignWorkerScheduleTemplateToWorkers(
      {
        templateId: template.id,
        workerIds: spec.workerIds,
        effectiveFrom: policyEffectiveFrom,
        actorUserId: args.actorUserId,
      },
      db,
    );
  }

  await generateWorkerSchedulesFromTemplateAssignments(
    {
      rangeStart: scheduleRangeStart,
      rangeEnd: scheduleRangeEnd,
      branchId: args.branchId,
      actorUserId: args.actorUserId,
    },
    db,
  );
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

async function seedCatalogProducts({
  categoryMap,
  brandMapByCategory,
  unitMap,
  packingUnitMap,
  locationMap,
  targetLookupByCategory,
  indicationLookupByCategory,
}: {
  categoryMap: Record<string, number>;
  brandMapByCategory: Record<string, Record<string, number>>;
  unitMap: Record<SeedUnitName, number>;
  packingUnitMap: Record<SeedPackingUnitName, number>;
  locationMap: Record<string, number>;
  targetLookupByCategory: Record<string, Record<string, { id: number }>>;
  indicationLookupByCategory: Record<string, Record<string, { id: number }>>;
}) {
  for (const [index, item] of PRODUCT_SNAPSHOTS.entries()) {
    const categoryId = requireValue(
      categoryMap[item.category],
      `Missing category id for ${item.category}`
    );
    const brandId = requireValue(
      brandMapByCategory[item.category]?.[item.brand],
      `Missing brand id for ${item.brand} (${item.category})`
    );
    const locationId = requireValue(
      locationMap[locationsByCategory[item.category]],
      `Missing location id for ${item.category}`
    );
    const targetRows = item.targets.map((targetName) =>
      requireValue(
        targetLookupByCategory[item.category]?.[targetName],
        `Missing target ${targetName} for ${item.category}`
      )
    );
    const indicationRows = item.indications.map((indicationName) =>
      requireValue(
        indicationLookupByCategory[item.category]?.[indicationName],
        `Missing indication ${indicationName} for ${item.category}`
      )
    );

    const unitPrice = item.allowPackSale
      ? +(item.unitPrice ?? item.packPrice / item.packingSize).toFixed(2)
      : item.packPrice;

    await db.product.create({
      data: {
        name: item.name,
        description: item.description,
        sku: generateSKU({
          name: item.name,
          brand: item.brand,
          category: item.category,
          id: index + 1,
        }),
        price: unitPrice,
        srp: item.packPrice,
        dealerPrice: item.dealerPrice,
        allowPackSale: item.allowPackSale,
        packingSize: item.packingSize,
        packingStock: item.packingStock,
        stock: item.stock,
        barcode: createSeedBarcode(index + 1),
        isActive: true,
        minStock: item.minStock,
        categoryId,
        brandId,
        locationId,
        unitId: unitMap[item.unit],
        packingUnitId: packingUnitMap[item.packingUnit],
        productTargets: {
          create: targetRows.map((target) => ({
            target: { connect: { id: target.id } },
          })),
        },
        productIndications: {
          create: indicationRows.map((indication) => ({
            indication: { connect: { id: indication.id } },
          })),
        },
      },
    });
  }
}

async function upsertSeedCustomer(
  customerSeed: SeedCustomerFixture,
  fallbackProvinceId: number
) {
  const customer = await db.customer.upsert({
    where: { phone: customerSeed.phone },
    update: {
      alias: customerSeed.alias,
      firstName: customerSeed.firstName,
      lastName: customerSeed.lastName,
      email: customerSeed.email,
      notes: customerSeed.notes,
      isActive: true,
    },
    create: {
      alias: customerSeed.alias,
      firstName: customerSeed.firstName,
      lastName: customerSeed.lastName,
      phone: customerSeed.phone,
      email: customerSeed.email,
      notes: customerSeed.notes,
      isActive: true,
    },
  });

  const existingAddress = await db.customerAddress.findFirst({
    where: { customerId: customer.id, label: customerSeed.addr.label },
    select: { id: true },
  });

  const found = await db.barangay.findFirst({
    where: {
      name: customerSeed.addr.barangay,
      municipality: {
        name: customerSeed.addr.city,
        province: { name: customerSeed.addr.province },
      },
    },
    select: {
      id: true,
      municipalityId: true,
      municipality: { select: { provinceId: true } },
    },
  });

  const zoneRef =
    found && customerSeed.addr.purok
      ? await db.zone.upsert({
          where: {
            barangayId_name: {
              barangayId: found.id,
              name: customerSeed.addr.purok,
            },
          },
          update: { isActive: true },
          create: {
            barangayId: found.id,
            name: customerSeed.addr.purok,
            isActive: true,
          },
          select: { id: true },
        })
      : null;

  let landmarkRef: { id: number } | null = null;
  if (found && customerSeed.addr.landmark) {
    landmarkRef =
      (await db.landmark.findFirst({
        where: {
          barangayId: found.id,
          name: customerSeed.addr.landmark,
        },
        select: { id: true },
      })) ??
      (await db.landmark.create({
        data: {
          barangayId: found.id,
          name: customerSeed.addr.landmark,
          isActive: true,
        },
        select: { id: true },
      }));
  }

  const addressData = {
    line1: customerSeed.addr.line1,
    barangay: customerSeed.addr.barangay,
    city: customerSeed.addr.city,
    province: customerSeed.addr.province,
    purok: customerSeed.addr.purok ?? null,
    postalCode: customerSeed.addr.postalCode ?? null,
    landmark: customerSeed.addr.landmark ?? null,
    geoLat: customerSeed.addr.geoLat ?? null,
    geoLng: customerSeed.addr.geoLng ?? null,
    provinceId: found?.municipality.provinceId ?? fallbackProvinceId,
    municipalityId: found?.municipalityId ?? null,
    barangayId: found?.id ?? null,
    zoneId: zoneRef?.id ?? null,
    landmarkId: landmarkRef?.id ?? null,
  } as const;

  if (existingAddress) {
    await db.customerAddress.update({
      where: { id: existingAddress.id },
      data: addressData,
    });
    return;
  }

  await db.customerAddress.create({
    data: {
      customerId: customer.id,
      label: customerSeed.addr.label,
      ...addressData,
    },
  });
}

async function upsertSeedEmployee(
  employeeSeed: SeedEmployeeFixture,
  fallbackProvinceId: number,
  vehiclesByKey: Record<string, { id: number }>
) {
  const defaultVehicleId = employeeSeed.defaultVehicleKey
    ? vehiclesByKey[employeeSeed.defaultVehicleKey]?.id ?? null
    : null;

  const employee = await db.employee.upsert({
    where: { email: employeeSeed.email },
    update: {
      firstName: employeeSeed.firstName,
      middleName: employeeSeed.middleName ?? null,
      lastName: employeeSeed.lastName,
      alias: employeeSeed.alias ?? null,
      birthDate: employeeSeed.birthDate ? new Date(employeeSeed.birthDate) : null,
      phone: employeeSeed.phone,
      role: employeeSeed.role,
      active: true,
      sssNumber: employeeSeed.sssNumber ?? null,
      pagIbigNumber: employeeSeed.pagIbigNumber ?? null,
      defaultVehicleId,
      licenseNumber: employeeSeed.licenseNumber ?? null,
      licenseExpiry: employeeSeed.licenseExpiry
        ? new Date(employeeSeed.licenseExpiry)
        : null,
    },
    create: {
      firstName: employeeSeed.firstName,
      middleName: employeeSeed.middleName ?? null,
      lastName: employeeSeed.lastName,
      alias: employeeSeed.alias ?? null,
      birthDate: employeeSeed.birthDate ? new Date(employeeSeed.birthDate) : null,
      phone: employeeSeed.phone,
      email: employeeSeed.email,
      role: employeeSeed.role,
      active: true,
      sssNumber: employeeSeed.sssNumber ?? null,
      pagIbigNumber: employeeSeed.pagIbigNumber ?? null,
      defaultVehicleId,
      licenseNumber: employeeSeed.licenseNumber ?? null,
      licenseExpiry: employeeSeed.licenseExpiry
        ? new Date(employeeSeed.licenseExpiry)
        : null,
    },
  });

  const found = await db.barangay.findFirst({
    where: {
      name: employeeSeed.address.barangay,
      municipality: {
        name: employeeSeed.address.city,
        province: { name: employeeSeed.address.province },
      },
    },
    select: {
      id: true,
      municipalityId: true,
      municipality: { select: { provinceId: true } },
    },
  });

  if (!found) {
    throw new Error(
      `Missing barangay master for employee address: ${employeeSeed.address.barangay}, ${employeeSeed.address.city}`
    );
  }

  const zoneRef =
    employeeSeed.address.purok
      ? await db.zone.upsert({
          where: {
            barangayId_name: {
              barangayId: found.id,
              name: employeeSeed.address.purok,
            },
          },
          update: { isActive: true },
          create: {
            barangayId: found.id,
            name: employeeSeed.address.purok,
            isActive: true,
          },
          select: { id: true },
        })
      : null;

  let landmarkRef: { id: number } | null = null;
  if (employeeSeed.address.landmark) {
    landmarkRef =
      (await db.landmark.findFirst({
        where: {
          barangayId: found.id,
          name: employeeSeed.address.landmark,
        },
        select: { id: true },
      })) ??
      (await db.landmark.create({
        data: {
          barangayId: found.id,
          name: employeeSeed.address.landmark,
          isActive: true,
        },
        select: { id: true },
      }));
  }

  await db.employeeAddress.upsert({
    where: { employeeId: employee.id },
    update: {
      line1: employeeSeed.address.line1,
      provinceId: found.municipality.provinceId ?? fallbackProvinceId,
      municipalityId: found.municipalityId,
      barangayId: found.id,
      zoneId: zoneRef?.id ?? null,
      landmarkId: landmarkRef?.id ?? null,
      province: employeeSeed.address.province,
      city: employeeSeed.address.city,
      barangay: employeeSeed.address.barangay,
      purok: employeeSeed.address.purok ?? null,
      postalCode: employeeSeed.address.postalCode ?? null,
      landmark: employeeSeed.address.landmark ?? null,
      geoLat: employeeSeed.address.geoLat ?? null,
      geoLng: employeeSeed.address.geoLng ?? null,
    },
    create: {
      employeeId: employee.id,
      line1: employeeSeed.address.line1,
      provinceId: found.municipality.provinceId ?? fallbackProvinceId,
      municipalityId: found.municipalityId,
      barangayId: found.id,
      zoneId: zoneRef?.id ?? null,
      landmarkId: landmarkRef?.id ?? null,
      province: employeeSeed.address.province,
      city: employeeSeed.address.city,
      barangay: employeeSeed.address.barangay,
      purok: employeeSeed.address.purok ?? null,
      postalCode: employeeSeed.address.postalCode ?? null,
      landmark: employeeSeed.address.landmark ?? null,
      geoLat: employeeSeed.address.geoLat ?? null,
      geoLng: employeeSeed.address.geoLng ?? null,
    },
  });

  return employee;
}

// ─────────────────────────────────────────
// 4️⃣ Seed Function
// ─────────────────────────────────────────
async function seed() {
  console.log("🧹 Resetting (FK-safe order)...");
  // Wrap in a single transaction for speed & consistency
  await db.$transaction([
    // ── Session/auth + role history
    db.loginOtpChallenge.deleteMany(),
    db.passwordResetToken.deleteMany(),
    db.loginRateLimitState.deleteMany(),
    db.userRoleAuditEvent.deleteMany(),
    db.userRoleAssignment.deleteMany(),

    // ── Cash / charge / variance / receipt / CCS / AR artifacts
    db.cashDrawerTxn.deleteMany(),
    db.cashierChargePayment.deleteMany(),
    db.riderChargePayment.deleteMany(),
    db.customerArPayment.deleteMany(),
    db.payment.deleteMany(),
    db.cashierCharge.deleteMany(),
    db.riderCharge.deleteMany(),
    db.cashierShiftVariance.deleteMany(),
    db.riderRunVariance.deleteMany(),
    db.runReceiptLine.deleteMany(),
    db.deliveryRunOrder.deleteMany(),
    db.runReceipt.deleteMany(),
    db.clearanceClaim.deleteMany(),
    db.customerAr.deleteMany(),
    db.clearanceDecision.deleteMany(),
    db.clearanceCase.deleteMany(),

    // ── Run / order / stock graph
    db.stockMovement.deleteMany(),
    db.orderItem.deleteMany(),
    db.order.deleteMany(),
    db.deliveryRun.deleteMany(),

    // ── Schedule / payroll / employee-side artifacts
    db.scheduleEvent.deleteMany(),
    db.attendanceDutyResult.deleteMany(),
    db.workerSchedule.deleteMany(),
    db.scheduleTemplateAssignment.deleteMany(),
    db.scheduleTemplateDay.deleteMany(),
    db.scheduleTemplate.deleteMany(),
    db.suspensionRecord.deleteMany(),
    db.payrollRunLine.deleteMany(),
    db.payrollRun.deleteMany(),
    db.companyPayrollPolicy.deleteMany(),
    db.employeePayProfile.deleteMany(),
    db.employeeStatutoryDeductionProfile.deleteMany(),
    db.employeeDocument.deleteMany(),
    db.employeeAddress.deleteMany(),

    // ── Customer-side artifacts
    db.customerAddressPhoto.deleteMany(),
    db.customerAddress.deleteMany(),
    db.customerItemPrice.deleteMany(),
    db.customer.deleteMany(),

    // ── Product-side artifacts
    db.productPhoto.deleteMany(),
    db.productIndication.deleteMany(),
    db.productTarget.deleteMany(),
    db.product.deleteMany(),
    db.brand.deleteMany(),
    db.target.deleteMany(),
    db.indication.deleteMany(),
    db.category.deleteMany(),

    // ── Cashier scopes / auth / branches
    db.cashierShift.deleteMany(),
    db.userBranch.deleteMany(),
    db.user.deleteMany(),
    db.branch.deleteMany(),

    // ── Static refs
    db.unit.deleteMany(),
    db.packingUnit.deleteMany(),
    db.location.deleteMany(),

    // ── Geo refs (wipe before reseed)
    db.landmark.deleteMany(),
    db.zone.deleteMany(),
    db.barangay.deleteMany(),
    db.municipality.deleteMany(),
    db.province.deleteMany(),

    // ── Fleet/workforce roots
    db.vehicleCapacityProfile.deleteMany(),
    db.vehicle.deleteMany(),
    db.employee.deleteMany(),
  ]);

  console.log("📦 Creating units and locations...");
  const unitMap = await getOrCreateMap("unit", unitNames);
  const packingUnitMap = await getOrCreateMap("packingUnit", packingUnitNames);

  // ─────────────────────────────────────────
  // NEW: Seed Pangasinan geo master data
  // ─────────────────────────────────────────
  console.log(
    "🗺️  Seeding Province/Municipality/Barangay/Zone/Landmarks (Pangasinan)..."
  );
  const { provinceId } = await seedGeoPangasinan();

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
  // NEW: Seed real Branch data (store branches)
  // ─────────────────────────────────────────
  console.log("🏬 Creating branches (real store branches)...");
  const BRANCH_NAMES = [
    "Asingan Branch",
    "San Nicolas Branch",
    "Rosales Branch",
  ] as const;
  const branchByName: Record<string, number> = {};
  for (const name of BRANCH_NAMES) {
    const b = await db.branch.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    branchByName[name] = b.id;
  }
  const mainBranchId =
    branchByName["Asingan Branch"] ??
    (await (async () => {
      const b = await db.branch.upsert({
        where: { name: "Asingan Branch" },
        update: {},
        create: { name: "Asingan Branch" },
      });
      return b.id;
    })());

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
      name: "Asingan Delivery Trike 01",
      type: VehicleType.TRICYCLE,
      plateNumber: "UAK 3814",
      orNumber: "2026-TRI-0003814",
      crNumber: "2026-CR-0003814",
      ltoRegistrationExpiry: new Date("2027-09-30"),
      capacityUnits: 165, // kg
      notes: "Primary poblacion tricycle for rice, LPG, and mixed basket deliveries.",
      active: true,
    },
    {
      name: "Asingan Delivery Motor 01",
      type: VehicleType.MOTORCYCLE,
      plateNumber: "9563-UA",
      orNumber: "2026-MC-0009563",
      crNumber: "2026-CR-0009563",
      ltoRegistrationExpiry: new Date("2027-06-15"),
      capacityUnits: 85, // kg
      notes: "Motorcycle with rear rack for urgent medicine and small-basket dispatches.",
      active: true,
    },
    {
      name: "Asingan Utility Sidecar 01",
      type: VehicleType.SIDECAR,
      plateNumber: "4431-UA",
      orNumber: "2026-SDC-0004431",
      crNumber: "2026-CR-0004431",
      ltoRegistrationExpiry: new Date("2027-11-21"),
      capacityUnits: 125, // kg
      notes: "Sidecar unit used for agri supply drops and barangay edge deliveries.",
      active: true,
    },
    {
      name: "Asingan Cargo Multicab 01",
      type: VehicleType.MULTICAB,
      plateNumber: "NCQ 2147",
      orNumber: "2026-MCB-0002147",
      crNumber: "2026-CR-0002147",
      ltoRegistrationExpiry: new Date("2027-12-31"),
      capacityUnits: 420, // kg
      notes: "High-capacity multicab for bulk feeds, fertilizer, and scheduled branch transfers.",
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

  console.log("👷 Creating employees (riders / cashiers / managers)...");
  const managerEmployees: SeededEmployeeRecord[] = [];
  const cashierEmployees: SeededEmployeeRecord[] = [];
  const riderEmployees: SeededEmployeeRecord[] = [];

  for (const riderSeed of SEEDED_RIDERS) {
    const employee = await upsertSeedEmployee(
      riderSeed,
      provinceId,
      vehiclesByKey
    );
    riderEmployees.push({ id: employee.id, seed: riderSeed });
  }

  for (const managerSeed of SEEDED_MANAGERS) {
    const employee = await upsertSeedEmployee(
      managerSeed,
      provinceId,
      vehiclesByKey
    );
    managerEmployees.push({ id: employee.id, seed: managerSeed });
  }

  for (const cashierSeed of SEEDED_CASHIERS) {
    const employee = await upsertSeedEmployee(
      cashierSeed,
      provinceId,
      vehiclesByKey
    );
    cashierEmployees.push({ id: employee.id, seed: cashierSeed });
  }

  // ─────────────────────────────────────────
  // NEW: Auth users (Admin + Cashiers + Managers + Employees linked to Employee)
  // ─────────────────────────────────────────
  console.log(
    "👤 Creating auth users (Admin/Cashiers/Managers/Riders linked to Employees)..."
  );
  const hash = (s: string) => bcrypt.hashSync(s, 12);
  if (!mainBranchId) throw new Error("No Branch found. Seed branches first.");
  let primaryCashierUserId: number | null = null;
  let primaryRiderUserId: number | null = null;

  // ADMIN (walang Employee; system-level)
  const adminUser = await db.user.upsert({
    where: { email: "admin@local" },
    update: {
      role: UserRole.ADMIN,
      active: true,
      authState: UserAuthState.ACTIVE,
    },
    create: {
      email: "admin@local",
      passwordHash: hash("admin123"),
      role: UserRole.ADMIN,
      managerKind: null,
      active: true,
      authState: UserAuthState.ACTIVE,
      branches: { create: { branchId: mainBranchId } },
    },
  });

  // CASHIER USERS (linked sa cashierEmployees + password login)
  for (let i = 0; i < cashierEmployees.length; i++) {
    const emp = cashierEmployees[i];
    const idx = i + 1;
    const user = await db.user.upsert({
      where: { email: `cashier${idx}@local` },
      update: {
        employeeId: emp.id,
        role: UserRole.CASHIER,
        managerKind: null,
        active: true,
        authState: UserAuthState.ACTIVE,
        passwordHash: hash(`cashier${idx}123`),
        pinHash: null,
      },
      create: {
        email: `cashier${idx}@local`,
        passwordHash: hash(`cashier${idx}123`),
        pinHash: null,
        role: UserRole.CASHIER,
        managerKind: null,
        active: true,
        authState: UserAuthState.ACTIVE,
        employeeId: emp.id,
        branches: { create: { branchId: mainBranchId } },
      },
    });
    if (!primaryCashierUserId) {
      primaryCashierUserId = user.id;
    }
  }

  // MANAGER USERS (STORE_MANAGER role, linked sa managerEmployees)
  for (let i = 0; i < managerEmployees.length; i++) {
    const emp = managerEmployees[i];
    const idx = i + 1;
    await db.user.upsert({
      where: { email: `manager${idx}@local` },
      update: {
        employeeId: emp.id,
        role: UserRole.STORE_MANAGER,
        managerKind: ManagerKind.STAFF,
        active: true,
        authState: UserAuthState.ACTIVE,
        pinHash: null,
      },
      create: {
        email: `manager${idx}@local`,
        passwordHash: hash(`manager${idx}123`),
        pinHash: null,
        role: UserRole.STORE_MANAGER,
        managerKind: ManagerKind.STAFF,
        active: true,
        authState: UserAuthState.ACTIVE,
        employeeId: emp.id,
        branches: { create: { branchId: mainBranchId } },
      },
    });
  }

  // EMPLOYEE USERS (frontline: riders / sellers etc.) → UserRole.EMPLOYEE
  for (let i = 0; i < riderEmployees.length; i++) {
    const emp = riderEmployees[i];
    const idx = i + 1;
    const user = await db.user.upsert({
      where: { email: `rider${idx}@local` },
      update: {
        employeeId: emp.id,
        role: UserRole.EMPLOYEE,
        managerKind: null,
        active: true,
        authState: UserAuthState.ACTIVE,
        pinHash: null,
      },
      create: {
        email: `rider${idx}@local`,
        passwordHash: hash(`rider${idx}123`),
        pinHash: null,
        role: UserRole.EMPLOYEE,
        managerKind: null,
        active: true,
        authState: UserAuthState.ACTIVE,
        employeeId: emp.id,
        branches: { create: { branchId: mainBranchId } },
      },
    });
    if (!primaryRiderUserId) {
      primaryRiderUserId = user.id;
    }
  }

  console.log("🪪 Seeding employee government numbers and document metadata...");
  await seedEmployeeDocumentBaseline({
    actorUserId: adminUser.id,
    seededEmployees: [
      ...riderEmployees,
      ...managerEmployees,
      ...cashierEmployees,
    ],
  });

  console.log("🗓️ Seeding workforce payroll policy, salary, deductions, and schedules...");
  await seedWorkforcePayrollAndScheduleBaseline({
    actorUserId: adminUser.id,
    branchId: mainBranchId,
    riderWorkerIds: riderEmployees.map((employee) => employee.id),
    managerWorkerIds: managerEmployees.map((employee) => employee.id),
    cashierWorkerIds: cashierEmployees.map((employee) => employee.id),
  });

  console.log("🎯 Creating targets...");
  const targetLookupByCategory: Record<string, Record<string, { id: number }>> =
    {};
  for (const [categoryName, targetNames] of Object.entries(targetNamesByCategory)) {
    const categoryId = categoryMap[categoryName];
    if (!categoryId) continue;

    targetLookupByCategory[categoryName] = {};
    for (const name of targetNames) {
      const created = await db.target.upsert({
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
        select: { id: true, name: true },
      });
      targetLookupByCategory[categoryName][name] = created;
    }
  }

  console.log("💊 Creating indications...");
  const indicationLookupByCategory: Record<
    string,
    Record<string, { id: number }>
  > = {};
  for (const [categoryName, indications] of Object.entries(indicationsByCategory)) {
    const categoryId = categoryMap[categoryName];
    if (!categoryId) continue;

    indicationLookupByCategory[categoryName] = {};
    for (const name of indications) {
      const created = await db.indication.upsert({
        where: {
          name_categoryId: {
            name,
            categoryId,
          },
        },
        update: {},
        create: { name, categoryId },
        select: { id: true, name: true },
      });
      indicationLookupByCategory[categoryName][name] = created;
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
  await seedCatalogProducts({
    categoryMap,
    brandMapByCategory,
    unitMap: unitMap as Record<SeedUnitName, number>,
    packingUnitMap: packingUnitMap as Record<SeedPackingUnitName, number>,
    locationMap,
    targetLookupByCategory,
    indicationLookupByCategory,
  });

  console.log("👨‍👩‍👧‍👦 Creating Asingan-first customers + addresses…");
  for (const customerSeed of ASINGAN_CUSTOMERS) {
    await upsertSeedCustomer(customerSeed, provinceId);
  }

  console.log("🚚 Seeding delivery order and run baseline...");
  await seedDeliveryTransactionBaseline({
    adminUserId: adminUser.id,
    cashierUserId: primaryCashierUserId,
    riderUserId: primaryRiderUserId,
    riderEmployee: riderEmployees[0] ?? null,
    riderVehicleId:
      riderEmployees[0]?.seed.defaultVehicleKey
        ? (vehiclesByKey[riderEmployees[0].seed.defaultVehicleKey]?.id ?? null)
        : null,
    riderVehicleName: riderEmployees[0]?.seed.defaultVehicleKey
      ? riderEmployees[0].seed.defaultVehicleKey.split(":")[0] ?? null
      : null,
  });

  console.log("\n✅ Seeding complete!");
  await db.$disconnect();
}

seed().catch((err) => {
  console.error("❌ Seed failed", err);
  process.exit(1);
});
