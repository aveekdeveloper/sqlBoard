import { eq } from 'drizzle-orm';
import {
  connections,
  dashboardItems,
  dashboardTags,
  dashboardVersions,
  dashboards,
  tags,
} from '../db/schema.js';
import type { DrizzleDb } from '../db/client.js';
import { ApiError, notFound } from '../errors.js';
import {
  parseDashboardManifest,
  serializeDashboardManifest,
  type ManifestDashboard,
  type ManifestFilter,
} from 'sql-to-flint';
import { type ApplyDashboardState } from '@sqlboard/shared';

export type DashboardSnapshot = ManifestDashboard;

export interface DashboardVersionKind {
  kind: 'manual' | 'apply' | 'restore';
}

export interface DashboardVersionSummary {
  id: number;
  dashboardId: number;
  version: number;
  parentVersion: number | null;
  message: string | null;
  authorId: number | null;
  authorEmail?: string | null;
  kind: DashboardVersionKind['kind'];
  createdAt: string | Date;
}

/**
 * Load a dashboard row and its blocks as a manifest snapshot.
 *
 * `tenantId` is optional for the REST routes (their tenant guard already ran),
 * but MCP callers must pass it so a dashboard ID from another tenant is treated
 * as not found.
 */
export async function readDashboard(
  db: DrizzleDb,
  id: number,
  tenantId?: string,
): Promise<{
  row: typeof dashboards.$inferSelect;
  snapshot: DashboardSnapshot;
}> {
  const [row] = await db.select().from(dashboards).where(eq(dashboards.id, id));
  if (!row || (tenantId && row.tenantId !== tenantId)) {
    throw notFound(`Dashboard ${id} not found`);
  }
  const items = await db
    .select()
    .from(dashboardItems)
    .where(eq(dashboardItems.dashboardId, id));

  return {
    row,
    snapshot: {
      name: row.name,
      description: row.description,
      filters: row.filtersJson ? JSON.parse(row.filtersJson) : [],
      theme: row.theme ?? undefined,
      colors: row.colorsJson ? JSON.parse(row.colorsJson) : undefined,
      items: items.map((item: any) => ({
        id: item.id,
        title: item.title,
        sql: item.sql,
        connectionId: item.connectionId,
        savedQueryId: item.savedQueryId ?? null,
        blockType: item.blockType as DashboardSnapshot['items'][number]['blockType'],
        config: parseConfig(item.configJson),
        layout: JSON.parse(item.layoutJson),
      })),
    },
  };
}

function parseConfig(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export async function dashboardResponse(db: DrizzleDb, id: number, tenantId?: string) {
  const { row, snapshot } = await readDashboard(db, id, tenantId);
  const latestVersion = await latestDashboardVersion(db, id);

  const dashTags = await db.select().from(dashboardTags).where(eq(dashboardTags.dashboardId, id));
  const allTags = await db.select().from(tags).where(eq(tags.tenantId, row.tenantId));
  const tagNames = dashTags
    .map((association: any) => allTags.find((tag: any) => tag.id === association.tagId)?.name)
    .filter(Boolean) as string[];

  return {
    id: row.id,
    name: snapshot.name,
    description: snapshot.description,
    tags: tagNames,
    filters: snapshot.filters ?? [],
    theme: snapshot.theme,
    colors: snapshot.colors,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    latestVersion,
    items: snapshot.items.map((item: any) => ({
      id: item.id,
      dashboardId: row.id,
      title: item.title,
      sql: item.sql,
      connectionId: item.connectionId,
      savedQueryId: item.savedQueryId ?? null,
      blockType: item.blockType,
      config: item.config,
      layout: item.layout,
      createdAt: row.createdAt,
    })),
  };
}

async function serializeSnapshot(db: DrizzleDb, snapshot: DashboardSnapshot): Promise<string> {
  const connectionList = await db
    .select({ id: connections.id, name: connections.name })
    .from(connections);
  return serializeDashboardManifest(snapshot, connectionList);
}

export async function latestDashboardVersion(db: DrizzleDb, dashboardId: number): Promise<number> {
  return (
    await db
      .select({ version: dashboardVersions.version })
      .from(dashboardVersions)
      .where(eq(dashboardVersions.dashboardId, dashboardId))
  ).reduce((max: any, row: any) => Math.max(max, row.version), 0);
}

export async function assertBaseVersion(
  db: DrizzleDb,
  dashboardId: number,
  baseVersion?: number,
): Promise<void> {
  if (baseVersion === undefined) return;
  const latest = await latestDashboardVersion(db, dashboardId);
  if (baseVersion !== latest) {
    throw new ApiError(
      409,
      'VERSION_CONFLICT',
      `Dashboard is at v${latest}, but the request expected v${baseVersion}. Reload and retry.`,
    );
  }
}

export async function insertVersion(
  db: DrizzleDb,
  dashboardId: number,
  snapshot: DashboardSnapshot,
  message: string | null,
  kind: DashboardVersionKind['kind'],
  authorId: number | null,
  authorEmail?: string | null,
): Promise<DashboardVersionSummary> {
  const latest = await latestDashboardVersion(db, dashboardId);
  const version = latest + 1;
  const now = new Date().toISOString();

  const [inserted] = await db
    .insert(dashboardVersions)
    .values({
      dashboardId,
      version,
      parentVersion: latest > 0 ? latest : null,
      message,
      authorId,
      authorEmail: authorEmail ?? null,
      kind,
      snapshotJson: JSON.stringify(snapshot),
      codeText: await serializeSnapshot(db, snapshot),
      createdAt: now,
    })
    .returning();
  return {
    id: inserted.id,
    dashboardId: inserted.dashboardId,
    version: inserted.version,
    parentVersion: inserted.parentVersion,
    message: inserted.message,
    authorId: inserted.authorId,
    authorEmail: inserted.authorEmail,
    kind: inserted.kind as DashboardVersionKind['kind'],
    createdAt: inserted.createdAt,
  };
}

export async function touchDashboard(db: DrizzleDb, id: number): Promise<void> {
  await db
    .update(dashboards)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(dashboards.id, id));
}

