// 通用空白排班工具 — 純邏輯（型別 + 基礎排班引擎）。
//
// 跟醫師端不同：這裡所有東西（班種、時間、人數、每日需求）都由 config 驅動，
// 沒有任何寫死的班別或家族規則。給護理師等單位移植用的 prototype 地基。
//
// 進階規則（連班上限、班種銜接禁則、個人偏好）尚未實作 — 之後再加。
// 目前引擎只做「公平填滿每天需求」。

export type ShiftDef = {
  id: string;
  /** 班種名稱，例「白班」 */
  label: string;
  /** 起 "07:00" */
  start: string;
  /** 訖 "15:00" */
  end: string;
};

/** 人員自訂欄位的型別 */
export type PersonFieldType = "text" | "number" | "select";

/** 負責人自訂的人員欄位，例「年資」(number)、「職級」(select) */
export type PersonField = {
  id: string;
  label: string;
  type: PersonFieldType;
  /** type === "select" 時的可選值，例 ["N1","N2","N3","N4"] */
  options?: string[];
};

export type Person = {
  id: string;
  /** 員工編號（第一欄） */
  empId?: string;
  name: string;
  /** 可上的班種 id 清單（空＝不限，可上全部） */
  allowedShifts?: string[];
  /** 可上的位置 id 清單（空＝不限，可上全部） */
  allowedPositions?: string[];
  /**
   * 主班時段（軟偏好）：該人主要上的班種 id。
   * 設了之後排班「優先排本班時段的人、缺額才跨班」，不是硬鎖（仍可跨）。
   * 未設＝不限（每個時段都當本班，等同 NP 行為）。
   */
  homeShiftId?: string;
  /** 自訂欄位值，key = PersonField.id */
  attrs?: Record<string, string | number>;
};

/** 位置／站別，使用者自訂，例「leader」「檢傷」「診間」「留觀」 */
export type Position = { id: string; label: string };

/** 某班每個位置要幾人：shiftId → positionId → 人數 */
export type Requirement = Record<string, Record<string, number>>;

export type RosterConfig = {
  people: Person[];
  /** 負責人自訂的人員欄位定義（年資/職級…） */
  personFields: PersonField[];
  shifts: ShiftDef[];
  /** 使用者自訂的位置／站別 */
  positions: Position[];
  /** 逐日需求，key = "YYYY-MM-DD" → 各班各位置要幾人（整月逐日設定） */
  dailyReq: Record<string, Requirement>;
  /**
   * 預設每日需求（shiftId → positionId → 人數）。
   * 某天在 dailyReq 沒設時，引擎退回用這個。護理師每日需求固定（白7/小夜7/大夜5）
   * 就只設這一份，不用逐日填。dailyReq 仍可逐日覆寫（如特殊日加人）。
   */
  defaultReq?: Requirement;
  /**
   * 各班別的站別「列」順序（shiftId → posId[]，每列一項、同站可重複出現）。
   * 排班工具可手動增刪/拖曳挪動列；站別第一次出現的順序＝該班填補順位（缺額留給後面）。
   * 沒設的班別退回 positions 全域順序。
   */
  rowOrder?: Record<string, string[]>;
  /** 基本需求快照（首次手動增列時凍結）：低於此數的站別列不可刪 */
  baseReq?: Requirement;
  /** 硬限制條列（自由文字），陣列順序＝位階，越前面越大 */
  hardRules: string[];
  /** 軟限制條列（自由文字），陣列順序＝位階，越前面越大 */
  softRules: string[];
};

export function emptyConfig(): RosterConfig {
  return {
    people: [],
    personFields: [],
    shifts: [],
    positions: [],
    dailyReq: {},
    hardRules: [],
    softRules: [],
  };
}

/** 一個空白人員列 */
export function blankPerson(): Person {
  return {
    id: newId("p"),
    empId: "",
    name: "",
    allowedShifts: [],
    allowedPositions: [],
    attrs: {},
  };
}

/** 一個空白人員欄位（預設文字型別） */
export function blankField(): PersonField {
  return { id: newId("f"), label: "", type: "text" };
}

/** 一個空白位置 */
export function blankPosition(): Position {
  return { id: newId("pos"), label: "" };
}

/** 預設位置：Leader / Triage / 重症 / 診間 / 留觀 / 行政 */
export function defaultPositions(): Position[] {
  return ["Leader", "Triage", "重症", "診間", "留觀", "行政"].map((label) => ({
    id: newId("pos"),
    label,
  }));
}

/** 預設三班：大夜 / 白班 / 小夜 */
export function defaultShifts(): ShiftDef[] {
  return [
    { id: newId("s"), label: "大夜班", start: "00:00", end: "08:00" },
    { id: newId("s"), label: "白班", start: "08:00", end: "16:00" },
    { id: newId("s"), label: "小夜班", start: "16:00", end: "00:00" },
  ];
}

/** 每格指派：date → shiftId → positionId → personId[] */
export type Assignments = Record<
  string,
  Record<string, Record<string, string[]>>
>;

export type Shortage = {
  date: string;
  shiftId: string;
  positionId: string;
  need: number;
  got: number;
};

export type MonthSchedule = {
  ym: string; // "2026-07"
  assignments: Assignments;
  shortages: Shortage[];
  /** personId → 當月總班數 */
  perPerson: Record<string, number>;
  /** 合規/分配警告（勞基法窗口檢查、OT 等，不阻擋排班只提示） */
  warnings?: string[];
  /** 產生時間（ISO） */
  generatedAt?: string;
};

/** 預假：某人某天一格的語意（比醫師端二元 off 多了限定/可接受/活動） */
export type VacationDay = {
  /** 原始 sheet 字串，保真用 */
  raw: string;
  /** 純預假（想休） */
  off?: boolean;
  /** 那天「只能上」這些班碼（如 ["E","H"]） */
  only?: string[];
  /** 想休、但可接受這些班碼 */
  alt?: string[];
  /** 非班別活動（如「擬真」） */
  notes?: string[];
};

export type VacationPerson = {
  empId: string;
  name: string;
  /** date "YYYY-MM-DD" → 當天預假（只存非空格） */
  days: Record<string, VacationDay>;
  /** 該人本月特殊需求備註（自由文字） */
  note?: string;
};

