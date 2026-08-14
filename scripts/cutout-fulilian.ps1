# 抠图：从边缘洪泛填充，删除与边缘连通的近白背景，保留人物（含人物内部的白色区域）。
# 用 C# 实现（Add-Type），避免 PowerShell 数组索引解析问题。
Add-Type -AssemblyName System.Drawing

$cs = @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class Cutout {
  public static int Run(string src, string dst, int thresh) {
    using (var bmp = new Bitmap(src)) {
      using (var bmp32 = new Bitmap(bmp.Width, bmp.Height, PixelFormat.Format32bppArgb)) {
        using (var g = Graphics.FromImage(bmp32)) { g.DrawImage(bmp, 0, 0, bmp.Width, bmp.Height); }
        int W = bmp32.Width, H = bmp32.Height;
        var rect = new Rectangle(0, 0, W, H);
        var data = bmp32.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
        int stride = data.Stride;
        byte[] bytes = new byte[stride * H];
        Marshal.Copy(data.Scan0, bytes, 0, bytes.Length);
        byte[] marked = new byte[stride * H];
        var stack = new Stack<int>();
        Func<int,bool> isBg = idx => bytes[idx] >= thresh && bytes[idx+1] >= thresh && bytes[idx+2] >= thresh;

        for (int x = 0; x < W; x++) {
          int[] ys = new int[]{ 0, H-1 };
          for (int k = 0; k < 2; k++) { int i = ys[k]*stride + x*4; if (marked[i]==0 && isBg(i)) { marked[i]=1; stack.Push(i); } }
        }
        for (int y = 0; y < H; y++) {
          int[] xs = new int[]{ 0, W-1 };
          for (int k = 0; k < 2; k++) { int i = y*stride + xs[k]*4; if (marked[i]==0 && isBg(i)) { marked[i]=1; stack.Push(i); } }
        }

        int count = 0;
        while (stack.Count > 0) {
          int i = stack.Pop(); count++;
          int pix = i / 4;
          int x = pix % W, y = pix / W;
          if (x > 0)   { int ni = i-4;        if (marked[ni]==0 && isBg(ni)) { marked[ni]=1; stack.Push(ni); } }
          if (x < W-1) { int ni = i+4;        if (marked[ni]==0 && isBg(ni)) { marked[ni]=1; stack.Push(ni); } }
          if (y > 0)   { int ni = i-stride;   if (marked[ni]==0 && isBg(ni)) { marked[ni]=1; stack.Push(ni); } }
          if (y < H-1) { int ni = i+stride;   if (marked[ni]==0 && isBg(ni)) { marked[ni]=1; stack.Push(ni); } }
        }

        for (int i = 0; i < bytes.Length; i += 4) { if (marked[i]==1) bytes[i+3] = 0; }
        Marshal.Copy(bytes, 0, data.Scan0, bytes.Length);
        bmp32.UnlockBits(data);
        bmp32.Save(dst, ImageFormat.Png);
        return count;
      }
    }
  }
}
"@

Add-Type -TypeDefinition $cs -ReferencedAssemblies System.Drawing

$src = 'E:\agent_workspace\NativeMind\.tmp-src.png'
$dst = 'E:\agent_workspace\NativeMind\src\ui\pets\fulilian.png'
try {
    $count = [Cutout]::Run($src, $dst, 245)
    Write-Host ("cutout done. bg pixels removed: " + $count)
} catch {
    Write-Host ("RUN ERROR: " + $_.Exception.Message)
    if ($_.Exception.InnerException) { Write-Host ("INNER: " + $_.Exception.InnerException.Message) }
    if ($_.Exception.InnerException.InnerException) { Write-Host ("INNER2: " + $_.Exception.InnerException.InnerException.Message) }
}
