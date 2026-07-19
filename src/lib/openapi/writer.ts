import {
  createNoopCollectionWriter,
  createTauriCollectionWriter,
  type CollectionWriter,
} from "@/lib/export/collection-writer";

export type OpenapiExportWriter = CollectionWriter;

export const createTauriOpenapiWriter = createTauriCollectionWriter;
export const createNoopOpenapiWriter = createNoopCollectionWriter;
