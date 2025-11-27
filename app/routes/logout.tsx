import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { logout } from "~/utils/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  return logout(request);
}

export async function action({ request }: ActionFunctionArgs) {
  return logout(request);
}

export default function Logout() {
  return null;
}
