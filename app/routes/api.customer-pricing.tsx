// app/routes/api.customer-pricing.tsx
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { db } from "~/utils/db.server";
import { fetchActiveCustomerRules } from "~/services/pricing";
import { requireRole } from "~/utils/auth.server";

// Local shape the UI expects. This avoids importing types from services/pricing.
type RuleSelector = {
  productIds?: number[];
  unitKind?: "RETAIL" | "PACK";
};

type ApiRule =
  | {
      id: string;
      name: string;
      scope: "ITEM";
      kind: "PRICE_OVERRIDE";
      priceOverride: number;
      selector?: RuleSelector;
      priority?: number;
      enabled?: boolean;
      stackable?: boolean;
      notes?: string;
    }
  | {
      id: string;
      name: string;
      scope: "ITEM";
      kind: "PERCENT_OFF";
      percentOff: number;
      selector?: RuleSelector;
      priority?: number;
      enabled?: boolean;
      stackable?: boolean;
      notes?: string;
    };

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["EMPLOYEE", "STORE_MANAGER", "CASHIER", "ADMIN"]);
  const url = new URL(request.url);
  const customerId = Number(url.searchParams.get("customerId") || 0);
  if (!Number.isFinite(customerId) || customerId <= 0) {
    return json({ rules: [] as ApiRule[] }, { status: 200 });
  }

  // Centralized: fetch and map via shared service (same output shape)
  const rules: ApiRule[] = (await fetchActiveCustomerRules(
    db,
    customerId
  )) as unknown as ApiRule[];

  return json({ rules });
}
