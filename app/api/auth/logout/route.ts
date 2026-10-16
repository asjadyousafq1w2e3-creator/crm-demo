import { NextResponse } from "next/server";
import { sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth";


/** Relative redirect, so signing out works on whatever origin served the page. */
export async function POST() {
  const res = new NextResponse(null, { status: 303, headers: { Location: "/login" } });
  // Same attributes as when it was set, maxAge 0: a browser only replaces a cookie when the
  // name, path and domain all match, so clearing it with a different shape leaves it in place.
  res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
  return res;
}
