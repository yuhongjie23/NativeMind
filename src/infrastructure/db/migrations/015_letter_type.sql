-- 015 信件类型
-- encourage=学习鼓励（每月一次），whats_up=Flora近况（网络搜索），warm=温暖鼓励。老数据默认 warm。

ALTER TABLE letters ADD COLUMN type TEXT NOT NULL DEFAULT 'warm'
