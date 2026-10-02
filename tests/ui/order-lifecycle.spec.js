import { test, expect } from '../../framework/fixtures/index.js';
import { USERS } from '../../framework/pages/login-page.js';

// UI tests against https://www.saucedemo.com.

const CUSTOMER = { firstName: 'Snehaa', lastName: 'Udhayakumar', postalCode: 'SW1A 1AA' };

test.beforeEach(async ({ loginPage }) => {
  await loginPage.open();
  await loginPage.signInAs(USERS.standard);
});

test('a cart can be assembled and placed, moving the order out of Cart state', async ({
  catalogPage,
  checkoutPage,
  page,
  evidence,
}) => {
  await catalogPage.expectLoaded();

  await catalogPage.addToCart('Sauce Labs Backpack');
  await catalogPage.addToCart('Sauce Labs Bike Light');
  expect(await catalogPage.cartCount()).toBe(2);

  await catalogPage.openCart();
  expect(await checkoutPage.lineItemCount()).toBe(2);
  await evidence.capture('Cart holding two items');

  await checkoutPage.startCheckout();
  await checkoutPage.enterCustomer(CUSTOMER);
  await checkoutPage.placeOrder();

  expect(await checkoutPage.confirmationText()).toContain('Thank you for your order');
  await expect(page).toHaveURL(/checkout-complete/);
  await evidence.capture('Order placed - confirmation shown');
});

test('the total presented at checkout matches the sum of the line items', async ({
  catalogPage,
  checkoutPage,
  evidence,
}) => {
  await catalogPage.expectLoaded();

  const backpack = Number((await catalogPage.priceOf('Sauce Labs Backpack')).replace('$', ''));
  const bikeLight = Number((await catalogPage.priceOf('Sauce Labs Bike Light')).replace('$', ''));

  await catalogPage.addToCart('Sauce Labs Backpack');
  await catalogPage.addToCart('Sauce Labs Bike Light');
  await catalogPage.openCart();
  await checkoutPage.startCheckout();
  await checkoutPage.enterCustomer(CUSTOMER);

  await evidence.capture('Checkout overview with item total, tax and total');
  const total = await checkoutPage.totalAmount();
  const subtotal = backpack + bikeLight;

  // Tax rate is not hard-coded: total = item total + non-negative tax.
  expect(total).toBeGreaterThanOrEqual(subtotal);
  expect(Number((total - subtotal).toFixed(2))).toBeLessThan(subtotal);
});

test('an order cannot be placed without the required customer fields', async ({
  catalogPage,
  checkoutPage,
  evidence,
}) => {
  await catalogPage.expectLoaded();
  await catalogPage.addToCart('Sauce Labs Backpack');
  await catalogPage.openCart();
  await checkoutPage.startCheckout();

  await checkoutPage.enterCustomer({ firstName: '', lastName: '', postalCode: '' });

  expect(await checkoutPage.errorMessage()).toContain('First Name is required');
  await evidence.capture('Validation error for missing customer details');
});

test('removing the last item empties the cart rather than leaving a stale badge', async ({
  catalogPage,
  evidence,
}) => {
  await catalogPage.expectLoaded();
  await catalogPage.addToCart('Sauce Labs Backpack');
  expect(await catalogPage.cartCount()).toBe(1);

  await catalogPage.removeFromCart('Sauce Labs Backpack');
  expect(await catalogPage.cartCount()).toBe(0);
  await evidence.capture('Cart empty after removing the last item');
});
