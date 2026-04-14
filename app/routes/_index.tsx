import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import { homePathFor, requireUser } from "~/utils/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const me = await requireUser(request);
  return redirect(homePathFor(me.role));
}

export default function RoleHomeRouter() {
  return null;
}
