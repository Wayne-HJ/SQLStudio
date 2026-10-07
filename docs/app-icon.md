# SQLStudio 应用图标

用户确认采用：蓝紫渐变圆角方形，中央白色倒置 Ω（℧）。

- 生产素材：[public/app-icon.png](../public/app-icon.png)，1254 × 1254，RGBA PNG。
- 原始确认稿：[assets/branding/icon-approved-preview.png](../assets/branding/icon-approved-preview.png)。
- 使用内置 `imagegen` 工具生成及提取透明背景。生产素材保留完整图形和配色，外围透明；构建时由 electron-builder 自动转换为 macOS ICNS 和 Windows ICO，安装器沿用程序图标。
- 标题栏、设置窗口和浏览器 favicon 与桌面安装包共用生产素材。

## 原始生成提示词

```text
Use case: logo-brand. Asset type: one preview concept for the SQLStudio macOS and Windows desktop application icon. Create a single polished, minimal app icon, front-facing and perfectly square, with a rounded-square blue-to-indigo background consistent with a blue/purple database workspace app. The main content must be a large white capital Greek Omega rotated EXACTLY 180 degrees, centered both horizontally and vertically. This is the inverted Omega symbol ℧, NOT the ordinary upright Ω. Shape accuracy is essential: a bold smoothly curved circular U-shaped bowl whose opening is at the TOP; the two open ends at the upper left and upper right each have a short horizontal foot extending OUTWARD, at the TOP of the symbol. The bottom is one continuous rounded curve. There is NO horizontal bar across the opening, no top connecting line, no bottom feet. Use a clean, sturdy geometrical glyph with balanced uniform thickness, occupying roughly 55 percent of the rounded square width and generous margins. Subtle native desktop app icon depth with gentle edge lighting and a restrained soft shadow; crisp silhouette, no decorative database cylinders or extra marks. Present one icon centered on a plain very light neutral background with a small amount of breathing room around it. No app name, no wordmark, no captions, no watermarks, no mock device, no surrounding interface. Square image.
```

## 生产素材编辑提示词

参考图：原始确认稿。`transparent_background: true`。

```text
Edit target: the attached approved SQLStudio app icon. Precise background extraction for production app-icon use. Preserve the approved icon EXACTLY: same blue-cyan-indigo-violet gradient, same rounded-square outline, same white inverted capital Omega ℧ rotated 180 degrees, same glyph proportions, stroke thickness, position and subtle edge highlights. Change ONLY the external near-white presentation backdrop and external drop shadow into fully transparent pixels. Keep the entire blue rounded square opaque and its white ℧ opaque. No redesign, no new marks, no text. Output one square PNG with actual alpha transparency; the rounded-square icon should fill approximately 88 percent of the canvas width and height, centered with equal narrow transparent margins on all sides. No checkerboard painted into the image. All pixels outside the icon must be transparent.
```
