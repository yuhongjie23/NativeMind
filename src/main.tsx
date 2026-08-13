/**
 * 应用入口
 *
 * StrictMode 开着：它会在开发期重复执行 effect，能提前暴露订阅没清理的问题。
 * 当前入口临时渲染全屏视觉 Demo（V4）。恢复真实应用时改回 <App />。
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { FullscreenCozyHome } from './ui/demo/fullscreen-cozy-home/FullscreenCozyHome';
import './ui/styles/globals.css';

const container = document.getElementById('root');
if (!container) throw new Error('找不到 #root 挂载点');

createRoot(container).render(
  <StrictMode>
    <FullscreenCozyHome />
  </StrictMode>
);
