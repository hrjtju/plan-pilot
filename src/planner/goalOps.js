// AI 目标调整对话的纯函数：update_goal / delete_goal 动作的归一化、校验与应用。
// 全部无副作用，便于 node:test 单测（见 test/goalOps.test.mjs）。
import { normalizeTitle, titleLooksDuplicate } from "./dedup.js";

const GOAL_TYPES = ["long", "month", "week"];
const GOAL_STATUSES = ["active", "paused", "done"];

// goalRef 可以是已有目标 id、精确标题或近似标题（复用 dedup 的模糊匹配）。
function resolveGoalRef(goals, ref) {
  const value = String(ref ?? "").trim();
  if (!value) return "";
  const byId = goals.find((goal) => goal.id === value);
  if (byId) return byId.id;
  const normalized = normalizeTitle(value);
  const byTitle = goals.find((goal) => normalizeTitle(goal.title) === normalized);
  if (byTitle) return byTitle.id;
  const similar = goals.find((goal) => titleLooksDuplicate(goal.title, value));
  return similar ? similar.id : "";
}

// 把模型返回的 actions 归一化为可应用的 ops：updates（含合法 patch 字段）+ deletes。
// 同一目标多条 update 按顺序合并；引用解析失败的动作整体丢弃。
export function normalizeGoalOps(actions, goals) {
  const actionList = Array.isArray(actions) ? actions : [];
  const goalList = Array.isArray(goals) ? goals : [];
  const updates = [];
  const deletes = [];

  for (const action of actionList) {
    if (!action || typeof action !== "object") continue;

    if (action.type === "delete_goal") {
      const goalId = resolveGoalRef(goalList, action.goalRef);
      if (goalId && !deletes.some((item) => item.goalId === goalId)) deletes.push({ goalId });
      continue;
    }

    if (action.type !== "update_goal") continue;
    const goalId = resolveGoalRef(goalList, action.goalRef);
    if (!goalId) continue;

    const patch = {};
    const title = String(action.title ?? "").trim();
    if (title) patch.title = title;
    if (GOAL_TYPES.includes(action.goalType)) patch.type = action.goalType;
    if (["high", "medium", "low"].includes(action.priority)) patch.priority = action.priority;
    if (GOAL_STATUSES.includes(action.status)) patch.status = action.status;
    if (action.progress != null && action.progress !== "") {
      const progress = Number(action.progress);
      if (Number.isFinite(progress)) patch.progress = Math.max(0, Math.min(100, Math.round(progress)));
    }
    if (action.parentRef !== undefined) {
      // 只有解析到真实上级、或显式空字符串（明确挂顶层）才写 parentId；
      // 非空但解析失败的 parentRef 整体丢弃，避免误挂顶层。
      const parentId = resolveGoalRef(goalList, action.parentRef);
      if (parentId || String(action.parentRef).trim() === "") patch.parentId = parentId;
    }
    if (Object.keys(patch).length === 0) continue;

    const existing = updates.find((item) => item.goalId === goalId);
    if (existing) existing.patch = { ...existing.patch, ...patch };
    else updates.push({ goalId, patch });
  }

  const deletedIds = new Set(deletes.map((item) => item.goalId));
  const validUpdates = updates
    .filter((item) => !deletedIds.has(item.goalId))
    .map((item) => ({
      ...item,
      // parentId 指向本批次被删目标的，重置为顶层
      patch: deletedIds.has(item.patch.parentId) ? { ...item.patch, parentId: "" } : item.patch,
    }));
  return { updates: validUpdates, deletes };
}

// 把 ops 应用到 goals 上（不可变）：先删（子目标上移一层，父链被删则挂顶层）再改。
export function applyGoalOps(goals, ops) {
  const goalList = Array.isArray(goals) ? goals : [];
  const deletedIds = new Set((ops?.deletes || []).map((item) => item.goalId));
  const parentOf = new Map(goalList.map((goal) => [goal.id, goal.parentId || ""]));

  let next = goalList;
  if (deletedIds.size > 0) {
    next = goalList
      .filter((goal) => !deletedIds.has(goal.id))
      .map((goal) => {
        if (!deletedIds.has(goal.parentId)) return goal;
        const grandparentId = parentOf.get(goal.parentId) || "";
        return { ...goal, parentId: deletedIds.has(grandparentId) ? "" : grandparentId };
      });
  }

  const updateById = new Map((ops?.updates || []).map((item) => [item.goalId, item.patch]));
  const updated = next.map((goal) => (updateById.has(goal.id) ? { ...goal, ...updateById.get(goal.id) } : goal));
  // parentId 指向已不存在目标的（如被 UI 提前删除），重置为顶层，避免悬空引用
  const idSet = new Set(updated.map((goal) => goal.id));
  return updated.map((goal) => (goal.parentId && !idSet.has(goal.parentId) ? { ...goal, parentId: "" } : goal));
}

export function goalOpsSummaryText(ops) {
  const updates = ops?.updates?.length || 0;
  const deletes = ops?.deletes?.length || 0;
  if (!updates && !deletes) return "没有需要应用的修改。";
  const parts = [];
  if (updates) parts.push(`修改 ${updates} 个目标`);
  if (deletes) parts.push(`删除 ${deletes} 个目标`);
  return `已${parts.join("、")}。`;
}
