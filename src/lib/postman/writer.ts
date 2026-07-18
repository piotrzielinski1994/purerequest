import {
  createNoopCollectionWriter,
  createTauriCollectionWriter,
  type CollectionWriter,
} from "@/lib/export/collection-writer";

export type PostmanExportWriter = CollectionWriter;

export const createTauriPostmanWriter = createTauriCollectionWriter;
export const createNoopPostmanWriter = createNoopCollectionWriter;
