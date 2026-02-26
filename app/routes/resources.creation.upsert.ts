/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { db } from "~/utils/db.server";

export const loader = () =>
  json({ ok: false, message: "POST only" }, { status: 405 });

type Kind =
  | "unit"
  | "packingUnit"
  | "location"
  | "brand"
  | "indication"
  | "target";

export async function action({ request }: ActionFunctionArgs) {
  const fd = await request.formData();
  const kind = String(fd.get("kind") || "") as Kind;
  const rawName = String(fd.get("name") || "").trim();
  const rawCategoryId = fd.get("categoryId");
  const categoryId = rawCategoryId ? Number(rawCategoryId) : null;
  const intent = String(fd.get("intent") || "create").trim();
  const rawId = fd.get("id");
  const id = rawId ? Number(rawId) : null;

  if (!rawName) {
    return json({ ok: false, message: "Name is required." }, { status: 400 });
  }

  try {
    if (intent === "update") {
      if (!id || !Number.isFinite(id)) {
        return json({ ok: false, message: "id is required for update." }, { status: 400 });
      }

      switch (kind) {
        case "unit": {
          const duplicate = await db.unit.findFirst({
            where: {
              id: { not: id },
              name: { equals: rawName, mode: "insensitive" },
            },
          });
          if (duplicate) {
            return json({ ok: false, message: "Unit name already exists." }, { status: 400 });
          }

          const row = await db.unit.update({ where: { id }, data: { name: rawName } });
          return json({ ok: true, message: "Unit updated.", row });
        }

        case "packingUnit": {
          const duplicate = await db.packingUnit.findFirst({
            where: {
              id: { not: id },
              name: { equals: rawName, mode: "insensitive" },
            },
          });
          if (duplicate) {
            return json(
              { ok: false, message: "Packing unit name already exists." },
              { status: 400 }
            );
          }

          const row = await db.packingUnit.update({ where: { id }, data: { name: rawName } });
          return json({ ok: true, message: "Packing unit updated.", row });
        }

        case "location": {
          const duplicate = await db.location.findFirst({
            where: {
              id: { not: id },
              name: { equals: rawName, mode: "insensitive" },
            },
          });
          if (duplicate) {
            return json(
              { ok: false, message: "Location name already exists." },
              { status: 400 }
            );
          }

          const row = await db.location.update({ where: { id }, data: { name: rawName } });
          return json({ ok: true, message: "Location updated.", row });
        }

        case "brand": {
          if (!categoryId) {
            return json({ ok: false, message: "categoryId is required." }, { status: 400 });
          }

          const duplicate = await db.brand.findFirst({
            where: {
              id: { not: id },
              categoryId,
              name: { equals: rawName, mode: "insensitive" },
            },
          });
          if (duplicate) {
            return json({ ok: false, message: "Brand name already exists." }, { status: 400 });
          }

          const row = await db.brand.update({ where: { id }, data: { name: rawName } });
          return json({ ok: true, message: "Brand updated.", row });
        }

        case "indication": {
          if (!categoryId) {
            return json({ ok: false, message: "categoryId is required." }, { status: 400 });
          }

          const duplicate = await db.indication.findFirst({
            where: {
              id: { not: id },
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

          const row = await db.indication.update({ where: { id }, data: { name: rawName } });
          return json({ ok: true, message: "Indication updated.", row });
        }

        case "target": {
          if (!categoryId) {
            return json({ ok: false, message: "categoryId is required." }, { status: 400 });
          }

          const duplicate = await db.target.findFirst({
            where: {
              id: { not: id },
              categoryId,
              name: { equals: rawName, mode: "insensitive" },
            },
          });
          if (duplicate) {
            return json({ ok: false, message: "Target name already exists." }, { status: 400 });
          }

          const row = await db.target.update({ where: { id }, data: { name: rawName } });
          return json({ ok: true, message: "Target updated.", row });
        }

        default:
          return json({ ok: false, message: "Unknown kind." }, { status: 400 });
      }
    }

    switch (kind) {
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
  } catch (e: any) {
    return json(
      { ok: false, message: e?.message ?? "Upsert failed." },
      { status: 500 }
    );
  }
}
