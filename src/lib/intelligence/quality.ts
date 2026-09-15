import type { FilterExpr, Snapshot } from "@/lib/schema/types";

export interface LogicIssue { id: string; rule: string; rows: string[]; count: number; severity: "warn" | "neg"; filter?: FilterExpr }

/** Cross-field logic checks driven by semantics, so they work on any sheet with the same meanings. */
export function logicChecks(s: Snapshot): LogicIssue[] {
  const f = (sem: string) => s.fields.find((x) => x.semantic === sem);
  const idField = s.fields.find((x) => x.role === "id");
  const idOf = (i: number) => (idField ? String(s.columns[idField.id]?.[i] ?? `row ${s.rowRefs[i]}`) : `row ${s.rowRefs[i]}`);
  const received = f("received_date"), quoted = f("quoted_date"), status = f("status"), outcome = f("outcome"), reason = f("reason"), remarks = f("remarks");
  const issues: LogicIssue[] = [];
  const collect = (id: string, rule: string, severity: "warn" | "neg", test: (i: number) => boolean) => {
    const rows: string[] = [];
    for (let i = 0; i < s.n; i++) if (test(i)) rows.push(idOf(i));
    if (rows.length) issues.push({ id, rule, rows, count: rows.length, severity, filter: idField ? { field: idField.id, op: "in", value: rows } : undefined });
  };
  if (received && quoted) collect("quoted_before_received", `${quoted.label} is before ${received.label}`, "neg", (i) => { const a = s.columns[received.id][i], b = s.columns[quoted.id][i]; return typeof a === "number" && typeof b === "number" && b < a; });
  if (status && quoted) collect("quoted_no_date", `${status.label} says quoted but ${quoted.label} is blank`, "warn", (i) => /quoted|sent/i.test(String(s.columns[status.id][i] ?? "")) && s.columns[quoted.id][i] === null);
  if (status && outcome) collect("outcome_without_quote", `${outcome.label} is set but ${status.label} is not quoted`, "warn", (i) => s.columns[outcome.id][i] !== null && !/quoted|sent/i.test(String(s.columns[status.id][i] ?? "")));
  if (outcome && reason) collect("lost_no_reason", `Lost without a ${reason.label.toLowerCase()}`, "warn", (i) => /lost|loss/i.test(String(s.columns[outcome.id][i] ?? "")) && s.columns[reason.id][i] === null);
  if (outcome && remarks) collect("won_but_remark_conflicts", `Marked won but the latest update reads like a problem`, "warn", (i) => /won|win/i.test(String(s.columns[outcome.id][i] ?? "")) && /could not|couldn't|cancel|not complete|waiting|pending|on hold/i.test(String(s.columns[remarks.id][i] ?? "")));
  if (received) collect("no_received_date", `${received.label} is blank`, "warn", (i) => s.columns[received.id][i] === null);
  return issues;
}
