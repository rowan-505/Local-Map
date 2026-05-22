import type { PrismaClient } from "@prisma/client";

import { AddressIndexRepository } from "./address-index.repo.js";

/** Fire-and-forget safe refresh; logs failures without throwing to callers. */
export async function refreshAddressSearchIndex(
    prisma: PrismaClient,
    addressIds: readonly bigint[] | null,
    log?: { warn: (obj: object, msg: string) => void }
): Promise<void> {
    try {
        const repo = new AddressIndexRepository(prisma);
        await repo.refresh(addressIds);
    } catch (err) {
        log?.warn({ err, addressIds: addressIds?.map(String) ?? null }, "search.refresh_address_index failed");
    }
}
