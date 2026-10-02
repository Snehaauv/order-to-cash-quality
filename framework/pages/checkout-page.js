export class CheckoutPage {
  constructor(page) {
    this.page = page;
    this.checkout = page.locator('[data-test="checkout"]');
    this.firstName = page.locator('[data-test="firstName"]');
    this.lastName = page.locator('[data-test="lastName"]');
    this.postalCode = page.locator('[data-test="postalCode"]');
    this.continue = page.locator('[data-test="continue"]');
    this.finish = page.locator('[data-test="finish"]');
    this.error = page.locator('[data-test="error"]');
    this.confirmation = page.locator('.complete-header');
    this.total = page.locator('.summary_total_label');
    this.cartItems = page.locator('.cart_item');
  }

  async startCheckout() {
    await this.checkout.click();
  }

  async enterCustomer({ firstName, lastName, postalCode }) {
    await this.firstName.fill(firstName);
    await this.lastName.fill(lastName);
    await this.postalCode.fill(postalCode);
    await this.continue.click();
  }

  async placeOrder() {
    await this.finish.click();
  }

  confirmationText() {
    return this.confirmation.textContent();
  }

  errorMessage() {
    return this.error.textContent();
  }

  async totalAmount() {
    const text = await this.total.textContent();
    return Number(text.replace(/[^0-9.]/g, ''));
  }

  async lineItemCount() {
    return this.cartItems.count();
  }
}
