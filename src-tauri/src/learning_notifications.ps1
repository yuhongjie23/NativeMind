$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
    $inputData = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $appId = 'com.nativemind.app'
    if (-not (Get-StartApps | Where-Object { $_.AppID -eq $appId })) {
        @{ supported = $false; enabled = $false; scheduled = 0; message = '请先安装 NativeMind 桌面版以注册 Windows 通知，然后点击重新同步。应用内提醒仍可使用。' } | ConvertTo-Json -Compress
        exit 0
    }
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
    [Windows.UI.Notifications.ScheduledToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null
    $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId)
    $existing = @($notifier.GetScheduledToastNotifications())
    $wanted = @{}
    foreach ($item in $inputData.reminders) { $wanted[$item.id] = $item }
    # Only touch this data directory's namespace, never another desktop/Anna library.
    foreach ($old in $existing) {
        if ($old.Group -ne $inputData.prefix) { continue }
        $desired = $wanted[$old.Tag]
        if ($null -eq $desired -or $old.DeliveryTime -ne [DateTimeOffset]::Parse($desired.dueAt)) {
            $notifier.RemoveFromSchedule($old)
        } else { $wanted.Remove($old.Tag) }
    }
    # Windows may not expose Setting until the first scheduled notification exists.
    if ($inputData.reminders.Count -gt 0 -and $null -ne $notifier.Setting -and $notifier.Setting.ToString() -ne 'Enabled') {
        throw 'Windows notifications are disabled for NativeMind.'
    }
    foreach ($item in $wanted.Values) {
        $due = [DateTimeOffset]::Parse($item.dueAt)
        # Missed reminders remain in the App. Do not replay a burst on reopening.
        if ($due -le [DateTimeOffset]::Now) { continue }
        $title = [System.Security.SecurityElement]::Escape([string]$item.title)
        $xml = [Windows.Data.Xml.Dom.XmlDocument]::new()
        $xml.LoadXml('<toast><visual><binding template="ToastGeneric"><text>NativeMind</text><text>' + $title + '</text><text>打开 NativeMind 的学习计划，可复盘、延后、跳过或停止提醒。</text></binding></visual><audio silent="true"/></toast>')
        $toast = [Windows.UI.Notifications.ScheduledToastNotification]::new($xml, $due)
        $toast.Group = $inputData.prefix
        $toast.Tag = $item.id
        $toast.ExpirationTime = $due.AddHours(2)
        $notifier.AddToSchedule($toast)
    }
    $pending = @($notifier.GetScheduledToastNotifications() | Where-Object { $_.Group -eq $inputData.prefix })
    @{ supported = $true; enabled = $true; scheduled = $pending.Count; message = 'Windows 已接管提醒；应用退出后仍可显示。关机、勿扰或系统通知关闭可能影响送达。' } | ConvertTo-Json -Compress
} catch {
    @{ supported = $false; enabled = $false; scheduled = 0; message = $_.Exception.Message } | ConvertTo-Json -Compress
    exit 1
}
