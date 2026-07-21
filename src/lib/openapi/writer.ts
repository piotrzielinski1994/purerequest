import {
  type CollectionWriter,
  createNoopCollectionWriter,
  createTauriCollectionWriter,
} from "@/lib/export/collection-writer";

export type OpenapiExportWriter = CollectionWriter;

export const createTauriOpenapiWriter = createTauriCollectionWriter;
export const createNoopOpenapiWriter = createNoopCollectionWriter;
