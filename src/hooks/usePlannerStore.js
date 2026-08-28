import { useEffect, useRef, useState } from "react";

import { defaultState } from "../app/initialState.js";
import { STORAGE_KEY } from "../constants/appConstants.js";
import { hasLocalServer } from "../app/platform.js";
import { hydrateState, mergeOfflineEdits } from "../planner/hydration.js";

// 上次会话存在保存失败时置位：下次加载成功后用本地态合并文件态并回传，
// 避免离线编辑被“文件优先”的水合逻辑静默覆盖。
const PENDING_SYNC_KEY = "plan-pilot-pending-sync-v1";

function hasPlannerContent(fileData) {
  return (
    (Array.isArray(fileData.tasks) && fileData.tasks.length > 0) ||
    (Array.isArray(fileData.blocks) && fileData.blocks.length > 0) ||
    (Array.isArray(fileData.goals) && fileData.goals.length > 0) ||
    (fileData.dayPlans != null && typeof fileData.dayPlans === "object" && Object.keys(fileData.dayPlans).length > 0) ||
    (Array.isArray(fileData.reviews) && fileData.reviews.length > 0) ||
    (Array.isArray(fileData.recurring) && fileData.recurring.length > 0) ||
    (fileData.settings != null && typeof fileData.settings === "object" && Object.keys(fileData.settings).length > 0) ||
    (fileData.ai != null && typeof fileData.ai === "object" && Object.keys(fileData.ai).length > 0)
  );
}

export function hydratePlannerState(input, mergeTasks) {
  return hydrateState(input, { mergeTasks });
}

// 只负责 planner 持久化：localStorage 启动、文件同步，以及加载后的数据压缩
// 文件同步失败会在 UI 亮出提示（App 的 sync-warning 条），让“服务没起”不再静默。
const SYNC_ISSUE_TEXT =
  "本地文件同步失败：检测不到本地服务（请运行 npm run dev 或 startup.bat）。数据暂存于浏览器，AI 功能与文件同步不可用。";

export function usePlannerStore({ compactPlannerTasks, mergeTasks }) {
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? hydratePlannerState(JSON.parse(raw), mergeTasks) : defaultState;
    } catch {
      return defaultState;
    }
  });
  const [loaded, setLoaded] = useState(false);
  const [syncIssue, setSyncIssue] = useState(null); // null=正常；非 null=文件同步不可达
  const saveTimer = useRef(null);
  const retryTimer = useRef(null);
  const savePayloadRef = useRef(""); // 始终指向最新待保存载荷：重试发送最新 state，避免旧载荷覆盖新数据

  useEffect(() => {
    // 原生壳无本机服务器：直接走 localStorage，不发 /api/data 请求
    if (!hasLocalServer) {
      setLoaded(true);
      return undefined;
    }
    let cancelled = false;
    let attempts = 0;

    // 服务可能在启动中（startup.bat 最多等 60s）：首次加载失败后短暂重试几次，再亮出提示
    function load() {
      fetch("/api/data")
        .then((response) => response.json())
        .then((fileData) => {
          if (cancelled) return;
          if (!fileData || fileData.error) {
            throw new Error(fileData?.error || "Empty response");
          }
          setSyncIssue(null); // 文件服务可达，恢复同步健康

          if (hasPlannerContent(fileData)) {
            // 上次会话有保存失败：本地态 = 文件态 + 离线编辑。先合并（本地胜）再回传服务端，
            // 避免直接用旧文件状态水合把离线编辑静默覆盖掉。
            let pendingOfflineEdits = false;
            try {
              pendingOfflineEdits = localStorage.getItem(PENDING_SYNC_KEY) === "1";
            } catch {
              pendingOfflineEdits = false;
            }

            if (pendingOfflineEdits) {
              const reconciled = hydratePlannerState(mergeOfflineEdits(fileData, state), mergeTasks);
              setState(reconciled);
              try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(reconciled));
              } catch {
                /* 忽略：localStorage 写失败不影响内存态 */
              }
              fetch("/api/data", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(reconciled),
              })
                .then((response) => {
                  if (!response.ok) throw new Error(`HTTP ${response.status}`);
                  setSyncIssue(null);
                  try {
                    localStorage.removeItem(PENDING_SYNC_KEY);
                  } catch {
                    /* 忽略 */
                  }
                })
                .catch(() => setSyncIssue(SYNC_ISSUE_TEXT)); // 标志保留：下次加载继续补传
              return;
            }

            // 文件数据存在时优先使用文件，再把恢复后的结构同步回 localStorage。
            const merged = hydratePlannerState(fileData, mergeTasks);
            setState(merged);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
            return;
          }

          // 文件存储为空时，用已有 localStorage 初始化文件，避免首次升级时清空本地数据。
          const localRaw = localStorage.getItem(STORAGE_KEY);
          if (localRaw) {
            fetch("/api/data", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: localRaw,
            })
              .then((response) => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                setSyncIssue(null);
              })
              .catch(() => setSyncIssue(SYNC_ISSUE_TEXT));
          }
        })
        .catch(() => {
          if (cancelled) return;
          attempts += 1;
          if (attempts >= 3) {
            setSyncIssue(SYNC_ISSUE_TEXT);
          } else {
            setTimeout(load, 3000);
          }
        })
        .finally(() => {
          if (!cancelled) setLoaded(true);
        });
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [mergeTasks]);

  useEffect(() => {
    setState((current) => {
      const compacted = compactPlannerTasks(current.tasks, current.blocks);
      const tasksChanged = compacted.tasks.length !== current.tasks.length;
      const blocksChanged =
        compacted.blocks.length !== current.blocks.length ||
        compacted.blocks.some((block, index) => block !== current.blocks[index]);

      return tasksChanged || blocksChanged ? { ...current, ...compacted } : current;
    });
  }, [compactPlannerTasks, loaded]);

  // 保存失败后的重试：始终发送 savePayloadRef 里的最新 state（指数退避，30s 封顶），
  // 服务恢复后自动补传，不再依赖用户下一次编辑触发。
  const attemptSave = (attempt) => {
    const payload = savePayloadRef.current;
    if (!payload) return;
    fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        setSyncIssue(null); // 保存成功即恢复健康（服务可能已重新拉起）
        try {
          localStorage.removeItem(PENDING_SYNC_KEY);
        } catch {
          /* 忽略 */
        }
      })
      .catch(() => {
        setSyncIssue(SYNC_ISSUE_TEXT);
        try {
          localStorage.setItem(PENDING_SYNC_KEY, "1");
        } catch {
          /* 忽略 */
        }
        const delay = Math.min(30000, 1000 * 2 ** attempt);
        clearTimeout(retryTimer.current);
        retryTimer.current = setTimeout(() => attemptSave(attempt + 1), delay);
      });
  };

  useEffect(() => {
    if (!loaded) return;

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error("localStorage write failed:", error);
    }

    // 文件写入防抖，避免连续编辑时频繁请求本地 API（原生壳跳过：localStorage 已落盘、无本机服务器可写）
    if (hasLocalServer) {
      clearTimeout(saveTimer.current);
      clearTimeout(retryTimer.current);
      savePayloadRef.current = JSON.stringify(state);
      saveTimer.current = setTimeout(() => attemptSave(0), 2000);
    }
    return () => {
      clearTimeout(saveTimer.current);
      clearTimeout(retryTimer.current);
    };
  }, [state, loaded]);

  return [state, setState, syncIssue];
}