/** 某職類某月的預假（model b：負責人代填 / Sheet 匯入） */
export type MonthVacation = {
  ym: string;
  group: string;
  source?: string;
  importedAt?: string;
  /** app 內手動編輯的存檔時間 */
  updatedAt?: string;
  /** 班碼 → 中文（E=小夜…） */
  legend?: Record<string, string>;
  people: VacationPerson[];
};

/** 預假表用的班碼（D8/N8 要在 D/N 前以免被吃掉；這裡用精確比對所以順序不影響） */
/** 已定案/匯入的班表（給人看的真相，與引擎草稿 MonthSchedule 分開） */
export type PublishedRosterRow = {
  empId: string;
  name: string;
  /** date → 班碼（D8/N8/E/H/OFF…） */
  days: Record<string, string>;
  /** date → 假別註記（特/例/休/國），匯入舊表才有 */
  leave?: Record<string, string>;
  /** date → 站別 id（護理師班表用；無站別資訊的日子可缺） */
  pos?: Record<string, string>;
};
export type PublishedRoster = {
  ym: string;
  group: string;
  source?: string;
  importedAt?: string;
  updatedAt?: string;
  legend?: Record<string, string>;
  rows: PublishedRosterRow[];
};

/** config 班種 label → 顯示班碼（與舊表一致：白=D8 夜=N8 中=H 小夜=E） */
export const LABEL_TO_CODE: Record<string, string> = {
  白班: "D8",
  夜班: "N8",
  中班: "H",
  小夜: "E",
};

export const SHIFT_CODES = ["D8", "N8", "D", "E", "N", "H", "V"];
export const VACATION_LEGEND: Record<string, string> = {
  E: "小夜",
  H: "中班",
  D: "白班",
  N: "夜班",
  D8: "白8",
  N8: "夜8",
  V: "休假",
};

/**
 * 把一格的字串（如 "OFF" / "E/H" / "OFF/H" / "OFF/擬真"）解析成 VacationDay。
 * 空字串回 null（代表該格沒填）。與匯入腳本的 Python 版同邏輯。
 */
export function parseVacationToken(input: string): VacationDay | null {
  const raw = input.trim();
  if (!raw) return null;
  const parts = raw
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  let off = false;
  const only: string[] = [];
  const alt: string[] = [];
  const notes: string[] = [];
  for (const p of parts) {
    const base = p.replace(/\(.*?\)/g, "").trim();
    if (base.toUpperCase() === "OFF") off = true;
    else if (SHIFT_CODES.includes(base)) (off ? alt : only).push(base);
    else if (base) notes.push(base);
  }
  const d: VacationDay = { raw };
  if (off) d.off = true;
  if (only.length) d.only = only;
  if (alt.length) d.alt = alt;
  if (notes.length) d.notes = notes;
  return d;
}

export const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];
/** 週一起頭的星期標籤（月曆用） */
export const WEEKDAY_LABELS_MON = ["一", "二", "三", "四", "五", "六", "日"];

