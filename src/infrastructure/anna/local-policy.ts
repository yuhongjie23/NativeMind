/** The current Executa bridge is valid only in the local development harness.
 * Production tools.invoke relays through Anna; do not send local content through it.
 * This is a deployment guard, NOT user authentication or an authorization boundary.
 */
export const assertLocalAnnaOrigin = (origin: string): void => {
  const url = new URL(origin);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('当前 Anna 接入仅允许本机调试；纯本地正式数据通道尚未完成，已阻止通过平台转发学习数据');
  }
};

export const assertLocalAnnaEnvironment = (): void => {
  assertLocalAnnaOrigin(window.location.origin);
  // Cross-origin embedding is rejected; a public site must not wrap our dev UI.
  assertLocalAnnaOrigin(window.top?.location.origin ?? window.location.origin);
};
