// File: app/routes/indication.check.tsx
import { json } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";
import { db } from "~/utils/db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { name, categoryId } = await request.json();

  const trimmedName = (name || "").trim();
  const parsedCategoryId = Number(categoryId);

  if (!trimmedName || !parsedCategoryId) {
    return json(
      { error: "Missing or invalid indication name or category ID." },
      { status: 400 }
    );
  }

  const category = await db.category.findUnique({
    where: { id: parsedCategoryId },
    select: { id: true, name: true, isActive: true },
  });

  if (!category) {
    return json({ error: "Category not found." }, { status: 404 });
  }

  if (!category.isActive) {
    return json(
      {
        error: `Category "${category.name}" is archived. Unarchive it before adding indications.`,
      },
      { status: 400 }
    );
  }

  const existing = await db.indication.findFirst({
    where: {
      categoryId: parsedCategoryId,
      name: { equals: trimmedName, mode: "insensitive" },
    },
  });

  if (existing) {
    return json({ id: existing.id, name: existing.name });
  }

  // Else, create it
  const created = await db.indication.create({
    data: {
      name: trimmedName,
      category: { connect: { id: parsedCategoryId } },
    },
  });

  return json({ id: created.id, name: created.name });
};
