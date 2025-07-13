import { createCookieSessionStorage } from "@remix-run/node";

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  throw new Error("SESSION_SECRET must be set in your .env");
}

export const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: "cart_session",
    secure: process.env.NODE_ENV === "production",
    secrets: [sessionSecret],
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    httpOnly: true,
  },
});

export async function getSession(request: Request) {
  const cookie = request.headers.get("Cookie");
  return sessionStorage.getSession(cookie);
}

export async function commitSession(
  session: ReturnType<typeof sessionStorage.getSession>
) {
  return sessionStorage.commitSession(session);
}

export async function destroySession(
  session: ReturnType<typeof sessionStorage.getSession>
) {
  return sessionStorage.destroySession(session);
}
