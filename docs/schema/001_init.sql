-- Atom Nursery → PostgreSQL, migration 001 (generated: node tools/schema_inventory.js --sql)
-- DO NOT EDIT BY HAND. Change the source declarations and re-generate, or the schema and
-- the app drift apart silently — which is the failure this whole file exists to prevent.
--
-- THREE DECISIONS ARE BAKED IN HERE, all taken before a line of it was written:
--   1. tenant_id on EVERY table, from migration 001. Adding it later means rewriting every
--      row, every index and every policy in a live database. It costs nothing now.
--   2. numeric for money, never float. Sheets stores every number as a float64, so the
--      prepay discounts, the OT, the provident fund and the payroll all run on binary
--      fractions today. This is the migration that ends that, and it only ends if the
--      column type says so.
--   3. the sheet id (STD-001, STF-011) is KEPT as `code`, not thrown away. Four years of
--      LINE messages, slips and audit rows refer to those strings; a uuid primary key with
--      no code column would orphan all of it.

create extension if not exists "pgcrypto";

-- ── tenancy ───────────────────────────────────────────────────────────────────────────
create table if not exists tenant (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,      -- "atom" — short, used in URLs and support
  name_th     text not null,
  name_en     text,
  status      text not null default 'ACTIVE',
  created_at  timestamptz not null default now()
);

