-- 012 每日打卡
-- 单日打卡：任务完成度 + 学习时长。落库供「打卡日历」展示与后续学习效率分析。
-- check_in_done = 当日所有任务完成（tasks_total > 0 且 tasks_completed >= tasks_total）。

CREATE TABLE daily_checkins (
    date TEXT PRIMARY KEY,                 -- YYYY-MM-DD
    tasks_total INTEGER NOT NULL DEFAULT 0,
    tasks_completed INTEGER NOT NULL DEFAULT 0,
    focus_minutes INTEGER NOT NULL DEFAULT 0,
    study_goal_minutes INTEGER NOT NULL DEFAULT 0,
    check_in_done INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
)
