// The Anna page deliberately has no learning UI, storage APIs or document inputs.
const button = document.getElementById('open');
const status = document.getElementById('status');
let connection;
button.addEventListener('click', async () => {
  button.disabled = true;
  status.textContent = 'Contacting your local Agent… 正在联系本机 Agent…';
  try {
    const { AnnaAppRuntime } = await import('/static/anna-apps/_sdk/latest/index.js');
    connection ??= AnnaAppRuntime.connect().catch(error => { connection = undefined; throw error; });
    const host = await connection;
    const result = await host.tools.invoke({
      tool_id: 'tool-forforever23-hongjie-yu-3qny9w3z', method: 'open_app', args: {},
    }, { timeoutMs: 30000 });
    if (result?.status !== 'launch_requested') throw new Error('Unexpected response');
    status.textContent = 'Confirm opening NativeMind on your computer. If it is already running, switch to its window. 请在本机确认打开；若已运行，请切换到 NativeMind 窗口。';
  } catch {
    // Host errors may contain routing details: no raw reflection into this UI.
    status.textContent = 'Unable to request launch. Select your local Windows Agent, check the bundled tool is installed, then retry. 请选本机 Windows Agent，检查工具安装后重试。';
  } finally { button.disabled = false; }
});
