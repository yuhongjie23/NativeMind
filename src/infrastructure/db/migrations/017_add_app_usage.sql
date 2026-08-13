-- 017 每日应用使用时长
-- 记录用户每天使用 NativeMind 的总时长（含专注与非专注，分开存，不互减）。
-- 前端 start() 周期累加 + 退出时落一次终值；窗口直接关闭不保证触发，所以周期落盘是主路径。
-- app_active_seconds: 应用在前台/打开的累计秒数（专注中也在内）
-- focus_seconds:      其中专注模式的累计秒数（可单独分析，也可从总时长里区分）

CREATE TABLE app_usage (
    date TEXT PRIMARY KEY,              -- YYYY-MM-DD（本地时区）
    app_active_seconds INTEGER NOT NULL DEFAULT 0,
    focus_seconds INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
)
