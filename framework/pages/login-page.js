// Locators use SauceDemo data-test attributes.
export class LoginPage {
  constructor(page) {
    this.page = page;
    this.username = page.locator('[data-test="username"]');
    this.password = page.locator('[data-test="password"]');
    this.submit = page.locator('[data-test="login-button"]');
    this.error = page.locator('[data-test="error"]');
  }

  async open() {
    await this.page.goto('/');
    await this.submit.waitFor({ state: 'visible' });
  }

  async signInAs({ username, password }) {
    await this.username.fill(username);
    await this.password.fill(password);
    await this.submit.click();
  }

  errorMessage() {
    return this.error.textContent();
  }
}

export const USERS = {
  standard: { username: 'standard_user', password: 'secret_sauce' },
  lockedOut: { username: 'locked_out_user', password: 'secret_sauce' },
  wrongPassword: { username: 'standard_user', password: 'not_the_password' },
};
