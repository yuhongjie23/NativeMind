-- 018 复盘来源提案关联
-- 复盘生成走确认门：proposal 先落 action_proposals，确认后写 review_logs。
-- 崩溃恢复时，只有「该提案已提交」才能判定 review 行存在 = commit 已完成；
-- 否则「重生成已有复盘」场景下旧复盘存在会被误判成新草稿已提交。
-- 新增列可空（旧数据无来源提案），语义：此复盘由哪个 generate_review 提案写入。

ALTER TABLE review_logs ADD COLUMN source_proposal_id TEXT
