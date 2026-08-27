// 目标甘特图条形的边缘拖拽（resize）纯逻辑：按天取整并夹取增量，保证条形至少保留 1 天时长。
// 供 GoalGantt 组件（预览 + 提交）与单元测试使用；ISO 日期换算由组件层用 addDays 完成。

/**
 * 夹取边缘拖拽的天数增量。
 * @param {string} origStart 原开始日期（YYYY-MM-DD）
 * @param {string} origEnd 原结束日期（YYYY-MM-DD）
 * @param {"start"|"end"} edge 拖动的边缘：start = 左缘（改开始日），end = 右缘（改结束日）
 * @param {number} deltaDays 指针位移换算的天数（可为小数，内部 round）
 * @param {(a:string,b:string)=>number} dayDiffFn b-a 的天数差
 * @returns {number} 夹取后的整数增量（start 最晚 = end、end 最早 = start，均保底 1 天时长）；-0 规范化为 0
 */
export function clampResizeDelta(origStart, origEnd, edge, deltaDays, dayDiffFn) {
  const d = Math.round(Number(deltaDays) || 0);
  const len = dayDiffFn(origStart, origEnd); // 含首尾的条宽 = len + 1 天，最短 1 天
  if (edge === "start") {
    // 左缘向右最多拖到与 end 重合（d ≤ len），向左扩无下限
    const v = Math.min(len, d);
    return v || 0;
  }
  if (edge === "end") {
    // 右缘向左最多拖到与 start 重合（d ≥ -len），向右扩无上限
    const v = Math.max(-len, d);
    return v || 0;
  }
  return 0;
}
