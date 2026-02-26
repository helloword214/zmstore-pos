import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  return redirect(`/creation/areas${url.search}`);
}

export async function action({ request }: ActionFunctionArgs) {
  const url = new URL(request.url);
  return redirect(`/creation/areas${url.search}`, 307);
}

export default function SettingsAreasRedirect() {
  return null;
}
