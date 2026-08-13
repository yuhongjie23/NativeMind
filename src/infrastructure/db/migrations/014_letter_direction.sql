-- 014 信件方向
-- out=寄出（用户→Flora），in=收到（Flora→用户，每日概率来信）。老数据默认 out。

ALTER TABLE letters ADD COLUMN direction TEXT NOT NULL DEFAULT 'out'
