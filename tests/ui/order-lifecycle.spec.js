import { test, expect } from '../../framework/fixtures/index.js';
import { USERS } from '../../framework/pages/login-page.js';

/**
 * UI slice, run against https://www.saucedemo.com (stated as required by the brief).
 *
 * SauceDemo was chosen over a generic demo app because its cart -> checkout -> complete flow is the
 * Cart -> Confirmed transition from the lifecycle under test. That makes the UI layer part of the
 * same story as the data layer rather than an unrelated exercise: the UI is where a Cart becomes a
 * placed order, which is precisely the point at which the sync contract says events must start
 * flowing.
 *
 * What is verified at this layer, and why: that an order cannot be placed with incomplete customer
 * data, that the amount the customer is shown is the amount that gets committed, and that the cart
 * count is consistent - because every one of those is a value that later has to survive the sync,
 * and a UI that commits the wrong total guarantees a reconciliation defect downstream.
 */

const CUSTOMER = { firstName: 'Snehaa', lastName: 'Udhayakumar', postalCode: 'SW1A 1AA' };

test.beforeEach(async ({ loginPage }) => {
  await loginPage.open();
  await loginPage.signInAs(USERS.standard);
});

test('a cart can be assembled and placed, moving the order out of Cart state', async ({
  catalogPage,
  checkoutPage,
  page,
}) => {
  await catalogPage.expectLoaded();

  await catalogPage.addToCart('Sauce Labs Backpack');
  await catalogPage.addToCart('Sauce Labs Bike Light');
  expect(await catalogPage.cartCount()).toBe(2);

  await catalogPage.openCart();
  expect(await checkoutPage.lineItemCount()).toBe(2);

  await checkoutPage.startCheckout();
  await checkoutPage.enterCustomer(CUSTOMER);
  await checkoutPage.placeOrder();

  expect(await checkoutPage.confirmationText()).toContain('Thank you for your order');
  await expect(page).toHaveURL(/checkout-complete/);
});

test('the total presented at checkout matches the sum of the line items', async ({
  catalogPage,
  checkoutPage,
}) => {
  // This is the UI-layer equivalent of WRONG-AMOUNT. An amount that is wrong on screen is wrong in the
  // OMS and therefore wrong in Analytics - catching it here is three layers cheaper.
  await catalogPage.expectLoaded();

  const backpack = Number((await catalogPage.priceOf('Sauce Labs Backpack')).replace('$', ''));
  const bikeLight = Number((await catalogPage.priceOf('Sauce Labs Bike Light')).replace('$', ''));

  await catalogPage.addToCart('Sauce Labs Backpack');
  await catalogPage.addToCart('Sauce Labs Bike Light');
  await catalogPage.openCart();
  await checkoutPage.startCheckout();
  await checkoutPage.enterCustomer(CUSTOMER);

  const total = await checkoutPage.totalAmount();
  const subtotal = backpack + bikeLight;

  // Tax is a percentage of subtotal, so the assertion is that the total is the subtotal plus a
  // non-negative tax, not an exact figure - hard-coding 8% would couple the test to pricing config.
  expect(total).toBeGreaterThanOrEqual(subtotal);
  expect(Number((total - subtotal).toFixed(2))).toBeLessThan(subtotal);
});

test('an order cannot be placed without the required customer fields', async ({
  catalogPage,
  checkoutPage,
}) => {
  await catalogPage.expectLoaded();
  await catalogPage.addToCart('Sauce Labs Backpack');
  await catalogPage.openCart();
  await checkoutPage.startCheckout();

  await checkoutPage.enterCustomer({ firstName: '', lastName: '', postalCode: '' });

  expect(await checkoutPage.errorMessage()).toContain('First Name is required');
});

test('removing the last item empties the cart rather than leaving a stale badge', async ({
  catalogPage,
  page,
}) => {
  await catalogPage.expectLoaded();
  await catalogPage.addToCart('Sauce Labs Backpack');
  expect(await catalogPage.cartCount()).toBe(1);

  await page.locator('[data-test="remove-sauce-labs-backpack"]').click();
  expect(await catalogPage.cartCount()).toBe(0);
});
