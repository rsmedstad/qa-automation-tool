import { heroTextVisible } from '../utils/hero.js';

// Mock isVisible helper
function visibleElement() {
  return { isVisible: async () => true };
}

function hiddenElement() {
  return { isVisible: async () => false };
}

describe('heroTextVisible', () => {
  test('returns true when any selector is visible', async () => {
    const page = {
      $: jest.fn(sel => sel === '.b' ? visibleElement() : null)
    };
    const result = await heroTextVisible(page, ['.a', '.b']);
    expect(page.$).toHaveBeenCalledTimes(2);
    expect(result).toBe(true);
  });

  test('returns false when no selectors are visible', async () => {
    const page = { $: jest.fn(() => null) };
    const result = await heroTextVisible(page, ['.a', '.b']);
    expect(page.$).toHaveBeenCalledTimes(2);
    expect(result).toBe(false);
  });
});

