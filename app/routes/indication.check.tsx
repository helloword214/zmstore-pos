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

  // Check existing by compound unique
  const existing = await db.indication.findUnique({
    where: {
      name_categoryId: {
        name: trimmedName,
        categoryId: parsedCategoryId,
      },
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
