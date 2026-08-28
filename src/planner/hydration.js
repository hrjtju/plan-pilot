import { defaultState } from "../app/initialState.js";
import { getLocalDate } from "../utils/dateTime.js";

export function isRecurringDerivedBlock(block) {
  return Boolean(block?.recurringDerived) || String(block?.id || "").startsWith("rec-");
}

export function expandRecurringBlocks(items, existingBlocks = [], options = {}) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const blocks = [];
  const baseDate = options.baseDate ? new Date(`${options.baseDate}T00:00:00`) : new Date();
  const existingKeys = new Set(
    existingBlocks.map((block) => `${block.date}|${block.start}|${block.taskId || block.title || ""}`),
  );

  items.forEach((item) => {
    if (!Number.isInteger(item.dayOfWeek) || item.dayOfWeek < 0 || item.dayOfWeek > 6) return;
    const cursor = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
    const endDate = item.endDate ? new Date(`${item.endDate}T00:00:00`) : null;
    const maxDate = new Date(baseDate.getFullYear() + 1, baseDate.getMonth(), baseDate.getDate());
    const limit = endDate && endDate < maxDate ? endDate : maxDate;

    while (cursor <= limit) {
      if (cursor.getDay() === item.dayOfWeek) {
        const date = getLocalDate(cursor);
        const key = `${date}|${item.start}|${item.taskId || item.title || ""}`;
        if (!existingKeys.has(key)) {
          blocks.push({
            id: `rec-${item.id || ""}-${date}`,
            recurringId: item.id || "",
            recurringDerived: true,
            date,
            type: "busy",
            taskId: "",
            title: item.title || "",
            start: item.start,
            end: item.end,
            auto: false,
          });
          existingKeys.add(key);
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  });

  return blocks;
}

export function replaceRecurringBlocks(items, blocks = [], options = {}) {
  const manualBlocks = blocks.filter((block) => !isRecurringDerivedBlock(block));
  return manualBlocks.concat(expandRecurringBlocks(items, manualBlocks, options));
}

export function hydrateState(input, options = {}) {
  const mergeTasks = options.mergeTasks || ((tasks) => tasks);

  return {
    ...defaultState,
    ...input,
    settings: {
      ...defaultState.settings,
      ...(input?.settings || {}),
      workSegments:
        input?.settings?.workSegments ||
        (input?.settings?.workStart
          ? [{ start: input.settings.workStart, end: input.settings.workEnd || "18:00" }]
          : defaultState.settings.workSegments),
      shortBreak: input?.settings?.shortBreak ?? input?.settings?.breakMinutes ?? defaultState.settings.shortBreak,
      longBreak: input?.settings?.longBreak ?? defaultState.settings.longBreak,
    },
    ai: (() => {
      const ai = { ...defaultState.ai, ...(input?.ai || {}) };
      delete ai.apiKey;
      return ai;
    })(),
    goals: Array.isArray(input?.goals)
      ? input.goals.map((goal) => ({ progress: 0, ...goal }))
      : [],
    tasks: mergeTasks(Array.isArray(input?.tasks) ? input.tasks : []),
    blocks: replaceRecurringBlocks(
      Array.isArray(input?.recurring) ? input.recurring : [],
      Array.isArray(input?.blocks) ? input.blocks : [],
      { baseDate: options.recurringBaseDate },
    ),
    dayPlans: input?.dayPlans && typeof input.dayPlans === "object" ? input.dayPlans : {},
    reviews: Array.isArray(input?.reviews) ? input.reviews : [],
    recurring: Array.isArray(input?.recurring) ? input.recurring : defaultState.recurring || [],
  };
}

// —— 离线编辑合并 ——
// 触发前提：调用方仅在“上次会话存在保存失败”（localStorage 的 plan-pilot-pending-sync-v1 标志）
// 时使用。此时本地态 ≡ 上次水合的文件态 + 本会话离线编辑，因此：
//   · tasks/blocks/goals/reviews/recurring 按 id 取并集，任何一侧独有的条目都保留；
//   · 同 id 冲突一律本地胜——文件侧同 id 版本必为离线编辑前的旧值，本地是用户主动操作的结果；
//   · dayPlans 按日期键并集，同日期本地胜；
//   · settings/ai 浅合并：文件侧新增键保留，本地值覆盖。
// 注意：合并产物应再过一遍 hydrateState（重建周期派生块、补齐默认字段）。
const MERGE_LIST_FIELDS = ["tasks", "blocks", "goals", "reviews"];

function itemKey(item, fallbackIndex) {
  if (item && typeof item === "object" && item.id != null && item.id !== "") return String(item.id);
  return `__anon__:${fallbackIndex}:${JSON.stringify(item)}`;
}

export function mergeOfflineEdits(fileData, localState) {
  const file = fileData || {};
  const local = localState || {};
  const merged = { ...file };

  MERGE_LIST_FIELDS.forEach((field) => {
    const fileItems = Array.isArray(file[field]) ? file[field] : [];
    const localItems = Array.isArray(local[field]) ? local[field] : [];
    const byId = new Map(fileItems.map((item, i) => [itemKey(item, `f${i}`), item]));
    localItems.forEach((item, i) => byId.set(itemKey(item, `l${i}`), item)); // 本地胜
    merged[field] = [...byId.values()];
  });

  const filePlans = file.dayPlans && typeof file.dayPlans === "object" ? file.dayPlans : {};
  const localPlans = local.dayPlans && typeof local.dayPlans === "object" ? local.dayPlans : {};
  merged.dayPlans = { ...filePlans, ...localPlans };

  const fileRec = Array.isArray(file.recurring) ? file.recurring : [];
  const localRec = Array.isArray(local.recurring) ? local.recurring : [];
  const recMap = new Map();
  fileRec.forEach((r) => recMap.set(itemKey(r, "f"), r));
  localRec.forEach((r) => recMap.set(itemKey(r, "l"), r));
  merged.recurring = [...recMap.values()];

  merged.settings = { ...(file.settings || {}), ...(local.settings || {}) };
  merged.ai = { ...(file.ai || {}), ...(local.ai || {}) };

  return merged;
}
