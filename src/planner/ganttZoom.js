// 目标甘特图的时间刻度缩放与窗口裁剪：纯函数，供 GoalGantt 组件与单元测试使用。
// 约定：一切以「天」为单位的整数偏移相对 contentMin（内容最早日期）表达；ISO 日期的换算由组件层用 addDays 完成。

// 缩放档位（可视天数）。放大 = 更少天 / 缩小 = 更多天。
export const GANTT_ZOOM_STEPS = [14, 30, 60, 90, 180, 365, 730];
export const GANTT_ZOOM_MIN_DAYS = 7;
export const GANTT_ZOOM_MAX_DAYS = 1825;

/** 把目标可视天数夹进 [min,max]；非法输入回落到 min。 */
export function clampZoomSpan(span, min = GANTT_ZOOM_MIN_DAYS, max = GANTT_ZOOM_MAX_DAYS) {
  const n = Number(span);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/**
 * 沿档位阶梯走一步。
 * @param {number} span 当前可视天数
 * @param {1|-1} dir +1 = zoom out（更多天），-1 = zoom in（更少天）
 * @returns 新的可视天数；已到边界时原样返回
 */
export function stepZoom(span, dir) {
  const cur = clampZoomSpan(span);
  const steps = GANTT_ZOOM_STEPS;
  if (dir < 0) {
    // 放大：找比 cur 小的最大档位；都不满足则维持 MIN 由 clamp 保证
    let next = GANTT_ZOOM_MIN_DAYS;
    for (const s of steps) {
      if (s >= cur) break;
      next = s;
    }
    return next === cur ? cur : next;
  }
  let next = null;
  for (const s of steps) {
    if (s > cur) { next = s; break; }
  }
  if (next === null) return clampZoomSpan(cur, GANTT_ZOOM_MIN_DAYS, GANTT_ZOOM_MAX_DAYS);
  return next;
}

/**
 * 围绕锚点计算新的窗口起点（天偏移，可为负）。
 * 锚点日期在缩放前后保持同一相对位置（±1 天取整误差内）。
 * @param {{startOff:number,span:number}} window 当前窗口
 * @param {number} newSpan 目标可视天数
 * @param {number} anchorRatio 锚点在窗口内的横向比例（0..1，钳制到该区间）
 */
export function zoomAnchorOffset(window, newSpan, anchorRatio) {
  const prevSpan = Number(window && window.span);
  const startOff = Number(window && window.startOff);
  if (!Number.isFinite(prevSpan) || prevSpan <= 0 || !Number.isFinite(startOff)) return 0;
  const ratio = Number.isFinite(anchorRatio) ? Math.max(0, Math.min(1, anchorRatio)) : 0.5;
  const newSpanSafe = clampZoomSpan(newSpan);
  const anchorDayOff = startOff + ratio * prevSpan; // 锚点日的偏移（浮点）
  return Math.round(anchorDayOff - ratio * newSpanSafe);
}

// —— 滚轮平移（pan）：默认滚轮 = 左右平移视角，Ctrl/Shift + 滚轮 = 缩放（见 GoalGantt）——

// 平移后窗口与内容区至少保留的可见交集天数（防止把内容整个移出视野）。
export const GANTT_PAN_MIN_VISIBLE_DAYS = 7;
// 触控板轻扫去抖：换算不足 1 天、但像素位移达到该阈值时保底平移 1 天。
export const GANTT_PAN_MIN_DELTA_PX = 12;

/**
 * 夹取窗口起点（天偏移，可为负）：保证窗口与内容区 [0, contentDays] 的交集 ≥ minVisible 天。
 * minVisible = min(span, GANTT_PAN_MIN_VISIBLE_DAYS, contentDays)，故 lo ≤ hi 恒成立；
 * 返回值规范化 -0 为 +0（-0 会干扰比较与日志）。
 */
export function clampPanStartOff(startOff, span, contentDays) {
  const s = clampZoomSpan(span);
  const content = Math.max(1, Number(contentDays) || 0);
  const minVisible = Math.min(s, GANTT_PAN_MIN_VISIBLE_DAYS, content);
  const v = Math.max(minVisible - s, Math.min(content - minVisible, Math.round(Number(startOff) || 0)));
  return v || 0;
}

/**
 * 平移窗口：startOff += deltaDays（天），结果经 clampPanStartOff 夹取；span 不变。
 * 非法窗口回落为「适应内容」。
 * @param {{startOff:number,span:number}} window 当前窗口
 * @param {number} deltaDays 平移天数，正 = 窗口右移（看更晚），负 = 左移（看更早）
 * @param {number} contentDays 内容区总天数
 */
export function panWindow(window, deltaDays, contentDays) {
  const prevSpan = Number(window && window.span);
  const startOff = Number(window && window.startOff);
  if (!Number.isFinite(prevSpan) || prevSpan <= 0 || !Number.isFinite(startOff)) {
    return { startOff: 0, span: clampZoomSpan(contentDays) };
  }
  const d = Math.round(Number(deltaDays) || 0);
  return { startOff: clampPanStartOff(startOff + d, prevSpan, contentDays), span: prevSpan };
}

/**
 * 把滚轮 delta（已按 deltaMode 归一为像素）换算成平移天数。
 * 换算值按四舍五入取整天；不足 1 天但 |deltaPx| ≥ GANTT_PAN_MIN_DELTA_PX 时保底 1 天（触控板轻扫意图），
 * 微颤（< 阈值）返回 0 不动。
 */
export function wheelToPanDays(deltaPx, pxPerDay) {
  const px = Number(deltaPx);
  const perDay = Number(pxPerDay);
  if (!Number.isFinite(px) || !px || !Number.isFinite(perDay) || perDay <= 0) return 0;
  const days = Math.round(px / perDay);
  if (days !== 0) return days;
  return Math.abs(px) >= GANTT_PAN_MIN_DELTA_PX ? (px > 0 ? 1 : -1) : 0;
}

/**
 * 解析当前渲染窗口。
 * @param {string} contentMinISO 内容最早日期（buildGoalGantt 的 min，已含 ±2 padding）
 * @param {string} contentMaxISO 内容最晚日期
 * @param {{startOff:number,span:number}|null} zoom 为 null 时「适应内容」
 * @returns {{startISO:string,days:number,fits:boolean}}
 */
export function resolveViewWindow(contentMinISO, contentMaxISO, zoom, addDaysFn, dayDiffFn) {
  const contentDays = Math.max(1, dayDiffFn(contentMinISO, contentMaxISO));
  if (!zoom || !Number.isFinite(zoom.span) || !Number.isFinite(zoom.startOff)) {
    return { startISO: contentMinISO, days: contentDays, fits: true };
  }
  const span = clampZoomSpan(zoom.span);
  return {
    startISO: addDaysFn(contentMinISO, zoom.startOff),
    days: span,
    fits: span >= contentDays,
  };
}

/**
 * 计算条形在窗口内的可见百分比区间；完全不交叉返回 null（不渲染）。
 * @param {number} rawLeftPct 条左缘百分比（可越界）
 * @param {number} rawWidthPct 条宽度百分比
 */
export function clipBarToViewport(rawLeftPct, rawWidthPct) {
  const l = Number(rawLeftPct);
  const w = Number(rawWidthPct);
  if (!Number.isFinite(l) || !Number.isFinite(w) || w <= 0) return null;
  const visLeft = Math.max(0, l);
  const visRight = Math.min(100, l + w);
  if (visRight - visLeft < 0.01) return null;
  return { left: visLeft, width: visRight - visLeft };
}