export async function applySnapshot(
  db: DrizzleDb,
  id: number,
  snapshot: DashboardSnapshot,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .update(dashboards)
    .set({
      name: snapshot.name,
      description: snapshot.description,
      filtersJson: JSON.stringify(snapshot.filters ?? []),
      theme: snapshot.theme ?? null,
      colorsJson: snapshot.colors ? JSON.stringify(snapshot.colors) : null,
      updatedAt: now,
    })
    .where(eq(dashboards.id, id));
  await db.delete(dashboardItems).where(eq(dashboardItems.dashboardId, id));

  for (const item of snapshot.items) {
    await db
      .insert(dashboardItems)
      .values({
        dashboardId: id,
        title: item.title,
        sql: item.sql,
        connectionId: item.connectionId,
        savedQueryId: item.savedQueryId ?? null,
        blockType: item.blockType,
        configJson: item.config ? JSON.stringify(item.config) : null,
        layoutJson: JSON.stringify(item.layout),
        createdAt: now,
      });
  }
}

/**
 * Replace the dashboard's blocks and record a version. Shared by
 * `PUT /api/dashboards/:id/state` and the `apply_dashboard_state` MCP tool.
 */
export async function applyDashboardState(
  db: DrizzleDb,
  id: number,
  state: ApplyDashboardState,
  authorId: number | null,
  tenantId?: string,
  authorEmail?: string | null,
): Promise<{ dashboard: Awaited<ReturnType<typeof dashboardResponse>>; version: DashboardVersionSummary }> {
  const { snapshot: current } = await readDashboard(db, id, tenantId);
  await assertBaseVersion(db, id, state.baseVersion);

  const snapshot: DashboardSnapshot = {
    name: state.name ?? current.name,
    description: state.description === undefined ? current.description : state.description,
    filters:
      state.filters === undefined
        ? current.filters ?? []
        : (state.filters as unknown as ManifestFilter[]),
    theme: state.theme === undefined ? current.theme : state.theme,
    colors: state.colors === undefined ? current.colors : state.colors,
    items: state.items.map((item) => ({
      title: item.title,
      sql: item.sql,
      connectionId: item.connectionId,
      savedQueryId: item.savedQueryId ?? null,
      blockType: item.blockType,
      config: item.config ?? null,
      layout: item.layout,
    })),
  };

  await applySnapshot(db, id, snapshot);
  const version = await insertVersion(
    db,
    id,
    snapshot,
    state.message ?? 'Apply dashboard code',
    state.kind,
    authorId,
    authorEmail ?? null,
  );

  return { dashboard: await dashboardResponse(db, id, tenantId), version };
}

export async function exportDashboardCode(
  db: DrizzleDb,
  id: number,
  tenantId?: string,
): Promise<string> {
  const { snapshot } = await readDashboard(db, id, tenantId);
  const connectionList = await db
    .select({ id: connections.id, name: connections.name })
    .from(connections);
  return serializeDashboardManifest(snapshot, connectionList);
}

export async function copyDashboard(
  db: DrizzleDb,
  id: number,
  authorId: number | null,
  tenantId?: string,
): Promise<{ dashboard: Awaited<ReturnType<typeof dashboardResponse>>; version: DashboardVersionSummary }> {
  const { row, snapshot: original } = await readDashboard(db, id, tenantId);
  const snapshot: DashboardSnapshot = {
    ...original,
    name: `Copy of ${original.name}`,
  };
  const now = new Date().toISOString();
  const tenant = tenantId ?? row.tenantId;
  const [inserted] = await db
    .insert(dashboards)
    .values({
      name: snapshot.name,
      description: snapshot.description,
      filtersJson: JSON.stringify(snapshot.filters ?? []),
      theme: snapshot.theme ?? null,
      colorsJson: snapshot.colors ? JSON.stringify(snapshot.colors) : null,
      tenantId: tenant,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  await applySnapshot(db, inserted.id, snapshot);
  const version = await insertVersion(db, inserted.id, snapshot, 'Copied dashboard', 'manual', authorId);
  return { dashboard: await dashboardResponse(db, inserted.id, tenantId), version };
}

export async function importDashboard(
  db: DrizzleDb,
  code: string,
  authorId: number | null,
  tenantId?: string,
  name?: string,
): Promise<{ dashboard: Awaited<ReturnType<typeof dashboardResponse>>; version: DashboardVersionSummary; diagnostics: any[] }> {
  const connectionList = await db
    .select({ id: connections.id, name: connections.name })
    .from(connections);
  const parsed = parseDashboardManifest(code, connectionList);
  const snapshot: DashboardSnapshot = parsed.dashboard;
  if (name) snapshot.name = name;

  const now = new Date().toISOString();
  const tenant = tenantId ?? '00000000-0000-0000-0000-000000000000';
  const [inserted] = await db
    .insert(dashboards)
    .values({
      name: snapshot.name,
      description: snapshot.description,
      filtersJson: JSON.stringify(snapshot.filters ?? []),
      theme: snapshot.theme ?? null,
      colorsJson: snapshot.colors ? JSON.stringify(snapshot.colors) : null,
      tenantId: tenant,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  await applySnapshot(db, inserted.id, snapshot);
  const version = await insertVersion(db, inserted.id, snapshot, 'Imported dashboard', 'manual', authorId);
  return { dashboard: await dashboardResponse(db, inserted.id, tenantId), version, diagnostics: parsed.diagnostics };
}
