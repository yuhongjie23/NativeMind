/**
 * 宠物苏格拉底式提问（本地演示）。
 *
 * 让宠物在气泡里冒一个简单问题，只在气泡显示，不需要在别处展示，
 * 也不写库。真实 Socratic 会话后续可替换此来源。
 */
import { create } from 'zustand';

export const SOCRATIC_QUESTIONS = [
  '这个概念，你能用自己的话讲一遍吗？',
  '这个结论成立的前提是什么？',
  '如果去掉一个条件，还成立吗？',
  '能举一个反例试试吗？',
  '你现在卡在哪一步？',
  '这个说法和你笔记里的哪条能对上？',
];

interface PetQuestionState {
  question: string | null;
  ask: (question: string) => void;
  clear: () => void;
}

export const usePetQuestion = create<PetQuestionState>((set) => ({
  question: null,
  ask: (question) => set({ question }),
  clear: () => set({ question: null }),
}));
