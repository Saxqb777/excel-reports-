import type { Layout } from "@/lib/dashboard/types";
import type { Field, SchemaMap } from "@/lib/schema/types";
import { normKey } from "@/lib/schema/types";

/**
 * Curated configuration for the Agthia RFQ tracker. Applied when the uploaded sheet's headers
 * match this fingerprint; otherwise the generic proposal engine is used.
 */
export const AGTHIA_FINGERPRINT = ["tracking no.", "request description", "origin", "destination", "freight type", "date received", "date quoted", "quotation status", "won/lost"];

export function matchesAgthia(headers: string[]): boolean {
  const set = new Set(headers.map(normKey));
  return AGTHIA_FINGERPRINT.every((h) => set.has(h));
}

const PLACE_MAP: Record<string, string> = {
  "uae": "UAE", "u.a.e": "UAE", "united arab emirates": "UAE", "all uae": "UAE (all)",
  "dubai": "Dubai, UAE", "duabi": "Dubai, UAE", "dxb": "Dubai, UAE",
  "abu dhabi": "Abu Dhabi, UAE", "auh": "Abu Dhabi, UAE", "auh -kizad": "Kizad, Abu Dhabi", "kizad": "Kizad, Abu Dhabi",
  "al ain": "Al Ain, UAE", "ain": "Al Ain, UAE", "al saad": "Al Saad (Al Ain), UAE", "al saad -)": "Al Saad (Al Ain), UAE", "al foah company": "Al Foah, Al Ain, UAE",
  "al wathba": "Al Wathba, Abu Dhabi", "mussafah i cad": "Mussafah ICAD, Abu Dhabi", "mussafah": "Mussafah, Abu Dhabi",
  "gmff ( mina zayed)": "Grand Mills (Mina Zayed), Abu Dhabi", "gmff": "Grand Mills (Mina Zayed), Abu Dhabi", "mina zayed": "Mina Zayed, Abu Dhabi",
  "jafza": "JAFZA, Dubai", "jebel ali": "Jebel Ali, Dubai",
  "ksa": "Saudi Arabia", "saudi": "Saudi Arabia", "saudi arabia": "Saudi Arabia",
  "kuwait": "Kuwait", "china": "China", "nigeria": "Nigeria", "ireland": "Ireland", "germany": "Germany",
  "eygpet": "Egypt", "egypt": "Egypt", "alugria": "Algeria", "algeria": "Algeria",
  "different loaction": "Multiple locations, UAE", "various": "Multiple locations, UAE",
};

/** Agthia's legal entities, in the order the business wants them listed. New entities typed into the sheet appear after these. */
export const AGTHIA_ENTITIES = ["Agthia Group PJSC", "Al Ain Food & Beverages PJSC", "Grand Mills", "Al Foah Company LLC", "BMB Group", "Al Faysal Bakery"];
const ENTITY_HEADER = /^(company|agthia company entit|entit(y|ies)|business unit)/i;
const ENTITY_ALIASES = ["Company", "Agthia company entities", "Entity", "Business unit"];

