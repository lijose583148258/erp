function createSalesOrderCustomerSelector({ report, testData, modalTimeout }) {
  async function selectFirstRealOption(selectLocator) {
    if (await selectLocator.getAttribute('role') === 'combobox') {
      await selectLocator.click();
      await selectLocator.press('Home');
      const activeOptionId = await selectLocator.getAttribute('aria-activedescendant');
      if (!activeOptionId) throw new Error('customer combobox did not expose an active option');
      const option = selectLocator.page().locator(`#${activeOptionId}`);
      await option.waitFor({ state: 'visible', timeout: modalTimeout });
      const value = (await option.getAttribute('data-testid') || '').replace('sales-order-customer-option-', '');
      const label = (await option.innerText()).trim();
      await selectLocator.press('ArrowDown');
      const nextActiveOptionId = await selectLocator.getAttribute('aria-activedescendant');
      if (!nextActiveOptionId) throw new Error('customer combobox lost active option after ArrowDown');
      const selectedOption = selectLocator.page().locator(`#${nextActiveOptionId}`);
      const selectedValue = (await selectedOption.getAttribute('data-testid') || '').replace('sales-order-customer-option-', '');
      const selectedLabel = (await selectedOption.innerText()).trim();
      await selectLocator.press('Enter');
      if (await selectLocator.getAttribute('aria-expanded') !== 'false') {
        throw new Error('customer combobox did not close after keyboard selection');
      }
      return { value: selectedValue || value, label: selectedLabel || label };
    }

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const option = await selectLocator.evaluate((element) => {
        const options = Array.from(element.options || []);
        const target = options.find((item) => item.value && !item.disabled);
        return target ? { value: target.value, label: target.textContent || '' } : null;
      });
      if (option?.value) {
        await selectLocator.selectOption(option.value);
        return option;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('no selectable option found');
  }

  async function selectSeedCustomer(selectLocator) {
    const seed = report.seedCustomer;
    if (!seed?.id) return selectFirstRealOption(selectLocator);
    await selectLocator.fill(seed.label || testData.customerName);
    await selectLocator.click();
    const option = selectLocator.page().locator(`[data-testid="sales-order-customer-option-${seed.id}"]`);
    await option.waitFor({ state: 'visible', timeout: modalTimeout });
    const label = (await option.innerText()).trim();
    await option.click();
    if (await selectLocator.getAttribute('aria-expanded') !== 'false') {
      throw new Error('seed customer combobox did not close after selection');
    }
    return { value: seed.id, label };
  }

  return { selectSeedCustomer };
}

module.exports = { createSalesOrderCustomerSelector };
