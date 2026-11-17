import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';

export interface ShareOptions {
  title: string;
  text: string;
  url: string;
  dialogTitle?: string;
}

export async function shareContent(opts: ShareOptions): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    try {
      const can = await Share.canShare();
      if (can.value) {
        await Share.share({
          title: opts.title,
          text: opts.text,
          url: opts.url,
          dialogTitle: opts.dialogTitle || opts.title,
        });
        return true;
      }
    } catch {
      // Fall through to web sharing
    }
  }

  // Web fallback via navigator.share
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({
        title: opts.title,
        text: opts.text,
        url: opts.url,
      });
      return true;
    } catch {
      // User cancelled share dialog
    }
  }

  // Clipboard fallback
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(`${opts.text}\n${opts.url}`);
      return true;
    } catch {}
  }

  return false;
}

export function shareSchoolProducts(schoolName: string, schoolUrl: string): Promise<boolean> {
  return shareContent({
    title: `${schoolName} Uniforms & Books List`,
    text: `Official uniform and stationery list for ${schoolName} on School Store:`,
    url: schoolUrl,
    dialogTitle: 'Share School List',
  });
}

export function shareOrderDetails(
  orderNumber: string,
  orderTotal: number,
  orderUrl: string
): Promise<boolean> {
  return shareContent({
    title: `School Store Order #${orderNumber}`,
    text: `School Store Order #${orderNumber} (₹${orderTotal}). Track order and delivery here:`,
    url: orderUrl,
    dialogTitle: 'Share Order Details',
  });
}
