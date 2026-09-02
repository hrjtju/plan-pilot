# agent-feedback（plan-pilot）

本目录沉淀用户对 agent 行为的显式纠正与偏好，驱动 workflow-improver 闭环。

## 目录

- YYYY-MM-DD.md：每日反馈条目（frontmatter + 正文）
- proposals/YYYY-MM-DD.md：improver 提案（用户审阅后合入）

## 条目格式

frontmatter：date / repo / category / source(user|history) / agent(codex|claude|cursor|...) / session(可选) / status / count(可选)

正文小节：场景 / Agent 实际做了什么 / 期望 / 理由

## 状态图例

open / applied / rejected / dismissed / needs-confirm

## 类别

TRAIN（训练方式）/ HYPER（超参数）/ PLOT（绘图）/ INTEGRITY（代码合规与诚信）/ CMD（Windows 命令与环境）/ PROCESS（任务流程）

## 纪律

- 数字/实验类反馈走 docs/worklog.md，不进这里；
- 已编码在 AGENTS.md/CLAUDE.md 的规则不重复沉淀；
- 只记录显式纠正，模糊抱怨不记。
