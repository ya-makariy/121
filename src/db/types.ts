/** Row interfaces are written by hand: no ORM, no codegen. */

export type Locale = "ru" | "en";
export type FieldType =
  | "scale" | "text" | "short_text" | "checkbox" | "single_select" | "multi_select" | "date";
export type Visibility = "shared" | "private";
export type MeetingStatus = "draft" | "scheduled" | "completed" | "cancelled";
export type ActionStatus = "open" | "in_progress" | "done" | "dropped";
export type Assignee = "manager" | "person" | "both";
export type MetricKind = "scalar" | "categorical";

export interface AppUserRow {
  id: number;
  display_name: string;
  email: string | null;
  role: string;
  locale: Locale;
  timezone: string;
  created_at: string;
  archived_at: string | null;
}

export interface MetricRow {
  id: number;
  key: string;
  label: string;
  description: string | null;
  kind: MetricKind;
  direction: 1 | -1;
  target_min: number | null;
  target_max: number | null;
  display_order: number;
  archived_at: string | null;
  created_at: string;
}

export interface PersonRow {
  id: number;
  full_name: string;
  email: string | null;
  role_title: string | null;
  timezone: string | null;
  started_on: string | null;
  cadence_days: number | null;
  cadence_anchor_on: string | null;
  default_template_id: number | null;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeamRow {
  id: number;
  name: string;
  description: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TemplateRow {
  id: number;
  name: string;
  description: string | null;
  current_version_id: number | null;
  is_default: 0 | 1;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TemplateVersionRow {
  id: number;
  template_id: number;
  version_no: number;
  parent_version_id: number | null;
  frozen_at: string | null;
  change_note: string | null;
  created_at: string;
}

export interface SectionRow {
  id: number;
  version_id: number;
  section_key: string;
  title: string;
  description: string | null;
  position: number;
}

export interface FieldRow {
  id: number;
  version_id: number;
  section_id: number;
  field_key: string;
  label: string;
  help_text: string | null;
  type: FieldType;
  visibility: Visibility;
  is_required: 0 | 1;
  position: number;
  metric_id: number | null;
  scale_min: number | null;
  scale_max: number | null;
  scale_step: number;
  scale_min_label: string | null;
  scale_max_label: string | null;
  config_json: string | null;
}

export interface OptionRow {
  id: number;
  field_id: number;
  option_key: string;
  label: string;
  score: number | null;
  color: string | null;
  position: number;
}

export interface MeetingRow {
  id: number;
  person_id: number;
  template_version_id: number | null;
  status: MeetingStatus;
  visibility: string;
  title: string | null;
  scheduled_at: string | null;
  held_on: string | null;
  duration_min: number | null;
  private_notes: string | null;
  counts_for_cadence: 0 | 1;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AnswerRow {
  id: number;
  meeting_id: number;
  field_id: number;
  field_key: string;
  num_value: number | null;
  text_value: string | null;
  date_value: string | null;
  bool_value: 0 | 1 | null;
  updated_at: string;
}

export interface ActionItemRow {
  id: number;
  person_id: number;
  created_meeting_id: number | null;
  closed_meeting_id: number | null;
  title: string;
  details: string | null;
  assignee: Assignee;
  status: ActionStatus;
  visibility: Visibility;
  due_on: string | null;
  closed_at: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface ShareLinkRow {
  id: number;
  meeting_id: number;
  token: string;
  snapshot_json: string;
  snapshot_hash: string;
  locale: Locale;
  created_at: string;
  revoked_at: string | null;
  expires_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
}

/** A field together with its options — the shape input is rendered and validated in. */
export interface FieldWithOptions extends FieldRow {
  options: OptionRow[];
}

export interface SectionWithFields extends SectionRow {
  fields: FieldWithOptions[];
}