-- ── ATTENDANCE_REQUEST  (HR workbook)
create table if not exists attendance_request (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  req_id                     text,
  staff_id                   text,
  date                       date,
  type                       text,
  request_time               time,
  reason                     text,
  status                     text,
  step1_by                   text,
  step1_status               text,
  step2_by                   text,
  step2_status               text,
  created_date               date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists attendance_request_code_uq on attendance_request(tenant_id, req_id);
create index if not exists attendance_request_tenant_ix on attendance_request(tenant_id);
alter table attendance_request enable row level security;

-- ── AUDIT_LOG  (HR workbook)
create table if not exists audit_log (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  timestamp                  timestamptz,
  user_id                    text,
  action                     text,
  table_name                 text,
  record_id                  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists audit_log_code_uq on audit_log(tenant_id, user_id);
create index if not exists audit_log_tenant_ix on audit_log(tenant_id);
alter table audit_log enable row level security;

-- ── CHECKIN_STAFF  (HR workbook)
create table if not exists checkin_staff (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  date                       date,
  staff_id                   text,
  check_in                   time,
  check_out                  time,
  late_minutes               numeric,
  othours                    numeric,
  status                     text,
  in_manual                  text,
  out_manual                 text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists checkin_staff_code_uq on checkin_staff(tenant_id, staff_id);
create index if not exists checkin_staff_tenant_ix on checkin_staff(tenant_id);
alter table checkin_staff enable row level security;

-- ── CLASS_CHANGE_REQ  (HR workbook)
create table if not exists class_change_req (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  req_id                     text,
  request_by                 text,
  request_by_name            text,
  created_date               date,
  status                     text,
  changes                    text,
  note                       text,
  step2_by                   text,
  decided_date               date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists class_change_req_code_uq on class_change_req(tenant_id, req_id);
create index if not exists class_change_req_tenant_ix on class_change_req(tenant_id);
alter table class_change_req enable row level security;

-- ── LEAVE_REQUEST  (HR workbook)
create table if not exists leave_request (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  leave_id                   text,
  staff_id                   text,
  department                 text,
  type                       text,
  start_date                 date,
  end_date                   date,
  days                       numeric,
  reason                     text,
  status                     text,
  step1_approver_id          text,
  step1_approver_name        text,
  step1_status               text,
  step1_date                 date,
  step1_cross_dept           text,
  step2_approver_id          text,
  step2_approver_name        text,
  step2_status               text,
  step2_date                 date,
  created_date               date,
  attachment                 text,
  half_day                   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists leave_request_code_uq on leave_request(tenant_id, leave_id);
create index if not exists leave_request_tenant_ix on leave_request(tenant_id);
alter table leave_request enable row level security;

-- ── OT_RECORDS  (HR workbook)
create table if not exists ot_records (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  otrecord_id                text,
  staff_id                   text,
  date                       date,
  hours                      numeric,
  rate                       numeric(12,2),
  amount                     numeric(12,2),
  approved_by                text,
  status                     text,
  minutes                    numeric,
  plan_out                   time,
  actual_out                 time,
  month                      text,
  step1_by                   text,
  step1_status               text,
  step2_by                   text,
  step2_status               text,
  note                       text,
  kind                       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists ot_records_code_uq on ot_records(tenant_id, otrecord_id);
create index if not exists ot_records_tenant_ix on ot_records(tenant_id);
alter table ot_records enable row level security;

-- ── PAYROLL  (HR workbook)
create table if not exists payroll (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  payroll_id                 text,
  staff_id                   text,
  month                      text,
  base_salary                numeric(12,2),
  diligence_attendance       text,
  diligence_facebook         text,
  diligence_total            numeric(12,2),
  extra_child_count          text,
  extra_child_amount         numeric(12,2),
  training_cert_count        text,
  training_cert_amount       numeric(12,2),
  otevening                  text,
  otholiday                  text,
  holiday_bonus              numeric(12,2),
  other_income               text,
  gross_income               numeric(12,2),
  social_security            text,
  contribution               numeric(12,2),
  other_deductions           numeric(12,2),
  total_deductions           numeric(12,2),
  net_pay                    numeric(12,2),
  bank_account               text,
  slip_sent                  text,
  generated_date             date,
  generated_by               text,
  pay_type                   text,
  daily_rate                 numeric(12,2),
  days_worked                text,
  child_multiplier           text,
  adjustments                text,
  adjustments_total          numeric(12,2),
  bank_name                  text,
  leave_days                 text,
  leave_limit                text,
  leave_exceeds              text,
  contribution_accum         numeric(12,2),
  position                   text,
  staff_name                 text,
  slip_url                   text,
  paid_date                  date,
  paid_by                    text,
  pause_salary_mode          text,
  pause_from                 text,
  pause_to                   text,
  pause_reason               text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists payroll_code_uq on payroll(tenant_id, payroll_id);
create index if not exists payroll_tenant_ix on payroll(tenant_id);
alter table payroll enable row level security;

-- ── PAYROLL_CONFIG  (HR workbook)
create table if not exists payroll_config (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  staff_id                   text,
  pay_type                   text,
  daily_rate                 numeric(12,2),
  base_salary                numeric(12,2),
  social_security_deduct     numeric(12,2),
  child_threshold            text,
  child_multiplier           text,
  diligence_attendance_amount numeric(12,2),
  diligence_facebook_amount  numeric(12,2),
  tax_deduct                 numeric(12,2),
  contribution               numeric(12,2),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists payroll_config_code_uq on payroll_config(tenant_id, staff_id);
create index if not exists payroll_config_tenant_ix on payroll_config(tenant_id);
alter table payroll_config enable row level security;

-- ── STAFF  (HR workbook)
create table if not exists staff (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  staff_id                   text,
  national_id                text,
  name                       text,
  name_en                    text,
  nickname                   text,
  dob                        date,
  position                   text,
  role                       text,
  department                 text,
  position_level             text,
  staff_group                text,
  reports_to                 text,
  phone                      text,
  line_uid                   text,
  start_date                 date,
  base_salary                numeric(12,2),
  require_checkin            boolean,
  password_hash              text,
  must_change_password       boolean,
  photo                      text,
  status                     text,
  nickname_en                text,
  classes                    text,
  bank_name                  text,
  bank_account               text,
  contribution_opening       numeric(12,2),
  contribution_accum         numeric(12,2),
  contribution_locked        text,
  can_class_org              boolean,
  can_food_menu              boolean,
  end_date                   date,
  end_reason                 text,
  end_remark                 text,
  email                      text,
  google_sub                 text,
  pause_from                 text,
  pause_to                   text,
  pause_reason               text,
  pause_remark               text,
  pause_salary_mode          text,
  pause_salary_amount        numeric(12,2),
  education                  text,
  edu_major                  text,
  edu_grad_date              date,
  leave_quota                text,
  pause_from                 text,
  pause_to                   text,
  pause_reason               text,
  pause_remark               text,
  pause_salary_mode          text,
  pause_salary_amount        numeric(12,2),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists staff_code_uq on staff(tenant_id, staff_id);
create index if not exists staff_tenant_ix on staff(tenant_id);
alter table staff enable row level security;

-- ── STAFF_GROUPS  (HR workbook)
create table if not exists staff_groups (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  group_name                 text,
  group_name_en              text,
  check_in_time              time,
  check_out_time             time,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists staff_groups_tenant_ix on staff_groups(tenant_id);
alter table staff_groups enable row level security;

-- ── TRAINING  (HR workbook)
create table if not exists training (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  training_id                text,
  staff_id                   text,
  course_name                text,
  date                       date,
  provider                   text,
  certificate                text,
  expire_date                date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists training_code_uq on training(tenant_id, training_id);
create index if not exists training_tenant_ix on training(tenant_id);
alter table training enable row level security;

-- ── WORK_SCHEDULE  (HR workbook)
create table if not exists work_schedule (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  staff_id                   text,
  day_of_week                text,
  check_in_time              time,
  check_out_time             time,
  effective_date             date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists work_schedule_code_uq on work_schedule(tenant_id, staff_id);
create index if not exists work_schedule_tenant_ix on work_schedule(tenant_id);
alter table work_schedule enable row level security;

-- ── ABSENCE_FOLLOWUP  (MAIN workbook, engine: absenceFollowups)
create table if not exists absence_followup (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  student_id                 text,
  note                       text,
  status                     text,
  date                       date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists absence_followup_code_uq on absence_followup(tenant_id, student_id);
create index if not exists absence_followup_tenant_ix on absence_followup(tenant_id);
alter table absence_followup enable row level security;

-- ── ABSENCE_FOLLOWUP_LOG  (MAIN workbook, engine: absenceFollowupLogs)
create table if not exists absence_followup_log (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  log_id                     text,
  student_id                 text,
  date                       date,
  time                       time,
  by_staff_id                text,
  by_name                    text,
  status                     text,
  note                       text,
  photo                      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists absence_followup_log_code_uq on absence_followup_log(tenant_id, log_id);
create index if not exists absence_followup_log_tenant_ix on absence_followup_log(tenant_id);
alter table absence_followup_log enable row level security;

-- ── ABSENCE_LOG  (MAIN workbook, engine: absenceLog)
create table if not exists absence_log (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  student_id                 text,
  date                       date,
  type                       text,
  reason                     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists absence_log_code_uq on absence_log(tenant_id, student_id);
create index if not exists absence_log_tenant_ix on absence_log(tenant_id);
alter table absence_log enable row level security;

-- ── ACTIVITY_LOG  (MAIN workbook, engine: activityLog)
create table if not exists activity_log (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  log_id                     text,
  timestamp                  timestamptz,
  user_role                  text,
  user_id                    text,
  user_name                  text,
  action                     text,
  target                     text,
  detail                     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists activity_log_code_uq on activity_log(tenant_id, log_id);
create index if not exists activity_log_tenant_ix on activity_log(tenant_id);
alter table activity_log enable row level security;

-- ── ADMIN_INBOX  (MAIN workbook) — the 🔔 in-app inbox — built when the LINE quota ran out
create table if not exists admin_inbox (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  inbox_id                   text,
  date                       date,
  category                   text,
  text                       text,
  read                       boolean,
  ref                        text,
  staff_id                   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists admin_inbox_code_uq on admin_inbox(tenant_id, inbox_id);
create index if not exists admin_inbox_tenant_ix on admin_inbox(tenant_id);
alter table admin_inbox enable row level security;

-- ── ANNOUNCEMENTS  (MAIN workbook, engine: announcements)
create table if not exists announcements (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  ann_id                     text,
  title                      text,
  title_en                   text,
  content                    text,
  content_en                 text,
  image                      text,
  date                       date,
  type                       text,
  target_group               text,
  popup                      boolean,
  start_date                 date,
  end_date                   date,
  priority                   numeric,
  start_time                 time,
  end_time                   time,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists announcements_code_uq on announcements(tenant_id, ann_id);
create index if not exists announcements_tenant_ix on announcements(tenant_id);
alter table announcements enable row level security;

-- ── AUDIT_LOG  (MAIN workbook)
create table if not exists audit_log (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  timestamp                  timestamptz,
  user_id                    text,
  action                     text,
  table_name                 text,
  record_id                  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists audit_log_code_uq on audit_log(tenant_id, user_id);
create index if not exists audit_log_tenant_ix on audit_log(tenant_id);
alter table audit_log enable row level security;

-- ── BACKUP_LOG  (MAIN workbook)
create table if not exists backup_log (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  backup_date                date,
  workbook_name              text,
  drive_file_id              text,
  status                     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists backup_log_code_uq on backup_log(tenant_id, drive_file_id);
create index if not exists backup_log_tenant_ix on backup_log(tenant_id);
alter table backup_log enable row level security;

-- ── BILLING  (MAIN workbook, engine: payments)
create table if not exists billing (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  billing_id                 text,
  student_id                 text,
  month                      text,
  amount                     numeric(12,2),
  otrollover                 text,
  due_date                   date,
  paid_date                  date,
  status                     text,
  slip_amount                numeric(12,2),
  verified_status            boolean,
  qrref                      text,
  payment_method             text,
  transaction_date           date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists billing_code_uq on billing(tenant_id, billing_id);
create index if not exists billing_tenant_ix on billing(tenant_id);
alter table billing enable row level security;

-- ── CHECKIN_STUDENT  (MAIN workbook, engine: checkinStudent)
create table if not exists checkin_student (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  date                       date,
  time                       time,
  student_id                 text,
  parent_id                  text,
  type                       text,
  gps_lat                    text,
  gps_lng                    text,
  status                     text,
  remark                     text,
  by_staff_id                text,
  by_at                      timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists checkin_student_code_uq on checkin_student(tenant_id, student_id);
create index if not exists checkin_student_tenant_ix on checkin_student(tenant_id);
alter table checkin_student enable row level security;

-- ── CLASS_COVER  (MAIN workbook, engine: classCover) — engine-managed — a teacher lent to another class
create table if not exists class_cover (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  cover_id                   text,
  staff_id                   text,
  class_name                 text,
  from_date                  date,
  to_date                    date,
  note                       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists class_cover_code_uq on class_cover(tenant_id, cover_id);
create index if not exists class_cover_tenant_ix on class_cover(tenant_id);
alter table class_cover enable row level security;

-- ── CLASSES  (MAIN workbook, engine: classes)
create table if not exists classes (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  class_id                   text,
  class_name                 text,
  teacher_id                 text,
  age_range                  text,
  capacity                   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists classes_code_uq on classes(tenant_id, class_id);
create index if not exists classes_tenant_ix on classes(tenant_id);
alter table classes enable row level security;

-- ── COMMENTS  (MAIN workbook, engine: comments)
create table if not exists comments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  comment_id                 text,
  student_id                 text,
  parent_id                  text,
  sender_role                text,
  message                    text,
  timestamp                  timestamptz,
  read_status                boolean,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists comments_code_uq on comments(tenant_id, comment_id);
create index if not exists comments_tenant_ix on comments(tenant_id);
alter table comments enable row level security;

-- ── DAILY_JOURNAL  (MAIN workbook, engine: journals)
create table if not exists daily_journal (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  date                       date,
  student_id                 text,
  teacher_id                 text,
  mood                       text,
  health                     text,
  milk                       text,
  meals                      text,
  sleep                      text,
  toilet                     text,
  activity                   text,
  skills                     text,
  highlight                  text,
  health_detail              text,
  milk_total                 numeric,
  water                      numeric,
  theme                      text,
  submitted_at               timestamptz,
  status                     text,
  updated_at                 timestamptz,
  milk_unit                  text,
  parent_comment             text,
  meal_items                 text,
  milk_times                 text,
  photo1                     text,
  photo2                     text,
  photo3                     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists daily_journal_code_uq on daily_journal(tenant_id, student_id);
create index if not exists daily_journal_tenant_ix on daily_journal(tenant_id);
alter table daily_journal enable row level security;

-- ── DSPM_ASSESSMENT  (MAIN workbook, engine: assessments)
create table if not exists dspm_assessment (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  assessment_id              text,
  student_id                 text,
  age_month                  numeric,
  item_no                    numeric,
  skill                      text,
  result                     text,
  date                       date,
  teacher_id                 text,
  teacher_name               text,
  timestamp                  timestamptz,
  admin_comment              text,
  comment_by                 text,
  comment_at                 timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists dspm_assessment_code_uq on dspm_assessment(tenant_id, assessment_id);
create index if not exists dspm_assessment_tenant_ix on dspm_assessment(tenant_id);
alter table dspm_assessment enable row level security;

-- ── DSPM_CRITERIA  (MAIN workbook, engine: dspmCriteria)
create table if not exists dspm_criteria (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  age_from                   text,
  age_to                     text,
  age_label_th               text,
  item_no                    numeric,
  skill                      text,
  description                text,
  description_en             text,
  method                     text,
  pass_criteria              text,
  track                      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists dspm_criteria_tenant_ix on dspm_criteria(tenant_id);
alter table dspm_criteria enable row level security;

-- ── FOOD_ITEMS  (MAIN workbook, engine: foodItems) — engine-managed
create table if not exists food_items (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  item_id                    text,
  name                       text,
  name_en                    text,
  category                   text,
  allergens                  text,
  active                     boolean,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists food_items_code_uq on food_items(tenant_id, item_id);
create index if not exists food_items_tenant_ix on food_items(tenant_id);
alter table food_items enable row level security;

-- ── FOOD_MENU  (MAIN workbook, engine: foodMenus) — engine-managed (ensureCollectionSheet_ creates it from first write)
create table if not exists food_menu (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  menu_id                    text,
  month                      text,
  day                        text,
  slot                       text,
  item_id                    text,
  note                       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists food_menu_code_uq on food_menu(tenant_id, menu_id);
create index if not exists food_menu_tenant_ix on food_menu(tenant_id);
alter table food_menu enable row level security;

-- ── GROWTH_RECORDS  (MAIN workbook, engine: growthRecords)
create table if not exists growth_records (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  date                       date,
  student_id                 text,
  age_month                  numeric,
  weight                     numeric,
  height                     numeric,
  recorded_by                text,
  recorded_at                timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists growth_records_code_uq on growth_records(tenant_id, student_id);
create index if not exists growth_records_tenant_ix on growth_records(tenant_id);
alter table growth_records enable row level security;

-- ── HOLIDAY_ATTEND  (MAIN workbook, engine: holidayAttend)
create table if not exists holiday_attend (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  date                       date,
  student_id                 text,
  added_by                   text,
  added_at                   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists holiday_attend_code_uq on holiday_attend(tenant_id, student_id);
create index if not exists holiday_attend_tenant_ix on holiday_attend(tenant_id);
alter table holiday_attend enable row level security;

-- ── HOLIDAYS  (MAIN workbook, engine: holidays)
create table if not exists holidays (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  date                       date,
  name_th                    text,
  name_en                    text,
  recurring                  text,
  start_time                 time,
  end_time                   time,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists holidays_tenant_ix on holidays(tenant_id);
alter table holidays enable row level security;

-- ── INJURY_REPORTS  (MAIN workbook, engine: injuryReports)
create table if not exists injury_reports (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  injury_id                  text,
  date                       date,
  time                       time,
  center_name                text,
  affiliation_type           text,
  affiliation_other          text,
  district                   text,
  recorder_name              text,
  student_id                 text,
  child_name                 text,
  sex                        text,
  age_years                  text,
  age_months                 text,
  edu_status                 text,
  edu_grade                  text,
  narrative                  text,
  cause_object               text,
  witness                    text,
  place                      text,
  place_other                text,
  injury_types               text,
  teacher_id                 text,
  created_date               date,
  created_at                 timestamptz,
  notify_parent              boolean,
  status                     text,
  leader_by                  text,
  leader_at                  timestamptz,
  admin_by                   text,
  admin_at                   timestamptz,
  reject_reason              text,
  updated_by                 text,
  updated_at                 timestamptz,
  reject_by                  text,
  reject_at                  timestamptz,
  resubmitted_at             timestamptz,
  share_journal              text,
  photo1                     text,
  photo2                     text,
  photo3                     text,
  wounds                     text,
  treatment_type             text,
  treatment_places           text,
  treatment_place_other      text,
  treatment_by               text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists injury_reports_code_uq on injury_reports(tenant_id, injury_id);
create index if not exists injury_reports_tenant_ix on injury_reports(tenant_id);
alter table injury_reports enable row level security;

-- ── INSURANCE_PCHI  (MAIN workbook, engine: insurancePCHI)
create table if not exists insurance_pchi (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  insurance_id               text,
  student_id                 text,
  type                       text,
  title                      text,
  insured_name               text,
  insured_middle_name        text,
  insured_last_name          text,
  gender                     text,
  national_id                text,
  passport                   text,
  dob                        date,
  member_status              text,
  marital_status             text,
  occupation                 text,
  effective_date             date,
  plan                       text,
  mobile                     text,
  email                      text,
  bank_account_name          text,
  bank_account_number        text,
  employee_id                text,
  beneficiary_name           text,
  beneficiary_last_name      text,
  beneficiary_relationship   text,
  remarks                    text,
  company_name               text,
  policy_no                  text,
  filled_by                  text,
  filled_by_role             text,
  filled_date                date,
  updated_by                 text,
  updated_date               date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists insurance_pchi_code_uq on insurance_pchi(tenant_id, insurance_id);
create index if not exists insurance_pchi_tenant_ix on insurance_pchi(tenant_id);
alter table insurance_pchi enable row level security;

-- ── LEAVE_REQUEST_STD  (MAIN workbook, engine: studentLeaves)
create table if not exists leave_request_std (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  leave_id                   text,
  student_id                 text,
  date                       date,
  reason                     text,
  status                     text,
  teacher_notified           text,
  date_to                    text,
  group_id                   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists leave_request_std_code_uq on leave_request_std(tenant_id, leave_id);
create index if not exists leave_request_std_tenant_ix on leave_request_std(tenant_id);
alter table leave_request_std enable row level security;

-- ── LINE_RECIPIENTS  (MAIN workbook) — who is pushed for which topic
create table if not exists line_recipients (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  topic                      text,
  staff_id                   text,
  enabled                    boolean,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists line_recipients_code_uq on line_recipients(tenant_id, staff_id);
create index if not exists line_recipients_tenant_ix on line_recipients(tenant_id);
alter table line_recipients enable row level security;

-- ── OT_DAILY  (MAIN workbook, engine: otDaily)
create table if not exists ot_daily (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  otid                       text,
  date                       date,
  student_id                 text,
  pickup_time                time,
  plan_end                   text,
  late_minutes               numeric,
  hours                      numeric,
  amount                     numeric(12,2),
  status                     text,
  slip_ref                   text,
  slip_amount                numeric(12,2),
  payment_method             text,
  transaction_date           date,
  paid_date                  date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists ot_daily_code_uq on ot_daily(tenant_id, otid);
create index if not exists ot_daily_tenant_ix on ot_daily(tenant_id);
alter table ot_daily enable row level security;

-- ── PARENTS  (MAIN workbook, engine: parents)
create table if not exists parents (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  parent_id                  text,
  national_id                text,
  name                       text,
  name_en                    text,
  relationship               text,
  phone                      text,
  occupation                 text,
  workplace                  text,
  office_phone               text,
  line_uid                   text,
  student_id                 text,
  address                    text,
  photo                      text,
  register_photo_url         text,
  nickname                   text,
  nickname_en                text,
  title                      text,
  line_picture_url           text,
  email                      text,
  google_sub                 text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists parents_code_uq on parents(tenant_id, parent_id);
create index if not exists parents_tenant_ix on parents(tenant_id);
alter table parents enable row level security;

-- ── PAYMENT_SLIPS  (MAIN workbook, engine: paymentSlips)
create table if not exists payment_slips (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  slip_id                    text,
  ref_kind                   text,
  ref_id                     text,
  student_id                 text,
  amount                     numeric(12,2),
  url                        text,
  file_id                    text,
  verified                   boolean,
  trans_ref                  text,
  receiver                   text,
  submitted_date             date,
  status                     text,
  slip_group                 text,
  trans_date                 date,
  trans_time                 time,
  sender                     text,
  method                     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists payment_slips_code_uq on payment_slips(tenant_id, slip_id);
create index if not exists payment_slips_tenant_ix on payment_slips(tenant_id);
alter table payment_slips enable row level security;

-- ── PERF_LOG  (MAIN workbook) — Phase 0 telemetry. NOT migrated — see the note in the DDL
create table if not exists perf_log (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  ts                         timestamptz,
  sid                        text,
  role                       text,
  type                       text,
  action                     text,
  ms                         numeric,
  ok                         text,
  code                       text,
  batch                      numeric,
  screen                     text,
  dev                        text,
  net                        text,
  pwa                        text,
  ver                        text,
  os                         text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists perf_log_tenant_ix on perf_log(tenant_id);
alter table perf_log enable row level security;

-- ── PICKUP_PERSONS  (MAIN workbook, engine: pickupPersons)
create table if not exists pickup_persons (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  student_id                 text,
  name                       text,
  phone                      text,
  relation                   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists pickup_persons_code_uq on pickup_persons(tenant_id, student_id);
create index if not exists pickup_persons_tenant_ix on pickup_persons(tenant_id);
alter table pickup_persons enable row level security;

-- ── PREPAYMENTS  (MAIN workbook, engine: prepayments)
create table if not exists prepayments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  prepay_id                  text,
  student_id                 text,
  months                     text,
  discount                   numeric(12,2),
  gross                      numeric(12,2),
  amount                     numeric(12,2),
  covered                    text,
  status                     text,
  slip_url                   text,
  slip_amount                numeric(12,2),
  verified_status            boolean,
  date                       date,
  payment_method             text,
  transaction_date           date,
  paid_date                  date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists prepayments_code_uq on prepayments(tenant_id, prepay_id);
create index if not exists prepayments_tenant_ix on prepayments(tenant_id);
alter table prepayments enable row level security;

-- ── SCHOOL_CONFIG  (MAIN workbook)
create table if not exists school_config (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  key                        text,
  value                      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists school_config_tenant_ix on school_config(tenant_id);
alter table school_config enable row level security;

-- ── STUDENT_CHARGES  (MAIN workbook, engine: studentCharges)
create table if not exists student_charges (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  charge_id                  text,
  student_id                 text,
  month                      text,
  label                      text,
  amount                     numeric(12,2),
  status                     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists student_charges_code_uq on student_charges(tenant_id, student_id);
create index if not exists student_charges_tenant_ix on student_charges(tenant_id);
alter table student_charges enable row level security;

-- ── STUDENTS  (MAIN workbook, engine: students)
create table if not exists students (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  student_id                 text,
  national_id                text,
  name                       text,
  name_en                    text,
  nickname                   text,
  nickname_en                text,
  gender                     text,
  dob                        date,
  class                      text,
  parent_id                  text,
  plan                       text,
  weight                     numeric,
  height                     numeric,
  photo                      text,
  blood_type                 text,
  rh                         text,
  allergy                    text,
  vaccine                    text,
  medical_history            text,
  race                       text,
  nationality                text,
  religion                   text,
  emergency_contact          text,
  address                    text,
  enroll_date                date,
  last_growth_update         text,
  insurance_has              text,
  insurance_policy_no        text,
  insurance_company          text,
  insurance_expiry           date,
  insurance_card_image       text,
  insurance_plan             text,
  insurance_type             text,
  insured_name               text,
  insurance_owner            text,
  insurance_status           text,
  insurance_start            text,
  insurance_sum              numeric(12,2),
  insurance_benefits         text,
  insurance_hotline          text,
  drive_folder_url           text,
  withdraw_reason            text,
  withdraw_detail            text,
  withdraw_date              date,
  withdraw_by                text,
  end_date                   date,
  end_reason                 text,
  end_remark                 text,
  status                     text,
  created_date               date,
  otrate                     numeric(12,2),
  billing_day                numeric,
  geo_exempt                 boolean,
  off_days                   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists students_code_uq on students(tenant_id, student_id);
create index if not exists students_tenant_ix on students(tenant_id);
alter table students enable row level security;

-- ── SURVEY_RESPONSES  (MAIN workbook, engine: surveyResponses) — engine-managed
create table if not exists survey_responses (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  response_id                text,
  survey_id                  text,
  respondent_id              text,
  answer                     text,
  date                       date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists survey_responses_code_uq on survey_responses(tenant_id, survey_id);
create index if not exists survey_responses_tenant_ix on survey_responses(tenant_id);
alter table survey_responses enable row level security;

-- ── SURVEYS  (MAIN workbook, engine: surveys) — engine-managed
create table if not exists surveys (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  survey_id                  text,
  title                      text,
  question                   text,
  options                    text,
  target                     text,
  start_date                 date,
  end_date                   date,
  status                     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists surveys_code_uq on surveys(tenant_id, survey_id);
create index if not exists surveys_tenant_ix on surveys(tenant_id);
alter table surveys enable row level security;

-- ── USER_LINKS  (MAIN workbook, engine: userLinks)
create table if not exists user_links (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  user_uid                   text,
  student_id                 text,
  verified_by                boolean,
  date                       date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists user_links_code_uq on user_links(tenant_id, user_uid);
create index if not exists user_links_tenant_ix on user_links(tenant_id);
alter table user_links enable row level security;

-- ── USERS  (MAIN workbook)
create table if not exists users (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  user_id                    text,
  line_uid                   text,
  role                       text,
  linked_id                  text,
  password_hash              text,
  created_date               date,
  status                     text,
  email                      text,
  google_sub                 text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists users_code_uq on users(tenant_id, user_id);
create index if not exists users_tenant_ix on users(tenant_id);
alter table users enable row level security;

-- ── VACCINE_RECORDS  (MAIN workbook, engine: vaccineRecords)
create table if not exists vaccine_records (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  student_id                 text,
  vaccine_key                text,
  vaccine_name               text,
  dose_date                  date,
  note                       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists vaccine_records_code_uq on vaccine_records(tenant_id, student_id);
create index if not exists vaccine_records_tenant_ix on vaccine_records(tenant_id);
alter table vaccine_records enable row level security;

-- ── WITHDRAWALS  (MAIN workbook, engine: withdrawals)
create table if not exists withdrawals (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete restrict,
  withdraw_id                text,
  student_id                 text,
  requested_by               text,
  requester_role             text,
  reason                     text,
  detail                     text,
  effective_date             date,
  status                     text,
  processed_by               text,
  processed_date             date,
  created_date               date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists withdrawals_code_uq on withdrawals(tenant_id, withdraw_id);
create index if not exists withdrawals_tenant_ix on withdrawals(tenant_id);
alter table withdrawals enable row level security;

-- ── row-level security ────────────────────────────────────────────────────────────────
-- One policy per table, all identical, all reading the SAME claim. A per-table exception is
-- how one table ends up readable across tenants, so there are none.
-- The app connects with the anon key plus a JWT we mint; the service-role key bypasses ALL
-- of this by design and must never leave the server.
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename <> 'tenant' loop
    execute format($f$
      create policy tenant_isolation on %I
        using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
        with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
    $f$, t);
  end loop;
end $$;