export function agthiaSchema(inferred: SchemaMap): SchemaMap {
  const bySource = new Map(inferred.fields.map((f) => [normKey(f.source ?? ""), f] as const));
  const pick = (h: string): Field | undefined => bySource.get(normKey(h));
  const fields: Field[] = [];
  const add = (f: Field | undefined, patch: Partial<Field>) => { if (f) fields.push({ ...f, ...patch }); };
  // A real entity column in the sheet beats the keyword guess below.
  const entityColumn = inferred.fields.find((f) => f.source && ENTITY_HEADER.test(f.source.trim()));

  add(pick("Tracking No."), { id: "tracking_no", label: "Tracking no.", role: "id" });
  add(pick("Request Description"), { id: "request_description", label: "Request", role: "text", semantic: "description" });
  add(pick("Origin"), { id: "origin", label: "Origin", role: "dimension", semantic: "origin", valueMap: PLACE_MAP });
  add(pick("Destination"), { id: "destination", label: "Destination", role: "dimension", semantic: "destination", valueMap: PLACE_MAP });
  add(pick("Freight Type"), { id: "freight_type", label: "Freight type", role: "dimension", semantic: "mode", allowedValues: ["Air", "Sea", "Land", "Multimodal"], valueMap: { "air/sea": "Multimodal", "sea/air": "Multimodal", "air-sea": "Multimodal", "air": "Air", "sea": "Sea", "land": "Land", "road": "Land", "truck": "Land" }, order: ["Land", "Air", "Sea", "Multimodal"] });
  add(pick("Date Received"), { id: "date_received", label: "Date received", role: "date", semantic: "received_date", format: "date" });
  add(pick("Date Quoted"), { id: "date_quoted", label: "Date quoted", role: "date", semantic: "quoted_date", format: "date" });
  add(pick("Quotation Status"), { id: "quotation_status", label: "Quotation status", role: "dimension", semantic: "status", allowedValues: ["Pending", "Quoted"], valueMap: { "pending": "Pending", "quoted": "Quoted", "open": "Pending", "sent": "Quoted" }, order: ["Pending", "Quoted"] });
  add(pick("Won/Lost"), { id: "outcome", label: "Outcome", role: "dimension", semantic: "outcome", allowedValues: ["Won", "Lost", "Open"], valueMap: { "won": "Won", "win": "Won", "lost": "Lost", "loss": "Lost", "open": "Open" }, order: ["Won", "Lost", "Open"] });
  add(pick("Reason for Loss"), { id: "reason_for_loss", label: "Reason for loss", role: "dimension", semantic: "reason", allowedValues: ["High Price", "Transit Time", "Competitor", "No Response", "Service Limitation", "Customer Cancelled", "Others"] });
  add(pick("Remarks/Latest updates"), { id: "remarks", label: "Latest update", role: "text", semantic: "remarks" });
  add(entityColumn, { id: "company", label: "Agthia entity", role: "dimension", semantic: "business_unit", order: AGTHIA_ENTITIES, aliases: ENTITY_ALIASES.filter((a) => normKey(a) !== normKey(entityColumn?.source ?? "")) });

  // Any extra columns the sheet gains later are kept with their inferred definition.
  for (const f of inferred.fields) if (!fields.some((x) => normKey(x.source ?? "") === normKey(f.source ?? ""))) fields.push(f);

  // Derived fields
  fields.push(
    { id: "stage", label: "Stage", source: null, type: "string", role: "dimension", semantic: "lane", order: ["Pending", "Quoted · awaiting", "Won", "Lost"],
      derived: { kind: "keyword", from: ["outcome"], rules: [{ value: "Won", match: ["won"] }, { value: "Lost", match: ["lost"] }], fallback: null } },
    { id: "turnaround_days", label: "Quote turnaround", source: null, type: "number", role: "measure", semantic: "turnaround", format: "days", derived: { kind: "diffDays", from: "date_received", to: "date_quoted" } },
    { id: "age_days", label: "Days open", source: null, type: "number", role: "measure", semantic: "age", format: "days",
      derived: { kind: "ageDays", from: "date_received", when: { or: [{ field: "outcome", op: "isNull" }, { field: "outcome", op: "eq", value: "Open" }] } } },
    { id: "lane_type", label: "Lane", source: null, type: "string", role: "dimension", semantic: "lane", order: ["Domestic", "Import", "Export", "Cross-trade"], derived: { kind: "laneType", origin: "origin", destination: "destination", home: [] } },
    { id: "equipment", label: "Equipment", source: null, type: "string", role: "dimension",
      derived: { kind: "keyword", from: ["request_description"], rules: [
        { value: "Reefer trailer", match: ["reefer", "chiller", "+18"] },
        { value: "Box trailer", match: ["box trailer", "box truck", "box trailers"] },
        { value: "Curtain trailer", match: ["curtain"] },
        { value: "40ft container", match: ["40-ft", "40 ft", "40ft", "40hc", "1x40"] },
        { value: "Air freight", match: ["air freight"] },
        { value: "Contract", match: ["contract", "1 year", "monthly"] },
      ], fallback: "Other" } },
    { id: "week_received", label: "Week received", source: null, type: "date", role: "date", semantic: "period", format: "date", derived: { kind: "period", from: "date_received", unit: "week" } },
  );

  // Without a real entity column, guess the business unit from the request text.
  if (!entityColumn) fields.push({ id: "business_unit", label: "Business unit", source: null, type: "string", role: "dimension", semantic: "business_unit",
    derived: { kind: "keyword", from: ["request_description", "origin", "destination", "remarks"], rules: [
      { value: "Al Foah", match: ["al foah", "al saad", "dates project"] },
      { value: "Grand Mills", match: ["grand mills", "gmff", "mina zayed"] },
      { value: "Water", match: ["water", "hana", "al ain water", "5-gallon", "bottle"] },
    ], fallback: "Agthia general" } });

  // Stage combines status and outcome: computed as keyword over outcome, then status fills the rest.
  const stage = fields.find((f) => f.id === "stage")!;
  stage.derived = { kind: "keyword", from: ["outcome", "quotation_status"], rules: [
    { value: "Won", match: ["won"] }, { value: "Lost", match: ["lost"] }, { value: "Quoted · awaiting", match: ["quoted"] }, { value: "Pending", match: ["pending"] },
  ], fallback: "Pending" };

  return { version: 1, sheet: inferred.sheet, fields, idField: "tracking_no", primaryDate: "date_received", home: inferred.home };
}

