import type { NextRequest } from 'next/server';
import type { z } from 'zod';

import { requirePermission, type CurrentUser } from '../auth/current-user';
import type { PermissionKey } from '../rbac/permissions';
import { readJsonBody } from '../request';
import type { ServiceActor } from '@/server/types';

import { actorFrom } from './actor';
import { withApi, type ApiHandlerContext } from './handler';
import { parseListQuery, parseBody, type ListQuery, type SortOrder } from './query';
import { jsonCreated, jsonNoContent, jsonOk, jsonPaginated, type Paginated } from './responses';

/**
 * Route factories.
 *
 * Collection and item endpoints follow the same shape across every resource:
 * check a permission, parse input, call a service, return the standard
 * envelope. Expressing that once means a new module cannot accidentally ship
 * without an authorization check, and the pagination, sorting and error
 * contracts stay identical everywhere.
 *
 * Anything with genuinely bespoke behaviour (auth, checkout, order actions) is
 * written out longhand instead of bent through this factory.
 */

type UuidParams = { id: string };

/** Collection endpoint: GET (paginated list) and optionally POST (create). */
export const collectionRoute = <TSort extends string, TCreateSchema extends z.ZodType>(config: {
  list: {
    permission: PermissionKey;
    sortable: readonly TSort[];
    defaultSort?: TSort;
    defaultSortOrder?: SortOrder;
    filterKeys?: readonly string[];
    defaultPageSize?: number;
    run: (query: ListQuery<TSort>, user: CurrentUser) => Promise<Paginated<unknown>>;
    /** Extra fields merged into the response `meta`, e.g. an unread count. */
    meta?: (result: Paginated<unknown>) => Record<string, unknown>;
  };
  create?: {
    permission: PermissionKey;
    schema: TCreateSchema;
    run: (input: z.output<TCreateSchema>, actor: ServiceActor) => Promise<unknown>;
    /** Builds a Location header for the created resource. */
    location?: (created: unknown) => string | undefined;
  };
}) => {
  const GET = withApi(async ({ searchParams }: ApiHandlerContext<unknown>) => {
    const user = await requirePermission(config.list.permission);

    const query = parseListQuery<TSort>(searchParams, {
      sortable: config.list.sortable,
      ...(config.list.defaultSort ? { defaultSort: config.list.defaultSort } : {}),
      ...(config.list.defaultSortOrder ? { defaultSortOrder: config.list.defaultSortOrder } : {}),
      ...(config.list.filterKeys ? { filterKeys: config.list.filterKeys } : {}),
      ...(config.list.defaultPageSize ? { defaultPageSize: config.list.defaultPageSize } : {}),
    });

    const result = await config.list.run(query, user);
    return jsonPaginated(result, config.list.meta?.(result));
  });

  if (!config.create) return { GET };

  const createConfig = config.create;

  const POST = withApi(async ({ request, client }: ApiHandlerContext<unknown>) => {
    const user = await requirePermission(createConfig.permission);
    const body = await readJsonBody(request as NextRequest);
    const input = parseBody(createConfig.schema, body);
    const created = await createConfig.run(input, actorFrom(user, client));
    return jsonCreated(created, createConfig.location?.(created));
  });

  return { GET, POST };
};

/** Item endpoint: GET / PATCH / DELETE for a single `[id]` resource. */
export const itemRoute = <TUpdateSchema extends z.ZodType>(config: {
  get?: {
    permission: PermissionKey;
    run: (id: string, user: CurrentUser) => Promise<unknown>;
  };
  update?: {
    permission: PermissionKey;
    schema: TUpdateSchema;
    run: (id: string, input: z.output<TUpdateSchema>, actor: ServiceActor) => Promise<unknown>;
  };
  remove?: {
    permission: PermissionKey;
    run: (id: string, actor: ServiceActor) => Promise<unknown>;
    /** Return the updated record rather than 204 (used by archive/restore). */
    respondWithBody?: boolean;
  };
}) => {
  const handlers: Record<string, unknown> = {};

  if (config.get) {
    const getConfig = config.get;
    handlers.GET = withApi<UuidParams>(async ({ params }) => {
      const user = await requirePermission(getConfig.permission);
      const record = await getConfig.run(params.id, user);
      return jsonOk(record);
    });
  }

  if (config.update) {
    const updateConfig = config.update;
    handlers.PATCH = withApi<UuidParams>(async ({ request, params, client }) => {
      const user = await requirePermission(updateConfig.permission);
      const body = await readJsonBody(request);
      const input = parseBody(updateConfig.schema, body);
      const updated = await updateConfig.run(params.id, input, actorFrom(user, client));
      return jsonOk(updated);
    });

    // PUT is accepted as an alias so a full-replacement client works too.
    handlers.PUT = handlers.PATCH;
  }

  if (config.remove) {
    const removeConfig = config.remove;
    handlers.DELETE = withApi<UuidParams>(async ({ params, client }) => {
      const user = await requirePermission(removeConfig.permission);
      const result = await removeConfig.run(params.id, actorFrom(user, client));
      return removeConfig.respondWithBody ? jsonOk(result) : jsonNoContent();
    });
  }

  return handlers as {
    GET?: ReturnType<typeof withApi>;
    PATCH?: ReturnType<typeof withApi>;
    PUT?: ReturnType<typeof withApi>;
    DELETE?: ReturnType<typeof withApi>;
  };
};

/**
 * A single-action POST/PATCH endpoint on a sub-path, e.g.
 * `/orders/[id]/refund`. Keeps the permission check and body parsing uniform
 * with the rest of the API.
 */
export const actionRoute = <TSchema extends z.ZodType>(config: {
  permission: PermissionKey;
  schema?: TSchema;
  run: (
    id: string,
    input: TSchema extends z.ZodType ? z.output<TSchema> : undefined,
    actor: ServiceActor,
    user: CurrentUser,
  ) => Promise<unknown>;
  status?: number;
}) =>
  withApi<UuidParams>(async ({ request, params, client }) => {
    const user = await requirePermission(config.permission);

    let input: unknown;
    if (config.schema) {
      const body = await readJsonBody(request);
      input = parseBody(config.schema, body);
    }

    const result = await config.run(
      params.id,
      input as never,
      actorFrom(user, client),
      user,
    );

    return jsonOk(result, config.status ? { status: config.status } : undefined);
  });
