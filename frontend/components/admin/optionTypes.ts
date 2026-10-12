export type OptionTypeKey =
  | "categories"
  | "delivery-modes"
  | "accommodations"
  | "entities"
  | "faculty-types"
  | "program-types"
  | "verticals";

export const OPTION_TYPE_LABELS: Record<OptionTypeKey, string> = {
  categories: "Categories",
  "delivery-modes": "Delivery Modes",
  accommodations: "Accommodations",
  entities: "Legal Entities",
  "faculty-types": "Faculty Types",
  "program-types": "Program Types",
  verticals: "Verticals",
};

export const OPTION_TYPE_KEYS = Object.keys(OPTION_TYPE_LABELS) as OptionTypeKey[];

export function isOptionTypeKey(value: string): value is OptionTypeKey {
  return value in OPTION_TYPE_LABELS;
}