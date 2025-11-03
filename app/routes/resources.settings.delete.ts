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
  const id = Number(fd.get("id"));

  if (!Number.isFinite(id))
    return json({ ok: false, message: "Invalid id." }, { status: 400 });

  try {
    if (kind === "unit") {
      const c = await db.product.count({ where: { unitId: id } });
      if (c)
        return json(
          { ok: false, message: `Cannot delete: used by ${c} product(s).` },
          { status: 400 }
        );
      await db.unit.delete({ where: { id } });
      return json({ ok: true, message: "Unit deleted." });
    }

    if (kind === "packingUnit") {
      const c = await db.product.count({ where: { packingUnitId: id } });
      if (c)
        return json(
          { ok: false, message: `Cannot delete: used by ${c} product(s).` },
          { status: 400 }
        );
      await db.packingUnit.delete({ where: { id } });
      return json({ ok: true, message: "Packing unit deleted." });
    }

    if (kind === "location") {
      const c = await db.product.count({ where: { locationId: id } });
      if (c)
        return json(
          { ok: false, message: `Cannot delete: used by ${c} product(s).` },
          { status: 400 }
        );
      await db.location.delete({ where: { id } });
      return json({ ok: true, message: "Location deleted." });
    }

    if (kind === "brand") {
      const c = await db.product.count({ where: { brandId: id } });
      if (c)
        return json(
          { ok: false, message: `Cannot delete: used by ${c} product(s).` },
          { status: 400 }
        );
      await db.brand.delete({ where: { id } });
      return json({ ok: true, message: "Brand deleted." });
    }

    if (kind === "indication") {
      const c = await db.productIndication.count({
        where: { indicationId: id },
      });
      if (c)
        return json(
          { ok: false, message: `Cannot delete: used by ${c} product(s).` },
          { status: 400 }
        );
      await db.indication.delete({ where: { id } });
      return json({ ok: true, message: "Indication deleted." });
    }

    if (kind === "target") {
      const c = await db.productTarget.count({ where: { targetId: id } });
      if (c)
        return json(
          { ok: false, message: `Cannot delete: used by ${c} product(s).` },
          { status: 400 }
        );
      await db.target.delete({ where: { id } });
      return json({ ok: true, message: "Target deleted." });
    }

    return json({ ok: false, message: "Unknown kind." }, { status: 400 });
  } catch (e: any) {
    return json(
      { ok: false, message: e?.message ?? "Delete failed." },
      { status: 500 }
    );
  }
}
