-- 010_add_focus_actual_minutes.sql
-- 记录「实际专注分钟数」：提前结束的会话应按真实时长统计，
-- 否则 25 分钟计划只做了 10 分钟，复盘/今日/陪伴统计都记 25。
ALTER TABLE focus_sessions ADD COLUMN actual_minutes INTEGER
