/**
 * 应用用例层公共出口
 * UI 层只从这里引用，不直接依赖内部路径。
 */
export * from './bootstrap';
export * from './ports';
export * from './events/event-bus';
export * from './events/event-types';
export * from './confirmation/action-proposal';
export * from './confirmation/confirmation-service';
export * from './policies/focus-mode-policy';
export * from './policies/interaction-policy';
export * from './policies/privacy-policy';
