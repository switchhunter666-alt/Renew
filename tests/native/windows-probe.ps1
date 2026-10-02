# Read-only foreground/capture probe plus graceful close and scoped cleanup.
# No activation, input injection, always-on-top, desktop switching or policy changes.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class RenewWindowProbe {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder text, int max);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect r);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int index);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool GetUserObjectInformation(IntPtr h, int n, StringBuilder text, int length, out uint needed);
  [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
[void][RenewWindowProbe]::SetProcessDPIAware()
function Window-State($process, [string]$nativeHandle) {
  $process.Refresh()
  $processHandle = $process.MainWindowHandle
  $handle = if ($nativeHandle) { [IntPtr]::new([long]::Parse($nativeHandle)) } else { $processHandle }
  [uint32]$ownerPid = 0
  [void][RenewWindowProbe]::GetWindowThreadProcessId($handle, [ref]$ownerPid)
  $title = [Text.StringBuilder]::new(512)
  [void][RenewWindowProbe]::GetWindowText($handle, $title, $title.Capacity)
  $rect = [RenewWindowProbe+Rect]::new()
  [void][RenewWindowProbe]::GetWindowRect($handle, [ref]$rect)
  $screen = [System.Windows.Forms.Screen]::FromHandle($handle).Bounds
  return @{
    pid = $process.Id; ownerPid = $ownerPid; handle = $handle.ToInt64().ToString(); title = $title.ToString()
    valid = [RenewWindowProbe]::IsWindow($handle); processMainWindowHandle = $processHandle.ToInt64().ToString()
    handleSource = $(if ($nativeHandle) { "Electron BrowserWindow.getNativeWindowHandle" } else { "Process.MainWindowHandle" })
    visible = [RenewWindowProbe]::IsWindowVisible($handle); minimized = [RenewWindowProbe]::IsIconic($handle)
    caption = (([RenewWindowProbe]::GetWindowLong($handle, -16) -band 0x00c00000) -ne 0)
    rect = @{ left=$rect.Left; top=$rect.Top; right=$rect.Right; bottom=$rect.Bottom }
    monitor = @{ left=$screen.Left; top=$screen.Top; right=$screen.Right; bottom=$screen.Bottom }
  }
}
function Owned-Processes($exe) {
  # Exact unique temporary executable path: never act on an arbitrary mGBA PID.
  @(Get-Process -Name 'mGBA' -ErrorAction SilentlyContinue | Where-Object {
    try { $_.Path -and ([string]::Equals($_.Path, $exe, [StringComparison]::OrdinalIgnoreCase)) } catch { $false }
  })
}
while ($line = [Console]::ReadLine()) {
  try {
    $request = $line | ConvertFrom-Json
    if ($request.op -eq 'quit') { break }
    $owned = @(Owned-Processes $request.exe)
    if ($request.op -eq 'close' -or $request.op -eq 'cleanup') {
      foreach ($process in $owned) {
        if ($request.op -eq 'cleanup') {
          $process.Kill()
          if (-not $process.WaitForExit(5000)) { throw 'Owned emulator did not exit during cleanup.' }
        }
        else {
          $process.Refresh()
          if ($process.MainWindowHandle -eq [IntPtr]::Zero) { throw 'Owned emulator has no closeable window.' }
          if (-not [RenewWindowProbe]::PostMessage($process.MainWindowHandle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) { throw 'WM_CLOSE failed.' }
        }
      }
      @{ ok=$true; count=$owned.Count } | ConvertTo-Json -Compress
      continue
    }
    $foreground = [RenewWindowProbe]::GetForegroundWindow()
    [uint32]$foregroundPid = 0
    [void][RenewWindowProbe]::GetWindowThreadProcessId($foreground, [ref]$foregroundPid)
    $desktop = [RenewWindowProbe]::OpenInputDesktop(0, $false, 1)
    $desktopName = [Text.StringBuilder]::new(256)
    [uint32]$needed = 0
    $desktopReadable = $false
    if ($desktop -ne [IntPtr]::Zero) {
      $desktopReadable = [RenewWindowProbe]::GetUserObjectInformation($desktop, 2, $desktopName, 512, [ref]$needed)
      [void][RenewWindowProbe]::CloseDesktop($desktop)
    }
    $result = @{
      time=[DateTime]::UtcNow.ToString('o'); interactive=[Environment]::UserInteractive
      sessionId=(Get-Process -Id $PID).SessionId; inputDesktop=$desktopName.ToString(); desktopReadable=$desktopReadable
      foregroundPid=$foregroundPid; foregroundHandle=$foreground.ToInt64().ToString(); emulators=@(); wrapperPid=$request.wrapperPid
    }
    if ($request.renewPid) { $result.renew = Window-State (Get-Process -Id $request.renewPid) $request.renewHandle }
    foreach ($process in $owned) {
      $window = Window-State $process
      $details = Get-CimInstance Win32_Process -Filter "ProcessId=$($process.Id)"
      $window.executable=$process.Path; $window.parentPid=$details.ParentProcessId; $window.commandLine=$details.CommandLine
      $result.emulators += $window
    }
    if ($request.capture -and $owned.Count -eq 1 -and $foregroundPid -eq $owned[0].Id) {
      $w = $result.emulators[0]; $r = $w.rect
      $width = $r.right - $r.left; $height = $r.bottom - $r.top
      if ($width -gt 0 -and $height -gt 0 -and $width -le 8192 -and $height -le 8192) {
        $bitmap = [Drawing.Bitmap]::new($width, $height)
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        try {
          $graphics.CopyFromScreen($r.left, $r.top, 0, 0, $bitmap.Size)
          $pixels = @()
          foreach ($x in @(0.4, 0.5, 0.6)) { foreach ($y in @(0.4, 0.5, 0.6)) {
            $color=$bitmap.GetPixel([int]($width*$x), [int]($height*$y))
            $pixels += ,@([int]$color.R, [int]$color.G, [int]$color.B)
          } }
          $bitmap.Save([string]$request.capture, [Drawing.Imaging.ImageFormat]::Png)
          $result.capture = @{ path=$request.capture; pixels=$pixels }
        } catch { $result.captureError = $_.Exception.Message }
        finally { $graphics.Dispose(); $bitmap.Dispose() }
      }
    }
    $result | ConvertTo-Json -Depth 10 -Compress
  } catch { @{ error=$_.Exception.Message } | ConvertTo-Json -Compress }
}
