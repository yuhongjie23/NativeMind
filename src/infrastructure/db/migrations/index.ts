/**
 * 迁移注册表
 *
 * 新增迁移：加 NNN_xxx.sql 文件 → 在 MIGRATIONS 末尾追加一项。
 * 版本号只增不改，已发布的迁移文件不要回头编辑（用户库里已经跑过了）。
 */
import init001 from './001_init.sql?raw';
import socratic002 from './002_add_socratic.sql?raw';
import companion003 from './003_add_companion_interactions.sql?raw';
import knowledgeLink004 from './004_add_knowledge_link_lifecycle.sql?raw';
import companionScene005 from './005_widen_companion_scene.sql?raw';
import fts006 from './006_fts5_note_chunks.sql?raw';
import monthlyReview007 from './007_add_monthly_review.sql?raw';
import relaxActionType008 from './008_relax_action_type_check.sql?raw';
import focusFkOnDelete009 from './009_add_focus_fk_on_delete.sql?raw';
import focusActualMinutes010 from './010_add_focus_actual_minutes.sql?raw';
import askSessions011 from './011_ask_sessions.sql?raw';
import dailyCheckins012 from './012_daily_checkins.sql?raw';
import letters013 from './013_letters.sql?raw';
import letterDirection014 from './014_letter_direction.sql?raw';
import letterType015 from './015_letter_type.sql?raw';
import letterConversation016 from './016_letter_conversation.sql?raw';

export interface Migration {

  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  { version: 1, name: 'init', sql: init001 },
  { version: 2, name: 'add_socratic', sql: socratic002 },
  { version: 3, name: 'add_companion_interactions', sql: companion003 },
  { version: 4, name: 'add_knowledge_link_lifecycle', sql: knowledgeLink004 },
  { version: 5, name: 'widen_companion_scene', sql: companionScene005 },
  { version: 6, name: 'fts5_note_chunks', sql: fts006 },
  { version: 7, name: 'add_monthly_review', sql: monthlyReview007 },
  { version: 8, name: 'relax_action_type_check', sql: relaxActionType008 },
  { version: 9, name: 'add_focus_fk_on_delete', sql: focusFkOnDelete009 },
  { version: 10, name: 'add_focus_actual_minutes', sql: focusActualMinutes010 },
  { version: 11, name: 'add_ask_sessions', sql: askSessions011 },
  { version: 12, name: 'add_daily_checkins', sql: dailyCheckins012 },
  { version: 13, name: 'add_letters', sql: letters013 },
  { version: 14, name: 'add_letter_direction', sql: letterDirection014 },
  { version: 15, name: 'add_letter_type', sql: letterType015 },
  { version: 16, name: 'add_letter_conversation', sql: letterConversation016 },
];


export const LATEST_VERSION = MIGRATIONS.reduce(
  (max, migration) => Math.max(max, migration.version),
  0
);
