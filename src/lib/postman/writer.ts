import {
  type CollectionWriter,
  createNoopCollectionWriter,
  createTauriCollectionWriter,
} from "@/lib/export/collection-writer";

export type PostmanExportWriter = CollectionWriter;

export const createTauriPostmanWriter = createTauriCollectionWriter;
export const createNoopPostmanWriter = createNoopCollectionWriter;
