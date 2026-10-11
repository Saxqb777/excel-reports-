"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UploadFlow } from "./UploadFlow";
import { UnlockHost } from "./UnlockPrompt";

/** A project without data yet: the first workbook is dropped or chosen here (large files go straight to storage). */
export function EmptyProject({ projectId, name, locked, homeHref }: { projectId: string; name: string; locked: boolean; homeHref: string | null }) {
  const router = useRouter();
  return (
    <>
      <UploadFlow projectId={projectId} locked={locked} onDone={() => router.refresh()}>
        {({ openPicker, busy }) => (
          <main className="mx-auto min-h-screen max-w-xl bg-bg px-6 py-24">
            <div className="label mb-2">{name}</div>
            <h1 className="text-xl font-medium">No data yet.</h1>
            <p className="mt-2 text-ink-2">Drop the workbook anywhere on this page, or choose it, to build this dashboard. Excel (.xlsx, .xlsb) and CSV files work; large files upload straight to storage, which can take a minute.</p>
            <div className="mt-6 flex flex-wrap gap-2">
              <button type="button" className="btn btn-accent" onClick={openPicker} disabled={busy}>{busy ? "Loading…" : "Choose the workbook"}</button>
              {homeHref && <Link href={homeHref} className="btn">Back to projects</Link>}
            </div>
          </main>
        )}
      </UploadFlow>
      <UnlockHost />
    </>
  );
}
