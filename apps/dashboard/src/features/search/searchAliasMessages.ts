import type { SearchAliasIndexSync, SearchAliasItem } from "./types";

export function formatIndexSyncMessage(sync: SearchAliasIndexSync | undefined): string | null {
    if (!sync) {
        return null;
    }
    if (!sync.ok) {
        return sync.error ?? "Search index refresh failed.";
    }
    return `Search index updated (+${sync.names_added} alias names, ${sync.documents_updated} document${sync.documents_updated === 1 ? "" : "s"} refreshed).`;
}

export function formatMutationSuccess(item: SearchAliasItem, verb: string): string {
    const base = `Alias ${verb}: "${item.alias_text}".`;
    const syncMsg = formatIndexSyncMessage(item.index_sync);
    return syncMsg ? `${base} ${syncMsg}` : base;
}
