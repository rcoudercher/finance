// Data migration: give every asset a lowercase ULID ID.
// Older assets have slug IDs (demo data), UUIDs, or uppercase ULIDs. Each one is re-keyed in a
// transaction: insert a copy under the new ID, move its valuations to it, delete the old row.
// Foreign keys stay enforced throughout. Idempotent: assets that already have a lowercase ULID are skipped.

import { eq } from 'drizzle-orm'
import type { DB } from './client'
import { assets, valuations } from './schema'
import { DEMO_ASSET_IDS } from './seed'
import { isUlid, isUlidAnyCase, ulid } from '../../shared/utils/ulid'

export function migrateAssetIdsToUlid(db: DB): { oldId: string, newId: string }[] {
  return db.transaction((tx) => {
    const renamed: { oldId: string, newId: string }[] = []
    for (const asset of tx.select().from(assets).all()) {
      if (isUlid(asset.id)) continue
      // Demo assets get their fixed ULID so `pnpm db:seed` keeps recognising them.
      const newId = (DEMO_ASSET_IDS as Record<string, string | undefined>)[asset.id]
        ?? (isUlidAnyCase(asset.id) ? asset.id.toLowerCase() : ulid(asset.createdAt))
      tx.insert(assets).values({ ...asset, id: newId }).run()
      tx.update(valuations).set({ assetId: newId }).where(eq(valuations.assetId, asset.id)).run()
      tx.delete(assets).where(eq(assets.id, asset.id)).run()
      renamed.push({ oldId: asset.id, newId })
    }
    return renamed
  })
}
