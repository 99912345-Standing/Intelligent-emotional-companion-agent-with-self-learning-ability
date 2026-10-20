param()
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$action = $env:BX_ACTION
$utf8 = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if (-not ('BanxingInput' -as [type])) {
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;

public static class BanxingInput {
    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT {
        public uint type;
        public InputUnion U;
    }
    [StructLayout(LayoutKind.Explicit)]
    public struct InputUnion {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
        [FieldOffset(0)] public HARDWAREINPUT hi;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct HARDWAREINPUT {
        public uint uMsg;
        public ushort wParamL;
        public ushort wParamH;
    }
    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
    [DllImport("user32.dll")]
    static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")]
    static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
    [DllImport("user32.dll")]
    static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    public static string Click(int x, int y) {
        if (!SetCursorPos(x, y)) return "set-cursor-failed";
        System.Threading.Thread.Sleep(80);
        mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
        mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
        return "ok";
    }
    public static string TypeText(string text) {
        var list = new List<INPUT>();
        foreach (char c in text) {
            INPUT down = new INPUT();
            down.type = 1;
            down.U.ki.wScan = c;
            down.U.ki.dwFlags = 0x0004;
            list.Add(down);
            INPUT up = new INPUT();
            up.type = 1;
            up.U.ki.wScan = c;
            up.U.ki.dwFlags = 0x0004 | 0x0002;
            list.Add(up);
        }
        INPUT[] inputs = list.ToArray();
        uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
        return sent == inputs.Length ? "ok" : "sendinput-failed:" + sent;
    }
    public static string FocusWindow(int pid) {
        var proc = System.Diagnostics.Process.GetProcessById(pid);
        IntPtr hwnd = proc.MainWindowHandle;
        if (hwnd == IntPtr.Zero) return "no-window";
        ShowWindow(hwnd, 9);
        SetForegroundWindow(hwnd);
        return "ok";
    }
}
"@
}

function Get-BanxingScreenshot {
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
    $graphics = [System.Drawing.Graphics]::FromImage($bmp)
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $target = $env:BX_OUT
    $bmp.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bmp.Dispose()
    return @{
        ok = $true
        file = $target
        width = $bounds.Width
        height = $bounds.Height
        x = $bounds.X
        y = $bounds.Y
        scale = [System.Windows.Forms.SystemInformation]::PrimaryMonitorSize.Width
    }
}

function Get-BanxingWindows {
    $items = Get-Process | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle.Trim().Length -gt 0 } |
        Sort-Object -Property MainWindowTitle |
        ForEach-Object {
            [PSCustomObject]@{
                pid = $_.Id
                title = $_.MainWindowTitle
                process = $_.ProcessName
            }
        }
    return @{ ok = $true; windows = @($items) }
}

try {
    switch ($action) {
        'screenshot' { Get-BanxingScreenshot | ConvertTo-Json -Compress -Depth 6 }
        'windows' { Get-BanxingWindows | ConvertTo-Json -Compress -Depth 6 }
        'click' {
            $result = [BanxingInput]::Click([int]$env:BX_X, [int]$env:BX_Y)
            @{ ok = ($result -eq 'ok'); result = $result; x = [int]$env:BX_X; y = [int]$env:BX_Y } | ConvertTo-Json -Compress
        }
        'type' {
            $text = $utf8.GetString([Convert]::FromBase64String($env:BX_TEXT_B64))
            $result = [BanxingInput]::TypeText($text)
            @{ ok = ($result -eq 'ok'); result = $result; chars = $text.Length } | ConvertTo-Json -Compress
        }
        'keys' {
            [System.Windows.Forms.SendKeys]::SendWait($env:BX_KEYS)
            @{ ok = $true; keys = $env:BX_KEYS } | ConvertTo-Json -Compress
        }
        'focus' {
            $result = [BanxingInput]::FocusWindow([int]$env:BX_PID)
            @{ ok = ($result -eq 'ok'); result = $result; pid = [int]$env:BX_PID } | ConvertTo-Json -Compress
        }
        'launch' {
            $target = $env:BX_TARGET
            if ($target -match '^(https?://|shell:)') {
                Start-Process $target
            } else {
                Start-Process -FilePath $target
            }
            @{ ok = $true; target = $target } | ConvertTo-Json -Compress
        }
        'screen-info' {
            $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
            @{
                ok = $true
                x = $bounds.X; y = $bounds.Y; width = $bounds.Width; height = $bounds.Height
                working = @{
                    width = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea.Width
                    height = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea.Height
                }
            } | ConvertTo-Json -Compress -Depth 4
        }
        default { @{ ok = $false; error = "unknown action: $action" } | ConvertTo-Json -Compress }
    }
} catch {
    @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
    exit 1
}
