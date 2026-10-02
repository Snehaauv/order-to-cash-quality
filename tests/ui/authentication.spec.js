import { test, expect } from '../../framework/fixtures/index.js';
import { USERS } from '../../framework/pages/login-page.js';

test.describe('order management access control', () => {
  test('a valid operator reaches the catalogue', async ({ loginPage, catalogPage, page, evidence }) => {
    await loginPage.open();
    await loginPage.signInAs(USERS.standard);
    await catalogPage.expectLoaded();
    await expect(page).toHaveURL(/inventory/);
    await evidence.capture('Catalogue shown after a valid login');
  });

  test('a wrong password is refused without revealing which field was wrong', async ({ loginPage, evidence }) => {
    await loginPage.open();
    await loginPage.signInAs(USERS.wrongPassword);

    const message = await loginPage.errorMessage();
    expect(message).toContain('do not match');
    // The message must not reveal whether the account exists.
    expect(message).not.toMatch(/password is incorrect|no such user/i);
    await evidence.capture('Login refused with a generic error');
  });

  test('a locked-out operator is refused', async ({ loginPage, evidence }) => {
    await loginPage.open();
    await loginPage.signInAs(USERS.lockedOut);
    expect(await loginPage.errorMessage()).toContain('locked out');
    await evidence.capture('Locked-out operator refused');
  });
});
