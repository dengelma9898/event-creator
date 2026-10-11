import { Notification, BrowserWindow } from 'electron';

export interface ShowNotificationOptions {
  title: string;
  body: string;
  silent?: boolean;
}

/**
 * Zeigt eine native macOS Systembenachrichtigung an.
 * Beim Klick auf die Benachrichtigung wird das Hauptfenster in den Vordergrund geholt.
 */
export function showSystemNotification(options: ShowNotificationOptions): void {
  try {
    if (!Notification.isSupported()) {
      return;
    }

    const notification = new Notification({
      title: options.title,
      body: options.body,
      silent: options.silent ?? false,
    });

    notification.on('click', () => {
      try {
        const allWindows = BrowserWindow.getAllWindows();
        if (allWindows.length > 0) {
          const win = allWindows[0] as any;
          if (win && typeof win.isMinimized === 'function' && win.isMinimized()) {
            win.restore();
          }
          if (win && typeof win.show === 'function') {
            win.show();
          }
          if (win && typeof win.focus === 'function') {
            win.focus();
          }
        }
      } catch (clickErr) {
        console.warn('[Notifier] Fehler beim Fokussieren des Fensters:', clickErr);
      }
    });

    notification.show();
  } catch (err) {
    console.warn('[Notifier] Konnte Systembenachrichtigung nicht anzeigen:', err);
  }
}
