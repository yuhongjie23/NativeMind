import css from './dev-harness.css?inline';
import { assertLocalAnnaEnvironment } from './local-policy';

/** Presentation-only compatibility for the pinned local Anna debugger.
 * Never changes session IDs, RPC dispatch, iframe permissions or production hosts.
 */
export function fitLocalAnnaHarness(): void {
  assertLocalAnnaEnvironment();
  if (window.parent === window || window.parent.location.origin !== window.location.origin) return;
  const host = window.parent.document;
  const frame = host.querySelector<HTMLIFrameElement>('iframe#app');
  if (host.title !== 'Anna App Harness — Mock Dashboard' || frame?.contentWindow !== window ||
      !host.querySelector('#frame > .titlebar') || !host.querySelector('aside #log')) return;
  const style = host.getElementById('nativemind-harness-layout') ?? host.createElement('style');
  style.id = 'nativemind-harness-layout';
  style.textContent = css;
  if (!style.isConnected) host.head.append(style);
  // A bundle reload destroys the iframe realm that owned the previous listener.
  host.getElementById('nativemind-log-toggle')?.remove();
  const button = host.createElement('button');
  button.type = 'button';
  button.id = 'nativemind-log-toggle';
  const expanded = host.body.classList.contains('nativemind-show-log');
  button.textContent = expanded ? '收起调试日志' : '显示调试日志';
  button.setAttribute('aria-expanded', String(expanded));
  button.setAttribute('aria-controls', 'log');
  button.addEventListener('click', () => {
    const open = host.body.classList.toggle('nativemind-show-log');
    button.textContent = open ? '收起调试日志' : '显示调试日志';
    button.setAttribute('aria-expanded', String(open));
  });
  host.querySelector('body > header')?.append(button);
  host.body.classList.add('nativemind-harness');
}
