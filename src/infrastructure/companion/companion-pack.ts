/**
 * 陪伴角色资源包加载
 *
 * 角色资源做成包，放在 public/companions/<id>/ 下（profile.json +
 * dialogues/templates.json），新增角色只加目录不改代码（§17.3）。
 * 动画资源后续接入，当前先把「角色资料 + 台词模板」这条加载链路打通。
 *
 * 加载失败（目录不存在 / 文件损坏）返回 null，UI 回退到内置配置 ——
 * 陪伴是锦上添花，不该因为资源缺失而报错。
 */

export interface CompanionPackProfile {
  id: string;
  name: string;
  description: string;
  tone: string;
  /** 动画名 → 资源键，与 CompanionWidget 的 data-animation 对应 */
  animations: Record<string, string>;
}

export interface CompanionPack {
  profile: CompanionPackProfile;
  /** 场景 → 台词模板，与 ai/companion/interaction-generator 的 CompanionVoice.lines 对应 */
  dialogues: Record<string, string[]>;
}

const packBase = (id: string): string => `/companions/${encodeURIComponent(id)}`;

export const loadCompanionPack = async (id: string): Promise<CompanionPack | null> => {
  try {
    const [profileResponse, dialogueResponse] = await Promise.all([
      fetch(`${packBase(id)}/profile.json`),
      fetch(`${packBase(id)}/dialogues/templates.json`),
    ]);

    if (!profileResponse.ok) return null;

    const profile: CompanionPackProfile = await profileResponse.json();
    const dialogues = dialogueResponse.ok ? await dialogueResponse.json() : {};

    return { profile, dialogues };
  } catch {
    return null;
  }
};
