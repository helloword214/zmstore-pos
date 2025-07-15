// app/routes/brand.check.tsx
import { json } from "@remix-run/node";
import { db } from "~/utils/db.server";

export const action = async ({ request }: { request: Request }) => {
  try {
    const formData = await request.formData();
    const brandName = formData.get("brandName")?.toString().trim();
    const categoryId = formData.get("categoryId")?.toString();

    if (!brandName) {
      return json({ exists: false });
    }

    const existingBrand = await db.brand.findFirst({
      where: {
        name: brandName,
        ...(categoryId && { categoryId: Number(categoryId) }),
      },
    });

    return json({ exists: !!existingBrand });
  } catch (error) {
    console.error("[❌ Error checking brand]:", error);
    return json({ exists: false, error: "Internal error" }, { status: 500 });
  }
};
