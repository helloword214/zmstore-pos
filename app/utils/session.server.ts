import { createCookieSessionStorage, type Session } from "@remix-run/node";

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

// commitSession/destroySession accept a Session and return a Set-Cookie string (Promise<string>)
export function commitSession(session: Session) {
  return sessionStorage.commitSession(session);
}

export function destroySession(session: Session) {
  return sessionStorage.destroySession(session);
}
