import { installAnnaBridge, type AnnaHost } from './infrastructure/anna';
import { assertLocalAnnaEnvironment } from './infrastructure/anna/local-policy';
import { fitLocalAnnaHarness } from './infrastructure/anna/dev-harness';
import { connectAnnaWindow } from './infrastructure/anna/window-session';
import './infrastructure/anna/startup.css';

// Keep one SDK handshake across retries in this document.
let hostConnection: Promise<AnnaHost> | undefined;
let starting = false;
let installed = false;

const start = async (): Promise<void> => {
  if (starting) return;
  starting = true;
  const root = document.getElementById('root');
  if (!root) throw new Error('找不到应用挂载点');
  root.textContent = '正在连接 NativeMind 桌面核心…';
  root.classList.add('anna-startup');
  let session: Awaited<ReturnType<typeof connectAnnaWindow>> | undefined;
  try {
    // Before SDK connection or any tool call carrying private data.
    assertLocalAnnaEnvironment();
    fitLocalAnnaHarness();
    const sdkUrl = '/static/anna-apps/_sdk/latest/index.js';
    const sdk = await import(/* @vite-ignore */ sdkUrl) as {
      AnnaAppRuntime: { connect(): Promise<AnnaHost> };
    };
    hostConnection ??= sdk.AnnaAppRuntime.connect().catch(error => { hostConnection = undefined; throw error; });
    const host = await hostConnection;
    session = await connectAnnaWindow(host, () => { root.textContent = '正在等待旧页面释放连接，通常不超过 15 秒…'; });
    try { await session.invoke('native_status'); }
    catch (error) { session.close(); throw error; }
    installAnnaBridge(session.invoke);
    installed = true;
    // Fail closed: never mount the App against the browser demo on connection failure.
    root.classList.remove('anna-startup');
    await import('./main');
  } catch (error) {
    session?.close();
    root.replaceChildren();
    root.classList.add('anna-startup');
    const title = document.createElement('h1');
    title.textContent = '暂时无法打开 NativeMind';
    const detail = document.createElement('p');
    detail.textContent = error instanceof Error ? error.message : String(error);
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = '重试连接';
    retry.addEventListener('click', () => { if (installed) window.location.reload(); else void start(); });
    const help = document.createElement('p');
    help.textContent = '请确认 Anna 本地服务仍在运行。如错误涉及存储，请检查数据目录权限、剩余空间以及是否已被另一个实例占用，再重试连接。';
    root.append(title, detail, help, retry);
  } finally {
    starting = false;
  }
};

window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });
void start();
