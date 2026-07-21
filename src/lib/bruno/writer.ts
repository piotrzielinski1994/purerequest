import {
  type CollectionWriter,
  createCollectionWriter,
  createNoopCollectionWriter,
  createTauriCollectionWriter,
} from "@/lib/export/collection-writer";

export type BrunoExportWriter = CollectionWriter;

export const createBrunoWriter = createCollectionWriter;
export const createTauriBrunoWriter = createTauriCollectionWriter;
export const createNoopBrunoWriter = createNoopCollectionWriter;
