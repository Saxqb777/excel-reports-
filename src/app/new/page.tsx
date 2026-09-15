import { NewProjectForm } from "./NewProjectForm";

export const metadata = { title: "New project · Meridian" };

export default function NewProjectPage() {
  return (
    <main className="min-h-screen bg-bg">
      <header className="flex h-11 items-center justify-between border-b border-line px-4">
        <a href="/" className="label hover:text-ink">Meridian</a>
        <span className="label">New project</span>
      </header>
      <div className="mx-auto max-w-2xl px-6 py-12">
        <h1 className="text-xl font-medium tracking-tight">Point Meridian at a workbook.</h1>
        <p className="mt-2 max-w-lg text-ink-2">Drop the Excel file. The sheet is read, the schema is inferred, and a dashboard is proposed. Nothing is hardcoded to column names, so the file can grow later.</p>
        <NewProjectForm />
      </div>
    </main>
  );
}
