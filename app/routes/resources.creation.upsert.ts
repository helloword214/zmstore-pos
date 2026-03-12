import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { requireRole } from "~/utils/auth.server";
import { db } from "~/utils/db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireRole(request, ["ADMIN"]);
  return json({ ok: false, message: "POST only" }, { status: 405 });
};

type Kind =
  | "category"
  | "unit"
  | "packingUnit"
  | "location"
  | "brand"
  | "indication"
  | "target";

type Intent = "create" | "update" | "archive" | "unarchive";

function resolveIntent(value: FormDataEntryValue | null): Intent {
  const raw = String(value ?? "").trim();
  if (raw === "update" || raw === "archive" || raw === "unarchive") {
    return raw;
  }
  return "create";
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

export async function action({ request }: ActionFunctionArgs) {
  await requireRole(request, ["ADMIN"]);
  const fd = await request.formData();
  const kind = String(fd.get("kind") || "") as Kind;
  const rawName = String(fd.get("name") || "").trim();
  const rawCategoryId = fd.get("categoryId");
  const categoryId = rawCategoryId ? Number(rawCategoryId) : null;
  const intent = resolveIntent(fd.get("intent"));
  const rawId = fd.get("id");
  const id = rawId ? Number(rawId) : null;

  if ((intent === "create" || intent === "update") && !rawName) {
    return json({ ok: false, message: "Name is required." }, { status: 400 });
  }

  if (
    (intent === "update" || intent === "archive" || intent === "unarchive") &&
    (!id || !Number.isFinite(id))
  ) {
    return json({ ok: false, message: "id is required." }, { status: 400 });
  }

  if ((intent === "archive" || intent === "unarchive") && kind !== "category") {
    return json(
      { ok: false, message: `Intent "${intent}" is only supported for category.` },
      { status: 400 }
    );
  }

  async function ensureActiveCategory(inputCategoryId: number) {
    const category = await db.category.findUnique({
      where: { id: inputCategoryId },
      select: { id: true, isActive: true, name: true },
    });

    if (!category) {
      return json({ ok: false, message: "Category not found." }, { status: 400 });
    }

    if (!category.isActive) {
      return json(
        {
          ok: false,
          message: `Category "${category.name}" is archived. Unarchive it before changing dependent options.`,
        },
        { status: 400 }
      );
    }

    return null;
  }

  try {
    if (kind === "category" && (intent === "archive" || intent === "unarchive")) {
      const row = await db.category.findUnique({
        where: { id: Number(id) },
        select: { id: true, name: true, isActive: true },
      });

      if (!row) {
        return json({ ok: false, message: "Category not found." }, { status: 404 });
      }

      if (intent === "archive" && !row.isActive) {
        return json({ ok: true, message: "Category already archived." });
      }

      if (intent === "unarchive" && row.isActive) {
        return json({ ok: true, message: "Category already active." });
      }

      const [productCount, brandCount, indicationCount, targetCount] =
        await Promise.all([
          db.product.count({ where: { categoryId: row.id } }),
          db.brand.count({ where: { categoryId: row.id } }),
          db.indication.count({ where: { categoryId: row.id } }),
          db.target.count({ where: { categoryId: row.id } }),
        ]);

      const updated = await db.category.update({
        where: { id: row.id },
        data: { isActive: intent === "unarchive" },
      });

      const usageSummary = `${productCount} products, ${brandCount} brands, ${indicationCount} indications, ${targetCount} targets`;

      return json({
        ok: true,
        message:
          intent === "archive"
            ? `Category archived. Existing links preserved (${usageSummary}).`
            : `Category unarchived. Category is active again (${usageSummary}).`,
        row: updated,
      });
    }

    if (intent === "update") {
      switch (kind) {
        case "category": {
          const duplicate = await db.category.findFirst({
            where: {
              id: { not: Number(id) },
              name: { equals: rawName, mode: "insensitive" },
            },
          });
          if (duplicate) {
            return json(
              { ok: false, message: "Category name already exists." },
              { status: 400 }
            );
          }

          const row = await db.category.update({
            where: { id: Number(id) },
            data: { name: rawName },
          });
          return json({ ok: true, message: "Category updated.", row });
        }

        case "unit": {
          const duplicate = await db.unit.findFirst({
            where: {
              id: { not: Number(id) },
              name: { equals: rawName, mode: "insensitive" },
            },
          });
          if (duplicate) {
            return json({ ok: false, message: "Unit name already exists." }, { status: 400 });
          }

          const row = await db.unit.update({ where: { id: Number(id) }, data: { name: rawName } });
          return json({ ok: true, message: "Unit updated.", row });
        }

        case "packingUnit": {
          const duplicate = await db.packingUnit.findFirst({
            where: {
              id: { not: Number(id) },
              name: { equals: rawName, mode: "insensitive" },
            },
          });
          if (duplicate) {
            return json(
              { ok: false, message: "Packing unit name already exists." },
              { status: 400 }
            );
          }

          const row = await db.packingUnit.update({ where: { id: Number(id) }, data: { name: rawName } });
          return json({ ok: true, message: "Packing unit updated.", row });
        }

        case "location": {
          const duplicate = await db.location.findFirst({
            where: {
              id: { not: Number(id) },
              name: { equals: rawName, mode: "insensitive" },
            },
          });
          if (duplicate) {
            return json(
              { ok: false, message: "Location name already exists." },
              { status: 400 }
            );
          }

          const row = await db.location.update({ where: { id: Number(id) }, data: { name: rawName } });
          return json({ ok: true, message: "Location updated.", row });
        }

        case "brand": {
          if (!categoryId) {
            return json({ ok: false, message: "categoryId is required." }, { status: 400 });
          }

          const inactiveCategoryResponse = await ensureActiveCategory(categoryId);
          if (inactiveCategoryResponse) return inactiveCategoryResponse;

          const duplicate = await db.brand.findFirst({
            where: {
              id: { not: Number(id) },
              categoryId,
              name: { equals: rawName, mode: "insensitive" },
            },
          });
          if (duplicate) {
            return json({ ok: false, message: "Brand name already exists." }, { status: 400 });
          }

          const row = await db.brand.update({ where: { id: Number(id) }, data: { name: rawName } });
          return json({ ok: true, message: "Brand updated.", row });
        }

        case "indication": {
          if (!categoryId) {
            return json({ ok: false, message: "categoryId is required." }, { status: 400 });
          }

          const inactiveCategoryResponse = await ensureActiveCategory(categoryId);
          if (inactiveCategoryResponse) return inactiveCategoryResponse;

          const duplicate = await db.indication.findFirst({
            where: {
              id: { not: Number(id) },
              categoryId,
              name: { equals: rawName, mode: "insensitive" },
            },
          });
          if (duplicate) {
            return json(
              { ok: false, message: "Indication name already exists." },
              { status: 400 }
            );
          }

          const row = await db.indication.update({ where: { id: Number(id) }, data: { name: rawName } });
          return json({ ok: true, message: "Indication updated.", row });
        }

        case "target": {
          if (!categoryId) {
            return json({ ok: false, message: "categoryId is required." }, { status: 400 });
          }

          const inactiveCategoryResponse = await ensureActiveCategory(categoryId);
          if (inactiveCategoryResponse) return inactiveCategoryResponse;

          const duplicate = await db.target.findFirst({
            where: {
              id: { not: Number(id) },
              categoryId,
              name: { equals: rawName, mode: "insensitive" },
            },
          });
          if (duplicate) {
            return json({ ok: false, message: "Target name already exists." }, { status: 400 });
          }

          const row = await db.target.update({ where: { id: Number(id) }, data: { name: rawName } });
          return json({ ok: true, message: "Target updated.", row });
        }

        default:
          return json({ ok: false, message: "Unknown kind." }, { status: 400 });
      }
    }

    switch (kind) {
      case "category": {
        const found = await db.category.findFirst({
          where: { name: { equals: rawName, mode: "insensitive" } },
          select: { id: true, name: true, isActive: true },
        });

        if (found && found.isActive) {
          return json({
            ok: true,
            message: "Category already exists.",
            row: found,
          });
        }

        if (found && !found.isActive) {
          const row = await db.category.update({
            where: { id: found.id },
            data: { isActive: true },
          });
          return json({
            ok: true,
            message: "Category already exists and has been unarchived.",
            row,
          });
        }

        const row = await db.category.create({ data: { name: rawName, isActive: true } });

        return json({
          ok: true,
          message: "Category created.",
          row,
        });
      }

      case "unit": {
        const found = await db.unit.findFirst({
          where: { name: { equals: rawName, mode: "insensitive" } },
        });
        const row = found ?? (await db.unit.create({ data: { name: rawName } }));
        return json({
          ok: true,
          message: found ? "Unit already exists." : "Unit created.",
          row,
        });
      }

      case "packingUnit": {
        const found = await db.packingUnit.findFirst({
          where: { name: { equals: rawName, mode: "insensitive" } },
        });
        const row = found ?? (await db.packingUnit.create({ data: { name: rawName } }));
        return json({
          ok: true,
          message: found ? "Packing unit already exists." : "Packing unit created.",
          row,
        });
      }

      case "location": {
        const found = await db.location.findFirst({
          where: { name: { equals: rawName, mode: "insensitive" } },
        });
        const row = found ?? (await db.location.create({ data: { name: rawName } }));
        return json({
          ok: true,
          message: found ? "Location already exists." : "Location created.",
          row,
        });
      }

      case "brand": {
        if (!categoryId) {
          return json({ ok: false, message: "categoryId is required." }, { status: 400 });
        }

        const inactiveCategoryResponse = await ensureActiveCategory(categoryId);
        if (inactiveCategoryResponse) return inactiveCategoryResponse;

        const found = await db.brand.findFirst({
          where: { categoryId, name: { equals: rawName, mode: "insensitive" } },
        });
        const row =
          found ??
          (await db.brand.create({
            data: { name: rawName, categoryId },
          }));
        return json({
          ok: true,
          message: found ? "Brand already exists." : "Brand created.",
          row,
        });
      }

      case "indication": {
        if (!categoryId) {
          return json({ ok: false, message: "categoryId is required." }, { status: 400 });
        }

        const inactiveCategoryResponse = await ensureActiveCategory(categoryId);
        if (inactiveCategoryResponse) return inactiveCategoryResponse;

        const found = await db.indication.findFirst({
          where: { categoryId, name: { equals: rawName, mode: "insensitive" } },
        });
        const row =
          found ??
          (await db.indication.create({
            data: { name: rawName, categoryId },
          }));
        return json({
          ok: true,
          message: found ? "Indication already exists." : "Indication created.",
          row,
        });
      }

      case "target": {
        if (!categoryId) {
          return json({ ok: false, message: "categoryId is required." }, { status: 400 });
        }

        const inactiveCategoryResponse = await ensureActiveCategory(categoryId);
        if (inactiveCategoryResponse) return inactiveCategoryResponse;

        const found = await db.target.findFirst({
          where: { categoryId, name: { equals: rawName, mode: "insensitive" } },
        });
        const row =
          found ??
          (await db.target.create({
            data: { name: rawName, categoryId },
          }));
        return json({
          ok: true,
          message: found ? "Target already exists." : "Target created.",
          row,
        });
      }

      default:
        return json({ ok: false, message: "Unknown kind." }, { status: 400 });
    }
  } catch (error: unknown) {
    return json(
      { ok: false, message: getErrorMessage(error, "Upsert failed.") },
      { status: 500 }
    );
  }
}
