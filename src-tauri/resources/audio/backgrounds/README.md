# 背景音乐（Background Music）

这里放按 `场景/天气` 命名的背景音乐文件。文件是 **bundle 资源**，运行时经 Rust `bgm_read` 读取；缺失时对应场景静默，不影响应用运行。

## 命名规则（`src/ui/demo/fullscreen-cozy-home/background-music.ts` 映射）

| 天气/场景 | 文件名 |
|-----------|--------|
| 晴（日常） | `day.mp3` |
| 雨 | `rain_all.mp3` |
| 雪 | `snow_all.mp3` |
| 春（樱花） | `spring_all.mp3` |
| 夏（萤火虫） | `summer_firefly.mp3` |
| 图书馆 · 白天/黄昏 | `library_day_dusk.mp3` |
| 图书馆 · 夜晚 | `library_night.mp3` |
| 备用（不参与映射） | `backup1.mp3` |

## 提示

- 建议用低码率 / 短循环的 mp3（几十 MB 以内），不要放几百 MB 的长曲 —— 会显著增大安装包。
- 也可以不改文件、在应用内 **设置 → 路径 → 资源目录** 指向你自己的音频目录。
- 修改映射：编辑 `src/ui/demo/fullscreen-cozy-home/background-music.ts`。
