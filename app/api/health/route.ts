import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkConfig, config } from "@/lib/config";
import { getSession } from "@/lib/auth";
import { systemState } from "@/lib/system-state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Liveness and readiness for a container orchestrator.
 *
 * Public on purpose - a health check that needs a session is useless to a load balancer - which
 * is exactly why the anonymous response says as little as it possibly can: a status word and
 * whether the database answered. That is everything a probe needs to decide whether to route
 * traffic here.
 *
 * Nothing else is anonymous. The driver's own error text is the clearest example of why: on a
 * managed database it reads "Can't reach database server at db-xyz.example-cloud.com:25060",
 * which hands the host and port of a private database to anyone who can curl a URL. The names of
 * misconfigured environment variables, and whether live sending is switched on, are the same kind
 * of thing - useful to an operator, and an inventory of where to push for anyone else.
 *
 * Signed in, the same endpoint returns the detail. It is the fastest way to answer "why is it
 * degraded?" without opening a shell on the box.
 */
export async function GET() {
  const started = Date.now();
  let database: "up" | "down" = "down";
  let databaseError: string | undefined;

  try {
    await prisma.$queryRaw`SELECT 1`;
    database = "up";
  } catch (e) {
    databaseError = e instanceof Error ? e.message.slice(0, 200) : "unknown error";
  }

  const problems = checkConfig();
  const fatal = problems.filter((p) => p.fatal).map((p) => p.key);

  // A suspension is reported but is not a failure: the container is healthy and doing exactly
  // what it was told to do, so an orchestrator must not restart it.
  let suspended = false;
  try { suspended = (await systemState()).suspended; } catch { /* database already reported */ }

  const ok = database === "up" && fatal.length === 0;
  const status = ok ? (suspended ? "suspended" : "ok") : "degraded";
  const httpStatus = ok ? 200 : 503;
  const headers = { "Cache-Control": "no-store" };

  // getSession touches the database; if that is what is broken, stay anonymous rather than
  // turning a health check into a second failure.
  let operator = false;
  if (database === "up") {
    try { operator = Boolean(await getSession()); } catch { /* treat as anonymous */ }
  }

  if (!operator)
    return NextResponse.json({ status, database }, { status: httpStatus, headers });

  return NextResponse.json({
    status,
    suspended,
    database,
    databaseError,
    configuration: fatal.length ? { fatal } : "ok",
    warnings: problems.filter((p) => !p.fatal).map((p) => p.key),
    appUrl: config.appUrl,
    emailMode: config.emailMode,
    liveSending: config.liveSendingEnabled,
    checkedInMs: Date.now() - started,
  }, { status: httpStatus, headers });
}