const OPEN_FILTER = { or: [{ field: "outcome", op: "isNull" as const }, { field: "outcome", op: "eq" as const, value: "Open" }] };
const DECIDED = { field: "outcome", op: "in" as const, value: ["Won", "Lost"] };

export const AGTHIA_LAYOUT: Layout = {
  version: 1,
  dateField: "date_received",
  filters: [
    { field: "date_received", kind: "daterange", label: "Received" },
    { field: "freight_type", kind: "select", label: "Freight" },
    { field: "stage", kind: "select", label: "Stage" },
    { field: "lane_type", kind: "select", label: "Lane" },
    { field: "business_unit", kind: "select", label: "Business unit" },
    { field: "request_description", kind: "search", label: "Search" },
  ],
  pages: [
    {
      id: "overview", title: "Overview",
      widgets: [
        { id: "insights", type: "insights", title: "What changed since the last update" },
        { id: "kpi_rfqs", type: "kpi", title: "RFQs received", metric: { agg: "count" }, good: "up", sparkline: { dateField: "date_received", unit: "week" } },
        { id: "kpi_quoted", type: "kpi", title: "Quoted rate", metric: { agg: "rate", numerator: { field: "quotation_status", op: "eq", value: "Quoted" }, format: "percent" }, good: "up", secondary: { metric: { agg: "count", filter: { field: "quotation_status", op: "eq", value: "Pending" } }, label: "still pending" }, onClick: { field: "quotation_status", op: "eq", value: "Quoted" } },
        { id: "kpi_win", type: "kpi", title: "Win rate", metric: { agg: "rate", numerator: { field: "outcome", op: "eq", value: "Won" }, denominator: DECIDED, format: "percent" }, good: "up", secondary: { metric: { agg: "count", filter: DECIDED }, label: "decided" }, onClick: DECIDED },
        { id: "kpi_open", type: "kpi", title: "Awaiting decision", metric: { agg: "count", filter: { and: [{ field: "quotation_status", op: "eq", value: "Quoted" }, OPEN_FILTER] } }, good: "none", secondary: { metric: { agg: "max", field: "age_days", filter: { and: [{ field: "quotation_status", op: "eq", value: "Quoted" }, OPEN_FILTER] }, format: "days" }, label: "oldest" }, onClick: { and: [{ field: "quotation_status", op: "eq", value: "Quoted" }, OPEN_FILTER] } },
        { id: "kpi_pending", type: "kpi", title: "Awaiting quote", metric: { agg: "count", filter: { field: "quotation_status", op: "eq", value: "Pending" } }, good: "down", secondary: { metric: { agg: "max", field: "age_days", filter: { field: "quotation_status", op: "eq", value: "Pending" }, format: "days" }, label: "oldest" }, onClick: { field: "quotation_status", op: "eq", value: "Pending" } },
        { id: "funnel", type: "funnel", title: "Pipeline", subtitle: "Click a stage to filter", stages: [
          { label: "Received", filter: { field: "tracking_no", op: "notNull" }, status: "neutral" },
          { label: "Quoted", filter: { field: "quotation_status", op: "eq", value: "Quoted" }, status: "accent" },
          { label: "Won", filter: { field: "outcome", op: "eq", value: "Won" }, status: "pos" },
          { label: "Lost", filter: { field: "outcome", op: "eq", value: "Lost" }, status: "neg" },
          { label: "Awaiting", filter: { and: [{ field: "quotation_status", op: "eq", value: "Quoted" }, OPEN_FILTER] }, status: "warn" },
        ] },
        { id: "weekly", type: "line", title: "Weekly activity", subtitle: "Received vs quoted", dateField: "date_received", unit: "week", series: [
          { label: "Received", metric: { agg: "count" }, kind: "bar" },
          { label: "Quoted", metric: { agg: "count", filter: { field: "quotation_status", op: "eq", value: "Quoted" } }, kind: "line" },
        ] },
        { id: "freight_outcome", type: "bar", title: "Freight type by stage", dimension: "freight_type", metric: { agg: "count" }, stackBy: "stage", orientation: "horizontal", sort: "order", colorBy: "status" },
        { id: "actions", type: "table", title: "Action list", subtitle: "Open items by age", columns: ["tracking_no", "request_description", "stage", "age_days", "remarks"], filter: OPEN_FILTER, sort: { field: "age_days", dir: "desc" }, statusField: "stage", emphasisField: "age_days", pageSize: 12 },
        { id: "lanes", type: "bar", title: "Lanes", subtitle: "Origin to destination", dimension: "lane_type", metric: { agg: "count" }, stackBy: "stage", orientation: "horizontal", sort: "order", colorBy: "status" },
        { id: "bu", type: "bar", title: "Business unit", dimension: "business_unit", metric: { agg: "count" }, stackBy: "stage", orientation: "horizontal", colorBy: "status" },
      ],
      grid: [
        { i: "insights", x: 0, y: 0, w: 12, h: 2, minH: 2 },
        { i: "kpi_rfqs", x: 0, y: 2, w: 3, h: 3 }, { i: "kpi_quoted", x: 3, y: 2, w: 3, h: 3 }, { i: "kpi_win", x: 6, y: 2, w: 2, h: 3 },
        { i: "kpi_open", x: 8, y: 2, w: 2, h: 3 }, { i: "kpi_pending", x: 10, y: 2, w: 2, h: 3 },
        { i: "funnel", x: 0, y: 5, w: 4, h: 7 }, { i: "weekly", x: 4, y: 5, w: 5, h: 7 }, { i: "freight_outcome", x: 9, y: 5, w: 3, h: 7 },
        { i: "actions", x: 0, y: 12, w: 8, h: 9 }, { i: "lanes", x: 8, y: 12, w: 4, h: 4 }, { i: "bu", x: 8, y: 16, w: 4, h: 5 },
      ],
    },
    {
      id: "pipeline", title: "Pipeline",
      widgets: [
        { id: "turnaround", type: "dots", title: "Quote turnaround", subtitle: "Days from receipt to quote, one dot per RFQ", valueField: "turnaround_days", labelField: "tracking_no", colorField: "stage", target: 1, targetLabel: "1 day target", format: "days" },
        { id: "reasons", type: "bar", title: "Reasons for loss", subtitle: "Why quotes were lost", dimension: "reason_for_loss", metric: { agg: "count", filter: { field: "outcome", op: "eq", value: "Lost" } }, orientation: "horizontal", includeNull: true },
        { id: "equipment", type: "bar", title: "Equipment requested", dimension: "equipment", metric: { agg: "count" }, stackBy: "stage", orientation: "horizontal", colorBy: "status" },
        { id: "origins", type: "bar", title: "Top origins", dimension: "origin", metric: { agg: "count" }, orientation: "horizontal", topN: 8 },
        { id: "destinations", type: "bar", title: "Top destinations", dimension: "destination", metric: { agg: "count" }, orientation: "horizontal", topN: 8 },
        { id: "heat", type: "heatmap", title: "Business unit by lane", rowDim: "business_unit", colDim: "lane_type", metric: { agg: "count" } },
      ],
      grid: [
        { i: "turnaround", x: 0, y: 0, w: 7, h: 7 }, { i: "reasons", x: 7, y: 0, w: 5, h: 7 },
        { i: "equipment", x: 0, y: 7, w: 4, h: 7 }, { i: "origins", x: 4, y: 7, w: 4, h: 7 }, { i: "destinations", x: 8, y: 7, w: 4, h: 7 },
        { i: "heat", x: 0, y: 14, w: 12, h: 6 },
      ],
    },
    {
      id: "register", title: "Register",
      widgets: [
        { id: "register", type: "table", title: "RFQ register", columns: ["tracking_no", "request_description", "origin", "destination", "freight_type", "date_received", "date_quoted", "turnaround_days", "stage", "reason_for_loss", "remarks"], sort: { field: "date_received", dir: "desc" }, statusField: "stage", search: true, pageSize: 50 },
      ],
      grid: [{ i: "register", x: 0, y: 0, w: 12, h: 18 }],
    },
    {
      id: "quality", title: "Data quality",
      widgets: [{ id: "quality", type: "quality", title: "Data quality" }],
      grid: [{ i: "quality", x: 0, y: 0, w: 12, h: 16 }],
    },
  ],
};

/** The curated layout, with business-unit visuals bound to the sheet's entity column when the schema has one. */
export function agthiaLayout(schema: SchemaMap): Layout {
  const entity = schema.fields.find((f) => !f.derived && (f.id === "company" || f.semantic === "business_unit"));
  if (!entity) return AGTHIA_LAYOUT;
  const text = JSON.stringify(AGTHIA_LAYOUT)
    .replaceAll('"business_unit"', JSON.stringify(entity.id))
    .replaceAll('"Business unit by lane"', '"Agthia entities by lane"')
    .replaceAll('"Business unit"', '"Agthia entities"');
  const layout = JSON.parse(text) as Layout;
  for (const f of layout.filters) if (f.field === entity.id) f.label = "Entity";
  for (const page of layout.pages) for (const w of page.widgets) if (w.type === "table" && w.id === "register" && !w.columns.includes(entity.id)) w.columns.splice(1, 0, entity.id);
  return layout;
}
