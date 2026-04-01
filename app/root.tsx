import {
  isRouteErrorResponse,
  Links,
  Link,
  Meta,
  Outlet,
  Scripts,
  useLocation,
  ScrollRestoration,
  useNavigation,
  useRouteError,
} from "@remix-run/react";
import type { LinksFunction } from "@remix-run/node";
import type { ReactNode } from "react";
import { SoTBrandFooter } from "~/components/ui/SoTBrandFooter";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTLoadingState } from "~/components/ui/SoTLoadingState";
import {
  SoTRouteLoadingPreview,
  type SoTRouteLoadingPreviewKind,
} from "~/components/ui/SoTRouteLoadingPreview";

import "./tailwind.css";

export const links: LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
];

type LoadingPreviewTarget = {
  kind: SoTRouteLoadingPreviewKind;
  label: string;
  hint: string;
};

function resolveLoadingPreviewTarget(pathname?: string | null): LoadingPreviewTarget {
  if (!pathname) {
    return {
      kind: "generic",
      label: "Loading page",
      hint: "Preparing the next workspace and the latest UI state.",
    };
  }

  if (pathname === "/") {
    return {
      kind: "dashboard",
      label: "Opening admin dashboard",
      hint: "Preparing your launchpad, shortcuts, and setup signals.",
    };
  }

  if (pathname === "/store") {
    return {
      kind: "dashboard",
      label: "Opening manager dashboard",
      hint: "Loading queues, dispatch counts, and today's signals.",
    };
  }

  if (pathname === "/cashier") {
    return {
      kind: "dashboard",
      label: "Opening cashier dashboard",
      hint: "Preparing your shift workspace and priority lanes.",
    };
  }

  if (pathname === "/rider") {
    return {
      kind: "dashboard",
      label: "Opening rider dashboard",
      hint: "Loading your runs, acceptance items, and daily signals.",
    };
  }

  if (pathname === "/runs") {
    return {
      kind: "operational-list",
      label: "Loading runs list",
      hint: "Refreshing run statuses and the next-step work surface.",
    };
  }

  if (pathname === "/store/dispatch") {
    return {
      kind: "operational-list",
      label: "Loading dispatch queue",
      hint: "Preparing triage counts, filters, and order rows.",
    };
  }

  if (pathname === "/ar" || pathname.startsWith("/ar/")) {
    return {
      kind: "operational-list",
      label: "Loading receivables list",
      hint: "Refreshing customer balances and review rows.",
    };
  }

  if (pathname === "/cashier/delivery" || pathname.startsWith("/cashier/delivery/")) {
    return {
      kind: "operational-list",
      label: "Loading cashier remit queue",
      hint: "Preparing remit rows and the next cashier actions.",
    };
  }

  return {
    kind: "generic",
    label: "Loading page",
    hint: "Preparing the next workspace and the latest UI state.",
  };
}

export function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const loading = navigation.state === "loading";
  const pathnameChanged =
    navigation.location?.pathname != null &&
    navigation.location.pathname !== location.pathname;
  const showOverlay = loading && pathnameChanged;
  const loadingTarget = resolveLoadingPreviewTarget(navigation.location?.pathname);
  const pendingLabel = loadingTarget.label;

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="bg-[#f7f7fb] text-slate-900" aria-busy={busy}>
        {showOverlay ? (
          <SoTLoadingState
            variant="overlay"
            label={pendingLabel}
            hint={loadingTarget.hint}
            preview={<SoTRouteLoadingPreview kind={loadingTarget.kind} />}
          />
        ) : null}
        {children}
        <SoTBrandFooter ownerName="John Michael Benito" />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary() {
  const error = useRouteError();
  const isNotFound = isRouteErrorResponse(error) && error.status === 404;

  const title = isNotFound
    ? "Page Not Found"
    : isRouteErrorResponse(error)
      ? `${error.status} ${error.statusText}`
      : "Something Went Wrong";

  const summary = isNotFound
    ? "The page you opened does not exist or may have been moved to another route."
    : "The app hit a problem while loading this page. You can head back to a safe route and continue working.";

  const technicalDetail = isRouteErrorResponse(error)
    ? typeof error.data === "string"
      ? error.data
      : JSON.stringify(error.data)
    : error instanceof Error
      ? error.message
      : "Unknown application error.";

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#dbeafe_0%,_#f8fafc_42%,_#eef2ff_100%)] px-5 py-10">
      <div className="mx-auto max-w-3xl">
        <SoTCard className="overflow-hidden border-slate-200 bg-white/95 shadow-xl shadow-slate-200/70">
          <div className="border-b border-slate-200 bg-slate-900 px-6 py-4 text-white">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-200">
              App Recovery
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-200">{summary}</p>
          </div>

          <div className="space-y-5 px-6 py-6">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                What You Can Do
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <Link
                  to="/"
                  className="inline-flex h-10 items-center rounded-xl bg-slate-900 px-4 text-sm font-medium text-white transition-colors duration-150 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                >
                  Go to Home
                </Link>
                <Link
                  to="/login"
                  className="inline-flex h-10 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                >
                  Go to Sign In
                </Link>
              </div>
            </div>

            <details className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4">
              <summary className="cursor-pointer text-sm font-medium text-rose-800">
                Technical details
              </summary>
              <pre className="mt-3 whitespace-pre-wrap text-xs leading-6 text-rose-900">
                {technicalDetail}
              </pre>
            </details>
          </div>
        </SoTCard>
      </div>
    </main>
  );
}
