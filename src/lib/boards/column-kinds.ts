import {
  Type,
  CircleDot,
  Users,
  Calendar,
  Hash,
  Tags,
  CheckSquare,
  Star,
  Link as LinkIcon,
  Mail,
  Phone,
  Paperclip,
  Timer,
} from "lucide-react";

import type { ColumnKind } from "@/lib/validations/boards";

export type KindMeta = {
  label: string;
  Icon: typeof Type;
  hasOptions: boolean;
};

/** Single source of truth for the Add-column menu + option-aware UI gating. */
export const COLUMN_KIND_META: Record<ColumnKind, KindMeta> = {
  text: { label: "Text", Icon: Type, hasOptions: false },
  status: { label: "Status", Icon: CircleDot, hasOptions: true },
  people: { label: "People", Icon: Users, hasOptions: false },
  date: { label: "Date", Icon: Calendar, hasOptions: false },
  numbers: { label: "Numbers", Icon: Hash, hasOptions: false },
  dropdown: { label: "Dropdown", Icon: Tags, hasOptions: true },
  checkbox: { label: "Checkbox", Icon: CheckSquare, hasOptions: false },
  rating: { label: "Rating", Icon: Star, hasOptions: false },
  link: { label: "Link", Icon: LinkIcon, hasOptions: false },
  email: { label: "Email", Icon: Mail, hasOptions: false },
  phone: { label: "Phone", Icon: Phone, hasOptions: false },
  files: { label: "Files", Icon: Paperclip, hasOptions: false },
  time_tracking: { label: "Time tracking", Icon: Timer, hasOptions: false },
};

export const COLUMN_KIND_ORDER: ColumnKind[] = [
  "text",
  "status",
  "people",
  "date",
  "numbers",
  "dropdown",
  "checkbox",
  "rating",
  "link",
  "email",
  "phone",
  "files",
  "time_tracking",
];
