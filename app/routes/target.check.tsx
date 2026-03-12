import { json } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";
import { requireRole } from "~/utils/auth.server";
import { db } from "~/utils/db.server";

export async function action({ request }: ActionFunctionArgs) {
  await requireRole(request, ["ADMIN"]);
  const body = await request.json();
  const name = (body.name || "").trim();
  const categoryId = Number(body.categoryId);

  if (!name || !categoryId) {
    return json(
      { error: "Missing target name or category ID." },
      { status: 400 }
    );
  }

  const category = await db.category.findUnique({
    where: { id: categoryId },
    select: { id: true, name: true, isActive: true },
  });

  if (!category) {
    return json({ error: "Category not found." }, { status: 404 });
  }

  if (!category.isActive) {
    return json(
      {
        error: `Category "${category.name}" is archived. Unarchive it before adding targets.`,
      },
      { status: 400 }
    );
  }

  const existing = await db.target.findFirst({
    where: {
      categoryId,
      name: { equals: name, mode: "insensitive" },
    },
  });

  if (existing) {
    return json({ id: existing.id, name: existing.name }); // return both for client
  }

  const created = await db.target.create({
    data: {
      name,
      category: { connect: { id: categoryId } },
    },
  });

  return json({ id: created.id, name: created.name }); // ✅ return created info
}
