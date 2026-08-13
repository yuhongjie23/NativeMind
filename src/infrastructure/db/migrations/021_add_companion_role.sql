-- 021 陪伴消息角色
-- 区分宠物/用户/系统消息（CompanionMessage.role），默认 'pet' 兼容旧数据。
-- 页面按 conversationId 分组时用 role 渲染左右气泡，不再依赖 scene_type 猜测。

ALTER TABLE companion_interactions ADD COLUMN role TEXT NOT NULL DEFAULT 'pet'