/** 當月 "YYYY-MM" */
export function currentYm(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** "2026-07" → ["2026-07-01", ..., "2026-07-31"] */
export function daysInMonth(ym: string): string[] {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const out: string[] = [];
  for (let d = 1; d <= last; d++) {
    out.push(`${ym}-${String(d).padStart(2, "0")}`);
  }
  return out;
}

/** 把某月切成週列（週一起頭），月初前與月末後補 null 對齊 7 欄 */
export function monthWeeks(ym: string): (string | null)[][] {
  const days = daysInMonth(ym);
  const lead = (weekdayOf(days[0]) + 6) % 7; // 週一=0 … 週日=6
  const cells: (string | null)[] = [...Array(lead).fill(null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function weekdayOf(dateISO: string): number {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

/** 週末（六/日） */
export function isWeekend(dateISO: string): boolean {
  const wd = weekdayOf(dateISO);
  return wd === 0 || wd === 6;
}

/** ISO 8601 週數（週一起頭，含當年第一個週四的那週為 W1） */
export function isoWeekOf(dateISO: string): number {
  const [y, m, d] = dateISO.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const day = (t.getUTCDay() + 6) % 7; // 週一=0 … 週日=6
  t.setUTCDate(t.getUTCDate() - day + 3); // 移到該週週四
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const fday = (firstThu.getUTCDay() + 6) % 7;
  return 1 + Math.round(((t.getTime() - firstThu.getTime()) / 86400000 - 3 + fday) / 7);
}

/** 某日需求（shiftId → positionId → 人數）：逐日 dailyReq 優先，否則退回 defaultReq */
export function requirementForDate(
  config: RosterConfig,
  dateISO: string,
): Requirement {
  return config.dailyReq?.[dateISO] ?? config.defaultReq ?? {};
}

// ---- 勞基法合規參數（四週變形：第30-1 / 34 / 36-II-3 / 32 條）----
/** 第34條：換班間隔至少連續 11h 休息 */
const MIN_SHIFT_GAP_MIN = 11 * 60;
/** 第30-1條：變形下每日正常工時上限 10h（超過部分算延長） */
const NORMAL_HOURS_CAP = 10;
/** 第32條：月延長工時上限 46h（未開放工會同意的 54h） */
const MAX_OT_PER_MONTH = 46;
/** 第36-II-3條：每2週至少 2 日例假、每4週例假+休息日至少 8 日 */
const REST_PER_2WK = 2;
const REST_PER_4WK = 8;
/** 連續上班：硬上限 5 連（第 6 連禁止）；軟上限 4 連（上到第 5 連時降級、盡量避免） */
const MAX_CONSECUTIVE = 5;
const SOFT_CONSECUTIVE = 4;

/** 預假班碼 → config 班種 label 候選（NP 與護理師的班種名不同，都要對得到） */
const VAC_CODE_TO_LABELS: Record<string, string[]> = {
  D: ["白班"],
  N: ["夜班", "大夜班"],
  H: ["中班"],
  E: ["小夜", "小夜班"],
  D8: ["白班"],
  N8: ["夜班"],
};

function hhmmToMin(s: string): number {
  const [h, m] = (s ?? "").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
/** 班時數（跨午夜自動 +24h） */
export function shiftHours(shift: ShiftDef): number {
  let dur = hhmmToMin(shift.end) - hhmmToMin(shift.start);
  if (dur <= 0) dur += 1440;
  return dur / 60;
}
/** 該班延長工時（超過正常上限的部分） */
function shiftOt(shift: ShiftDef): number {
  return Math.max(0, shiftHours(shift) - NORMAL_HOURS_CAP);
}
/** 班的絕對起/訖分鐘（相對月初，dayIdx 0-based） */
function shiftStartAbs(dayIdx: number, shift: ShiftDef): number {
  return dayIdx * 1440 + hhmmToMin(shift.start);
}
function shiftEndAbs(dayIdx: number, shift: ShiftDef): number {
  let end = hhmmToMin(shift.end);
  if (hhmmToMin(shift.end) <= hhmmToMin(shift.start)) end += 1440;
  return dayIdx * 1440 + end;
}

/**
 * 排班引擎（v2，含預假 + 勞基法四週變形硬規則）：
 * - 逐日掃，依 config.shifts × config.positions 順序填人；一人一天最多一班
 * - 預假(vacation)：off 不排、only 限定當天可上班別、alt 只在缺額時動且降序
 * - 硬規則（候選人過濾）：第34條 11h 換班間隔、第32條 月延長工時≤46h、連上≤5天
 * - 軟規則（排序降級）：上到第5連班者「缺人才動」，盡量不連上>4天
 * - 公平：剩餘候選挑累計班數最少者；人不夠記 shortages
 * - 後檢查（warnings，不阻擋）：第36-II-3 每2週≥2例假/每4週≥8休、OT 總時數
 */
export function generateSchedule(
  config: RosterConfig,
  ym: string,
  vacation?: MonthVacation | null,
  opts?: {
    nightRotationEmpIds?: string[];
    /**
     * 鎖定預置，自動填時保留、不受預假/間隔限制。兩種形狀：
     * - date → shiftId → personId[]（不帶站別；放進該班第一個有需求的站，NP 用）
     * - date → shiftId → posId → personId[]（帶站別；放回正確的站，護理用）
     */
    preassigned?: Record<string, Record<string, string[] | Record<string, string[]>>>;
    /** 目標班數：empId → 目標；到/超過目標的人在公平排序中降級 */
    targets?: Record<string, number>;
    /** 不自動排的人（如部分工時）：empId 清單；仍可被 preassigned 手動鎖定 */
    excludeEmpIds?: string[];
    /** 只用本班人填的班種 id：這些班不抓跨班的人來補，本班人不夠就留空（記 shortage） */
    homeStrictShiftIds?: string[];
    /** 每人當月工時硬上限(h)（原則：不超過法定工時）；鎖定(preassigned)不受限 */
    maxHoursPerPerson?: number;
    /** 缺額分散：先試跑一遍測當月實際可排量，再把量平均配額到每天（原則：空格不集中在同一天） */
    spreadShortages?: boolean;
    /**
     * 優先站別（如 Leader）：先單獨整月排滿這些站（保留會的人的連上/工時額度），
     * 再排其他站；其他站選人時會避開破壞已排優先班的連上鏈/隔日銜接/工時額度。
     */
    priorityPositionIds?: string[];
    /**
     * 挪移修補：排完後仍有空格、且有人只因「連上會超 5」被擋時，
     * 把他連班鏈上的一天讓給別人（該天有人合法接手），人挪過來填空格。
     * 單步挪移；鎖定與優先站的班不動。
     */
    repairShortages?: boolean;
    /**
     * 上月月尾狀態（跨月合規）：empId → {
     *   consec: 連續工作到上月最後一天的天數（0＝上月最後一天沒上班），
     *   lastEndAbs: 上月最後一班的訖，相對本月 1 號 00:00 的分鐘（負值或 0）
     * }。給了才會把連上鏈與 11h 間隔接到上個月。
     */
    prevTail?: Record<string, { consec: number; lastEndAbs?: number }>;
    /**
     * 連班聚集（軟偏好）：盡量讓班以約 N 連為一輪、減少隔日班(QOD)。
     * 已連上 1..N-1 天者優先續班；連滿 N 天者降後（去休息）；休息中的人居中。
     * 排在公平排序「本班偏好」之後、「班數少」之前——月總量公平不變、只改分布形狀。
     */
    preferRunLen?: number;
    /**
     * 連班聚集只作用於這些班別（不給＝全部）。人力緊的班（如大夜 7 人供 5 需求）
     * 開聚集會讓大家的連班鏈同步撞「連5」硬牆、反而多缺額——只在人力寬鬆的班開。
     */
    preferRunShiftIds?: string[];
    /**
     * 薄日保護：先找出「可用人數 ≤ 需求」的日班（預假造成的人力薄日），
     * 像優先站別一樣先整月預排這些天，前瞻守衛保住這些人的連上鏈/工時額度
     * 不被其他天燒掉——避免薄日破雙洞。
     */
    protectThinDays?: boolean;
  },
): MonthSchedule {
  const nightIds = opts?.nightRotationEmpIds ?? [];
  const preassigned = opts?.preassigned;
  const targets = opts?.targets;
  const excluded = new Set(opts?.excludeEmpIds ?? []);
  const homeStrict = new Set(opts?.homeStrictShiftIds ?? []);
  const maxHours = opts?.maxHoursPerPerson;

  // 預假查表：empId → date → VacationDay
  const vacByEmp = new Map<string, Record<string, VacationDay>>();
  for (const vp of vacation?.people ?? []) vacByEmp.set(vp.empId, vp.days ?? {});
  // 班種 label → id（把預假班碼對到實際班種）
  const shiftIdByLabel = new Map<string, string>();
  for (const s of config.shifts) shiftIdByLabel.set(s.label, s.id);
  const codesToShiftIds = (codes: string[]): Set<string> => {
    const ids = new Set<string>();
    for (const c of codes)
      for (const label of VAC_CODE_TO_LABELS[c] ?? []) {
        const id = shiftIdByLabel.get(label);
        if (id) ids.add(id);
      }
    return ids;
  };
  const shiftDurH = (s: ShiftDef) => {
    let min = hhmmToMin(s.end) - hhmmToMin(s.start);
    if (min <= 0) min += 1440;
    return min / 60;
  };

  const allDates = daysInMonth(ym);
  const shiftById = new Map(config.shifts.map((s) => [s.id, s]));
  // 上月月尾狀態（empId → personId 對照）
  const prevConsecById: Record<string, number> = {};
  const prevEndById: Record<string, number> = {};
  if (opts?.prevTail) {
    for (const p of config.people) {
      const t = p.empId ? opts.prevTail[p.empId] : undefined;
      if (!t) continue;
      if (t.consec > 0) prevConsecById[p.id] = t.consec;
      if (t.lastEndAbs != null) prevEndById[p.id] = t.lastEndAbs;
    }
  }
  // 各班別的站別順序（rowOrder 優先、其餘補在後）；順序＝填補順位
  const posSeqCache = new Map<string, Position[]>();
  const posSeqOf = (sid: string): Position[] => {
    let seq = posSeqCache.get(sid);
    if (!seq) {
      const order = config.rowOrder?.[sid];
      if (order?.length) {
        const uniq = [...new Set(order)]; // rowOrder 每列一項可重複；順位取站別首次出現
        const byId = new Map(config.positions.map((p) => [p.id, p]));
        seq = [
          ...(uniq.map((id) => byId.get(id)).filter(Boolean) as Position[]),
          ...config.positions.filter((p) => !uniq.includes(p.id)),
        ];
      } else seq = config.positions;
      posSeqCache.set(sid, seq);
    }
    return seq;
  };

  // 整月排一遍。
  // quota：每班每天的自動排配額（用不完往後滾），用來分散缺額。
  // onlyPositions：只排這些站（其他站需求視為 0；鎖定仍照放）——優先站別的前置排程用。
  // priorityPre：前置排程結果（date → shiftId → posId → personId[]），當預置放入；
  //   並對「未來還有預置班」的人做前瞻守衛（連上鏈/隔日銜接/工時額度）。
  // onlyCells：只排這些 `${date}|${shiftId}`（其他需求視為 0）——薄日保護的前置排程用。
  const execute = (
    quota?: Map<string, number[]>,
    onlyPositions?: Set<string>,
    priorityPre?: Record<string, Record<string, Record<string, string[]>>>,
    onlyCells?: Set<string>,
  ) => {
  // personId → dayIdx → shiftId（未來優先班查表，前瞻守衛用）
  const futurePri = new Map<string, Map<number, string>>();
  if (priorityPre) {
    allDates.forEach((date, di) => {
      for (const [sid, poss] of Object.entries(priorityPre[date] ?? {}))
        for (const ids of Object.values(poss))
          for (const id of ids) {
            (futurePri.get(id) ?? futurePri.set(id, new Map()).get(id)!).set(di, sid);
          }
    });
  }
  const assignments: Assignments = {};
  const shortages: Shortage[] = [];
  const perPerson: Record<string, number> = {};
  for (const p of config.people) perPerson[p.id] = 0;

  // 跨日狀態（合規檢查用）；lastEndAbs 以上月最後一班起算（跨月 11h 間隔）
  const lastEndAbs: Record<string, number> = { ...prevEndById }; // personId → 上一個班的訖（絕對分鐘）
  const otTotal: Record<string, number> = {}; // personId → 累計延長工時(h)
  const hoursTotal: Record<string, number> = {}; // personId → 累計總工時(h)
  const workedDates: Record<string, Set<string>> = {}; // personId → 已排到班的日期
  for (const p of config.people) {
    otTotal[p.id] = 0;
    hoursTotal[p.id] = 0;
    workedDates[p.id] = new Set();
  }
  // 每班每天自動排到的人數（分散缺額的試跑統計）＋配額結轉
  const autoFilled = new Map<string, number[]>();
  for (const s of config.shifts) autoFilled.set(s.id, allDates.map(() => 0));
  const carry: Record<string, number> = {};

  allDates.forEach((date, dayIdx) => {
    const req = requirementForDate(config, date);
    const usedToday = new Set<string>();
    assignments[date] = {};

    const placeCount = (id: string, shift: ShiftDef) => {
      usedToday.add(id);
      perPerson[id] = (perPerson[id] ?? 0) + 1;
      lastEndAbs[id] = shiftEndAbs(dayIdx, shift);
      otTotal[id] = (otTotal[id] ?? 0) + shiftOt(shift);
      hoursTotal[id] = (hoursTotal[id] ?? 0) + shiftDurH(shift);
      (workedDates[id] ??= new Set()).add(date);
    };

    // 帶站別的鎖定：開排前先全部放到位（佔自己的站，不吃掉排序在前的站的名額）
    // 來源①手動鎖定（preassigned 物件形狀）②優先站別前置排程（priorityPre）
    const prePlaced = new Map<string, string[]>(); // `${shiftId}|${posId}` → personId[]
    const addPre = (entry: Record<string, string[]>, shift: ShiftDef) => {
      for (const [posId, ids] of Object.entries(entry)) {
        for (const id of ids) {
          if (usedToday.has(id)) continue;
          const key = `${shift.id}|${posId}`;
          prePlaced.set(key, [...(prePlaced.get(key) ?? []), id]);
          placeCount(id, shift);
        }
      }
    };
    for (const shift of config.shifts) {
      const entry = preassigned?.[date]?.[shift.id];
      if (entry && !Array.isArray(entry)) addPre(entry, shift);
      const pri = priorityPre?.[date]?.[shift.id];
      if (pri) addPre(pri, shift);
    }

    for (const shift of config.shifts) {
      assignments[date][shift.id] = {};
      const posReq = req[shift.id] ?? {};
      // 前置排程的範圍限制：非優先站／非指定日班的需求視為 0（鎖定仍照放）
      const needOf = (posId: string) => {
        if (onlyPositions && !onlyPositions.has(posId)) return 0;
        if (onlyCells && !onlyCells.has(`${date}|${shift.id}`)) return 0;
        return posReq[posId] ?? 0;
      };

      // ① 鎖定的人（manager 手動指定，跳過所有限制）：
      // 帶站別的已在日初放好；不帶站別的（legacy）照舊塞進順位前面有需求的站
      const posSeq = posSeqOf(shift.id);
      const preByPos: Record<string, string[]> = {};
      for (const pos of posSeq)
        preByPos[pos.id] = [...(prePlaced.get(`${shift.id}|${pos.id}`) ?? [])];
      const legacy = preassigned?.[date]?.[shift.id];
      if (Array.isArray(legacy)) {
        for (const pos of posSeq) {
          const need = needOf(pos.id);
          for (const id of legacy) {
            if (preByPos[pos.id].length >= need) break;
            if (usedToday.has(id)) continue;
            preByPos[pos.id].push(id);
            placeCount(id, shift);
          }
        }
      }

      // ② 本班可用候選（班別層硬規則過濾一次）+ 是否降序(alt) + 是否本班時段
      type Cand = { id: string; deprioritized: boolean; homeMatch: boolean; consecSoft: boolean; back: number; allowedPos: string[] };
      const shiftCands: Cand[] = [];
      for (const p of config.people) {
        if (usedToday.has(p.id)) continue;
        // 部分工時等：不自動排（但 preassigned 鎖定的仍會被放）
        if (p.empId && excluded.has(p.empId)) continue;
        // 既有：可上班種
        const aS = p.allowedShifts ?? [];
        if (aS.length && !aS.includes(shift.id)) continue;
        // 夜班輪值：當月夜班只排輪值的人（定義了才限制）
        if (shift.label === "夜班" && nightIds.length && !nightIds.includes(p.empId ?? ""))
          continue;

        // 預假
        let deprioritized = false;
        const vac = p.empId ? vacByEmp.get(p.empId)?.[date] : undefined;
        if (vac) {
          if (vac.only?.length) {
            if (!codesToShiftIds(vac.only).has(shift.id)) continue; // 那天只能上特定班
          } else if (vac.off) {
            if (vac.alt?.length) {
              if (!codesToShiftIds(vac.alt).has(shift.id)) continue; // 想休但限這些班
              deprioritized = true; // 缺額才動
            } else {
              continue; // 純預假（含 OFF/擬真）→ 不排
            }
          }
        }

        // 第34條：與上一個班間隔 ≥ 11h
        const prevEnd = lastEndAbs[p.id];
        if (prevEnd != null && shiftStartAbs(dayIdx, shift) - prevEnd < MIN_SHIFT_GAP_MIN)
          continue;
        // 第32條：月延長工時上限
        if (otTotal[p.id] + shiftOt(shift) > MAX_OT_PER_MONTH) continue;

        // 前瞻守衛：這人未來已排定的優先班（如 Leader）不能被今天的排班破壞
        const priDays = futurePri.get(p.id);
        // 法定工時上限（原則：不超過）：到頂的人不再自動排（鎖定不受限）。
        // 未來優先班的工時先預留，不讓其他站吃掉額度。
        if (maxHours != null) {
          let reserve = 0;
          if (priDays)
            for (const [k, sid] of priDays)
              if (k > dayIdx) reserve += shiftDurH(shiftById.get(sid) ?? shift);
          if (hoursTotal[p.id] + shiftDurH(shift) + reserve > maxHours) continue;
        }
        // 隔日銜接：明天有優先班 → 今天這班的訖到明天優先班的始要 ≥ 11h
        if (priDays) {
          const nsid = priDays.get(dayIdx + 1);
          const ns = nsid ? shiftById.get(nsid) : undefined;
          if (ns && shiftStartAbs(dayIdx + 1, ns) - shiftEndAbs(dayIdx, shift) < MIN_SHIFT_GAP_MIN)
            continue;
        }

        // 連續上班天數（往前數已排的連續日＋往後數已排定的優先班連續日）：
        // 硬限整鏈 ≤5、軟限盡量 ≤4。連到月初沒斷 → 接上月月尾的連上天數。
        let consec = 0;
        for (let k = dayIdx - 1; k >= 0; k--) {
          if (workedDates[p.id]?.has(allDates[k])) consec++;
          else break;
        }
        if (consec === dayIdx) consec += prevConsecById[p.id] ?? 0;
        let fwd = 0;
        if (priDays) for (let k = dayIdx + 1; priDays.has(k); k++) fwd++;
        if (consec + 1 + fwd > MAX_CONSECUTIVE) continue; // 整鏈會連 6，禁止
        const consecSoft = consec + 1 + fwd > SOFT_CONSECUTIVE; // 整鏈會連 5，盡量避免

        // 本班時段（軟偏好）：未設 homeShiftId＝不限，視為本班
        const homeMatch = !p.homeShiftId || p.homeShiftId === shift.id;
        // 嚴格本班班種（如大夜）：非本班人不當候選，本班人不夠就留空（不跨班補）
        if (homeStrict.has(shift.id) && p.homeShiftId !== shift.id) continue;
        shiftCands.push({ id: p.id, deprioritized, homeMatch, consecSoft, back: consec, allowedPos: p.allowedPositions ?? [] });
      }

      // 排序：非降級(alt/連5)優先 → 未達目標優先 → 本班時段優先 → 連班聚集 → 累計班數少優先
      // 降級＝alt 預假(想休)或上到第5連班，兩者都「缺人才動」。
      // homeMatch 放在「未過目標」之後＝盡量排本班，但本班人到月目標就讓位給跨班的人，
      // 避免某時段人少時把該組操爆（大夜需求>大夜人數時靠白/小夜支援）。
      const overTarget = (id: string) => {
        const emp = config.people.find((p) => p.id === id)?.empId;
        const t = emp ? targets?.[emp] : undefined;
        return t != null && perPerson[id] >= t;
      };
      const soft = (c: Cand) => c.deprioritized || c.consecSoft;
      // 連班聚集：連上 1..N-1 天＝續班優先(0)；休息中＝居中(1)；連滿 N 天＝降後去休息(2)
      const runLen =
        opts?.preferRunLen && (!opts.preferRunShiftIds || opts.preferRunShiftIds.includes(shift.id))
          ? opts.preferRunLen
          : 0;
      const clusterRank = (c: Cand) => (c.back >= runLen ? 2 : c.back === 0 ? 1 : 0);
      shiftCands.sort((a, b) => {
        const sa = soft(a), sb = soft(b);
        if (sa !== sb) return sa ? 1 : -1;
        const oa = overTarget(a.id), ob = overTarget(b.id);
        if (oa !== ob) return oa ? 1 : -1;
        if (a.homeMatch !== b.homeMatch) return a.homeMatch ? -1 : 1;
        if (runLen > 0) {
          const ra = clusterRank(a), rb = clusterRank(b);
          if (ra !== rb) return ra - rb;
        }
        return perPerson[a.id] - perPerson[b.id];
      });

      // ③ 順位優先配對（Kuhn 增廣）：缺額留給順位後面的站。
      // slot 依該班站別順序（rowOrder ?? positions）展開；每個 slot 依公平排序嘗試候選人；
      // 後面的站要人時可把已配對的人挪到他會的其他站，讓順位前面的站盡量填滿。
      const slotPosIds: string[] = [];
      for (const pos of posSeq) {
        const remain = needOf(pos.id) - preByPos[pos.id].length;
        for (let k = 0; k < remain; k++) slotPosIds.push(pos.id);
      }
      // 分散缺額：本日配額（含前面沒用完的結轉）；超出配額的 slot 從順位尾端截掉
      const qArr = quota?.get(shift.id);
      const avail = qArr ? (carry[shift.id] ?? 0) + qArr[dayIdx] : Infinity;
      if (slotPosIds.length > avail) slotPosIds.length = avail;
      const candsByPos = new Map<string, Cand[]>();
      for (const pos of config.positions)
        candsByPos.set(pos.id, shiftCands.filter((c) => !c.allowedPos.length || c.allowedPos.includes(pos.id)));
      const matchSlot: (string | null)[] = slotPosIds.map(() => null);
      const matchPerson = new Map<string, number>();
      const tryFill = (slotIdx: number, visited: Set<string>): boolean => {
        for (const c of candsByPos.get(slotPosIds[slotIdx]) ?? []) {
          if (visited.has(c.id)) continue;
          visited.add(c.id);
          const cur = matchPerson.get(c.id);
          if (cur == null || tryFill(cur, visited)) {
            matchPerson.set(c.id, slotIdx);
            matchSlot[slotIdx] = c.id;
            return true;
          }
        }
        return false;
      };
      for (let i = 0; i < slotPosIds.length; i++) tryFill(i, new Set());
      autoFilled.get(shift.id)![dayIdx] = matchPerson.size;
      if (qArr) carry[shift.id] = avail - matchPerson.size;

      // ④ 寫回結果：鎖定 + 配對；缺額記 shortage
      const filledByPos: Record<string, string[]> = {};
      matchSlot.forEach((pid, i) => {
        if (pid) (filledByPos[slotPosIds[i]] ??= []).push(pid);
      });
      for (const pid of matchPerson.keys()) placeCount(pid, shift);
      for (const pos of posSeq) {
        const need = needOf(pos.id);
        const picked = [...preByPos[pos.id], ...(filledByPos[pos.id] ?? [])];
        assignments[date][shift.id][pos.id] = picked;
        if (picked.length < need) {
          shortages.push({
            date,
            shiftId: shift.id,
            positionId: pos.id,
            need,
            got: picked.length,
          });
        }
      }
    }
  });
  return { assignments, shortages, perPerson, otTotal, workedDates, autoFilled };
  };

  // 優先站別（如 Leader）先整月排滿：單獨排一遍只填優先站，
  // 結果當預置帶進正式排班（會的人的連上/工時額度優先留給這些站）。
  let priorityPre: Record<string, Record<string, Record<string, string[]>>> | undefined;
  const priorityIds = opts?.priorityPositionIds ?? [];
  if (priorityIds.length) {
    const pp = execute(undefined, new Set(priorityIds));
    priorityPre = {};
    for (const [date, byShift] of Object.entries(pp.assignments))
      for (const [sid, byPos] of Object.entries(byShift))
        for (const pid of priorityIds) {
          const ids = byPos[pid] ?? [];
          if (ids.length) (((priorityPre[date] ??= {})[sid] ??= {})[pid] ??= []).push(...ids);
        }
  }

  // 薄日保護：可用人數 ≤ 需求的日班先整月預排（結果併入 priorityPre，前瞻守衛生效）
  if (opts?.protectThinDays) {
    const thinCells = new Set<string>();
    for (const date of allDates) {
      const req = requirementForDate(config, date);
      for (const shift of config.shifts) {
        const needN = Object.values(req[shift.id] ?? {}).reduce((a, b) => a + b, 0);
        if (needN <= 0) continue;
        let avail = 0;
        for (const p of config.people) {
          if (p.empId && excluded.has(p.empId)) continue;
          const aS = p.allowedShifts ?? [];
          if (aS.length && !aS.includes(shift.id)) continue;
          if (homeStrict.has(shift.id) && p.homeShiftId !== shift.id) continue;
          const vac = p.empId ? vacByEmp.get(p.empId)?.[date] : undefined;
          if (vac) {
            if (vac.only?.length) {
              if (!codesToShiftIds(vac.only).has(shift.id)) continue;
            } else if (vac.off) {
              if (!vac.alt?.length || !codesToShiftIds(vac.alt).has(shift.id)) continue;
            }
          }
          avail++;
        }
        if (avail <= needN) thinCells.add(`${date}|${shift.id}`);
      }
    }
    if (thinCells.size) {
      const tp = execute(undefined, undefined, priorityPre, thinCells);
      const merged: NonNullable<typeof priorityPre> = JSON.parse(JSON.stringify(priorityPre ?? {}));
      for (const [date, byShift] of Object.entries(tp.assignments)) {
        for (const [sid, byPos] of Object.entries(byShift)) {
          if (!thinCells.has(`${date}|${sid}`)) continue;
          for (const [pid, ids] of Object.entries(byPos))
            if (ids.length) {
              const cur = (((merged[date] ??= {})[sid] ??= {})[pid] ??= []);
              for (const id of ids) if (!cur.includes(id)) cur.push(id);
            }
        }
      }
      priorityPre = merged;
    }
  }

  // 分散缺額（原則：空格不集中在同一天）：先試跑測出每班當月實際可排量 F，
  // 攤平成每日配額（floor 累積差分，餘數均勻散開；用不完往後滾）後重排一遍。
  let quota: Map<string, number[]> | undefined;
  if (opts?.spreadShortages) {
    const probe = execute(undefined, undefined, priorityPre);
    quota = new Map();
    const D = allDates.length;
    for (const [sid, byDay] of probe.autoFilled) {
      const F = byDay.reduce((a, b) => a + b, 0);
      quota.set(sid, allDates.map((_, i) => Math.floor(((i + 1) * F) / D) - Math.floor((i * F) / D)));
    }
  }
  let result = execute(quota, undefined, priorityPre);
  // 補滿 pass：配額分散可能砍到「其實有人可上」的格子（配額是算術攤的，不看當日人力）。
  // 把結果當預置、不帶配額重跑一遍：還有人可上的空格補起來；月上限吃緊時補不進去，分散效果保留。
  if (quota) {
    const asPre: Record<string, Record<string, Record<string, string[]>>> = {};
    for (const [date, byShift] of Object.entries(result.assignments))
      for (const [sid, byPos] of Object.entries(byShift))
        for (const [pid, ids] of Object.entries(byPos))
          if (ids.length) (((asPre[date] ??= {})[sid] ??= {})[pid] ??= []).push(...ids);
    result = execute(undefined, undefined, asPre);
  }

  // 挪移修補：空格若只差「連上會超 5」，把候選人連班鏈上的一天讓給別人、人挪過來填。
  if (opts?.repairShortages && result.shortages.length) {
    const a = result.assignments;
    const dayIdxOf = new Map(allDates.map((d, i) => [d, i]));
    // person → dayIdx → 當天班/站
    const byPerson = new Map<string, Map<number, { sid: string; pos: string }>>();
    for (const [date, byShift] of Object.entries(a)) {
      const di = dayIdxOf.get(date)!;
      for (const [sid, byPos] of Object.entries(byShift))
        for (const [pos, ids] of Object.entries(byPos))
          for (const id of ids)
            (byPerson.get(id) ?? byPerson.set(id, new Map()).get(id)!).set(di, { sid, pos });
    }
    const hours: Record<string, number> = {};
    for (const p of config.people) hours[p.id] = 0;
    for (const [id, m] of byPerson)
      for (const { sid } of m.values()) hours[id] += shiftDurH(shiftById.get(sid)!);
    // 不可挪動：手動鎖定（優先站的班「可挪」，但挪走時遞迴一定會把該站補回，排滿保證不變）
    const fixed = new Set<string>(); // `${date}|${shiftId}|${personId}`
    for (const [date, byShift] of Object.entries(preassigned ?? {}))
      for (const [sid, entry] of Object.entries(byShift)) {
        const ids = Array.isArray(entry) ? entry : Object.values(entry).flat();
        for (const id of ids) fixed.add(`${date}|${sid}|${id}`);
      }

    const personById = new Map(config.people.map((p) => [p.id, p]));
    const chainIfAdd = (id: string, di: number) => {
      const m = byPerson.get(id);
      let back = 0;
      for (let k = di - 1; k >= 0 && m?.has(k); k--) back++;
      if (back === di) back += prevConsecById[id] ?? 0; // 連到月初沒斷 → 接上月
      let fwd = 0;
      for (let k = di + 1; k < allDates.length && m?.has(k); k++) fwd++;
      return back + 1 + fwd;
    };
    const gapOK = (id: string, di: number, shift: ShiftDef) => {
      const m = byPerson.get(id);
      const prev = m?.get(di - 1);
      if (prev) {
        const ps = shiftById.get(prev.sid)!;
        if (shiftStartAbs(di, shift) - shiftEndAbs(di - 1, ps) < MIN_SHIFT_GAP_MIN) return false;
      } else if (di === 0) {
        const pe = prevEndById[id];
        if (pe != null && shiftStartAbs(0, shift) - pe < MIN_SHIFT_GAP_MIN) return false; // 上月最後一班的 11h 銜接
      }
      const next = m?.get(di + 1);
      if (next) {
        const ns = shiftById.get(next.sid)!;
        if (shiftStartAbs(di + 1, ns) - shiftEndAbs(di, shift) < MIN_SHIFT_GAP_MIN) return false;
      }
      return true;
    };
    // 合法性（不含連上）。ignoreHours＝跳過工時上限（挪移分支用：讓一天換一天＝淨工時不變）
    const legal = (id: string, di: number, shift: ShiftDef, posId: string, ignoreHours = false) => {
      const p = personById.get(id);
      if (!p) return false;
      if (byPerson.get(id)?.has(di)) return false; // 當天已有班
      if (p.empId && excluded.has(p.empId)) return false;
      const aS = p.allowedShifts ?? [];
      if (aS.length && !aS.includes(shift.id)) return false;
      const aP = p.allowedPositions ?? [];
      if (aP.length && !aP.includes(posId)) return false;
      if (shift.label === "夜班" && nightIds.length && !nightIds.includes(p.empId ?? "")) return false;
      if (homeStrict.has(shift.id) && p.homeShiftId !== shift.id) return false;
      const vac = p.empId ? vacByEmp.get(p.empId)?.[allDates[di]] : undefined;
      if (vac) {
        if (vac.only?.length) {
          if (!codesToShiftIds(vac.only).has(shift.id)) return false;
        } else if (vac.off) {
          if (!vac.alt?.length || !codesToShiftIds(vac.alt).has(shift.id)) return false; // 純預假不動；alt=缺人才動，修補正是缺人
        }
      }
      if (!ignoreHours && maxHours != null && hours[id] + shiftDurH(shift) > maxHours) return false;
      if (!gapOK(id, di, shift)) return false;
      return true;
    };
    const commitAdd = (id: string, di: number, shift: ShiftDef, posId: string) => {
      const date = allDates[di];
      ((a[date] ??= {})[shift.id] ??= {})[posId] = [...(a[date][shift.id][posId] ?? []), id];
      (byPerson.get(id) ?? byPerson.set(id, new Map()).get(id)!).set(di, { sid: shift.id, pos: posId });
      hours[id] += shiftDurH(shift);
      result.perPerson[id] = (result.perPerson[id] ?? 0) + 1;
    };
    const commitRemove = (id: string, di: number, sid: string, posId: string) => {
      const date = allDates[di];
      a[date][sid][posId] = (a[date][sid][posId] ?? []).filter((x) => x !== id);
      byPerson.get(id)?.delete(di);
      hours[id] -= shiftDurH(shiftById.get(sid)!);
      result.perPerson[id] = (result.perPerson[id] ?? 0) - 1;
    };

    // 遞迴補格：直接有人就填；「連上卡住」或「工時到頂」的人可退掉一天（該天遞迴找人補）
    // 再來補這格——退一天換上一天＝淨工時不變。最多 REPAIR_DEPTH 層；失敗完整回復。
    // budget＝搜尋預算（放寬候選後樹會變大，防爆炸）。
    const REPAIR_DEPTH = 5;
    let repairBudget = 300000;
    const coverSlot = (di: number, shift: ShiftDef, posId: string, depth: number, exclude: Set<string>): boolean => {
      if (--repairBudget <= 0) return false;
      const cands = config.people
        .filter((q) => !exclude.has(q.id) && legal(q.id, di, shift, posId))
        .sort((x, y) => (hours[x.id] ?? 0) - (hours[y.id] ?? 0));
      for (const q of cands)
        if (chainIfAdd(q.id, di) <= MAX_CONSECUTIVE) {
          commitAdd(q.id, di, shift, posId);
          return true;
        }
      if (depth <= 0) return false;
      // 挪移候選：連上卡住（在 cands 裡）＋工時到頂（legal 放寬工時才看得到）的人
      const looseCands = config.people
        .filter((q) => !exclude.has(q.id) && legal(q.id, di, shift, posId, true))
        .sort((x, y) => (hours[x.id] ?? 0) - (hours[y.id] ?? 0));
      const newDur = shiftDurH(shift);
      for (const q of looseCands) {
        const m = byPerson.get(q.id);
        if (!m) continue;
        // 退讓日候選：連班鏈上的日子優先（離空格越遠、切鏈越有效），其次其他天（工時釋放用）
        const chainDays: number[] = [];
        for (let k = di - 1; m.has(k); k--) chainDays.push(k);
        for (let k = di + 1; m.has(k); k++) chainDays.push(k);
        chainDays.sort((x, y) => Math.abs(y - di) - Math.abs(x - di));
        const otherDays = [...m.keys()].filter((k) => !chainDays.includes(k)).sort((x, y) => Math.abs(y - di) - Math.abs(x - di));
        for (const D of [...chainDays, ...otherDays]) {
          const asg = m.get(D)!;
          if (fixed.has(`${allDates[D]}|${asg.sid}|${q.id}`)) continue;
          // 模擬移除：鏈長/銜接/工時（退 D 的時數、加這格的時數）都要通過才值得讓
          m.delete(D);
          const ok =
            chainIfAdd(q.id, di) <= MAX_CONSECUTIVE &&
            gapOK(q.id, di, shift) &&
            (maxHours == null || hours[q.id] - shiftDurH(shiftById.get(asg.sid)!) + newDur <= maxHours);
          m.set(D, asg);
          if (!ok) continue;
          commitRemove(q.id, D, asg.sid, asg.pos);
          const dShift = shiftById.get(asg.sid)!;
          if (coverSlot(D, dShift, asg.pos, depth - 1, new Set(exclude).add(q.id))) {
            commitAdd(q.id, di, shift, posId);
            return true;
          }
          commitAdd(q.id, D, dShift, asg.pos); // 連鎖失敗：回復
        }
      }
      // 同日換站：當天同班已在別站、會這站的人挪過來（時數/鏈長不變），原站的洞遞迴補
      for (const r of config.people) {
        if (exclude.has(r.id)) continue;
        const asg2 = byPerson.get(r.id)?.get(di);
        if (!asg2 || asg2.sid !== shift.id || asg2.pos === posId) continue;
        if (fixed.has(`${allDates[di]}|${asg2.sid}|${r.id}`)) continue; // 手動鎖定不動
        const aP2 = personById.get(r.id)?.allowedPositions ?? [];
        if (aP2.length && !aP2.includes(posId)) continue;
        commitRemove(r.id, di, asg2.sid, asg2.pos);
        commitAdd(r.id, di, shift, posId);
        if (coverSlot(di, shift, asg2.pos, depth - 1, new Set(exclude).add(r.id))) return true;
        commitRemove(r.id, di, shift.id, posId); // 回復
        commitAdd(r.id, di, shiftById.get(asg2.sid)!, asg2.pos);
      }
      return false;
    };

    const stillShort: Shortage[] = [];
    for (const sh of result.shortages) {
      const di = dayIdxOf.get(sh.date)!;
      const shift = shiftById.get(sh.shiftId);
      let remaining = sh.need - sh.got;
      if (shift) {
        while (remaining > 0 && coverSlot(di, shift, sh.positionId, REPAIR_DEPTH, new Set())) remaining--;
      }
      if (remaining > 0) stillShort.push({ ...sh, got: sh.need - remaining });
    }
    result = { ...result, shortages: stillShort };
    // 供後檢查：依挪移後結果重建跨日狀態
    for (const p of config.people) {
      result.workedDates[p.id] = new Set();
      result.otTotal[p.id] = 0;
    }
    for (const [date, byShift] of Object.entries(a))
      for (const [sid, byPos] of Object.entries(byShift))
        for (const ids of Object.values(byPos))
          for (const id of ids) {
            result.workedDates[id].add(date);
            result.otTotal[id] += shiftOt(shiftById.get(sid)!);
          }
  }
  const { assignments, shortages, perPerson, otTotal, workedDates } = result;

  // ---- 後檢查：第36-II-3 休假窗口 + OT 總時數（warnings，不阻擋）----
  const warnings: string[] = [];
  const nameOf = (pid: string) =>
    config.people.find((p) => p.id === pid)?.name ?? pid;
  const offCountInWindow = (worked: Set<string>, start: number, len: number) => {
    let off = 0;
    for (let i = start; i < start + len && i < allDates.length; i++)
      if (!worked.has(allDates[i])) off++;
    return off;
  };
  for (const p of config.people) {
    const worked = workedDates[p.id];
    // 每 2 週(14日)滑動窗口至少 2 例假
    for (let s = 0; s + 14 <= allDates.length; s++) {
      if (offCountInWindow(worked, s, 14) < REST_PER_2WK) {
        warnings.push(
          `${nameOf(p.id)}：${allDates[s].slice(5)}起兩週內休假不足 ${REST_PER_2WK} 日（第36-II-3條例假）`,
        );
        break;
      }
    }
    // 每 4 週(28日)滑動窗口至少 8 休
    for (let s = 0; s + 28 <= allDates.length; s++) {
      if (offCountInWindow(worked, s, 28) < REST_PER_4WK) {
        warnings.push(
          `${nameOf(p.id)}：${allDates[s].slice(5)}起四週內休假不足 ${REST_PER_4WK} 日（第36-II-3條）`,
        );
        break;
      }
    }
    if (otTotal[p.id] > MAX_OT_PER_MONTH)
      warnings.push(`${nameOf(p.id)}：當月延長工時 ${otTotal[p.id]}h 超過 ${MAX_OT_PER_MONTH}h（第32條）`);
  }

  return { ym, assignments, shortages, perPerson, warnings };
}

let _idCounter = 0;
/** 產生穩定 id（client-side）。 */
export function newId(prefix: string): string {
  _idCounter += 1;
  const rnd =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID().slice(0, 8)
      : Math.floor(Math.random() * 1e9).toString(36);
  return `${prefix}_${rnd}${_idCounter}`;
}

export function prevMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function nextMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
