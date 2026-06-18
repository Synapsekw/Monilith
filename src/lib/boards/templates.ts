import type { ColumnKind } from "@/lib/validations/boards";

export type TemplateOption = { ref: string; label: string; color: string };

export type TemplateColumn = {
  ref: string;
  kind: ColumnKind;
  name: string;
  options?: TemplateOption[]; // status / dropdown only
  settings?: { unit?: string; precision?: number }; // numbers only
};

export type TemplateGroup = { ref: string; name: string; color: string };

export type TemplateCellValue =
  | { optionRef: string } // status   -> { optionId }
  | { optionRefs: string[] } // dropdown -> { optionIds }
  | { dateOffset: number; endOffset?: number } // date -> { date, end? }
  | { n: number } // numbers -> { n }
  | { text: string }; // text -> { text }

export type TemplateItem = {
  groupRef: string;
  name: string;
  cells: Record<string, TemplateCellValue>; // keyed by column ref
};

export type BoardTemplate = {
  id: string;
  name: string;
  icon: string; // lucide key, mapped in the picker
  description: string;
  columns: TemplateColumn[];
  groups: TemplateGroup[];
  items: TemplateItem[];
};

// Shared status palette (Monday-ish hexes used elsewhere in the app).
const C = {
  green: "#00c875",
  amber: "#fdab3d",
  red: "#e2445c",
  grey: "#c4c4c4",
  slate: "#808080",
  indigo: "#6366f1",
  violet: "#8b5cf6",
  sky: "#38bdf8",
  pink: "#ec4899",
  teal: "#14b8a6",
  orange: "#f97316",
};

