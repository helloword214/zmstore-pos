import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  return redirect(`/creation/provinces${url.search}`);
}

export async function action({ request }: ActionFunctionArgs) {
  const url = new URL(request.url);
  return redirect(`/creation/provinces${url.search}`, 307);
}

export default function SettingsProvincesRedirect() {
  return null;
}
