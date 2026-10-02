import { test, expect } from '../../framework/fixtures/index.js';
import { USERS } from '../../framework/pages/login-page.js';

test.describe('order management access control', () => {
  test('a valid operator reaches the catalogue', async ({ loginPage, catalogPage, page }) => {
    await loginPage.open();
    await loginPage.signInAs(USERS.standard);
    await catalogPage.expectLoaded();
    await expect(page).toHaveURL(/inventory/);
  });

  test('a wrong password is refused without revealing which field was wrong', async ({ loginPage }) => {
    await loginPage.open();
    await loginPage.signInAs(USERS.wrongPassword);

    const message = await loginPage.errorMessage();
    expect(message).toContain('do not match');
    // Asserting the absence of user enumeration: the message must not confirm the account exists.
    expect(message).not.toMatch(/password is incorrect|no such user/i);
  });

  test('a locked-out operator is refused', async ({ loginPage }) => {
    await loginPage.open();
    await loginPage.signInAs(USERS.lockedOut);
    expect(await loginPage.errorMessage()).toContain('locked out');
  });
});
