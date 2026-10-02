const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export class CatalogPage {
  constructor(page) {
    this.page = page;
    this.items = page.locator('.inventory_item');
    this.cartBadge = page.locator('.shopping_cart_badge');
    this.cartLink = page.locator('.shopping_cart_link');
  }

  async expectLoaded() {
    await this.items.first().waitFor({ state: 'visible' });
  }

  async addToCart(productName) {
    await this.page.locator(`[data-test="add-to-cart-${slug(productName)}"]`).click();
  }

  async priceOf(productName) {
    const row = this.items.filter({ hasText: productName }).first();
    const text = await row.locator('.inventory_item_price').textContent();
    return text.trim();
  }

  /**
   * Returns a number rather than a string, and 0 for an absent badge. SauceDemo removes the badge
   * element entirely when the cart is empty, so a test asserting on its text would fail with a
   * timeout rather than reporting "expected 1, got 0".
   */
  async cartCount() {
    if ((await this.cartBadge.count()) === 0) return 0;
    return Number((await this.cartBadge.textContent()).trim());
  }

  async openCart() {
    await this.cartLink.click();
  }
}
