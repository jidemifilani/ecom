import { db } from '@/lib/db';

/**
 * GET /api/health
 *
 * Liveness and database readiness, for container health checks and uptime
 * monitoring. Deliberately unauthenticated and deliberately terse: it reports
 * whether the process can reach its database and nothing about the schema,
 * versions or configuration.
 */
export const GET = async (): Promise<Response> => {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json(
      { status: 'ok', database: 'up' },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json(
      { status: 'degraded', database: 'down' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
};
