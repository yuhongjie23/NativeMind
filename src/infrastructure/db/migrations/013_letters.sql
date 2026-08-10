-- 013 Flora 信件
-- 写信后不立刻回信：先排队，半天后由 ProcessLettersUseCase 生成回信。
-- status: pending（待发）→ sent（已回）。

CREATE TABLE letters (
    id TEXT PRIMARY KEY,
    letter TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'zh',   -- zh / en，回信语言
    send_after TEXT NOT NULL,              -- 到达该时刻后可生成回信
    status TEXT NOT NULL CHECK(status IN ('pending', 'sent')),
    reply TEXT,                            -- 回信正文
    emotion TEXT,                          -- JSON：{emotion,summary,tone}
    created_at TEXT NOT NULL,
    sent_at TEXT
)
-- @@split
CREATE INDEX idx_letters_send_after ON letters(send_after)
