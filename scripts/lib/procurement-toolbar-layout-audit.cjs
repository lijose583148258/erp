const assert = require('node:assert/strict');
const path = require('node:path');
const { expect } = require('playwright/test');

async function verifyProcurementToolbarLayouts(page, folder) {
  const evidence = [];
  const originalViewport = page.viewportSize();
  try {
    for (const width of [1024, 1280, 1440, 768, 390]) {
      const height = { 1024: 768, 1280: 720, 1440: 900, 768: 1024, 390: 844 }[width];
      await page.setViewportSize({ width, height });
      for (const desk of ['suppliers', 'orders']) {
        await page.getByTestId(`procurement-desk-${desk}`).click();
        await page.locator('#loading').waitFor({ state: 'hidden', timeout: 10000 });
        const grid = page.locator('[data-enterprise-grid]:visible').first();
        await expect(grid).not.toHaveAttribute('data-grid-state', 'loading', { timeout: 10000 });
        const trigger = grid.getByRole('button', { name: '显示或隐藏表格列', exact: true });
        // Place the control in the usable viewport, not beneath the fixed mobile
        // navigation at its bottom edge. This scroll does not bypass hit testing.
        await trigger.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
        const bounds = await trigger.evaluate(element => {
          const button = element.getBoundingClientRect();
          const grid = element.closest('[data-enterprise-grid]').getBoundingClientRect();
          const top = document.elementFromPoint(button.x + button.width / 2, button.y + button.height / 2);
          return { button: button.toJSON(), grid: grid.toJSON(), hitTarget: top?.outerHTML.slice(0, 350),
            receivesPointer: !!top && (top === element || element.contains(top)) };
        });
        evidence.push({ width, height, desk, ...bounds });
        await page.screenshot({ path: path.join(folder, `toolbar-${desk}-${width}.png`) });
        assert(bounds.receivesPointer, `Procurement ${desk} ${width}px: column button is covered`);
        assert(bounds.button.left >= bounds.grid.left - 1 && bounds.button.right <= bounds.grid.right + 1,
          `Procurement ${desk} ${width}px: column button overflows its own grid`);
        // Never force the click: the user's pointer must actually reach the button.
        await trigger.click({ timeout: 5000 });
        const dialog = page.getByRole('dialog', { name: '选择要显示的表格列', exact: true });
        await dialog.waitFor();
        const panel = await dialog.boundingBox();
        assert(panel && panel.x >= -1 && panel.x + panel.width <= width + 1 && panel.y >= -1 && panel.y + panel.height <= height + 1,
          `Procurement ${desk} ${width}px: column menu is clipped`);
        const checkboxes = dialog.getByRole('checkbox');
        const selectedColumns = await checkboxes.evaluateAll(elements => elements.filter(element => element.checked).length);
        assert(selectedColumns > 1, `Procurement ${desk} ${width}px: fresh preferences must select the default columns`);
        const checkbox = checkboxes.last();
        const before = await checkbox.isChecked();
        await checkbox.click();
        await expect(checkbox).toBeChecked({ checked: !before, timeout: 5000 });
        await checkbox.click();
        await expect(checkbox).toBeChecked({ checked: before, timeout: 5000 });
        await page.screenshot({ path: path.join(folder, `toolbar-menu-${desk}-${width}.png`) });
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
        evidence[evidence.length - 1].menu = { ...panel, toggledAndRestored: true };
      }
    }
    return evidence;
  } catch (error) { error.layoutEvidence = evidence; throw error; }
  finally { if (originalViewport) await page.setViewportSize(originalViewport); }
}

module.exports = { verifyProcurementToolbarLayouts };
