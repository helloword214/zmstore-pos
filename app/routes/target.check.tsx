import { json } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";
import { db } from "~/utils/db.server";

export async function action({ request }: ActionFunctionArgs) {
  const body = await request.json();
  const name = (body.name || "").trim();
  const categoryId = Number(body.categoryId);

  if (!name || !categoryId) {
    return json(
      { error: "Missing target name or category ID." },
      { status: 400 }
    );
  }

  const existing = await db.target.findUnique({
    where: {
      name_categoryId: {
        name,
        categoryId,
      },
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
