import { Injectable, Logger } from '@nestjs/common';
import { displayGtin } from './barcode-info';

export interface OnlineProduct {
  title: string | null;
  brand: string | null;
  model: string | null;
}

const DAY = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 4000;

/**
 * Looks shop barcodes up in UPCitemdb's free trial API (about 100 lookups a
 * day, no key). Coverage for machinery spare parts is patchy, so a miss is
 * normal. Set BARCODE_LOOKUP=off to never call out.
 */
@Injectable()
export class OnlineLookup {
  private readonly logger = new Logger(OnlineLookup.name);
  private readonly cache = new Map<
    string,
    { at: number; value: OnlineProduct | null }
  >();
  private blockedUntil = 0;

  get enabled(): boolean {
    return process.env['BARCODE_LOOKUP'] !== 'off';
  }

  async find(gtin14: string, now = Date.now()): Promise<OnlineProduct | null> {
    if (!this.enabled || now < this.blockedUntil) return null;
    const hit = this.cache.get(gtin14);
    if (hit && now - hit.at < DAY) return hit.value;

    const upc = displayGtin(gtin14);
    let value: OnlineProduct | null = null;
    try {
      const res = await fetch(
        `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(upc)}`,
        {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
      if (res.status === 429) {
        // Daily allowance used up: stop asking for an hour.
        this.blockedUntil = now + 60 * 60 * 1000;
        this.logger.warn('Barcode lookup limit reached; pausing for an hour');
        return null;
      }
      if (res.ok) {
        const body = (await res.json()) as {
          items?: { title?: string; brand?: string; model?: string }[];
        };
        const item = body.items?.[0];
        if (item) {
          value = {
            title: item.title?.trim() || null,
            brand: item.brand?.trim() || null,
            model: item.model?.trim() || null,
          };
        }
      }
    } catch {
      // Offline or slow: just no suggestion this time.
      return null;
    }
    this.cache.set(gtin14, { at: now, value });
    return value;
  }
}
