// Utility that checks if hero section text is visible on a page
import { heroSelectors as defaultSelectors } from '../config.js';

export async function heroTextVisible(page, selectors = defaultSelectors) {
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el && await el.isVisible()) {
      return true;
    }
  }
  return false;
}