export const BOARD_TEMPLATES: BoardTemplate[] = [
  {
    id: "blank",
    name: "Blank board",
    icon: "board",
    description: "Status, Owner and Date to start from scratch.",
    groups: [{ ref: "g1", name: "Group 1", color: C.indigo }],
    columns: [
      {
        ref: "c_status",
        kind: "status",
        name: "Status",
        options: [
          { ref: "working", label: "Working on it", color: C.amber },
          { ref: "stuck", label: "Stuck", color: C.red },
          { ref: "done", label: "Done", color: C.green },
          { ref: "notstarted", label: "Not started", color: C.grey },
        ],
      },
      { ref: "c_owner", kind: "people", name: "Owner" },
      { ref: "c_date", kind: "date", name: "Date" },
    ],
    items: [],
  },
  {
    id: "sprints",
    name: "Sprint planning",
    icon: "rocket",
    description: "Backlog / In Sprint / Done with points & progress.",
    groups: [
      { ref: "g_backlog", name: "Backlog", color: C.slate },
      { ref: "g_sprint", name: "In Sprint", color: C.indigo },
      { ref: "g_done", name: "Done", color: C.green },
    ],
    columns: [
      {
        ref: "c_status",
        kind: "status",
        name: "Status",
        options: [
          { ref: "working", label: "Working on it", color: C.amber },
          { ref: "stuck", label: "Stuck", color: C.red },
          { ref: "done", label: "Done", color: C.green },
          { ref: "notstarted", label: "Not started", color: C.grey },
        ],
      },
      { ref: "c_owner", kind: "people", name: "Owner" },
      {
        ref: "c_points",
        kind: "numbers",
        name: "Points",
        settings: { unit: " pts" },
      },
      {
        ref: "c_progress",
        kind: "numbers",
        name: "Progress",
        settings: { unit: "%" },
      },
      { ref: "c_sprint", kind: "date", name: "Sprint" },
    ],
    items: [
      {
        groupRef: "g_sprint",
        name: "Build onboarding flow",
        cells: {
          c_status: { optionRef: "working" },
          c_points: { n: 8 },
          c_progress: { n: 40 },
          c_sprint: { dateOffset: 0, endOffset: 14 },
        },
      },
      {
        groupRef: "g_sprint",
        name: "Fix flaky tests",
        cells: {
          c_status: { optionRef: "stuck" },
          c_points: { n: 3 },
          c_progress: { n: 10 },
          c_sprint: { dateOffset: 0, endOffset: 14 },
        },
      },
      {
        groupRef: "g_backlog",
        name: "Research auth providers",
        cells: {
          c_status: { optionRef: "notstarted" },
          c_points: { n: 5 },
          c_progress: { n: 0 },
        },
      },
      {
        groupRef: "g_done",
        name: "Ship settings page",
        cells: {
          c_status: { optionRef: "done" },
          c_points: { n: 5 },
          c_progress: { n: 100 },
        },
      },
    ],
  },
  {
    id: "content",
    name: "Content calendar",
    icon: "megaphone",
    description: "Ideas / Writing / Published with channel & publish date.",
    groups: [
      { ref: "g_ideas", name: "Ideas", color: C.violet },
      { ref: "g_progress", name: "In Progress", color: C.amber },
      { ref: "g_published", name: "Published", color: C.green },
    ],
    columns: [
      {
        ref: "c_stage",
        kind: "status",
        name: "Stage",
        options: [
          { ref: "idea", label: "Idea", color: C.violet },
          { ref: "writing", label: "Writing", color: C.amber },
          { ref: "review", label: "Review", color: C.sky },
          { ref: "published", label: "Published", color: C.green },
        ],
      },
      { ref: "c_writer", kind: "people", name: "Writer" },
      {
        ref: "c_channel",
        kind: "dropdown",
        name: "Channel",
        options: [
          { ref: "blog", label: "Blog", color: C.indigo },
          { ref: "social", label: "Social", color: C.pink },
          { ref: "email", label: "Email", color: C.teal },
          { ref: "video", label: "Video", color: C.orange },
        ],
      },
      { ref: "c_publish", kind: "date", name: "Publish" },
      { ref: "c_draft", kind: "text", name: "Draft" },
    ],
    items: [
      {
        groupRef: "g_progress",
        name: "Dark mode design deep-dive",
        cells: {
          c_stage: { optionRef: "writing" },
          c_channel: { optionRefs: ["blog"] },
          c_publish: { dateOffset: 5 },
        },
      },
      {
        groupRef: "g_progress",
        name: "Launch thread",
        cells: {
          c_stage: { optionRef: "review" },
          c_channel: { optionRefs: ["social"] },
          c_publish: { dateOffset: 2 },
        },
      },
      {
        groupRef: "g_ideas",
        name: "Customer story: Acme",
        cells: {
          c_stage: { optionRef: "idea" },
          c_channel: { optionRefs: ["blog"] },
          c_publish: { dateOffset: 20 },
        },
      },
      {
        groupRef: "g_published",
        name: "Weekly newsletter #42",
        cells: {
          c_stage: { optionRef: "published" },
          c_channel: { optionRefs: ["email"] },
          c_publish: { dateOffset: -2 },
        },
      },
    ],
  },
  {
    id: "crm",
    name: "Sales CRM",
    icon: "dashboard",
    description: "Leads / Negotiation / Won with deal size & priority.",
    groups: [
      { ref: "g_leads", name: "Leads", color: C.sky },
      { ref: "g_play", name: "In Play", color: C.amber },
      { ref: "g_closed", name: "Closed", color: C.green },
    ],
    columns: [
      {
        ref: "c_stage",
        kind: "status",
        name: "Stage",
        options: [
          { ref: "lead", label: "Lead", color: C.sky },
          { ref: "negotiation", label: "Negotiation", color: C.amber },
          { ref: "won", label: "Won", color: C.green },
          { ref: "lost", label: "Lost", color: C.red },
        ],
      },
      { ref: "c_rep", kind: "people", name: "Rep" },
      {
        ref: "c_deal",
        kind: "numbers",
        name: "Deal size",
        settings: { unit: "$" },
      },
      {
        ref: "c_priority",
        kind: "status",
        name: "Priority",
        options: [
          { ref: "hot", label: "Hot", color: C.red },
          { ref: "warm", label: "Warm", color: C.amber },
          { ref: "cold", label: "Cold", color: C.slate },
        ],
      },
      { ref: "c_close", kind: "date", name: "Close date" },
    ],
    items: [
      {
        groupRef: "g_play",
        name: "Acme Corp — Platform",
        cells: {
          c_stage: { optionRef: "negotiation" },
          c_deal: { n: 48000 },
          c_priority: { optionRef: "hot" },
          c_close: { dateOffset: 12 },
        },
      },
      {
        groupRef: "g_play",
        name: "Northwind — Teams",
        cells: {
          c_stage: { optionRef: "negotiation" },
          c_deal: { n: 22000 },
          c_priority: { optionRef: "warm" },
          c_close: { dateOffset: 25 },
        },
      },
      {
        groupRef: "g_leads",
        name: "Globex — Trial",
        cells: {
          c_stage: { optionRef: "lead" },
          c_deal: { n: 9000 },
          c_priority: { optionRef: "cold" },
          c_close: { dateOffset: 40 },
        },
      },
      {
        groupRef: "g_closed",
        name: "Initech — Renewal",
        cells: {
          c_stage: { optionRef: "won" },
          c_deal: { n: 31000 },
          c_priority: { optionRef: "hot" },
          c_close: { dateOffset: -3 },
        },
      },
    ],
  },
];

export function getTemplate(id: string): BoardTemplate | undefined {
  return BOARD_TEMPLATES.find((t) => t.id === id);
}
