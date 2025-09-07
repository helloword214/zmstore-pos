// app/routes/api.customers.create.ts
import { json, type ActionFunctionArgs } from "@remix-run/node";
import { db } from "~/utils/db.server";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST")
    return json({ ok: false, error: "POST only" }, { status: 405 });
  const fd = await request.formData();
  const firstName = String(fd.get("firstName") || "").trim();
  const lastName = String(fd.get("lastName") || "").trim();
  const middleName = String(fd.get("middleName") || "").trim() || null;
  const alias = String(fd.get("alias") || "").trim() || null;
  const phone = String(fd.get("phone") || "").trim() || null;

  if (!firstName && !lastName) {
    return json(
      { ok: false, error: "First or last name is required." },
      { status: 400 }
    );
  }

  try {
    const customer = await db.customer.create({
      data: { firstName, lastName, middleName, alias, phone },
      select: {
        id: true,
        firstName: true,
        middleName: true,
        lastName: true,
        alias: true,
        phone: true,
      },
    });
    return json({ ok: true, customer });
  } catch (e: any) {
    return json(
      { ok: false, error: e?.message || "Failed to create customer." },
      { status: 400 }
    );
  }
}
